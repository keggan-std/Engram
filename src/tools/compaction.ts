// ============================================================================
// Engram MCP Server — Compaction & Clear Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getDbSizeKb, backupDatabase, getRepos, getServices } from "../database.js";
import { TOOL_PREFIX, COMPACTION_THRESHOLD_SESSIONS } from "../constants.js";
import { log } from "../logger.js";
import { success, error } from "../response.js";

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
            const services = getServices();
            const sizeBefore = getDbSizeKb();

            const result = services.compaction.manualCompact(keep_sessions, max_age_days, dry_run);

            if (dry_run) {
                return success({
                    dry_run: true,
                    would_compact: { sessions: result.sessionsCompacted, changes: result.changesSummarized },
                    message: `Would compact ${result.sessionsCompacted} sessions and summarize ${result.changesSummarized} change records. Run with dry_run=false to execute.`,
                });
            }

            const sizeAfter = getDbSizeKb();

            return success({
                sessions_compacted: result.sessionsCompacted,
                changes_summarized: result.changesSummarized,
                storage_freed_kb: Math.max(0, sizeBefore - sizeAfter),
                backup_path: result.backupPath || null,
                message: `Compaction complete.${result.backupPath ? ` Backup saved at ${result.backupPath}.` : ""}`,
            });
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
                return error('Safety check: set confirm to "yes-delete-permanently" to proceed.');
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

            return success({
                message: `Cleared: ${tables.join(", ")}. Memory has been reset.${backupPath ? ` Backup saved at ${backupPath}.` : ""}`,
            });
        }
    );
}
