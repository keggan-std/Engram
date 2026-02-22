// ============================================================================
// Engram MCP Server — Architectural Decision Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success, error } from "../response.js";

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
  Decision ID and confirmation. May include a warning if similar decisions exist.`,
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
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const newDecisionId = repos.decisions.create(
                sessionId, timestamp, decision, rationale, affected_files, tags, status, supersedes
            );

            if (supersedes) {
                repos.decisions.supersede(supersedes, newDecisionId);
            }

            // Check for similar existing decisions (deduplication signal)
            const response: Record<string, unknown> = {
                decision_id: newDecisionId,
                message: `Decision #${newDecisionId} recorded${supersedes ? ` (supersedes #${supersedes})` : ""}.`,
                decision,
            };

            const similar = repos.decisions.findSimilar(decision, 5)
                .filter(d => d.id !== newDecisionId);
            if (similar.length > 0) {
                response.warning = `Found ${similar.length} similar active decision(s). Review for potential duplicates.`;
                response.similar_decisions = similar.map(d => ({
                    id: d.id,
                    decision: d.decision,
                    status: d.status,
                    timestamp: d.timestamp,
                }));
            }

            return success(response);
        }
    );

    // ─── BATCH RECORD DECISIONS ──────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_record_decisions_batch`,
        {
            title: "Record Decisions (Batch)",
            description: `Record multiple architectural decisions in a single atomic call.

Args:
  - decisions (array, 1-50): Array of decision objects, each with:
    - decision (string): The decision that was made
    - rationale (string, optional): Why
    - affected_files (array, optional): Impacted files
    - tags (array, optional): Tags
    - status (string, optional): "active" | "experimental" (default: "active")

Returns:
  Array of decision IDs.`,
            inputSchema: {
                decisions: z.array(z.object({
                    decision: z.string().min(5).describe("The decision"),
                    rationale: z.string().optional(),
                    affected_files: z.array(z.string()).optional(),
                    tags: z.array(z.string()).optional(),
                    status: z.enum(["active", "experimental"]).default("active"),
                })).min(1).max(50).describe("Array of decisions to record"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ decisions }) => {
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            const ids = repos.decisions.createBatch(decisions, sessionId, timestamp);

            return success({
                message: `Recorded ${ids.length} decision(s).`,
                decision_ids: ids,
            });
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
            const repos = getRepos();
            const decisions = repos.decisions.getFiltered({ status, tag, file_path, limit });
            return success({ count: decisions.length, decisions });
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
            const repos = getRepos();
            const changes = repos.decisions.updateStatus(id, status);
            if (changes === 0) {
                return error(`Decision #${id} not found.`);
            }
            return success({ message: `Decision #${id} status updated to "${status}".` });
        }
    );
}
