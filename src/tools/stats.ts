// ============================================================================
// Engram MCP Server — Stats, Config & Health Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, getDbSizeKb, getRepos, now, getCurrentSessionId } from "../database.js";
import {
    TOOL_PREFIX,
    DB_VERSION,
    SERVER_VERSION,
    GITHUB_RELEASES_URL,
    CFG_AUTO_UPDATE_CHECK,
    CFG_AUTO_UPDATE_LAST_CHECK,
    CFG_AUTO_UPDATE_AVAILABLE,
    CFG_AUTO_UPDATE_SKIP_VERSION,
    CFG_AUTO_UPDATE_REMIND_AFTER,
    CFG_AUTO_UPDATE_NOTIFY_LEVEL,
} from "../constants.js";
import { success, error } from "../response.js";

const KNOWN_CONFIG_KEYS = new Set([
    "auto_compact",
    "compact_threshold",
    "retention_days",
    "max_backups",
    CFG_AUTO_UPDATE_CHECK,
    CFG_AUTO_UPDATE_SKIP_VERSION,
    CFG_AUTO_UPDATE_REMIND_AFTER,
    CFG_AUTO_UPDATE_NOTIFY_LEVEL,
]);

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

            const repos = getRepos();
            const updateAvailable = repos.config.get(CFG_AUTO_UPDATE_AVAILABLE) || null;
            const lastCheck = repos.config.get(CFG_AUTO_UPDATE_LAST_CHECK) || null;
            const autoUpdateEnabled = repos.config.getBool(CFG_AUTO_UPDATE_CHECK, true);

            const durationStats = repos.sessions.getDurationStats();

            // Q3: Per-agent contribution metrics
            const agentMetrics = db.prepare(`
              SELECT
                s.agent_name,
                COUNT(DISTINCT s.id)                                          AS sessions,
                (SELECT COUNT(*) FROM changes c WHERE c.session_id IN
                  (SELECT id FROM sessions WHERE agent_name = s.agent_name)) AS changes_recorded,
                (SELECT COUNT(*) FROM decisions d WHERE d.session_id IN
                  (SELECT id FROM sessions WHERE agent_name = s.agent_name)) AS decisions_made,
                MAX(COALESCE(s.ended_at, s.started_at))                       AS last_active
              FROM sessions s
              GROUP BY s.agent_name
              ORDER BY sessions DESC
            `).all() as Array<{ agent_name: string; sessions: number; changes_recorded: number; decisions_made: number; last_active: string }>;

            return success({
                server_version: SERVER_VERSION,
                update_status: updateAvailable
                    ? { available: true, version: updateAvailable, releases_url: GITHUB_RELEASES_URL }
                    : { available: false },
                auto_update_check: autoUpdateEnabled ? "enabled" : "disabled",
                last_update_check: lastCheck,
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
                avg_session_duration_minutes: durationStats.avg_minutes,
                longest_session_minutes: durationStats.max_minutes,
                sessions_last_7_days: durationStats.sessions_last_7_days,
                agents: agentMetrics,
            });
        }
    );

    // ─── CONFIG ───────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_config`,
        {
            title: "Config Management",
            description: `Read or update Engram configuration values.

Known keys:
  auto_compact           (true/false)   — enable/disable auto-compaction
  compact_threshold      (number)       — sessions before auto-compact triggers
  retention_days         (number)       — days to retain old session data
  max_backups            (number)       — max number of backup files to keep
  auto_update_check      (true/false)   — enable/disable background update checks (default: true)
  auto_update_skip_version (string)     — skip notifications for this specific version
  auto_update_remind_after (string)     — snooze updates: ISO date or duration like "7d", "2w", "1m"
  auto_update_notify_level (string)     — "major", "minor" (default), or "patch"

Args:
  - action: "get" (read all config) or "set" (update a key)
  - key (string, optional): Config key to update (required for "set")
  - value (string, optional): New value (required for "set"). For auto_update_remind_after, accepts "7d", "2w", "1m", or an ISO date string.

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

            // Parse duration shorthand for auto_update_remind_after (e.g. "7d", "2w", "1m")
            let storedValue = value;
            if (key === CFG_AUTO_UPDATE_REMIND_AFTER && /^\d+[dwm]$/.test(value.trim())) {
                const match = value.trim().match(/^(\d+)([dwm])$/);
                if (match) {
                    const amount = parseInt(match[1]!, 10);
                    const unit = match[2]!;
                    const ms = unit === "d" ? amount * 86_400_000
                        : unit === "w" ? amount * 7 * 86_400_000
                        : amount * 30 * 86_400_000;
                    storedValue = new Date(Date.now() + ms).toISOString();
                }
            }

            repos.config.set(key, storedValue, now());
            return success({
                message: `Config "${key}" updated to "${storedValue}".`,
                key,
                value: storedValue,
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
