// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getRepos, getServices, getDb, logToolCall } from "../database.js";
import { COMPACTION_THRESHOLD_SESSIONS, FOCUS_MAX_ITEMS_PER_CATEGORY } from "../constants.js";
import { log } from "../logger.js";
import { truncate, ftsEscape, coerceStringArray } from "../utils.js";
import { success, error } from "../response.js";
import type { SessionContext, ProjectSnapshot, ScheduledEventRow } from "../types.js";
import { buildToolCatalog, AGENT_RULES } from "./find.js";


// ============================================================================
// engram_session — Lean Surface Dispatcher (v1.6)
// Routes action:"start" | "end" | "get_history" | "handoff" to session logic.
// ============================================================================

// ─── Tiered catalog tier selection ───────────────────────────────────────────

/**
 * Choose which tool catalog tier to return based on agent history.
 * Tier 0 (~80 tokens):   Names only — repeat session, agent already knows the surface.
 * Tier 1 (~400 tokens):  Descriptions — returning agent after >30 days.
 * Tier 2 (~1,200 tokens): Full params — first session ever for this agent.
 */
function selectCatalogTier(agent_name: string, verbosity: string): 0 | 1 | 2 {
  if (verbosity === "nano") return 0;
  const config = getRepos().config;
  const lastDelivery = config.get(`catalog_delivered_${agent_name}`);
  if (!lastDelivery) return 2; // First time this agent has ever started
  const daysSince = (Date.now() - parseInt(lastDelivery, 10)) / 86_400_000;
  if (daysSince > 30) return 1;  // Been a while — refresh with descriptions
  return 0; // Recent session — action names only
}

function storeCatalogDelivery(agent_name: string, tier: 0 | 1 | 2): void {
  if (tier >= 1) { // Only record when we delivered meaningful catalog (tier 1 or 2)
    try { getRepos().config.set(`catalog_delivered_${agent_name}`, String(Date.now()), new Date().toISOString()); } catch { /* best effort */ }
  }
}

