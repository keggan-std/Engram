// ============================================================================
// Engram MCP Server — Stats, Config & Health Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, getDbSizeKb, getRepos, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX, DB_VERSION } from "../constants.js";
import { success, error } from "../response.js";

const KNOWN_CONFIG_KEYS = new Set(["auto_compact", "compact_threshold", "retention_days", "max_backups"]);

export function registerStatsTools(server: McpServer): void {
    // ─── STATS ────────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_stats`,
        {
            title: "Memory Statistics",
            description: `Get a comprehensive overview of everything stored in Engram's memory: session count, changes, decisions, file notes, conventions, tasks, milestones, most-changed files, and database size.

Returns:
  MemoryStats object with counts and insights.`,
            inputSchema: {},
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            const db = getDb();

            const count = (table: string): number =>
                (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

            const oldest = db.prepare("SELECT started_at FROM sessions ORDER BY id ASC LIMIT 1").get() as { started_at: string } | undefined;
            const newest = db.prepare("SELECT started_at FROM sessions ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;

            const mostChanged = db.prepare(`
        SELECT file_path, COUNT(*) as change_count
        FROM changes GROUP BY file_path ORDER BY change_count DESC LIMIT 10
      `).all() as Array<{ file_path: string; change_count: number }>;

            const layerDist = db.prepare(`
        SELECT layer, COUNT(*) as count FROM file_notes WHERE layer IS NOT NULL GROUP BY layer ORDER BY count DESC
      `).all() as Array<{ layer: string; count: number }>;

            const tasksByStatus = db.prepare(`
        SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC
      `).all() as Array<{ status: string; count: number }>;

            let schemaVersion = 0;
            try {
                const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
                schemaVersion = vRow ? parseInt(vRow.value, 10) : 0;
            } catch { /* no schema_meta */ }

            return success({
                total_sessions: count("sessions"),
                total_changes: count("changes"),
                total_decisions: count("decisions"),
                total_file_notes: count("file_notes"),
                total_conventions: count("conventions"),
                total_tasks: count("tasks"),
                total_milestones: count("milestones"),
                oldest_session: oldest?.started_at || null,
                newest_session: newest?.started_at || null,
                most_changed_files: mostChanged,
                database_size_kb: getDbSizeKb(),
                layer_distribution: layerDist,
                tasks_by_status: tasksByStatus,
                schema_version: schemaVersion,
                engine: "better-sqlite3 (WAL mode)",
            });
        }
    );

    // ─── CONFIG ───────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_config`,
        {
            title: "Config Management",
            description: `Read or update Engram configuration values. Known keys: auto_compact (true/false), compact_threshold (number), retention_days (number), max_backups (number).

Args:
  - action: "get" (read all config) or "set" (update a key)
  - key (string, optional): Config key to update (required for "set")
  - value (string, optional): New value (required for "set")

Returns:
  Current config values or confirmation of update.`,
            inputSchema: {
                action: z.enum(["get", "set"]).describe("Read all config or set a key"),
                key: z.string().optional().describe("Config key (for set)"),
                value: z.string().optional().describe("New value (for set)"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ action, key, value }) => {
            const repos = getRepos();

            if (action === "get") {
                const config = repos.config.getAll();
                return success({ config });
            }

            // action === "set"
            if (!key || value === undefined) {
                return error("Both 'key' and 'value' are required for action 'set'.");
            }
            if (!KNOWN_CONFIG_KEYS.has(key)) {
                return error(`Unknown config key: "${key}". Known keys: ${[...KNOWN_CONFIG_KEYS].join(", ")}`);
            }

            repos.config.set(key, value, now());
            return success({
                message: `Config "${key}" updated to "${value}".`,
                key,
                value,
            });
        }
    );

    // ─── HEALTH / DIAGNOSTICS ─────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_health`,
        {
            title: "Health Diagnostics",
            description: `Run health checks on the Engram database: integrity, schema version, FTS availability, WAL mode, table sizes, and config.

Returns:
  Diagnostic report with status for each check.`,
            inputSchema: {},
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            const db = getDb();
            const repos = getRepos();

            // Integrity check
            let integrity = "unknown";
            try {
                const result = db.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
                integrity = result?.quick_check || "ok";
            } catch (e) {
                integrity = `error: ${e}`;
            }

            // Schema version
            let schemaVersion = 0;
            try {
                const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
                schemaVersion = vRow ? parseInt(vRow.value, 10) : 0;
            } catch { /* no schema_meta */ }

            // FTS5 availability
            let ftsAvailable = false;
            try {
                const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fts_sessions'").get();
                ftsAvailable = !!row;
            } catch { /* skip */ }

            // Journal mode
            let journalMode = "unknown";
            try {
                const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
                journalMode = result[0]?.journal_mode || "unknown";
            } catch { /* skip */ }

            // Table row counts
            const tables = ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "scheduled_events"];
            const tableCounts: Record<string, number> = {};
            for (const table of tables) {
                try {
                    tableCounts[table] = (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
                } catch {
                    tableCounts[table] = -1; // table doesn't exist
                }
            }

            // Config values
            const config = repos.config.getAll();

            // Active session
            const activeSessionId = getCurrentSessionId();

            return success({
                integrity,
                schema_version: schemaVersion,
                expected_schema_version: DB_VERSION,
                needs_migration: schemaVersion < DB_VERSION,
                fts5_available: ftsAvailable,
                journal_mode: journalMode,
                database_size_kb: getDbSizeKb(),
                table_row_counts: tableCounts,
                config,
                active_session_id: activeSessionId,
            });
        }
    );
}
