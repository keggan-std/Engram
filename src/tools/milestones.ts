// ============================================================================
// Engram MCP Server — Milestone Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success } from "../response.js";

export function registerMilestoneTools(server: McpServer): void {
    server.registerTool(
        `${TOOL_PREFIX}_record_milestone`,
        {
            title: "Record Milestone",
            description: `Record a major project milestone or achievement. Milestones mark significant points in the project timeline — feature completions, releases, major refactors, etc.

Args:
  - title (string): Milestone title
  - description (string, optional): What was achieved
  - version (string, optional): Version number if applicable
  - tags (array, optional): Tags

Returns:
  Milestone ID and confirmation.`,
            inputSchema: {
                title: z.string().min(3).describe("Milestone title"),
                description: z.string().optional().describe("What was achieved"),
                version: z.string().optional().describe("Version number"),
                tags: z.array(z.string()).optional(),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ title, description, version, tags }) => {
            const db = getDb();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const result = db.prepare(
                "INSERT INTO milestones (session_id, timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(sessionId, timestamp, title, description || null, version || null, tags ? JSON.stringify(tags) : null);

            return success({
                milestone_id: Number(result.lastInsertRowid),
                message: `Milestone #${result.lastInsertRowid} recorded: "${title}"${version ? ` (v${version})` : ""}`,
            });
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_get_milestones`,
        {
            title: "Get Milestones",
            description: `Retrieve project milestones. Shows the project's achievement timeline.

Args:
  - limit (number, optional): Max results (default 20)

Returns:
  Array of milestones in reverse chronological order.`,
            inputSchema: {
                limit: z.number().int().min(1).max(100).default(20),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ limit }) => {
            const db = getDb();
            const milestones = db.prepare("SELECT * FROM milestones ORDER BY timestamp DESC LIMIT ?").all(limit);
            return success({ milestones });
        }
    );
}
