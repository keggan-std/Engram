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

        // FR-D6: the safety backup BLOCKS. This used to be
        //   try { backupPath = backupDatabase(); } catch (e) { log.warn(...); }
        // and then deleted change rows anyway — so a failed backup produced
        // exactly the outcome the backup exists to prevent, and the only trace
        // was a stderr line nobody reads. Third instance of this exact shape:
        // the restore path (FR-D1 T1) and the installer config write (FR-D5 T2)
        // both swallowed a failed backup and destroyed the thing it protected.
        // See docs/foundations/06-observability.md F4.
        let backupPath: string;
        try {
            backupPath = backupDatabase();
            log.info(`Auto-backup created before compaction: ${backupPath}`);
        } catch (e) {
            throw new Error(
                `Refusing to compact: the safety backup failed (${e}). Nothing was changed.`
            );
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
