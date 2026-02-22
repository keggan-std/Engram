// ============================================================================
// Engram MCP Server — Compaction Service
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { Repositories } from "../repositories/index.js";
import { backupDatabase } from "../database.js";
import { log } from "../logger.js";

/**
 * Handles compaction of old session data — both auto-compact (session start)
 * and manual compact (user-triggered).
 */
export class CompactionService {
    constructor(
        private db: DatabaseType,
        private repos: Repositories,
    ) { }

    /**
     * Auto-compaction: runs at session start if total completed sessions exceed threshold.
     * Returns true if compaction was performed.
     */
    autoCompact(threshold: number): boolean {
        const configThreshold = this.repos.config.getInt("compact_threshold", threshold);
        const autoEnabled = this.repos.config.getBool("auto_compact", true);
        const totalSessions = this.repos.sessions.countCompleted();

        if (totalSessions <= configThreshold || !autoEnabled) {
            return false;
        }

        log.info(`Auto-compacting: ${totalSessions} sessions exceed threshold of ${configThreshold}`);
        try { backupDatabase(); } catch { /* best effort */ }

        const cutoffId = this.repos.sessions.getIdAtOffset(configThreshold);
        if (!cutoffId) return false;

        this.compactBeforeCutoff(cutoffId);
        log.info("Auto-compaction complete.");
        return true;
    }

    /**
     * Manual compaction with dry-run support.
     */
    manualCompact(
        keepSessions: number,
        maxAgeDays?: number,
        dryRun: boolean = true
    ): { sessionsCompacted: number; changesSummarized: number; backupPath?: string } {
        const cutoffId = this.repos.sessions.getIdAtOffset(keepSessions);

        if (!cutoffId) {
            return { sessionsCompacted: 0, changesSummarized: 0 };
        }

        const sessionsToCompact = this.countCompactableSessions(cutoffId, maxAgeDays);
        const changesToSummarize = this.repos.changes.countBeforeCutoff(cutoffId);

        if (dryRun) {
            return { sessionsCompacted: sessionsToCompact, changesSummarized: changesToSummarize };
        }

        // Create backup before compacting
        let backupPath: string | undefined;
        try {
            backupPath = backupDatabase();
            log.info(`Auto-backup created before compaction: ${backupPath}`);
        } catch (e) {
            log.warn(`Failed to create backup before compaction: ${e}`);
        }

        this.compactBeforeCutoff(cutoffId);

        // Vacuum to reclaim space
        this.db.exec("VACUUM");

        return { sessionsCompacted: sessionsToCompact, changesSummarized: changesToSummarize, backupPath };
    }

    private compactBeforeCutoff(cutoffId: number): void {
        const now = new Date().toISOString();

        const doCompact = this.db.transaction(() => {
            const sessionIds = this.repos.sessions.getCompletedBeforeId(cutoffId);

            for (const sid of sessionIds) {
                const changes = this.repos.changes.getBySession(sid);
                if (changes.length > 0) {
                    const summary = changes.map(c => `[${c.change_type}] ${c.file_path}`).join("; ");
                    this.repos.changes.insertCompacted(
                        sid, now,
                        `Compacted ${changes.length} changes: ${summary.slice(0, 2000)}`
                    );
                }
                this.repos.changes.deleteNonCompacted(sid);
            }
        });

        doCompact();
    }

    private countCompactableSessions(cutoffId: number, maxAgeDays?: number): number {
        let query = "SELECT COUNT(*) as c FROM sessions WHERE id <= ? AND ended_at IS NOT NULL";
        const params: unknown[] = [cutoffId];

        if (maxAgeDays) {
            const cutoffDate = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
            query += " AND started_at < ?";
            params.push(cutoffDate);
        }

        return (this.db.prepare(query).get(...params) as { c: number }).c;
    }
}
