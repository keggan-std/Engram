// ============================================================================
// Engram MCP Server — Scheduled Events Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId, getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success, error } from "../response.js";
import type { ScheduledEventRow } from "../types.js";
import { coerceStringArray } from "../utils.js";

export function registerSchedulerTools(server: McpServer): void {
    // ─── SCHEDULE EVENT ──────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_schedule_event`,
        {
            title: "Schedule Event",
            description: `Schedule a deferred event that fires at a specified trigger. Use when a user says "do this later", "next session", "after task X is done", or "at a specific time". Events are surfaced in start_session when their trigger fires.

Args:
  - title (string): Short, descriptive event title
  - description (string, optional): Detailed description of what needs to happen
  - trigger_type: "next_session" | "datetime" | "task_complete" | "manual"
  - trigger_value (string, optional): ISO datetime for 'datetime', task ID (as string) for 'task_complete'. Not needed for 'next_session' or 'manual'.
  - action_summary (string, optional): Brief summary for the agent to present when event triggers
  - action_data (string, optional): JSON string with detailed context for execution
  - priority: "critical" | "high" | "medium" | "low" (default: "medium")
  - requires_approval (boolean, optional): Whether user must approve before execution (default: true)
  - recurrence (string, optional): "once" | "every_session" | "daily" | "weekly" (default: null = once)
  - tags (array, optional): Categorization tags

Returns:
  Event ID, trigger summary, and confirmation.`,
            inputSchema: {
                title: z.string().min(3).describe("Short event title"),
                description: z.string().optional().describe("Detailed description"),
                trigger_type: z.enum(["next_session", "datetime", "task_complete", "manual"]).describe("When the event should trigger"),
                trigger_value: z.string().optional().describe("ISO datetime or task ID (as string)"),
                action_summary: z.string().optional().describe("Brief summary for agent to present"),
                action_data: z.string().optional().describe("JSON context for execution"),
                priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
                requires_approval: z.boolean().default(true).describe("Whether user must approve"),
                recurrence: z.enum(["once", "every_session", "daily", "weekly"]).optional().describe("Recurrence pattern"),
                tags: coerceStringArray().optional().describe("Tags"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ title, description, trigger_type, trigger_value, action_summary, action_data, priority, requires_approval, recurrence, tags }) => {
            const db = getDb();
            const timestamp = now();
            const sessionId = getCurrentSessionId();

            if (trigger_type === "datetime" && !trigger_value) {
                return error("trigger_value (ISO datetime) is required when trigger_type is 'datetime'.");
            }
            if (trigger_type === "task_complete" && !trigger_value) {
                return error("trigger_value (task ID as string) is required when trigger_type is 'task_complete'.");
            }

            const result = db.prepare(
                `INSERT INTO scheduled_events (session_id, created_at, title, description, trigger_type, trigger_value, status, requires_approval, action_summary, action_data, priority, tags, recurrence)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
            ).run(
                sessionId, timestamp, title, description || null,
                trigger_type, trigger_value || null,
                requires_approval ? 1 : 0,
                action_summary || null, action_data || null,
                priority,
                tags ? JSON.stringify(tags) : null,
                recurrence || null
            );

            const triggerDesc =
                trigger_type === "next_session" ? "next session start" :
                    trigger_type === "datetime" ? `at/after ${trigger_value}` :
                        trigger_type === "task_complete" ? `when task #${trigger_value} completes` :
                            "when manually checked";

            return success({
                event_id: Number(result.lastInsertRowid),
                title,
                trigger: triggerDesc,
                requires_approval,
                recurrence: recurrence || "once",
                message: `Event #${result.lastInsertRowid} scheduled — will trigger on ${triggerDesc}.${requires_approval ? " User approval required before execution." : ""}`,
            });
        }
    );

    // ─── GET SCHEDULED EVENTS ────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_get_scheduled_events`,
        {
            title: "Get Scheduled Events",
            description: `List scheduled events. Filter by status or trigger type.

Args:
  - status (string, optional): Filter by status — "pending", "triggered", "acknowledged", "executed", "cancelled", "snoozed"
  - trigger_type (string, optional): Filter by trigger type
  - include_done (boolean, optional): Include executed/cancelled events (default: false)
  - limit (number, optional): Max results (default 20)

Returns:
  Array of events sorted by priority then creation date.`,
            inputSchema: {
                status: z.enum(["pending", "triggered", "acknowledged", "executed", "cancelled", "snoozed"]).optional(),
                trigger_type: z.enum(["next_session", "datetime", "task_complete", "manual"]).optional(),
                include_done: z.boolean().default(false),
                limit: z.number().int().min(1).max(100).default(20),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ status, trigger_type, include_done, limit }) => {
            const db = getDb();
            let query = "SELECT * FROM scheduled_events WHERE 1=1";
            const params: unknown[] = [];

            if (!include_done) {
                query += " AND status NOT IN ('executed', 'cancelled')";
            }
            if (status) { query += " AND status = ?"; params.push(status); }
            if (trigger_type) { query += " AND trigger_type = ?"; params.push(trigger_type); }

            query += ` ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        created_at ASC
        LIMIT ?`;
            params.push(limit);

            const events = db.prepare(query).all(...params) as unknown[] as ScheduledEventRow[];
            const pendingCount = (db.prepare("SELECT COUNT(*) as c FROM scheduled_events WHERE status IN ('pending', 'triggered')").get() as { c: number }).c;

            return success({
                total_active: pendingCount,
                returned: events.length,
                events,
            });
        }
    );

    // ─── UPDATE SCHEDULED EVENT ──────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_update_scheduled_event`,
        {
            title: "Update Scheduled Event",
            description: `Update a scheduled event. Use to cancel, snooze, reschedule, or modify an event.

Args:
  - id (number): Event ID to update
  - status (string, optional): New status
  - trigger_type (string, optional): New trigger type
  - trigger_value (string, optional): New trigger value
  - title (string, optional): New title
  - description (string, optional): New description
  - priority (string, optional): New priority

Returns:
  Updated event.`,
            inputSchema: {
                id: z.number().int().describe("Event ID"),
                status: z.enum(["pending", "triggered", "acknowledged", "executed", "cancelled", "snoozed"]).optional(),
                trigger_type: z.enum(["next_session", "datetime", "task_complete", "manual"]).optional(),
                trigger_value: z.string().optional(),
                title: z.string().optional(),
                description: z.string().optional(),
                priority: z.enum(["critical", "high", "medium", "low"]).optional(),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ id, status, trigger_type, trigger_value, title, description, priority }) => {
            const db = getDb();

            const existing = db.prepare("SELECT * FROM scheduled_events WHERE id = ?").get(id);
            if (!existing) {
                return error(`Event #${id} not found.`);
            }

            const updates: string[] = [];
            const params: unknown[] = [];

            if (status !== undefined) {
                updates.push("status = ?"); params.push(status);
                if (status === "acknowledged") { updates.push("acknowledged_at = ?"); params.push(now()); }
                if (status === "executed") { updates.push("acknowledged_at = COALESCE(acknowledged_at, ?)"); params.push(now()); }
                if (status === "pending") {
                    updates.push("triggered_at = NULL");
                    updates.push("acknowledged_at = NULL");
                }
            }
            if (trigger_type !== undefined) { updates.push("trigger_type = ?"); params.push(trigger_type); }
            if (trigger_value !== undefined) { updates.push("trigger_value = ?"); params.push(trigger_value); }
            if (title !== undefined) { updates.push("title = ?"); params.push(title); }
            if (description !== undefined) { updates.push("description = ?"); params.push(description); }
            if (priority !== undefined) { updates.push("priority = ?"); params.push(priority); }

            if (updates.length === 0) {
                return success({ message: `No changes specified for event #${id}.` });
            }

            params.push(id);
            db.prepare(`UPDATE scheduled_events SET ${updates.join(", ")} WHERE id = ?`).run(...params);

            const updated = db.prepare("SELECT * FROM scheduled_events WHERE id = ?").get(id) as unknown as ScheduledEventRow;
            return success({
                message: `Event #${id} updated.`,
                event: updated,
            } as unknown as Record<string, unknown>);
        }
    );

    // ─── ACKNOWLEDGE EVENT ───────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_acknowledge_event`,
        {
            title: "Acknowledge Event",
            description: `Acknowledge a triggered event after user reviews it. Sets status to 'acknowledged' (approved) or 'cancelled' (declined). For recurring events, resets to 'pending' after acknowledgement so they fire again.

Args:
  - id (number): Event ID
  - approved (boolean): Whether the user approves the event for execution
  - note (string, optional): User's note on the acknowledgement

Returns:
  Confirmation with next status.`,
            inputSchema: {
                id: z.number().int().describe("Event ID"),
                approved: z.boolean().describe("Whether user approves execution"),
                note: z.string().optional().describe("User note"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ id, approved, note }) => {
            const db = getDb();

            const event = db.prepare("SELECT * FROM scheduled_events WHERE id = ?").get(id) as unknown as ScheduledEventRow | undefined;
            if (!event) {
                return error(`Event #${id} not found.`);
            }

            if (approved) {
                db.prepare(
                    "UPDATE scheduled_events SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?"
                ).run(now(), id);

                if (event.recurrence && event.recurrence !== "once") {
                    const nextTriggerValue = event.trigger_type === "datetime" ? calculateNextTrigger(event.recurrence, event.trigger_value) : event.trigger_value;
                    db.prepare(
                        `INSERT INTO scheduled_events (session_id, created_at, title, description, trigger_type, trigger_value, status, requires_approval, action_summary, action_data, priority, tags, recurrence)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
                    ).run(
                        getCurrentSessionId(), now(), event.title, event.description,
                        event.trigger_type, nextTriggerValue,
                        event.requires_approval,
                        event.action_summary, event.action_data,
                        event.priority, event.tags, event.recurrence
                    );
                }

                return success({
                    event_id: id,
                    status: "acknowledged",
                    message: `Event #${id} approved for execution. "${event.title}"${note ? ` — Note: ${note}` : ""}${event.recurrence && event.recurrence !== "once" ? ` (recurring: ${event.recurrence} — new pending event created)` : ""}`,
                });
            } else {
                db.prepare(
                    "UPDATE scheduled_events SET status = 'cancelled', acknowledged_at = ? WHERE id = ?"
                ).run(now(), id);

                return success({
                    event_id: id,
                    status: "cancelled",
                    message: `Event #${id} declined and cancelled. "${event.title}"${note ? ` — Reason: ${note}` : ""}`,
                });
            }
        }
    );

    // ─── CHECK EVENTS (mid-session) ──────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_check_events`,
        {
            title: "Check Events",
            description: `Check for triggered/pending events AND context pressure. Use mid-session to see if datetime triggers have fired or if context window is filling up. Pass context_tokens_used for precise pressure detection (Level 3 — most accurate). Without it, Engram uses byte-estimate or heuristics.

Args:
  - context_tokens_used (number, optional): Tokens consumed so far this session (agent-reported, most accurate)
  - context_window_total (number, optional): Total context window size (default: configured value, usually 200000)

Returns:
  Triggered/pending events + optional context_pressure warning at 50%/70%/85% thresholds.`,
            inputSchema: {
                context_tokens_used: z.number().int().optional().describe("Tokens consumed so far (agent-reported, most accurate)"),
                context_window_total: z.number().int().optional().describe("Total context window size (default: configured value)"),
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ context_tokens_used, context_window_total }) => {
            const db = getDb();
            const timestamp = now();

            db.prepare(
                `UPDATE scheduled_events SET status = 'triggered', triggered_at = ?
         WHERE status = 'pending' AND trigger_type = 'datetime' AND trigger_value <= ?`
            ).run(timestamp, timestamp);

            const events = db.prepare(
                `SELECT * FROM scheduled_events
         WHERE status IN ('triggered', 'pending')
         ORDER BY
           CASE status WHEN 'triggered' THEN 0 WHEN 'pending' THEN 1 END,
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END
         LIMIT 20`
            ).all() as unknown[] as ScheduledEventRow[];

            const triggered = events.filter(e => e.status === "triggered");
            const pending = events.filter(e => e.status === "pending");

            // ─── F3: Context Pressure Detection ─────────────────────────────────
            const contextPressure = detectContextPressure(context_tokens_used, context_window_total);

            return success({
                triggered_count: triggered.length,
                pending_count: pending.length,
                triggered_events: triggered,
                pending_events: pending,
                context_pressure: contextPressure,
                message: [
                    triggered.length > 0
                        ? `${triggered.length} event(s) triggered and awaiting action.`
                        : "No events triggered.",
                    contextPressure
                        ? `⚠️ Context pressure [${contextPressure.severity.toUpperCase()}]: ${contextPressure.message}`
                        : null,
                ].filter(Boolean).join(" ") || "All clear.",
            });
        }
    );

    // ─── ACCUMULATE BYTES (for Level 2 context pressure tracking) ────────
    server.registerTool(
        `${TOOL_PREFIX}_track_context`,
        {
            title: "Track Context",
            description: `Update the byte-usage estimate for the current session. Call this periodically (e.g. every 5-10 tool calls) with the approximate sizes of tool inputs and outputs to improve context pressure accuracy. This enables Level 2 byte-estimate pressure detection in engram_check_events when agent-reported tokens are not available.

Args:
  - input_bytes (number): Approximate bytes in tool inputs this batch
  - output_bytes (number): Approximate bytes in tool outputs this batch

Returns:
  Updated session byte totals and current pressure estimate.`,
            inputSchema: {
                input_bytes: z.number().int().min(0).describe("Approximate input bytes this batch"),
                output_bytes: z.number().int().min(0).describe("Approximate output bytes this batch"),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async ({ input_bytes, output_bytes }) => {
            const sessionId = getCurrentSessionId();
            if (!sessionId) return success({ message: "No active session." });

            try {
                db_upsertSessionBytes(sessionId, input_bytes, output_bytes);
                const totals = db_getSessionBytes(sessionId);
                const pressure = detectContextPressure(undefined, undefined, totals);
                return success({
                    session_id: sessionId,
                    total_input_bytes: totals?.input_bytes ?? 0,
                    total_output_bytes: totals?.output_bytes ?? 0,
                    tool_calls: totals?.tool_calls ?? 0,
                    estimated_tokens: Math.round(((totals?.input_bytes ?? 0) + (totals?.output_bytes ?? 0)) / 4),
                    context_pressure: pressure,
                    message: pressure
                        ? `⚠️ Context pressure [${pressure.severity.toUpperCase()}]: ~${pressure.estimated_pct_used}% used.`
                        : "Byte tracking updated. No pressure threshold crossed.",
                });
            } catch (e) {
                return success({ message: `Byte tracking unavailable: ${e}` });
            }
        }
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface SessionBytesRow { session_id: number; input_bytes: number; output_bytes: number; tool_calls: number; }

function db_getSessionBytes(sessionId: number): SessionBytesRow | null {
    try {
        return getDb().prepare(
            "SELECT session_id, input_bytes, output_bytes, tool_calls FROM session_bytes WHERE session_id = ?"
        ).get(sessionId) as SessionBytesRow | null;
    } catch { return null; }
}

function db_upsertSessionBytes(sessionId: number, inputBytes: number, outputBytes: number): void {
    getDb().prepare(
        `INSERT INTO session_bytes (session_id, input_bytes, output_bytes, tool_calls, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           input_bytes  = input_bytes  + excluded.input_bytes,
           output_bytes = output_bytes + excluded.output_bytes,
           tool_calls   = tool_calls   + 1,
           updated_at   = excluded.updated_at`
    ).run(sessionId, inputBytes, outputBytes, Date.now());
}

interface ContextPressureResult {
    severity: "notice" | "warning" | "urgent";
    estimated_pct_used: number;
    source: "agent_reported" | "byte_estimate" | "heuristic";
    message: string;
    suggestions: string[];
}

/**
 * Determine context pressure using the best available signal:
 *   Level 3 (most accurate)  — agent passes context_tokens_used
 *   Level 2 (byte estimate)  — session_bytes row from DB
 *   Level 1 (heuristic)      — session duration in config / fallback
 */
function detectContextPressure(
    agentTokensUsed?: number,
    agentWindowTotal?: number,
    sessionBytesOverride?: SessionBytesRow | null,
): ContextPressureResult | null {
    try {
        const repos = getRepos();
        const noticePct  = repos.config.getInt("context_pressure_notice_pct",  50);
        const warningPct = repos.config.getInt("context_pressure_warning_pct", 70);
        const urgentPct  = repos.config.getInt("context_pressure_urgent_pct",  85);
        const windowSize = repos.config.getInt("context_window_size",     200_000);

        let pct: number;
        let source: ContextPressureResult["source"];

        if (agentTokensUsed !== undefined) {
            // Level 3: exact agent-reported value
            const total = agentWindowTotal ?? windowSize;
            pct = Math.round((agentTokensUsed / total) * 100);
            source = "agent_reported";
        } else {
            // Level 2: byte estimate from session_bytes
            const sessionId = getCurrentSessionId();
            const bytes = sessionBytesOverride !== undefined
                ? sessionBytesOverride
                : (sessionId ? db_getSessionBytes(sessionId) : null);

            if (bytes && (bytes.input_bytes + bytes.output_bytes) > 0) {
                const estimatedTokens = Math.round((bytes.input_bytes + bytes.output_bytes) / 4);
                pct = Math.round((estimatedTokens / windowSize) * 100);
                source = "byte_estimate";
            } else {
                // Level 1: heuristic — not enough data
                return null;
            }
        }

        if (pct < noticePct) return null;

        const severity: ContextPressureResult["severity"] =
            pct >= urgentPct  ? "urgent"  :
            pct >= warningPct ? "warning" : "notice";

        const suggestions =
            severity === "urgent"  ? ["engram_end_session", "engram_create_task"] :
            severity === "warning" ? ["engram_create_task", "engram_end_session"] :
                                     ["finish current sub-task before starting new ones"];

        const messages = {
            notice:  `~${pct}% of context window used (${source}). Finish current sub-task before starting new ones.`,
            warning: `~${pct}% of context window used (${source}). Create tasks for incomplete work now.`,
            urgent:  `~${pct}% of context window used (${source}). Call engram_end_session immediately.`,
        };

        return { severity, estimated_pct_used: pct, source, message: messages[severity], suggestions };
    } catch {
        return null; /* best effort */
    }
}

function calculateNextTrigger(recurrence: string, currentValue: string | null): string {
    const base = currentValue ? new Date(currentValue) : new Date();
    switch (recurrence) {
        case "daily":
            base.setDate(base.getDate() + 1);
            break;
        case "weekly":
            base.setDate(base.getDate() + 7);
            break;
        case "every_session":
            return currentValue || new Date().toISOString();
        default:
            break;
    }
    return base.toISOString();
}
