// ============================================================================
// Engram MCP Server — Global Knowledge Tools
// ============================================================================
//
// Tools for cross-project knowledge sharing via ~/.engram/global.db
//
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_PREFIX } from "../constants.js";
import { success, error } from "../response.js";
import { queryGlobalDecisions, queryGlobalConventions } from "../global-db.js";
import { truncate } from "../utils.js";

export function registerKnowledgeTools(server: McpServer): void {

    // ─── GET GLOBAL KNOWLEDGE ─────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_get_global_knowledge`,
        {
            title: "Get Global Knowledge",
            description: `Retrieve cross-project knowledge from the shared global knowledge base (~/.engram/global.db). Shows architectural decisions and conventions that were exported from any project on this machine.

Useful when starting a new project — you can pull in battle-tested decisions and conventions from other projects automatically.

To add knowledge to the global store, use engram_record_decision with export_global: true, or engram_add_convention with export_global: true.

Args:
  - query (string, optional): Search term(s) to filter relevant knowledge (uses FTS5)
  - limit (number, optional): Max decisions to return (default: 20)

Returns:
  Global decisions and conventions from all projects on this machine.`,
            inputSchema: {
                query: z.string().optional().describe("Search filter for relevant knowledge (FTS5)"),
                limit: z.number().int().min(1).max(100).default(20),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ query, limit }) => {
            const decisions = queryGlobalDecisions(query, limit);
            const conventions = queryGlobalConventions(50);

            if (decisions.length === 0 && conventions.length === 0) {
                return success({
                    message: "Global knowledge base is empty. Use export_global: true when recording decisions or conventions to populate it.",
                    decisions: [],
                    conventions: [],
                    total: 0,
                });
            }

            return success({
                query: query ?? null,
                total: decisions.length + conventions.length,
                decisions: decisions.map(d => ({
                    id: d.id,
                    project_root: d.project_root,
                    decision: truncate(d.decision, 200),
                    rationale: d.rationale ? truncate(d.rationale, 200) : null,
                    tags: d.tags,
                    timestamp: d.timestamp,
                })),
                conventions: conventions.map(c => ({
                    id: c.id,
                    project_root: c.project_root,
                    category: c.category,
                    rule: truncate(c.rule, 200),
                    timestamp: c.timestamp,
                })),
                note: "Knowledge sourced from ~/.engram/global.db — shared across all projects on this machine.",
            });
        }
    );
}
