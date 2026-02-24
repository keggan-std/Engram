// ============================================================================
// Engram MCP Server — Agent Coordination Tools
// ============================================================================
//
// Tools in this module:
//   engram_dump          — raw brain dump with auto-classification
//   engram_claim_task    — atomically claim a task for an agent
//   engram_release_task  — release a claimed task back to the pool
//   engram_agent_sync    — heartbeat / status update for an agent
//   engram_get_agents    — list all known agents and their current work
//   engram_broadcast     — send a message to all agents
//
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId, getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { truncate } from "../utils.js";
import { success, error } from "../response.js";

// ─── Dump classification ──────────────────────────────────────────────────────

type DumpType = "decision" | "task" | "convention" | "finding";

interface ClassificationScores {
    decision: number;
    task: number;
    convention: number;
    finding: number;
}

/**
 * Score a raw content string against each memory type using keyword heuristics.
 * Returns scores — higher = more likely that type.
 */
function scoreDump(content: string): ClassificationScores {
    const scores: ClassificationScores = { decision: 0, task: 0, convention: 0, finding: 0 };

    // Decision signals: deliberate choice language
    if (/\b(decided?|decision|chose|choosing|going with|will use|use .+ instead|approach|ADR|design choice|architecture)\b/i.test(content)) scores.decision += 3;
    if (/\b(instead of|rather than|over|versus|vs\.?)\b/i.test(content)) scores.decision += 2;
    if (/\b(because|rationale|reason|tradeoff|trade-off|pros?|cons?)\b/i.test(content)) scores.decision += 1;

    // Task signals: imperative / future work language
    if (/\b(TODO|todo|FIXME|fixme|need to|needs to|should|must fix|implement|create|add|remove|refactor|migrate)\b/.test(content)) scores.task += 3;
    if (/\b(next step|blocked by|blocking|pending|backlog|ticket|issue)\b/i.test(content)) scores.task += 2;
    if (/\b(will|plan to|going to|scheduled)\b/i.test(content)) scores.task += 1;

    // Convention signals: universal / always-applies language
    if (/\b(always|never|every|all files?|in every|convention|rule|standard|style|naming)\b/i.test(content)) scores.convention += 3;
    if (/\b(must be|should be|is required|is mandatory|enforce)\b/i.test(content)) scores.convention += 2;
    if (/\b(pattern|template|boilerplate|consistent)\b/i.test(content)) scores.convention += 1;

    // Finding signals: factual observation / file mentions
    if (/\b\w+\.(ts|js|tsx|jsx|py|go|rs|java|kt|vue|svelte|json|yaml|yml)\b/.test(content)) scores.finding += 3;
    if (/\b(found|discovered|noticed|observed|turns out|note:|finding:)\b/i.test(content)) scores.finding += 2;
    if (/\b(line \d+|file |function |class |method )\b/i.test(content)) scores.finding += 1;

    return scores;
}