export function registerSessionDispatcher(server: McpServer): void {
  server.registerTool(
    "engram_session",
    {
      title: "Session Management",
      description: `Start or end an Engram memory session. On start, returns session context AND a full catalog of available engram_memory operations.

Actions:
  - start: Begin session, load context, receive tool_catalog + agent_rules.
  - end: Close session with summary.
  - get_history: Retrieve past session summaries.
  - handoff: Create a handoff record for the next agent.
  - acknowledge_handoff: Mark a handoff as read.`,
      inputSchema: {
        action: z.enum(["start", "end", "get_history", "handoff", "acknowledge_handoff"]).describe("Session operation to perform."),
        // start params
        agent_name: z.string().optional().describe("Your agent identifier. For: start."),
        resume_task: z.string().optional().describe("Task title to focus context on. For: start."),
        verbosity: z.enum(["full", "summary", "minimal", "nano"]).optional().describe("Response detail level. For: start. nano=counts+rules only (~10 tokens), minimal=counts+agent_rules, summary=default, full=everything."),
        focus: z.string().optional().describe("Topic/keywords to filter context. For: start."),
        agent_role: z.enum(["primary", "sub"]).optional().default("primary").describe("'primary' = full session context (default). 'sub' = task-focused session for orchestrator-spawned sub-agents (~300-500 tokens)."),
        task_id: z.number().int().optional().describe("Task ID to scope context around. Required when agent_role='sub'."),
        // end params
        summary: z.string().optional().describe("Session accomplishments summary. Required for: end."),
        tags: coerceStringArray().optional().describe("Tags for session. For: end."),
        // get_history params
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
        // handoff params
        reason: z.string().optional().describe("Why handing off. For: handoff."),
        next_agent_instructions: z.string().optional(),
        // acknowledge_handoff params
        id: z.number().int().optional().describe("Handoff ID. For: acknowledge_handoff."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const repos = getRepos();
      const services = getServices();
      const projectRoot = getProjectRoot();
      const db = getDb();

      switch (params.action) {

        case "start": {
          const agent_name = params.agent_name ?? "unknown";
          const verbosity = params.verbosity ?? "summary";
          const focus = params.focus;          const resume_task = params.resume_task;
          const timestamp = now();

          // ── Sub-agent path: task-scoped context (~300-500 tokens) ─────────
          if (params.agent_role === "sub") {
            if (params.task_id === undefined) return error("task_id required when agent_role='sub'. Pass the task ID assigned by the orchestrator.");
            const openSession = getCurrentSessionId();
            if (openSession) { repos.sessions.autoClose(openSession, timestamp); }
            const sessionId = repos.sessions.create(agent_name, projectRoot, timestamp);
            const task = repos.tasks.getById(params.task_id) as Record<string, unknown> | null;
            if (!task) return error(`Task #${params.task_id} not found.`);
            const assignedFiles: string[] = task.assigned_files ? (typeof task.assigned_files === "string" ? JSON.parse(task.assigned_files) : task.assigned_files as string[]) : [];
            const taskTags: string[] = task.tags ? (typeof task.tags === "string" ? JSON.parse(task.tags) : task.tags as string[]) : [];
            // Relevant file notes
            const relevantFiles = assignedFiles.slice(0, 5).map(fp => {
              try {
                const fn = repos.fileNotes.getByPath(fp);
                return fn ? { file_path: fp, executive_summary: fn.executive_summary ?? fn.purpose ?? fn.notes, confidence: "high" } : null;
              } catch { return null; }
            }).filter(Boolean);
            // Relevant decisions (by tag overlap)
            const allDecisions = repos.decisions.getActive(50);
            const relevantDecisions = allDecisions.filter(d => {
              const dTags: string[] = d.tags ? (typeof d.tags === "string" ? JSON.parse(d.tags) : d.tags as string[]) : [];
              return taskTags.some(t => dTags.includes(t)) || assignedFiles.some(f => (d.affected_files ?? "").includes(f));
            }).slice(0, 5).map(d => ({ id: d.id, decision: truncate(d.decision, 120), status: d.status }));
            // Relevant conventions (by tag overlap)
            const allConventions = repos.conventions.getActive();
            const relevantConventions = allConventions.filter(c => {
              const keyword = `${c.category} ${c.rule}`.toLowerCase();
              return taskTags.some(t => keyword.includes(t.toLowerCase())) || assignedFiles.some(f => keyword.includes(f.toLowerCase().split("/").pop() ?? ""));
            }).slice(0, 5).map(c => ({ id: c.id, category: c.category, rule: truncate(c.rule, 100) }));
            logToolCall("start_session_sub", "success", `agent=${agent_name} task=${params.task_id}`);
            return success({
              session_id: sessionId,
              agent_role: "sub",
              task: { id: task.id, title: task.title, description: task.description, priority: task.priority, tags: taskTags },
              relevant_files: relevantFiles,
              relevant_decisions: relevantDecisions,
              relevant_conventions: relevantConventions,
              message: `Sub-agent session #${sessionId} started for task #${params.task_id}. Record changes when done, then call engram_session(action:'end'). Use engram_find({query}) for any action lookups.`,
            });
          }
          // ── End sub-agent path ─────────────────────────────────────────────

          // Check for already-open session and close it
          const openSession = getCurrentSessionId();
          if (openSession) { repos.sessions.autoClose(openSession, timestamp); }

          const lastSession = getLastCompletedSession();
          const sessionId = repos.sessions.create(agent_name, projectRoot, timestamp);

          let autoCompacted = false;
          try { autoCompacted = services.compaction.autoCompact(COMPACTION_THRESHOLD_SESSIONS); } catch { /* best effort */ }

          let recordedChanges = lastSession?.ended_at ? repos.changes.getSince(lastSession.ended_at) : [];
          const gitBranch = services.git.getBranch();
          const gitHead = services.git.getHead();
          const gitLog = lastSession?.ended_at && services.git.isRepo() ? services.git.getLogSince(lastSession.ended_at) : "";

          // Focus filtering
          let focusInfo: import("../types.js").SessionFocusInfo | undefined;
          let activeDecisions = repos.decisions.getActive(20);
          const activeConventions = repos.conventions.getActive();
          // Sort: enforced conventions first, then most recently added — so the most important appear in capped responses
          activeConventions.sort((a, b) => ((b.enforced ? 1 : 0) - (a.enforced ? 1 : 0)) || (b.id - a.id));
          const totalConventions = activeConventions.length;
          const capConventions = (cap: number) => activeConventions.slice(0, cap).map(c => ({ id: c.id, category: c.category, rule: truncate(c.rule, 100), enforced: c.enforced }));
          let openTasks = repos.tasks.getOpen(15, resume_task || undefined);

          if (focus && focus.trim().length > 0) {
            const ftsQuery = ftsEscape(focus);
            const totalDecisions = activeDecisions.length;
            const totalTasks = openTasks.length;
            const totalChanges = recordedChanges.length;
            try { activeDecisions = repos.decisions.getActiveFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY); } catch { /* FTS unavailable */ }
            try { openTasks = repos.tasks.getOpenFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY); } catch { /* FTS unavailable */ }
            const focusWords = focus.toLowerCase().split(/\s+/).filter(Boolean);
            const focusedChanges = recordedChanges.filter(c =>
              focusWords.some(w => c.file_path.toLowerCase().includes(w) || c.description.toLowerCase().includes(w) || (c.diff_summary ?? "").toLowerCase().includes(w))
            );
            if (focusedChanges.length > 0) recordedChanges = focusedChanges;
            focusInfo = { query: focus, decisions_returned: activeDecisions.length, tasks_returned: openTasks.length, changes_returned: recordedChanges.length, note: `Context filtered to focus "${focus}". Full memory available via engram_memory(action:"search").` };
          }

          const gitHookLog = services.git.parseHookLog(lastSession?.ended_at);
          let triggeredEvents: ScheduledEventRow[] = [];
          try { triggeredEvents = services.events.triggerSessionEvents(); } catch { /* best effort */ }
          const updateNotification = services.update.getNotification();

          interface PendingWorkRow { id: number; agent_id: string; description: string; files: string; started_at: number; session_id: number | null; }
          let abandonedWork: PendingWorkRow[] = [];
          try {
            if (lastSession?.id) { db.prepare(`UPDATE pending_work SET status = 'abandoned' WHERE status = 'pending' AND (session_id IS NULL OR session_id < ?)`).run(sessionId); }
            abandonedWork = db.prepare("SELECT id, agent_id, description, files, started_at, session_id FROM pending_work WHERE status = 'abandoned' ORDER BY started_at DESC LIMIT 5").all() as PendingWorkRow[];
          } catch { /* best effort */ }

          interface HandoffRow { id: number; from_agent: string | null; reason: string; next_agent_instructions: string | null; resume_at: string | null; git_branch: string | null; open_task_ids: string | null; last_file_touched: string | null; created_at: number; }
          let handoffPending: HandoffRow | null = null;
          try { handoffPending = db.prepare("SELECT * FROM handoffs WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 1").get() as HandoffRow | null; } catch { /* best effort */ }

          let suggestedFocus: string | undefined;
          if (!focus) {
            const candidates: string[] = [];
            if (recordedChanges.length > 0) {
              const parts = recordedChanges[recordedChanges.length - 1].file_path.replace(/\\/g, "/").split("/").filter(Boolean);
              if (parts.length >= 2) candidates.push(parts[parts.length - 2]);
            }
            if (openTasks.length > 0) { const w = openTasks[0].title.split(/\s+/).find(w => w.length > 3); if (w) candidates.push(w.toLowerCase()); }
            if (activeDecisions.length > 0) { const w = activeDecisions[0].decision.split(/\s+/).find(w => w.length > 4); if (w) candidates.push(w.toLowerCase()); }
            if (candidates.length > 0) suggestedFocus = candidates[0];
          }

          logToolCall("start_session", "success", `agent=${agent_name} verbosity=${verbosity} (dispatcher)`);

          // Build response
          const catalogTier = selectCatalogTier(agent_name, verbosity);
          storeCatalogDelivery(agent_name, catalogTier);
          const abandoned = abandonedWork.length > 0 ? abandonedWork.map(w => ({ id: w.id, agent_id: w.agent_id, description: w.description, files: JSON.parse(w.files), started_ago_minutes: Math.round((Date.now() - w.started_at) / 60_000) })) : undefined;
          const handoff = handoffPending ? { id: handoffPending.id, from_agent: handoffPending.from_agent, reason: handoffPending.reason, next_agent_instructions: handoffPending.next_agent_instructions, git_branch: handoffPending.git_branch } : undefined;
          const rulesResult = services.agentRules.getRules();
          const baseResponse = {
            session_id: sessionId,
            previous_session: lastSession ? { id: lastSession.id, summary: lastSession.summary, ended_at: lastSession.ended_at, agent: lastSession.agent_name } : null,
            git: { branch: gitBranch, head: gitHead },
            auto_compacted: autoCompacted,
            focus: focusInfo,
            suggested_focus: suggestedFocus,
            abandoned_work: abandoned,
            handoff_pending: handoff,
            update_available: updateNotification ?? undefined,
            agent_rules: rulesResult.rules,
            agent_rules_source: rulesResult.source,
            tool_catalog: buildToolCatalog(catalogTier),
            triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
          };

          if (verbosity === "nano") {
            return success({
              session_id: sessionId,
              verbosity: "nano",
              counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: activeConventions.length, tasks: openTasks.length, files: repos.fileNotes.countAll() },
              agent_rules: rulesResult.rules,
              agent_rules_source: rulesResult.source,
              tool_catalog: buildToolCatalog(0),
              triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
              update_available: updateNotification ?? undefined,
              message: `Session #${sessionId} started (nano). Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}`,
            });
          }

          if (verbosity === "minimal") {
            return success({ ...baseResponse, verbosity: "minimal", counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: totalConventions, tasks: openTasks.length, files: repos.fileNotes.countAll() }, active_conventions: capConventions(5), total_conventions: totalConventions, message: `Session #${sessionId} started. Use engram_memory for all ops — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` });
          }

          if (verbosity === "summary") {
            return success({ ...baseResponse, verbosity: "summary", changes_since_last: { count: recordedChanges.length, recent: recordedChanges.slice(0, 5).map(c => ({ file_path: c.file_path, change_type: c.change_type, description: truncate(c.description, 120), timestamp: c.timestamp })), git_log: gitLog ? truncate(gitLog, 500) : "" }, active_decisions: activeDecisions.slice(0, 5).map(d => ({ id: d.id, decision: truncate(d.decision, 120), status: d.status, tags: d.tags })), active_conventions: capConventions(10), total_conventions: totalConventions, conventions_note: totalConventions > 10 ? `Showing 10 of ${totalConventions} conventions. Use engram_memory(action:'get_conventions') for all.` : undefined, open_tasks: openTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })), total_file_notes: repos.fileNotes.countAll(), git_hook_log: gitHookLog || undefined, message: lastSession ? `Session #${sessionId} started. Resuming from #${lastSession.id}. ${recordedChanges.length} changes since. Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` : `Session #${sessionId} started. First session. Use engram_memory — see tool_catalog.` });
          }

          // full verbosity
          let projectSnapshot = null;
          try { projectSnapshot = services.scan.getOrRefresh(projectRoot); } catch { /* best effort */ }
          return success({ ...baseResponse, verbosity: "full", changes_since_last: { recorded: recordedChanges, git_log: gitLog }, active_decisions: activeDecisions, active_conventions: activeConventions, open_tasks: openTasks, project_snapshot: projectSnapshot, git_hook_log: gitHookLog || undefined, message: lastSession ? `Session #${sessionId} started (full). ${recordedChanges.length} changes since session #${lastSession.id}. Use engram_memory — see tool_catalog.` : `Session #${sessionId} started (full). First session. Use engram_memory — see tool_catalog.` });
        }

        case "end": {
          if (!params.summary) return error("summary required for end action");
          const sessionId = getCurrentSessionId();
          if (!sessionId) return error("No active session. Start one first with engram_session(action:'start').");
          const timestamp = now();

          const sessionRow = repos.sessions.getById(sessionId) as { agent_name?: string } | null;
          const agentName = sessionRow?.agent_name ?? null;
          let claimedTasksWarning: Array<{ id: number; title: string; status: string }> | undefined;
          if (agentName) {
            try {
              const unclosed = db.prepare("SELECT id, title, status FROM tasks WHERE claimed_by = ? AND status NOT IN ('done', 'cancelled')").all(agentName) as Array<{ id: number; title: string; status: string }>;
              if (unclosed.length > 0) claimedTasksWarning = unclosed;
            } catch { /* best effort */ }
          }

          const changeCount = repos.changes.countBySession(sessionId);
          const decisionCount = repos.sessions.countBySession(sessionId, "decisions");
          const tasksDone = repos.tasks.countDoneInSession(sessionId);
          logToolCall("end_session", "success", `changes=${changeCount} decisions=${decisionCount} tasks_done=${tasksDone} (dispatcher)`);
          repos.sessions.close(sessionId, timestamp, params.summary, params.tags);

          return success({ message: `Session #${sessionId} ended.${claimedTasksWarning ? ` ⚠️ ${claimedTasksWarning.length} claimed task(s) still open.` : ""}`, session_id: sessionId, stats: { changes_recorded: changeCount, decisions_made: decisionCount, tasks_completed: tasksDone }, ...(claimedTasksWarning ? { claimed_tasks_warning: { tasks: claimedTasksWarning } } : {}) });
        }

        case "get_history": {
          const sessions = repos.sessions.getHistory(params.limit ?? 10, params.offset ?? 0, params.agent_name);
          const total = repos.sessions.countAll();
          return success({ sessions, total, has_more: (params.offset ?? 0) + (params.limit ?? 10) < total });
        }

        case "handoff": {
          if (!params.reason) return error("reason required for handoff");
          const sessionId = getCurrentSessionId();
          if (!sessionId) return error("No active session.");
          const gitBranch = services.git.getBranch();
          const openTasks = repos.tasks.getOpen(20);
          const recentChanges = repos.changes.getBySession(sessionId);
          const lastFileTouched = recentChanges.length > 0 ? recentChanges[recentChanges.length - 1].file_path : null;
          const fromAgent = (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? "unknown";
          const result = db.prepare(`INSERT INTO handoffs (from_session_id, from_agent, created_at, reason, next_agent_instructions, resume_at, git_branch, open_task_ids, last_file_touched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, fromAgent, Date.now(), params.reason, params.next_agent_instructions ?? null, null, gitBranch, openTasks.length > 0 ? JSON.stringify(openTasks.map(t => t.id)) : null, lastFileTouched);
          return success({ handoff_id: result.lastInsertRowid, message: `Handoff #${result.lastInsertRowid} created. Next agent will see this in start_session.` });
        }

        case "acknowledge_handoff": {
          if (params.id === undefined) return error("id required for acknowledge_handoff");
          const sessionId = getCurrentSessionId();
          const fromAgent = sessionId ? (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? "unknown" : "unknown";
          const result = db.prepare(`UPDATE handoffs SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL`).run(Date.now(), fromAgent, params.id);
          if ((result.changes as number) === 0) return error(`Handoff #${params.id} not found or already acknowledged.`);
          return success({ message: `Handoff #${params.id} acknowledged.` });
        }

        default:
          return error(`Unknown session action: ${(params as Record<string, unknown>).action}`);
      }
    }
  );
}
