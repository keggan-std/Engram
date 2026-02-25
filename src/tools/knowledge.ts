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

    // ─── LIST TOOLS ───────────────────────────────────────────────────
    server.registerTool(
        `${TOOL_PREFIX}_list_tools`,
        {
            title: "List Tools",
            description: `Returns a compact catalog of every Engram MCP tool, grouped by category, with a one-line description of WHEN to call it. Call this once at session start to know what tools exist and choose the right ones — avoids loading all full tool descriptions to save tokens.`,
            inputSchema: {},
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            return success({
                note: "Call engram_start_session with verbosity:'summary' or 'minimal' — NEVER 'full'. Use this catalog to find the right tool without reading all descriptions.",
                tools: {
                    session: [
                        { tool: "engram_start_session",       when: "FIRST call every session — pass verbosity:'summary' always, never 'full'" },
                        { tool: "engram_end_session",         when: "LAST call every session — summarise work done, tasks, blockers" },
                        { tool: "engram_get_session_history", when: "Review past sessions (auditing / retrospective)" },
                        { tool: "engram_handoff",             when: "Hand off work to another agent mid-session" },
                        { tool: "engram_acknowledge_handoff", when: "Pick up a pending handoff left by another agent" },
                        { tool: "engram_suggest_commit",      when: "Generate a conventional commit message from recent changes" },
                    ],
                    memory_write: [
                        { tool: "engram_record_change",       when: "After EVERY file edit — what changed and why" },
                        { tool: "engram_record_decision",     when: "New architectural / design decision made" },
                        { tool: "engram_record_decisions_batch", when: "Record multiple decisions in one call" },
                        { tool: "engram_update_decision",     when: "Supersede or retire an existing decision" },
                        { tool: "engram_set_file_notes",      when: "After reading a file for the first time — store purpose/layer/deps" },
                        { tool: "engram_set_file_notes_batch", when: "Store notes for multiple files at once" },
                        { tool: "engram_add_convention",      when: "Codify a new project rule/style/naming convention" },
                        { tool: "engram_toggle_convention",   when: "Enable or disable an existing convention" },
                        { tool: "engram_record_milestone",    when: "Mark a major release, feature completion, or project milestone" },
                    ],
                    memory_read: [
                        { tool: "engram_get_file_notes",      when: "BEFORE opening any file — check if notes already exist" },
                        { tool: "engram_get_decisions",       when: "Before making architecture choices — check existing decisions" },
                        { tool: "engram_get_conventions",     when: "Check active coding/style conventions" },
                        { tool: "engram_get_tasks",           when: "List open/blocked/completed tasks" },
                        { tool: "engram_get_milestones",      when: "Review project milestones and timeline" },
                        { tool: "engram_get_file_history",    when: "Get change history for a specific file" },
                        { tool: "engram_get_session_history", when: "Review what happened in past sessions" },
                        { tool: "engram_get_global_knowledge", when: "Retrieve decisions/conventions shared across all projects on this machine" },
                    ],
                    intelligence: [
                        { tool: "engram_search",              when: "Full-text search across ALL memory (sessions/changes/decisions/tasks)" },
                        { tool: "engram_what_changed",        when: "Catch up on what changed since a timestamp / last session (includes git)" },
                        { tool: "engram_scan_project",        when: "Build/refresh a cached file-tree snapshot with architectural layers" },
                        { tool: "engram_get_dependency_map",  when: "Get file dependency graph for a specific file" },
                        { tool: "engram_replay",              when: "Replay a session to see step-by-step what an agent did" },
                        { tool: "engram_generate_report",     when: "Generate a markdown report of project activity/status" },
                    ],
                    tasks: [
                        { tool: "engram_create_task",         when: "Create a tracked task (bug, feature, TODO) that persists across sessions" },
                        { tool: "engram_update_task",         when: "Change task status (in_progress / done / blocked / review)" },
                        { tool: "engram_begin_work",          when: "Mark the start of work on a task — sets pending_work marker" },
                        { tool: "engram_claim_task",          when: "Claim a task in multi-agent coordination to prevent double-work" },
                        { tool: "engram_release_task",        when: "Release a claimed task (done or abandoning)" },
                    ],
                    file_locks: [
                        { tool: "engram_lock_file",           when: "Claim exclusive write lock on a file in multi-agent setup" },
                        { tool: "engram_unlock_file",         when: "Release a file lock after finishing edits" },
                    ],
                    scheduling: [
                        { tool: "engram_schedule_event",      when: "Schedule a deferred action (reminder, review, check-in)" },
                        { tool: "engram_check_events",        when: "Check for triggered/pending scheduled events" },
                        { tool: "engram_get_scheduled_events", when: "List all scheduled events" },
                        { tool: "engram_update_scheduled_event", when: "Modify or cancel a scheduled event" },
                        { tool: "engram_acknowledge_event",   when: "Mark a triggered event as handled" },
                        { tool: "engram_track_context",       when: "Save active context for later resumption" },
                    ],
                    coordination: [
                        { tool: "engram_agent_sync",          when: "Register/heartbeat as an active agent in multi-agent setup" },
                        { tool: "engram_get_agents",          when: "List all active agents and their current tasks" },
                        { tool: "engram_broadcast",           when: "Send a message to all active agents" },
                        { tool: "engram_dump",                when: "Full memory dump for debugging or handoff purposes" },
                    ],
                    maintenance: [
                        { tool: "engram_backup",              when: "Create a DB backup before risky operations" },
                        { tool: "engram_restore",             when: "Restore DB from a backup file" },
                        { tool: "engram_list_backups",        when: "List available backup files" },
                        { tool: "engram_export",              when: "Export full DB as a portable JSON file" },
                        { tool: "engram_import",              when: "Import memory from a JSON export file" },
                        { tool: "engram_compact",             when: "Shrink DB by merging old session change records" },
                        { tool: "engram_clear",               when: "DANGER: permanently delete memory tables (auto-backs up first)" },
                        { tool: "engram_stats",               when: "Get DB stats: session count, sizes, most-changed files" },
                        { tool: "engram_health",              when: "Check schema version, migration status, DB integrity" },
                        { tool: "engram_config",              when: "Read or update Engram configuration settings" },
                        { tool: "engram_list_tools",          when: "Get this catalog — call once to know all tools without reading full descriptions" },
                    ],
                },
            });
        }
    );
}
