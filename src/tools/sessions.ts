// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// getCurrentSessionId is deliberately NOT imported here: session identity in this
// file is resolved through resolveSession() below, which is agent-scoped. The
// global helper remains for legacy call sites that have no identity available.
import { now, getLastCompletedSession, getProjectRoot, getRepos, getServices, getDb, reinitDatabase } from "../database.js";
import { COMPACTION_THRESHOLD_SESSIONS, FOCUS_MAX_ITEMS_PER_CATEGORY, PHASE_MAP } from "../constants.js";
import { log } from "../logger.js";
import { truncate, ftsEscape, coerceStringArray } from "../utils.js";
import { success, error } from "../response.js";
import type { SessionContext, ProjectSnapshot, ScheduledEventRow, ConventionRow } from "../types.js";
import { getPMConventions, getPhaseOverview } from "../knowledge/index.js";
import { pmSafe } from "../services/index.js";
import * as os from "os";
import * as path from "path";
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

// ─── Session identity (audit N3a/N3b) ────────────────────────────────────────
//
// A session belongs to exactly one agent. Nothing else in this file may assume
// there is only one open session, because there no longer is: `start` retires
// only the CALLING agent's previous session, so an orchestrator and its
// sub-agents are open concurrently by design.
//
// Every non-start action therefore has to say which session it means. The
// resolution order below is strict-to-loose, and the loosest rung reports that
// it guessed rather than guessing silently.

type SessionResolution =
  | { id: number; scope: "explicit" | "agent" | "global"; ambiguous: boolean }
  | { id: null; scope: "none"; ambiguous: false };

/**
 * Decide which session a non-start action operates on.
 *   1. `session_id` — the handle returned by `start`. Exact, always preferred.
 *   2. `agent_name` — the caller's own newest open session.
 *   3. newest open session of any agent — legacy fallback, flagged `ambiguous`
 *      when more than one session is open so the caller learns it was a guess.
 */
function resolveSession(
  params: { session_id?: number; agent_name?: string },
  repos: ReturnType<typeof getRepos>
): SessionResolution {
  if (params.session_id !== undefined) {
    return { id: params.session_id, scope: "explicit", ambiguous: false };
  }
  const agentName = params.agent_name?.trim();
  if (agentName) {
    const own = repos.sessions.getOpenSessionId(agentName);
    if (own !== null) return { id: own, scope: "agent", ambiguous: false };
  }
  const open = repos.sessions.getOpenSessions();
  if (open.length === 0) return { id: null, scope: "none", ambiguous: false };
  return { id: open[0].id, scope: "global", ambiguous: open.length > 1 };
}