function pickType(scores: ClassificationScores, hint?: string): DumpType {
    if (hint && ["decision", "task", "convention", "finding"].includes(hint)) {
        return hint as DumpType;
    }
    const entries = Object.entries(scores) as Array<[DumpType, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    // Require at least score 1; otherwise default to "finding"
    return entries[0][1] > 0 ? entries[0][0] : "finding";
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerCoordinationTools(server: McpServer): void {

    // ─── DUMP ────────────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_dump`,
        {
            title: "Dump",
            description: `Raw brain dump — paste research findings, observations, or notes and Engram will classify and store them automatically.

Engram scores the content against four types and picks the best fit:
  - decision    → stored as an architectural decision
  - task        → stored as a work item (backlog)
  - convention  → stored as a project convention
  - finding     → stored as a change record (file observation / research note)

Use the hint param to guide classification when the content is ambiguous.
IMPORTANT: Always check the returned extracted_items[] to verify what was stored — auto-classification can be wrong.

Args:
  - content (string): Raw text to classify and store
  - hint ("decision" | "task" | "convention" | "finding" | "auto", optional): Type hint
  - tags (array, optional): Tags to apply regardless of type

Returns:
  extracted_items[] showing exactly what was stored and where. Review and correct if needed.`,
            inputSchema: {
                content: z.string().min(5).describe("Raw text to classify and store"),
                hint: z.enum(["decision", "task", "convention", "finding", "auto"])
                    .default("auto")
                    .describe("Classification hint — 'auto' lets Engram decide"),
                tags: z.array(z.string()).optional().describe("Tags to apply to the stored item"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ content, hint, tags }) => {
            const repos = getRepos();
            const timestamp = now();
            const sessionId = getCurrentSessionId();
            const scores = scoreDump(content);
            const classified = pickType(scores, hint === "auto" ? undefined : hint);
            const extractedItems: Array<{ type: DumpType; id: number; summary: string }> = [];

            try {
                switch (classified) {
                    case "decision": {
                        const id = repos.decisions.create(
                            sessionId, timestamp,
                            truncate(content, 500),
                            undefined, undefined,
                            tags ?? null,
                            "active"
                        );
                        extractedItems.push({ type: "decision", id, summary: truncate(content, 120) });
                        break;
                    }
                    case "task": {
                        const id = repos.tasks.create(sessionId, timestamp, {
                            title: truncate(content, 100),
                            description: content.length > 100 ? content : undefined,
                            priority: "medium",
                            status: "backlog",
                            tags: tags ?? null,
                        });
                        extractedItems.push({ type: "task", id, summary: truncate(content, 120) });
                        break;
                    }
                    case "convention": {
                        const id = repos.conventions.create(
                            sessionId, timestamp,
                            "other",
                            truncate(content, 300)
                        );
                        extractedItems.push({ type: "convention", id, summary: truncate(content, 120) });
                        break;
                    }
                    case "finding":
                    default: {
                        // Store as a change record — file_path uses "dump" label, type "modified"
                        repos.changes.recordBulk([{
                            file_path: "dump",
                            change_type: "modified",
                            description: truncate(content, 500),
                            impact_scope: "local",
                        }], sessionId, timestamp);
                        // Get the last inserted id for the response
                        const lastId = (getDb().prepare(
                            "SELECT id FROM changes WHERE file_path = 'dump' AND session_id = ? ORDER BY id DESC LIMIT 1"
                        ).get(sessionId) as { id: number } | undefined)?.id ?? 0;
                        extractedItems.push({ type: "finding", id: lastId, summary: truncate(content, 120) });
                        break;
                    }
                }
            } catch (e) {
                return error(`Failed to store dump: ${e}`);
            }

            const confidence = Math.max(...Object.values(scores));
            const confidenceLabel = confidence >= 4 ? "high" : confidence >= 2 ? "medium" : "low";

            return success({
                extracted_items: extractedItems,
                classification: {
                    type: classified,
                    confidence: confidenceLabel,
                    scores,
                    hint_used: hint !== "auto" && hint !== undefined,
                },
                message: `Classified as "${classified}" (${confidenceLabel} confidence) and stored. Review extracted_items[] to verify — call the appropriate tool to correct if wrong.`,
            });
        }
    );

    // ─── CLAIM TASK ──────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_claim_task`,
        {
            title: "Claim Task",
            description: `Atomically claim a task for this agent. Prevents two parallel agents from picking up the same work. Returns an error if another agent already holds the claim.

Args:
  - task_id (number): ID of the task to claim
  - agent_id (string): This agent's unique identifier (e.g. "claude-code-1", "subagent-auth")

Returns:
  The claimed task, or an error if already claimed by another agent.`,
            inputSchema: {
                task_id: z.number().int().describe("Task ID to claim"),
                agent_id: z.string().min(1).describe("Unique agent identifier"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ task_id, agent_id }) => {
            const db = getDb();
            const timestamp = now();
            const claimedAtMs = Date.now();

            // Atomic claim: only succeeds if claimed_by is NULL (unclaimed)
            const result = db.prepare(`
                UPDATE tasks
                SET claimed_by = ?, claimed_at = ?, updated_at = ?
                WHERE id = ? AND claimed_by IS NULL AND status NOT IN ('done', 'cancelled')
            `).run(agent_id, claimedAtMs, timestamp, task_id);

            if (result.changes === 0) {
                // Check if the task exists and why it failed
                const task = db.prepare("SELECT id, title, status, claimed_by FROM tasks WHERE id = ?").get(task_id) as
                    { id: number; title: string; status: string; claimed_by: string | null } | undefined;

                if (!task) return error(`Task #${task_id} not found.`);
                if (task.status === "done" || task.status === "cancelled") {
                    return error(`Task #${task_id} is already ${task.status} — cannot claim.`);
                }
                if (task.claimed_by) {
                    return error(`Task #${task_id} is already claimed by agent "${task.claimed_by}". Use engram_release_task to release it first.`);
                }
                return error(`Task #${task_id} could not be claimed (unknown reason).`);
            }

            const claimed = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id) as Record<string, unknown>;
            return success({
                message: `Task #${task_id} claimed by "${agent_id}".`,
                task: claimed,
            });
        }
    );

    // ─── RELEASE TASK ────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_release_task`,
        {
            title: "Release Task",
            description: `Release a claimed task back to the pool so another agent can pick it up. Only the agent that claimed the task can release it (or use force: true for admin override).

Args:
  - task_id (number): Task ID to release
  - agent_id (string): The agent releasing the task (must match the claimer)
  - force (boolean, optional): Override ownership check (default: false)

Returns:
  Confirmation.`,
            inputSchema: {
                task_id: z.number().int().describe("Task ID to release"),
                agent_id: z.string().min(1).describe("Agent releasing the task"),
                force: z.boolean().default(false).describe("Skip ownership check"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ task_id, agent_id, force }) => {
            const db = getDb();
            const timestamp = now();

            const whereClause = force
                ? "WHERE id = ?"
                : "WHERE id = ? AND claimed_by = ?";
            const params: unknown[] = force ? [timestamp, task_id] : [timestamp, task_id, agent_id];

            const result = db.prepare(
                `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = ? ${whereClause}`
            ).run(...params);

            if (result.changes === 0) {
                const task = db.prepare("SELECT claimed_by FROM tasks WHERE id = ?").get(task_id) as
                    { claimed_by: string | null } | undefined;
                if (!task) return error(`Task #${task_id} not found.`);
                return error(`Cannot release task #${task_id}: it is claimed by "${task.claimed_by ?? "nobody"}", not "${agent_id}". Use force: true to override.`);
            }

            return success({ message: `Task #${task_id} released back to pool.` });
        }
    );

    // ─── AGENT SYNC ──────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_agent_sync`,
        {
            title: "Agent Sync",
            description: `Heartbeat — register this agent and update its current status. Call at the start of each agent run and periodically during long-running work. Agents not seen for 30 minutes are considered stale and their task claims may be released.

Args:
  - agent_id (string): Unique identifier for this agent instance
  - agent_name (string, optional): Human-readable name (e.g. "claude-code", "subagent-auth")
  - status ("idle" | "working" | "done", optional): Current status (default: "idle")
  - current_task_id (number, optional): Task ID this agent is currently working on

Returns:
  Agent record + list of unread broadcasts for this agent.`,
            inputSchema: {
                agent_id: z.string().min(1).describe("Unique agent instance ID"),
                agent_name: z.string().optional().describe("Human-readable agent name"),
                status: z.enum(["idle", "working", "done"]).default("idle"),
                current_task_id: z.number().int().optional(),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ agent_id, agent_name, status, current_task_id }) => {
            const db = getDb();
            const repos = getRepos();
            const nowMs = Date.now();

            // Upsert agent record
            try {
                db.prepare(`
                    INSERT INTO agents (id, name, last_seen, current_task_id, status)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        name = COALESCE(excluded.name, name),
                        last_seen = excluded.last_seen,
                        current_task_id = excluded.current_task_id,
                        status = excluded.status
                `).run(agent_id, agent_name ?? agent_id, nowMs, current_task_id ?? null, status);
            } catch {
                // agents table may not exist yet on older DBs
                return error("Agent coordination tables not yet initialised. Ensure the DB has run all migrations.");
            }

            // Auto-release stale task claims (> 30 min without heartbeat)
            const STALE_TIMEOUT_MS = 30 * 60 * 1000;
            try {
                db.prepare(`
                    UPDATE tasks SET claimed_by = NULL, claimed_at = NULL
                    WHERE claimed_by IN (
                        SELECT id FROM agents WHERE status = 'working' AND last_seen < ?
                    )
                `).run(nowMs - STALE_TIMEOUT_MS);
                db.prepare(
                    "UPDATE agents SET status = 'stale' WHERE status = 'working' AND last_seen < ?"
                ).run(nowMs - STALE_TIMEOUT_MS);
            } catch { /* best-effort */ }

            // Fetch unread broadcasts for this agent
            let broadcasts: unknown[] = [];
            try {
                const allBroadcasts = db.prepare(`
                    SELECT * FROM broadcasts
                    WHERE (expires_at IS NULL OR expires_at > ?)
                      AND NOT EXISTS (
                          SELECT 1 FROM json_each(read_by) WHERE value = ?
                      )
                    ORDER BY created_at DESC LIMIT 10
                `).all(nowMs, agent_id) as Array<{ id: number; from_agent: string; message: string }>;

                broadcasts = allBroadcasts;

                // Mark as read
                for (const b of allBroadcasts) {
                    const row = db.prepare("SELECT read_by FROM broadcasts WHERE id = ?").get(b.id) as { read_by: string };
                    const readers: string[] = JSON.parse(row.read_by || "[]");
                    if (!readers.includes(agent_id)) {
                        readers.push(agent_id);
                        db.prepare("UPDATE broadcasts SET read_by = ? WHERE id = ?").run(JSON.stringify(readers), b.id);
                    }
                }
            } catch { /* broadcasts table may not exist */ }

            const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agent_id) as Record<string, unknown>;
            return success({
                agent,
                unread_broadcasts: broadcasts,
                message: broadcasts.length > 0
                    ? `Agent "${agent_id}" synced. ${broadcasts.length} unread broadcast(s).`
                    : `Agent "${agent_id}" synced.`,
            });
        }
    );

    // ─── GET AGENTS ──────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_get_agents`,
        {
            title: "Get Agents",
            description: `List all known agents, their current status, and what task they're working on. Useful for orchestrating multi-agent workflows.

Returns:
  Array of agent records with status, last_seen, and current_task_id.`,
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
            const nowMs = Date.now();

            try {
                const agents = db.prepare(
                    "SELECT * FROM agents ORDER BY last_seen DESC"
                ).all() as Array<Record<string, unknown>>;

                // Annotate each agent with its current task title
                const enriched = agents.map(a => {
                    const taskId = a.current_task_id as number | null;
                    if (!taskId) return { ...a, current_task: null };
                    const task = db.prepare("SELECT id, title, status FROM tasks WHERE id = ?").get(taskId) as
                        { id: number; title: string; status: string } | undefined;
                    return { ...a, current_task: task ?? null };
                });

                return success({
                    count: enriched.length,
                    agents: enriched,
                    note: "Agents not seen for >30 minutes are marked 'stale'. Their task claims will be auto-released on next agent_sync.",
                });
            } catch {
                return error("Agent coordination tables not initialised. Run engram_agent_sync first.");
            }
        }
    );

    // ─── BROADCAST ───────────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_broadcast`,
        {
            title: "Broadcast",
            description: `Send a message to all agents. All agents will see this on their next engram_agent_sync or engram_start_session call.

Args:
  - from_agent (string): Sender agent ID
  - message (string): The message to broadcast
  - expires_in_minutes (number, optional): Auto-expire after N minutes (default: 60)

Returns:
  Broadcast ID.`,
            inputSchema: {
                from_agent: z.string().min(1).describe("Sender agent ID"),
                message: z.string().min(1).describe("Message text"),
                expires_in_minutes: z.number().int().min(1).max(1440).default(60),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ from_agent, message, expires_in_minutes }) => {
            const db = getDb();
            const nowMs = Date.now();
            const expiresAt = nowMs + expires_in_minutes * 60_000;

            try {
                const result = db.prepare(`
                    INSERT INTO broadcasts (from_agent, message, created_at, expires_at, read_by)
                    VALUES (?, ?, ?, ?, '[]')
                `).run(from_agent, message, nowMs, expiresAt);

                return success({
                    broadcast_id: Number(result.lastInsertRowid),
                    message: `Broadcast #${result.lastInsertRowid} sent. All agents will see it on next sync.`,
                    expires_at: new Date(expiresAt).toISOString(),
                });
            } catch {
                return error("Broadcast table not initialised. Ensure migrations have run.");
            }
        }
    );
}
