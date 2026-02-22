// ============================================================================
// Engram MCP Server — Architectural Decision Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import type { DecisionRow } from "../types.js";

export function registerDecisionTools(server: McpServer): void {
    server.registerTool(
        `${TOOL_PREFIX}_record_decision`,
        {
            title: "Record Decision",
            description: `Record an architectural or design decision with its rationale. These persist across all future sessions and are surfaced during start_session. Use this for any choice that future agents or sessions need to respect.

Args:
  - decision (string): The decision that was made
  - rationale (string, optional): Why this decision was made — context, tradeoffs, alternatives considered
  - affected_files (array of strings, optional): Files impacted by this decision
  - tags (array of strings, optional): Categorization tags (e.g., "architecture", "database", "ui", "api")
  - status: "active" | "experimental" (default: "active")
  - supersedes (number, optional): ID of a previous decision this replaces

Returns:
  Decision ID and confirmation.`,
            inputSchema: {
                decision: z.string().min(5).describe("The decision that was made"),
                rationale: z.string().optional().describe("Why — context, tradeoffs, alternatives considered"),
                affected_files: z.array(z.string()).optional().describe("Files impacted by this decision"),
                tags: z.array(z.string()).optional().describe("Tags for categorization"),
                status: z.enum(["active", "experimental"]).default("active"),
                supersedes: z.number().int().optional().describe("ID of a previous decision this replaces"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ decision, rationale, affected_files, tags, status, supersedes }) => {
            const db = getDb();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const result = db.prepare(
                "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(
                sessionId, timestamp, decision,
                rationale || null,
                affected_files ? JSON.stringify(affected_files) : null,
                tags ? JSON.stringify(tags) : null,
                status,
                supersedes || null
            );

            const newDecisionId = result.lastInsertRowid as number;

            if (supersedes) {
                db.prepare("UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ?")
                    .run(newDecisionId, supersedes);
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        decision_id: newDecisionId,
                        message: `Decision #${newDecisionId} recorded${supersedes ? ` (supersedes #${supersedes})` : ""}.`,
                        decision,
                    }, null, 2),
                }],
            };
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_get_decisions`,
        {
            title: "Get Decisions",
            description: `Retrieve recorded architectural decisions. Filter by status, tags, or affected files.

Args:
  - status (string, optional): Filter by status — "active", "superseded", "deprecated", "experimental"
  - tag (string, optional): Filter by tag
  - file_path (string, optional): Find decisions affecting a specific file
  - limit (number, optional): Max results (default 20)

Returns:
  Array of decisions with rationale and metadata.`,
            inputSchema: {
                status: z.enum(["active", "superseded", "deprecated", "experimental"]).optional(),
                tag: z.string().optional().describe("Filter by tag"),
                file_path: z.string().optional().describe("Find decisions affecting this file"),
                limit: z.number().int().min(1).max(100).default(20),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ status, tag, file_path, limit }) => {
            const db = getDb();
            let query = "SELECT * FROM decisions WHERE 1=1";
            const params: unknown[] = [];

            if (status) { query += " AND status = ?"; params.push(status); }
            if (tag) { query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; params.push(tag); }
            if (file_path) { query += " AND EXISTS (SELECT 1 FROM json_each(affected_files) WHERE value = ?)"; params.push(file_path); }

            query += " ORDER BY timestamp DESC LIMIT ?";
            params.push(limit);

            const decisions = db.prepare(query).all(...params) as unknown[] as DecisionRow[];

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ count: decisions.length, decisions }, null, 2),
                }],
            };
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_update_decision`,
        {
            title: "Update Decision Status",
            description: `Update the status of an existing decision. Use to deprecate, supersede, or reactivate decisions.

Args:
  - id (number): Decision ID to update
  - status: "active" | "superseded" | "deprecated" | "experimental"

Returns:
  Confirmation.`,
            inputSchema: {
                id: z.number().int().describe("Decision ID"),
                status: z.enum(["active", "superseded", "deprecated", "experimental"]),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ id, status }) => {
            const db = getDb();
            const result = db.prepare("UPDATE decisions SET status = ? WHERE id = ?").run(status, id);
            if (result.changes === 0) {
                return { isError: true, content: [{ type: "text", text: `Decision #${id} not found.` }] };
            }
            return { content: [{ type: "text", text: `Decision #${id} status updated to "${status}".` }] };
        }
    );
}