/** Advisory note attached to responses that had to guess which session was meant. */
function ambiguityNote(resolution: SessionResolution, action: string): string | undefined {
  if (resolution.scope !== "global" || !resolution.ambiguous) return undefined;
  return `More than one session is open and no session_id or agent_name was supplied, so the newest was used. Pass session_id (returned by engram_session(action:'start')) or agent_name to make '${action}' unambiguous.`;
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
        agent_name: z.string().optional().describe("Your agent identifier. REQUIRED for: start — sessions are owned by an agent and an unnamed session cannot be told apart from anyone else's. Pass the same name on 'end'/'handoff' to operate on your own session."),
        session_id: z.number().int().optional().describe("The session handle returned by start. For: end, handoff, acknowledge_handoff. Pass it when other agents may also have sessions open — without it the newest open session is used."),
        parent_session_id: z.number().int().optional().describe("The orchestrator's session_id. For: start with agent_role='sub'. Omit to infer the most recent open session belonging to another agent."),
        project_root: z.string().optional().describe("Absolute path to the project workspace. For: start. Pass this when the IDE spawns MCP servers from a non-project directory (e.g. $HOME). Engram will re-initialize the database at this location."),
        resume_task: z.string().optional().describe("Task title to focus context on. For: start."),
        verbosity: z.enum(["full", "summary", "minimal", "nano"]).optional().describe("Response detail level. For: start. nano=counts+rules only (~10 tokens), minimal=counts+agent_rules, summary=default, full=everything."),
        focus: z.string().optional().describe("Topic/keywords to filter context. For: start."),
        agent_role: z.enum(["primary", "sub"]).optional().default("primary").describe("'primary' = full session context (default). 'sub' = task-focused session for orchestrator-spawned sub-agents (~300-500 tokens)."),
        task_id: z.number().int().optional().describe("Task ID to scope context around. Required when agent_role='sub'."),
        intent: z.enum(["full_context", "quick_op", "phase_work"]).optional().default("full_context").describe("Session start intent. For: start. full_context=current behavior (default, ~730 tokens); quick_op=minimal (session_id+rules+catalog only, ~200 tokens); phase_work=full context + current phase knowledge for PM-Full (~900 tokens)."),
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
      let repos = getRepos();
      let services = getServices();
      let projectRoot = getProjectRoot();
      let db = getDb();

      switch (params.action) {

        case "start": {
          // AUDIT N3b: agent_name used to default to the literal "unknown", so
          // every agent that omitted it landed in one bucket and per-agent
          // scoping bought nothing. It is required, and the error says so.
          const agent_name = params.agent_name?.trim();
          if (!agent_name) {
            return error("agent_name is required for engram_session(action:'start'). Sessions are owned by an agent — without a name yours cannot be told apart from another agent's, and concurrent agents would corrupt each other's records. Pass a stable identifier you reuse across sessions, e.g. agent_name:'claude-backend'.");
          }
          const verbosity = params.verbosity ?? "summary";
          const focus = params.focus;
          const resume_task = params.resume_task;
          const intent = params.intent ?? 'full_context';
          const timestamp = now();

          // ── Runtime project root override ──────────────────────────────────
          // For IDEs that spawn MCP servers from $HOME or a non-project dir
          // (e.g. Antigravity, Windsurf), the agent can pass project_root to
          // redirect the database to the correct project location.
          let dbMigrationNote: string | undefined;
          if (params.project_root && params.project_root.trim()) {
            const requested = params.project_root.trim();
            const currentRoot = getProjectRoot();
            const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
            if (norm(requested) !== norm(currentRoot)) {
              // Detect the --ide=<key> from process args (if present)
              const ideArg = process.argv.find(a => a.startsWith("--ide="));
              const ideKey = ideArg ? ideArg.slice("--ide=".length).trim() : undefined;
              const result = reinitDatabase(requested, ideKey);
              dbMigrationNote = result.message;
              log.info(`[Session] DB re-initialized: ${result.message}`);
              // Refresh all references after re-initialization
              repos = getRepos();
              services = getServices();
              projectRoot = getProjectRoot();
              db = getDb();
            }
          }

          // ── Global fallback detection ──────────────────────────────────────
          // When the DB landed at ~/.engram/global/ (no project root detected),
          // prompt the agent to ask the user for the correct project path.
          // ONLY when --ide=<key> is present (IDE couldn't provide the root).
          // If no --ide flag, the user deliberately chose a global install and
          // the global location is intentional — don't nag.
          const globalFallback = path.join(os.homedir(), ".engram", "global");
          const normRoot = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
          const hasIdeFlag = process.argv.some(a => a.startsWith("--ide="));
          let projectRootRequired: { warning: string; action: string } | undefined;
          if (normRoot(projectRoot) === normRoot(globalFallback) && !dbMigrationNote && hasIdeFlag) {
            projectRootRequired = {
              warning: "Engram could not detect your project directory. Memory is currently stored in a shared global location, which means different projects would share the same data.",
              action: "Ask the user: 'What is the absolute path to your project directory?' (This is the root folder of the project you're working on — for example C:\\Users\\you\\projects\\my-app or /home/you/projects/my-app). Then call engram_session again with project_root set to that path. Example: engram_session({ action: 'start', project_root: '/path/to/project' })",
            };
          }

          // ── Sub-agent path: task-scoped context (~300-500 tokens) ─────────
          if (params.agent_role === "sub") {
            if (params.task_id === undefined) return error("task_id required when agent_role='sub'. Pass the task ID assigned by the orchestrator.");

            // AUDIT N3a: this used to auto-close the newest open session of ANY
            // agent — i.e. the orchestrator that just spawned this sub-agent.
            // Only this agent's own stale session may be retired.
            const ownStale = repos.sessions.getOpenSessionId(agent_name);
            if (ownStale !== null) { repos.sessions.autoClose(ownStale, timestamp); }

            // AUDIT N3b: link sub -> orchestrator. The column has existed since
            // the V1 baseline migration and was never written, which is why a
            // delegated session's lineage was unrecoverable. An explicit
            // parent_session_id wins; otherwise infer the most recent open
            // session belonging to a different agent.
            let parentSessionId: number | null = null;
            if (params.parent_session_id !== undefined) {
              const declared = repos.sessions.getById(params.parent_session_id);
              if (!declared) return error(`parent_session_id #${params.parent_session_id} does not exist.`);
              parentSessionId = declared.id;
            } else {
              const candidate = repos.sessions.getOpenSessions().find(s => s.agent_name !== agent_name);
              parentSessionId = candidate?.id ?? null;
            }

            const sessionId = repos.sessions.create(agent_name, projectRoot, timestamp, parentSessionId);
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
            return success({
              session_id: sessionId,
              agent_role: "sub",
              parent_session_id: parentSessionId ?? undefined,
              task: { id: task.id, title: task.title, description: task.description, priority: task.priority, tags: taskTags },
              relevant_files: relevantFiles,
              relevant_decisions: relevantDecisions,
              relevant_conventions: relevantConventions,
              message: `Sub-agent session #${sessionId} started for task #${params.task_id}. Record changes when done, then call engram_session(action:'end'). Use engram_find({query}) for any action lookups.`,
            });
          }
          // ── End sub-agent path ─────────────────────────────────────────────

          // AUDIT N3a: retire only THIS agent's previous session. Sessions
          // belonging to other agents — including sub-agents this orchestrator
          // spawned — stay open. Restarting yourself is a legitimate reason to
          // close your own session; it is never a reason to close someone else's.
          const ownStale = repos.sessions.getOpenSessionId(agent_name);
          if (ownStale !== null) { repos.sessions.autoClose(ownStale, timestamp); }

          const lastSession = getLastCompletedSession();
          const sessionId = repos.sessions.create(agent_name, projectRoot, timestamp);

          let autoCompacted = false;
          try { autoCompacted = services.compaction.autoCompact(COMPACTION_THRESHOLD_SESSIONS); } catch { /* best effort */ }

          // ── PM mode config ─────────────────────────────────────────────────
          let pmLiteEnabled = false;
          let pmFullEnabled = false;
          try {
            pmLiteEnabled = repos.config.get('pm_lite_enabled') === 'true';
            pmFullEnabled = repos.config.get('pm_full_enabled') === 'true';
          } catch { /* best effort — config table may not exist yet in older DBs */ }
          const pmMode: 'full' | 'lite' | 'disabled' = pmFullEnabled ? 'full' : (pmLiteEnabled ? 'lite' : 'disabled');

          // ── quick_op: minimal response — session_id + rules + catalog only ─
          if (intent === 'quick_op') {
            const qCatalogTier = selectCatalogTier(agent_name, verbosity);
            storeCatalogDelivery(agent_name, qCatalogTier);
            const qRulesResult = services.agentRules.getRules();
            let qTriggeredEvents: ScheduledEventRow[] = [];
            try { qTriggeredEvents = services.events.triggerSessionEvents(); } catch { /* best effort */ }
            const qUpdateNotification = services.update.getNotification();
            return success({
              session_id: sessionId,
              intent: 'quick_op',
              pm_mode: pmMode === 'disabled' ? undefined : pmMode,
              agent_rules: qRulesResult.rules,
              agent_rules_source: qRulesResult.source,
              security_notice: qRulesResult.security_notice,
              tool_catalog: buildToolCatalog(qCatalogTier),
              triggered_events: qTriggeredEvents.length > 0 ? qTriggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
              update_available: qUpdateNotification ?? undefined,
              db_migration: dbMigrationNote ?? undefined,
              project_root_required: projectRootRequired ?? undefined,
              message: `Session #${sessionId} started (quick_op). Agent rules + tool catalog loaded. Use engram_memory — see tool_catalog.`,
            });
          }

          let recordedChanges = lastSession?.ended_at ? repos.changes.getSince(lastSession.ended_at) : [];
          const gitBranch = services.git.getBranch();
          const gitHead = services.git.getHead();
          const gitLog = lastSession?.ended_at && services.git.isRepo() ? services.git.getLogSince(lastSession.ended_at) : "";

          // Focus filtering
          let focusInfo: import("../types.js").SessionFocusInfo | undefined;
          let activeDecisions = repos.decisions.getActive(20);
          let activeConventions = repos.conventions.getActive();
          // Sort: enforced conventions first, then most recently added — so the most important appear in capped responses
          activeConventions.sort((a, b) => ((b.enforced ? 1 : 0) - (a.enforced ? 1 : 0)) || (b.id - a.id));
          const totalConventions = activeConventions.length;
          // capConventions: deliver summary (80-char intent-first), append PM conventions when PM-Full active
          const capConventions = (cap: number) => {
            const mapped = activeConventions.slice(0, cap).map(c => ({ id: c.id, category: c.category, summary: c.summary || truncate(c.rule, 80), enforced: c.enforced }));
            if (pmFullEnabled) {
              const pmConvs = pmSafe(
                () => getPMConventions().map(p => ({ id: `pm-${p.id}`, category: p.category, summary: p.compact, enforced: true })),
                [] as { id: string | number; category: string; summary: string; enforced: boolean | number }[],
                'inject PM conventions'
              );
              return [...mapped, ...pmConvs];
            }
            return mapped;
          };
          let openTasks = repos.tasks.getOpen(15, resume_task || undefined);

          if (focus && focus.trim().length > 0) {
            const ftsQuery = ftsEscape(focus);
            const totalDecisions = activeDecisions.length;
            const totalTasks = openTasks.length;
            const totalChanges = recordedChanges.length;
            try { activeDecisions = repos.decisions.getActiveFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY); } catch { /* FTS unavailable */ }
            try { activeConventions = repos.conventions.getActiveFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY); } catch { /* FTS unavailable */ }
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
            // AUDIT N3c: this UPDATE used to be unscoped — "status='pending' AND
            // (session_id IS NULL OR session_id < ?)" — so ANY agent starting a
            // session flagged EVERY other agent's in-flight work as abandoned,
            // plus every orphaned row. Nothing about C starting implies A stopped.
            // (The old `if (lastSession?.id)` guard was dead: lastSession never
            // appeared in the query.)
            //
            // Abandonment is now what it always meant: work THIS agent declared
            // in an EARLIER session and never completed. Another agent's work is
            // never touched, and rows belonging to a still-open session are left
            // alone even when they are this agent's own.
            db.prepare(`
              UPDATE pending_work SET status = 'abandoned'
              WHERE status = 'pending'
                AND agent_id = ?
                AND (session_id IS NULL OR session_id IN (
                      SELECT id FROM sessions WHERE ended_at IS NOT NULL
                    ))
                AND (session_id IS NULL OR session_id != ?)
            `).run(agent_name, sessionId);
            abandonedWork = db.prepare(
              "SELECT id, agent_id, description, files, started_at, session_id FROM pending_work WHERE status = 'abandoned' AND agent_id = ? ORDER BY started_at DESC LIMIT 5"
            ).all(agent_name) as PendingWorkRow[];
          } catch { /* best effort */ }

          interface HandoffRow { id: number; from_agent: string | null; reason: string; next_agent_instructions: string | null; resume_at: string | null; git_branch: string | null; open_task_ids: string | null; last_file_touched: string | null; created_at: number; }
          // AUDIT N3d: this used to be `ORDER BY created_at DESC LIMIT 1` with no
          // agent filter, so with two outstanding handoffs one was silently
          // invisible — and an unrelated agent could acknowledge it out from
          // under the agent it was meant for. Surface all of them; prefer one
          // authored by somebody else, since that is what "handed off to you"
          // actually means.
          // FR-0g: handoffs never superseded each other, so an unacknowledged one
          // stayed "pending" forever and was eventually promoted as live. Handoffs
          // #1 and #2 sat pending for two days; the moment #4 was acknowledged,
          // this query would have handed the next agent #2 — a stale baton from a
          // session closed days earlier — because acknowledgement was the only
          // thing that could retire a handoff, and acknowledging the CURRENT one
          // did nothing to the ones it had already overtaken.
          //
          // A handoff is a baton, and the pass is linear. Once any LATER handoff
          // has been acknowledged, every EARLIER one has been overtaken by events
          // and cannot still be live. So the newest acknowledgement is a cutoff.
          // Superseded ones are still reported — losing them would repeat N3d —
          // but they are marked stale and can never be promoted.
          let handoffPending: HandoffRow | null = null;
          let otherHandoffs: Array<{ id: number; from_agent: string | null; reason: string; stale?: true }> = [];
          try {
            const allPending = db.prepare(
              "SELECT * FROM handoffs WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 10"
            ).all() as HandoffRow[];
            const cutoff = (db.prepare(
              "SELECT MAX(acknowledged_at) AS t FROM handoffs WHERE acknowledged_at IS NOT NULL"
            ).get() as { t: number | null } | undefined)?.t ?? 0;

            const live = allPending.filter(h => h.created_at > cutoff);
            const superseded = allPending.filter(h => h.created_at <= cutoff);

            handoffPending = live.find(h => h.from_agent !== agent_name) ?? live[0] ?? null;
            otherHandoffs = [
              ...live
                .filter(h => h.id !== handoffPending?.id)
                .map(h => ({ id: h.id, from_agent: h.from_agent, reason: truncate(h.reason, 100) })),
              ...superseded
                .map(h => ({ id: h.id, from_agent: h.from_agent, reason: truncate(h.reason, 100), stale: true as const })),
            ].slice(0, 4);
          } catch { /* best effort */ }

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


          // ── phase_work: detect current phase from task tags ────────────────
          let phaseKnowledge: { phase: number; name: string; label: string; compact: string; entryCriteria: string[]; exitCriteria: string[]; instructionSummaries: string[] } | undefined;
          if (intent === 'phase_work' && pmFullEnabled) {
            let detectedPhase: number | undefined;
            // First pass: look for explicit phase:N tags on open tasks
            for (const t of openTasks) {
              const tags: string[] = t.tags ? (typeof t.tags === 'string' ? JSON.parse(t.tags) : t.tags as string[]) : [];
              for (const tag of tags) {
                const m = tag.match(/^phase:(\d+)$/);
                if (m) { const n = parseInt(m[1]); if (!detectedPhase || n > detectedPhase) detectedPhase = n; }
              }
            }
            // Second pass: keyword match against task titles
            if (!detectedPhase) {
              for (const t of openTasks) {
                const lower = t.title.toLowerCase();
                for (const [keyword, phase] of Object.entries(PHASE_MAP)) {
                  if (lower.includes(keyword)) { if (!detectedPhase || phase > detectedPhase) detectedPhase = phase; }
                }
              }
            }
            if (detectedPhase !== undefined) {
              const overview = pmSafe(() => getPhaseOverview(detectedPhase!), null as ReturnType<typeof getPhaseOverview>, 'get phase overview');
              if (overview) phaseKnowledge = overview;
            }
          }

          // ── PM-Full agent rules injection ──────────────────────────────────
          const pmAgentRules = pmFullEnabled ? [
            { priority: "HIGH", condition: "pm_full", rule: "When working on phase-tagged tasks, check phase gate checklist before marking the phase complete. Use get_knowledge(phase:N, type:'checklist')." },
            { priority: "MEDIUM", condition: "pm_full", rule: "Tag new tasks with phase:N (e.g., phase:planning, phase:execution) for phase tracking and automatic gate detection." },
            { priority: "MEDIUM", condition: "pm_full", rule: "Use get_knowledge(type:'estimation') before providing time estimates. Apply PERT formula: E=(O+4M+P)/6." },
          ] : undefined;

          // Build response
          const catalogTier = selectCatalogTier(agent_name, verbosity);
          storeCatalogDelivery(agent_name, catalogTier);
          const abandoned = abandonedWork.length > 0 ? abandonedWork.map(w => ({ id: w.id, agent_id: w.agent_id, description: w.description, files: JSON.parse(w.files), started_ago_minutes: Math.round((Date.now() - w.started_at) / 60_000) })) : undefined;
          const handoff = handoffPending ? { id: handoffPending.id, from_agent: handoffPending.from_agent, reason: handoffPending.reason, next_agent_instructions: handoffPending.next_agent_instructions, git_branch: handoffPending.git_branch } : undefined;
          const rulesResult = services.agentRules.getRules();
          const baseResponse = {
            session_id: sessionId,
            intent: intent !== 'full_context' ? intent : undefined,
            pm_mode: pmMode === 'disabled' ? undefined : pmMode,
            pm_agent_rules: pmAgentRules,
            previous_session: lastSession ? { id: lastSession.id, summary: lastSession.summary, ended_at: lastSession.ended_at, agent: lastSession.agent_name } : null,
            git: { branch: gitBranch, head: gitHead },
            auto_compacted: autoCompacted,
            focus: focusInfo,
            suggested_focus: suggestedFocus,
            abandoned_work: abandoned,
            handoff_pending: handoff,
            other_handoffs_pending: otherHandoffs.length > 0 ? otherHandoffs : undefined,
            update_available: updateNotification ?? undefined,
            agent_rules: rulesResult.rules,
            agent_rules_source: rulesResult.source,
            security_notice: rulesResult.security_notice,
            tool_catalog: buildToolCatalog(catalogTier),
            triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
            db_migration: dbMigrationNote ?? undefined,
            project_root_required: projectRootRequired ?? undefined,
          };

          if (verbosity === "nano") {
            return success({
              session_id: sessionId,
              verbosity: "nano",
              counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: activeConventions.length, tasks: openTasks.length, files: repos.fileNotes.countAll() },
              agent_rules: rulesResult.rules,
              agent_rules_source: rulesResult.source,
              security_notice: rulesResult.security_notice,
              tool_catalog: buildToolCatalog(0),
              triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
              update_available: updateNotification ?? undefined,
              db_migration: dbMigrationNote ?? undefined,
              project_root_required: projectRootRequired ?? undefined,
              message: `Session #${sessionId} started (nano). Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}`,
            });
          }

          if (verbosity === "minimal") {
            const topDecision = activeDecisions.length > 0 ? { id: activeDecisions[0].id, decision: truncate(activeDecisions[0].decision, 60) } : undefined;
            const topTask = openTasks.length > 0 ? { id: openTasks[0].id, title: openTasks[0].title, priority: openTasks[0].priority } : undefined;
            return success({ ...baseResponse, verbosity: "minimal", counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: totalConventions, tasks: openTasks.length, files: repos.fileNotes.countAll() }, top_decision: topDecision, top_task: topTask, active_conventions: capConventions(5), total_conventions: totalConventions, message: `Session #${sessionId} started. Use engram_memory for all ops — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` });
          }

          if (verbosity === "summary") {
            return success({ ...baseResponse, verbosity: "summary", changes_since_last: { count: recordedChanges.length, recent: recordedChanges.slice(0, 3).map(c => ({ file_path: c.file_path, change_type: c.change_type, description: truncate(c.description, 80), timestamp: c.timestamp })) }, active_decisions: activeDecisions.slice(0, 3).map(d => ({ id: d.id, decision: truncate(d.decision, 80), status: d.status, tags: d.tags })), active_conventions: capConventions(6), total_conventions: totalConventions, conventions_note: totalConventions > 6 ? `Showing 6 of ${totalConventions} conventions. Use engram_memory(action:'get_conventions') for all.` : undefined, open_tasks: openTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })), total_file_notes: repos.fileNotes.countAll(), git_hook_log: gitHookLog || undefined, phase_knowledge: phaseKnowledge ?? undefined, message: lastSession ? `Session #${sessionId} started. Resuming from #${lastSession.id}. ${recordedChanges.length} changes since. Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` : `Session #${sessionId} started. First session. Use engram_memory — see tool_catalog.` });
          }

          // full verbosity
          let projectSnapshot = null;
          try { projectSnapshot = services.scan.getOrRefresh(projectRoot); } catch { /* best effort */ }
          return success({ ...baseResponse, verbosity: "full", changes_since_last: { recorded: recordedChanges, git_log: gitLog }, active_decisions: activeDecisions, active_conventions: capConventions(activeConventions.length + 10), open_tasks: openTasks, project_snapshot: projectSnapshot, git_hook_log: gitHookLog || undefined, phase_knowledge: phaseKnowledge ?? undefined, message: lastSession ? `Session #${sessionId} started (full). ${recordedChanges.length} changes since session #${lastSession.id}. Use engram_memory — see tool_catalog.` : `Session #${sessionId} started (full). First session. Use engram_memory — see tool_catalog.` });
        }

        case "end": {
          // Accept summary from params.summary OR params.query (universal mode fallback: engram({action:"end", query:"..."})).
          const endSummary = params.summary ?? (params as Record<string, unknown>).query as string | undefined;
          if (!endSummary) return error("summary required for end action. Pass summary:'...' or, in universal mode, query:'...'.");
          // Reassign for the rest of the handler
          (params as Record<string, unknown>).summary = endSummary;
          // AUDIT N3a: this used to re-derive "the current session" from a
          // global query, so agent B's summary landed on agent A's record.
          const resolution = resolveSession(params, repos);
          const sessionId = resolution.id;
          if (!sessionId) return error("No active session. Start one first with engram_session(action:'start').");
          const timestamp = now();

          const sessionRow = repos.sessions.getById(sessionId) as { agent_name?: string; ended_at?: string | null } | null;
          if (!sessionRow) return error(`Session #${sessionId} not found.`);
          if (sessionRow.ended_at) return error(`Session #${sessionId} is already closed. Its summary was left untouched — start a new session rather than re-ending a closed one.`);
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
          let observationCount = 0;
          try { observationCount = repos.observations.countBySession(sessionId); } catch { /* table may not exist */ }
          const didClose = repos.sessions.close(sessionId, timestamp, endSummary, params.tags);
          if (!didClose) return error(`Session #${sessionId} is already closed. Its summary was left untouched.`);

          return success({ message: `Session #${sessionId} ended.${claimedTasksWarning ? ` ⚠️ ${claimedTasksWarning.length} claimed task(s) still open.` : ""}`, session_id: sessionId, agent_name: agentName ?? undefined, stats: { changes_recorded: changeCount, decisions_made: decisionCount, tasks_completed: tasksDone, observations_recorded: observationCount }, session_resolution: ambiguityNote(resolution, "end"), ...(claimedTasksWarning ? { claimed_tasks_warning: { tasks: claimedTasksWarning } } : {}) });
        }

        case "get_history": {
          const sessions = repos.sessions.getHistory(params.limit ?? 10, params.offset ?? 0, params.agent_name);
          const total = repos.sessions.countAll();
          return success({ sessions, total, has_more: (params.offset ?? 0) + (params.limit ?? 10) < total });
        }

        case "handoff": {
          if (!params.reason) return error("reason required for handoff");
          const handoffResolution = resolveSession(params, repos);
          const sessionId = handoffResolution.id;
          if (!sessionId) return error("No active session.");
          const gitBranch = services.git.getBranch();
          const openTasks = repos.tasks.getOpen(20);
          const recentChanges = repos.changes.getBySession(sessionId);
          const lastFileTouched = recentChanges.length > 0 ? recentChanges[recentChanges.length - 1].file_path : null;
          const fromAgent = (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? "unknown";
          const result = db.prepare(`INSERT INTO handoffs (from_session_id, from_agent, created_at, reason, next_agent_instructions, resume_at, git_branch, open_task_ids, last_file_touched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, fromAgent, Date.now(), params.reason, params.next_agent_instructions ?? null, null, gitBranch, openTasks.length > 0 ? JSON.stringify(openTasks.map(t => t.id)) : null, lastFileTouched);
          return success({ handoff_id: result.lastInsertRowid, from_session_id: sessionId, session_resolution: ambiguityNote(handoffResolution, "handoff"), message: `Handoff #${result.lastInsertRowid} created. Next agent will see this in start_session.` });
        }

        case "acknowledge_handoff": {
          if (params.id === undefined) return error("id required for acknowledge_handoff");
          const ackResolution = resolveSession(params, repos);
          const sessionId = ackResolution.id;
          // AUDIT N3d: acknowledging used to be anonymous — no active session was
          // required, `acknowledged_by` fell back to the literal "unknown", and
          // any agent could clear any handoff. Acknowledging is a claim that YOU
          // read it, so it needs a real identity behind it.
          if (!sessionId) return error("No active session. Start one with engram_session(action:'start') before acknowledging a handoff — acknowledging records who read it.");
          const ackAgent = (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? null;
          if (!ackAgent) return error(`Session #${sessionId} not found.`);

          const target = db.prepare("SELECT id, from_session_id, from_agent, reason, acknowledged_at, acknowledged_by FROM handoffs WHERE id = ?")
            .get(params.id) as { id: number; from_session_id: number; from_agent: string | null; reason: string; acknowledged_at: number | null; acknowledged_by: string | null } | undefined;
          if (!target) return error(`Handoff #${params.id} not found.`);
          if (target.acknowledged_at) return error(`Handoff #${params.id} was already acknowledged by "${target.acknowledged_by ?? "unknown"}".`);
          // A handoff is addressed to whoever comes next, so a later session of
          // the SAME agent may legitimately acknowledge it. Acknowledging one
          // your own still-open session just created is the nonsensical case —
          // it would clear the handoff before anyone could act on it.
          if (target.from_session_id === sessionId) {
            return error(`Handoff #${params.id} was created by this same session (#${sessionId}). Acknowledging it now would hide it from the agent it was written for.`);
          }

          const result = db.prepare(`UPDATE handoffs SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL`).run(Date.now(), ackAgent, params.id);
          if ((result.changes as number) === 0) return error(`Handoff #${params.id} not found or already acknowledged.`);
          return success({ message: `Handoff #${params.id} acknowledged.`, handoff_id: params.id, from_agent: target.from_agent, acknowledged_by: ackAgent });
        }

        default:
          return error(`Unknown session action: ${(params as Record<string, unknown>).action}`);
      }
    }
  );
}
