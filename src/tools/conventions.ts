// ============================================================================
// Engram MCP Server — Convention Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success, error } from "../response.js";
import type { ConventionRow } from "../types.js";

export function registerConventionTools(server: McpServer): void {
    server.registerTool(
        `${TOOL_PREFIX}_add_convention`,
        {
            title: "Add Convention",
            description: `Record a project convention that the agent should always follow. Conventions are surfaced during start_session and serve as persistent rules.

Args:
  - category: "naming" | "architecture" | "styling" | "testing" | "git" | "documentation" | "error_handling" | "performance" | "security" | "other"
  - rule (string): The convention rule in clear, actionable language
  - examples (array of strings, optional): Code or usage examples

Returns:
  Convention ID and confirmation.`,
            inputSchema: {
                category: z.enum(["naming", "architecture", "styling", "testing", "git", "documentation", "error_handling", "performance", "security", "other"]),
                rule: z.string().min(5).describe("The convention rule"),
                examples: z.array(z.string()).optional().describe("Examples of the convention in use"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ category, rule, examples }) => {
            const db = getDb();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const result = db.prepare(
                "INSERT INTO conventions (session_id, timestamp, category, rule, examples) VALUES (?, ?, ?, ?, ?)"
            ).run(sessionId, timestamp, category, rule, examples ? JSON.stringify(examples) : null);

            return success({
                convention_id: Number(result.lastInsertRowid),
                message: `Convention #${result.lastInsertRowid} added to [${category}].`,
                rule,
            });
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_get_conventions`,
        {
            title: "Get Conventions",
            description: `Retrieve all active project conventions. Optionally filter by category.

Args:
  - category (string, optional): Filter by convention category
  - include_disabled (boolean, optional): Include unenforced conventions (default: false)

Returns:
  Array of conventions grouped by category.`,
            inputSchema: {
                category: z.enum(["naming", "architecture", "styling", "testing", "git", "documentation", "error_handling", "performance", "security", "other"]).optional(),
                include_disabled: z.boolean().default(false),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ category, include_disabled }) => {
            const db = getDb();
            let query = "SELECT * FROM conventions WHERE 1=1";
            const params: unknown[] = [];

            if (!include_disabled) { query += " AND enforced = 1"; }
            if (category) { query += " AND category = ?"; params.push(category); }
            query += " ORDER BY category, id";

            const conventions = db.prepare(query).all(...params) as unknown[] as ConventionRow[];

            const grouped: Record<string, ConventionRow[]> = {};
            for (const c of conventions) {
                if (!grouped[c.category]) grouped[c.category] = [];
                grouped[c.category].push(c);
            }

            return success({ total: conventions.length, by_category: grouped });
        }
    );

    server.registerTool(
        `${TOOL_PREFIX}_toggle_convention`,
        {
            title: "Toggle Convention",
            description: `Enable or disable a convention. Disabled conventions are not surfaced during start_session.

Args:
  - id (number): Convention ID
  - enforced (boolean): Whether the convention should be enforced

Returns:
  Confirmation.`,
            inputSchema: {
                id: z.number().int().describe("Convention ID"),
                enforced: z.boolean().describe("Enable or disable"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ id, enforced }) => {
            const db = getDb();
            const result = db.prepare("UPDATE conventions SET enforced = ? WHERE id = ?").run(enforced ? 1 : 0, id);
            if (result.changes === 0) {
                return error(`Convention #${id} not found.`);
            }
            return success({ message: `Convention #${id} ${enforced ? "enabled" : "disabled"}.` });
        }
    );
}
