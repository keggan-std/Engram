// ============================================================================
// Engram MCP Server — Change Tracking Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos, getDb } from "../database.js";
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
                })).min(1, 'Pass a "changes" array: [{ file_path, change_type, description, impact_scope? }]. Do not pass fields at the top level.').describe("Array of changes to record"),
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

            // F2: auto-close any pending_work records that cover these files
            const changedPaths = normalized.map(c => c.file_path);
            try {
                const db = getDb();
                const pending = db.prepare(
                    "SELECT id, files FROM pending_work WHERE status = 'pending'"
                ).all() as { id: number; files: string }[];

                for (const pw of pending) {
                    const pwFiles: string[] = JSON.parse(pw.files);
                    const overlap = pwFiles.some(f => changedPaths.includes(normalizePath(f)));
                    if (overlap) {
                        db.prepare(
                            "UPDATE pending_work SET status = 'completed' WHERE id = ?"
                        ).run(pw.id);
                    }
                }
            } catch { /* best effort — pending_work table may not exist yet */ }

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

    // ─── BEGIN WORK ──────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_begin_work`,
        {
            title: "Begin Work",
            description: `Record intent to modify files BEFORE you start editing. Creates a pending_work record that is automatically closed when engram_record_change is called for the same files. If a session ends without the change being recorded, the record shows as "abandoned" — a warning for the next session to investigate incomplete work.

Args:
  - description (string): What you are about to do (e.g. "Add context_chars enrichment block to search handler")
  - files (array): Files you intend to edit
  - agent_id (string, optional): Your agent identifier

Returns:
  work_id — pass this to engram_record_change if you want to explicitly close it.`,
            inputSchema: {
                description: z.string().min(5).describe("What you are about to do"),
                files: z.array(z.string()).min(1).describe("Files you intend to edit"),
                agent_id: z.string().default("unknown").describe("Your agent identifier"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ description, files, agent_id }) => {
            const sessionId = getCurrentSessionId();
            const normalizedFiles = files.map(f => normalizePath(f));

            try {
                const db = getDb();
                const result = db.prepare(
                    `INSERT INTO pending_work (agent_id, session_id, description, files, started_at, status)
                     VALUES (?, ?, ?, ?, ?, 'pending')`
                ).run(agent_id, sessionId ?? null, description, JSON.stringify(normalizedFiles), Date.now());

                return success({
                    work_id: result.lastInsertRowid,
                    message: `Pending work #${result.lastInsertRowid} recorded. Edit your files, then call engram_record_change — it will auto-close this record.`,
                    files: normalizedFiles,
                });
            } catch (e) {
                return success({ message: `Failed to record pending work: ${e}` });
            }
        }
    );
}
