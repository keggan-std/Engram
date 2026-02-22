// ============================================================================
// Engram MCP Server — Change Tracking Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { normalizePath } from "../utils.js";
import { success } from "../response.js";

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
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const normalized = changes.map(c => ({
                ...c,
                file_path: normalizePath(c.file_path),
            }));

            repos.changes.recordBulk(normalized, sessionId, timestamp);

            return success({
                message: `Recorded ${changes.length} change(s) in session #${sessionId ?? "none"}.`,
                count: changes.length,
            });
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
            const repos = getRepos();
            const fp = normalizePath(file_path);

            const notes = repos.fileNotes.getByPath(fp);
            const changes = repos.changes.getByFile(fp, limit);
            const decisions = repos.decisions.getByFile(fp);

            return success({
                file_path: fp,
                notes: notes || null,
                change_count: changes.length,
                changes,
                related_decisions: decisions,
            });
        }
    );
}
