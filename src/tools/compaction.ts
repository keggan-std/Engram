// ============================================================================
// Engram MCP Server — Compaction & Clear Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getDbSizeKb, backupDatabase } from "../database.js";
import { TOOL_PREFIX, COMPACTION_THRESHOLD_SESSIONS } from "../constants.js";
import { log } from "../logger.js";
import type { CompactionResult } from "../types.js";

export function registerCompactionTools(server: McpServer): void {
    // ─── COMPACT MEMORY ─────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_compact`,
        {
            title: "Compact Memory",
            description: `Compact old session data to reduce database size. Merges change records from old sessions into summaries and removes granular entries. Sessions newer than the threshold are preserved in full. Automatically creates a backup before compacting.

Args:
  - keep_sessions (number, optional): Number of recent sessions to keep in full detail (default: ${COMPACTION_THRESHOLD_SESSIONS})
  - max_age_days (number, optional): Also remove sessions older than N days (default: no age limit)
  - dry_run (boolean, optional): Show what would be compacted without actually doing it (default: true)

Returns:
  CompactionResult with counts and freed storage.`,
            inputSchema: {
                keep_sessions: z.number().int().min(5).default(COMPACTION_THRESHOLD_SESSIONS).describe("Recent sessions to preserve"),
                max_age_days: z.number().int().min(7).optional().describe("Remove sessions older than N days"),
                dry_run: z.boolean().default(true).describe("Preview mode — no changes made"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ keep_sessions, max_age_days, dry_run }) => {
            const db = getDb();

            const cutoff = db.prepare(
                "SELECT id FROM sessions ORDER BY id DESC LIMIT 1 OFFSET ?"
            ).get(keep_sessions) as { id: number } | undefined;

            if (!cutoff) {
                return {
                    content: [{ type: "text", text: "Not enough sessions to compact. Nothing to do." }],
                };
            }

            let sessionsQuery = "SELECT COUNT(*) as c FROM sessions WHERE id <= ? AND ended_at IS NOT NULL";
            const sessionsParams: unknown[] = [cutoff.id];

            if (max_age_days) {
                const cutoffDate = new Date(Date.now() - max_age_days * 86400000).toISOString();
                sessionsQuery += " AND started_at < ?";
                sessionsParams.push(cutoffDate);
            }

            const sessionsToCompact = (db.prepare(sessionsQuery).get(...sessionsParams) as { c: number }).c;

            const changesToSummarize = (db.prepare(
                "SELECT COUNT(*) as c FROM changes WHERE session_id <= ?"
            ).get(cutoff.id) as { c: number }).c;

            const sizeBefore = getDbSizeKb();

            if (dry_run) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            dry_run: true,
                            would_compact: { sessions: sessionsToCompact, changes: changesToSummarize },
                            message: `Would compact ${sessionsToCompact} sessions and summarize ${changesToSummarize} change records. Run with dry_run=false to execute.`,
                        }, null, 2),
                    }],
                };
            }

            let backupPath = "";
            try {
                backupPath = backupDatabase();
                log.info(`Auto-backup created before compaction: ${backupPath}`);
            } catch (e) {
                log.warn(`Failed to create backup before compaction: ${e}`);
            }

            const compact = db.transaction(() => {
                const oldSessions = db.prepare(
                    "SELECT id, summary FROM sessions WHERE id <= ? AND ended_at IS NOT NULL"
                ).all(cutoff.id) as Array<{ id: number; summary: string | null }>;

                for (const session of oldSessions) {
                    const changes = db.prepare(
                        "SELECT change_type, file_path, description FROM changes WHERE session_id = ?"
                    ).all(session.id) as Array<{ change_type: string; file_path: string; description: string }>;

                    if (changes.length > 0) {
                        const summaryDesc = changes.map(c => `[${c.change_type}] ${c.file_path}: ${c.description}`).join("; ");
                        db.prepare(
                            "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, impact_scope) VALUES (?, ?, ?, ?, ?, ?)"
                        ).run(session.id, now(), "(compacted)", "modified", `Compacted ${changes.length} changes: ${summaryDesc.slice(0, 2000)}`, "global");
                    }

                    db.prepare("DELETE FROM changes WHERE session_id = ? AND file_path != '(compacted)'").run(session.id);
                }
            });

            compact();
            db.exec("VACUUM");

            const sizeAfter = getDbSizeKb();

            const result: CompactionResult = {
                sessions_compacted: sessionsToCompact,
                changes_summarized: changesToSummarize,
                storage_freed_kb: Math.max(0, sizeBefore - sizeAfter),
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        ...result,
                        backup_path: backupPath || null,
                        message: `Compaction complete. ${backupPath ? `Backup saved at ${backupPath}.` : ""}`,
                    }, null, 2),
                }],
            };
        }
    );

    // ─── CLEAR MEMORY ───────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_clear`,
        {
            title: "Clear Memory",
            description: `Clear specific tables or the entire memory database. USE WITH EXTREME CAUTION. This is irreversible. A backup is automatically created before clearing.

Args:
  - scope: "all" | "sessions" | "changes" | "decisions" | "file_notes" | "conventions" | "tasks" | "milestones" | "cache"
  - confirm (string): Must be "yes-delete-permanently" to execute

Returns:
  Confirmation of what was cleared.`,
            inputSchema: {
                scope: z.enum(["all", "sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "cache"]),
                confirm: z.string().describe('Type "yes-delete-permanently" to confirm'),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ scope, confirm }) => {
            if (confirm !== "yes-delete-permanently") {
                return {
                    isError: true,
                    content: [{ type: "text", text: 'Safety check: set confirm to "yes-delete-permanently" to proceed.' }],
                };
            }

            let backupPath = "";
            try {
                backupPath = backupDatabase();
                log.info(`Auto-backup created before clear: ${backupPath}`);
            } catch (e) {
                log.warn(`Failed to create backup before clear: ${e}`);
            }

            const db = getDb();
            const tables = scope === "all"
                ? ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "snapshot_cache"]
                : scope === "cache" ? ["snapshot_cache"] : [scope];

            for (const table of tables) {
                db.prepare(`DELETE FROM ${table}`).run();
            }

            return {
                content: [{
                    type: "text",
                    text: `Cleared: ${tables.join(", ")}. Memory has been reset.${backupPath ? ` Backup saved at ${backupPath}.` : ""}`,
                }],
            };
        }
    );
}
