// ============================================================================
// Engram MCP Server — Stats Tool
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb, getDbSizeKb } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";

export function registerStatsTools(server: McpServer): void {
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

            const stats = {
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
            };

            return {
                content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
            };
        }
    );
}
