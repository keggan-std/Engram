// ============================================================================
// Engram MCP Server — Change Tracking Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import type { ChangeRow, DecisionRow, FileNoteRow } from "../types.js";

export function registerChangeTools(server: McpServer): void {
    server.registerTool(
        `${TOOL_PREFIX}_record_change`,
        {
            title: "Record Change",
            description: `Record a file change so future sessions know what happened and why. Call this after making significant modifications. Bulk recording is supported — pass multiple changes at once.

Args:
  - changes (array): Array of change objects, each with:
    - file_path (string): Relative path to the changed file
    - change_type: "created" | "modified" | "deleted" | "refactored" | "renamed" | "moved" | "config_changed"
    - description (string): What was changed and why
    - diff_summary (string, optional): Brief summary of the diff
    - impact_scope: "local" | "module" | "cross_module" | "global" (default: "local")

Returns:
  Confirmation with number of changes recorded.`,
            inputSchema: {
                changes: z.array(z.object({
                    file_path: z.string().describe("Relative path to the changed file"),
                    change_type: z.enum(["created", "modified", "deleted", "refactored", "renamed", "moved", "config_changed"]),
                    description: z.string().describe("What was changed and why"),
                    diff_summary: z.string().optional().describe("Brief diff summary"),
                    impact_scope: z.enum(["local", "module", "cross_module", "global"]).default("local"),
                })).min(1).describe("Array of changes to record"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ changes }) => {
            const db = getDb();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const insert = db.prepare(
                "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope) VALUES (?, ?, ?, ?, ?, ?, ?)"
            );

            const transaction = db.transaction(() => {
                for (const c of changes) {
                    insert.run(sessionId, timestamp, c.file_path, c.change_type, c.description, c.diff_summary || null, c.impact_scope);

                    if (sessionId) {
                        db.prepare(
                            "UPDATE file_notes SET last_modified_session = ? WHERE file_path = ?"
                        ).run(sessionId, c.file_path);
                    }
                }
            });

            transaction();

            return {
                content: [{
                    type: "text",
                    text: `Recorded ${changes.length} change(s) in session #${sessionId ?? "none"}.`,
                }],
            };
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_get_file_history`,
        {
            title: "Get File History",
            description: `Get the complete change history for a specific file — all recorded modifications, related decisions, and file notes.

Args:
  - file_path (string): Path to the file
  - limit (number, optional): Max changes to return (default 20)

Returns:
  File notes, change history, and related decisions.`,
            inputSchema: {
                file_path: z.string().describe("Relative path to the file"),
                limit: z.number().int().min(1).max(100).default(20).describe("Max changes to return"),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ file_path, limit }) => {
            const db = getDb();

            const notes = db.prepare("SELECT * FROM file_notes WHERE file_path = ?").get(file_path) as unknown as FileNoteRow | undefined;
            const changes = db.prepare(
                "SELECT * FROM changes WHERE file_path = ? ORDER BY timestamp DESC LIMIT ?"
            ).all(file_path, limit) as unknown[] as ChangeRow[];
            const decisions = db.prepare(
                "SELECT * FROM decisions WHERE affected_files LIKE ? AND status = 'active' ORDER BY timestamp DESC"
            ).all(`%${file_path}%`) as unknown[] as DecisionRow[];

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        file_path,
                        notes: notes || null,
                        change_count: changes.length,
                        changes,
                        related_decisions: decisions,
                    }, null, 2),
                }],
            };
        }
    );
}
