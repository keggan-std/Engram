// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getRepos, getServices, getDb, logToolCall } from "../database.js";
import { TOOL_PREFIX, COMPACTION_THRESHOLD_SESSIONS, FOCUS_MAX_ITEMS_PER_CATEGORY } from "../constants.js";
import { log } from "../logger.js";
import { truncate, ftsEscape, coerceStringArray } from "../utils.js";
import { success, error } from "../response.js";
import type { SessionContext, ProjectSnapshot, ScheduledEventRow } from "../types.js";
import { buildToolCatalog, AGENT_RULES } from "./find.js";

export function registerSessionTools(server: McpServer): void {
  // ─── START SESSION ──────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_start_session`,
    {
      title: "Start Session",
      description: `Begin a new working session. Returns full context: previous session summary, all changes since last session (both agent-recorded and git-detected), active architectural decisions, enforced conventions, and open tasks. Call this FIRST when starting work on a project.

Args:
  - agent_name (string, optional): Identifier for the agent (e.g., "copilot", "claude-code", "cursor")
  - resume_task (string, optional): If resuming a specific task, provide its title to auto-focus context
  - verbosity ("full" | "summary" | "minimal", optional): Controls response size. "minimal" returns counts only (~90% fewer tokens), "summary" returns truncated recent items (~60-80% fewer tokens), "full" returns everything including file_tree. Default: "summary".
  - focus (string, optional): Topic or keywords to focus context on (e.g., "auth", "installer refactor"). When provided, decisions, tasks, and changes are FTS-ranked and filtered to the top-15 most relevant items per category. Use engram_search for broader queries outside the focus. Conventions are always returned in full regardless of focus.

Returns:
  SessionContext object with previous session info, changes, decisions, conventions, and open tasks.`,
      inputSchema: {
        agent_name: z.string().default("unknown").describe("Name of the agent starting the session"),
        resume_task: z.string().optional().describe("Title of a task to resume, for focused context"),
        verbosity: z.enum(["full", "summary", "minimal"]).default("summary").describe("Response detail level: full, summary, or minimal"),
        focus: z.string().optional().describe("Topic/keywords to filter context to (e.g. 'auth', 'installer refactor'). Returns top-15 FTS-ranked items per category."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ agent_name, resume_task, verbosity, focus }) => {
      const repos = getRepos();
      const services = getServices();
      const projectRoot = getProjectRoot();
      const timestamp = now();

      // Check for an already-open session and close it
      const openSession = getCurrentSessionId();
      if (openSession) {
        repos.sessions.autoClose(openSession, timestamp);
      }

      // Get previous session context
      const lastSession = getLastCompletedSession();

      // Create new session
      const sessionId = repos.sessions.create(agent_name, projectRoot, timestamp);

      // ─── Auto-compaction via service ────────────────────────
      let autoCompacted = false;
      try {
        autoCompacted = services.compaction.autoCompact(COMPACTION_THRESHOLD_SESSIONS);
      } catch (e) {
        log.warn(`Auto-compaction skipped: ${e}`);
      }

      // Gather changes since last session
      let recordedChanges = lastSession?.ended_at
        ? repos.changes.getSince(lastSession.ended_at)
        : [];

      // Git context via service
      const gitBranch = services.git.getBranch();
      const gitHead = services.git.getHead();
      const gitLog = lastSession?.ended_at && services.git.isRepo()
        ? services.git.getLogSince(lastSession.ended_at)
        : "";

      // ─── Focus filtering ─────────────────────────────────────
      // When a focus query is provided, rank decisions/tasks/changes by FTS relevance
      // and return only the top-N most relevant per category. Conventions are always
      // returned in full — they're short and always relevant to any work.
      let focusInfo: import("../types.js").SessionFocusInfo | undefined;

      let activeDecisions = repos.decisions.getActive(20);
      const activeConventions = repos.conventions.getActive();
      let openTasks = repos.tasks.getOpen(15, resume_task || undefined);

      if (focus && focus.trim().length > 0) {
        const ftsQuery = ftsEscape(focus);
        const totalDecisions = activeDecisions.length;
        const totalTasks = openTasks.length;
        const totalChanges = recordedChanges.length;

        try {
          activeDecisions = repos.decisions.getActiveFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY);
        } catch { /* FTS unavailable — keep full list */ }

        try {
          openTasks = repos.tasks.getOpenFocused(ftsQuery, FOCUS_MAX_ITEMS_PER_CATEGORY);
        } catch { /* FTS unavailable — keep full list */ }

        // Filter changes in-memory: keep if any focus word appears in path, description, or diff
        const focusWords = focus.toLowerCase().split(/\s+/).filter(Boolean);
        const focusedChanges = recordedChanges.filter(c =>
          focusWords.some(w =>
            c.file_path.toLowerCase().includes(w) ||
            c.description.toLowerCase().includes(w) ||
            (c.diff_summary ?? "").toLowerCase().includes(w)
          )
        );
        // Only apply the filter if it returned something — avoids empty context on weak matches
        if (focusedChanges.length > 0) {
          recordedChanges = focusedChanges;
        }

        focusInfo = {
          query: focus,
          decisions_returned: activeDecisions.length,
          tasks_returned: openTasks.length,
          changes_returned: recordedChanges.length,
          note: `Context filtered to focus "${focus}". Full memory available via engram_search.`,
        };

        log.info(`Focus "${focus}": ${totalDecisions}→${activeDecisions.length} decisions, ${totalTasks}→${openTasks.length} tasks, ${totalChanges}→${recordedChanges.length} changes`);
      }

      // ─── Project snapshot via service ───────────────────────
      let projectSnapshot: ProjectSnapshot | null = null;
      if (verbosity === "full") {
        try {
          projectSnapshot = services.scan.getOrRefresh(projectRoot);
        } catch { /* scan is best-effort */ }
      }

      // ─── Git hook log via service ──────────────────────────
      const gitHookLog = services.git.parseHookLog(lastSession?.ended_at);

      // ─── Trigger scheduled events via service ──────────────
      let triggeredEvents: ScheduledEventRow[] = [];
      try {
        triggeredEvents = services.events.triggerSessionEvents();
      } catch { /* scheduled_events table may not exist yet */ }

      // ─── Update notification (once per process) ────────────
      const updateNotification = services.update.getNotification();

      // ─── F2: Surface abandoned pending_work from prior sessions ─────
      interface PendingWorkRow { id: number; agent_id: string; description: string; files: string; started_at: number; session_id: number | null; }
      let abandonedWork: PendingWorkRow[] = [];
      try {
        // Mark any pending work from closed sessions as abandoned
        const db = getDb();
        if (lastSession?.id) {
          db.prepare(
            `UPDATE pending_work SET status = 'abandoned'
             WHERE status = 'pending' AND (session_id IS NULL OR session_id < ?)`
          ).run(sessionId);
        }
        abandonedWork = db.prepare(
          "SELECT id, agent_id, description, files, started_at, session_id FROM pending_work WHERE status = 'abandoned' ORDER BY started_at DESC LIMIT 5"
        ).all() as PendingWorkRow[];
      } catch { /* best effort — table may not exist */ }

      // ─── F6: Check for unacknowledged handoff from a previous agent ──
      interface HandoffRow { id: number; from_agent: string | null; reason: string; next_agent_instructions: string | null; resume_at: string | null; git_branch: string | null; open_task_ids: string | null; last_file_touched: string | null; created_at: number; }
      let handoffPending: HandoffRow | null = null;
      try {
        handoffPending = getDb().prepare(
          "SELECT * FROM handoffs WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 1"
        ).get() as HandoffRow | null;
      } catch { /* table may not exist on older DBs */ }

      // ─── Q5: Auto-suggest focus when none provided ─────────
      let suggestedFocus: string | undefined;
      if (!focus) {
        // Derive suggested focus from: most-recently-touched file prefix, highest-priority task title, most-recent decision
        const candidates: string[] = [];
        // Recent file path component
        if (recordedChanges.length > 0) {
          const fp = recordedChanges[recordedChanges.length - 1].file_path;
          const parts = fp.replace(/\\/g, "/").split("/").filter(Boolean);
          // Take the last directory name before the filename as the focus hint
          if (parts.length >= 2) candidates.push(parts[parts.length - 2]);
        }
        // Highest priority open task — first content word
        if (openTasks.length > 0) {
          const taskWord = openTasks[0].title.split(/\s+/).find(w => w.length > 3);
          if (taskWord) candidates.push(taskWord.toLowerCase());
        }
        // Most recent decision — first meaningful word
        if (activeDecisions.length > 0) {
          const decWord = activeDecisions[0].decision.split(/\s+/).find(w => w.length > 4);
          if (decWord) candidates.push(decWord.toLowerCase());
        }
        if (candidates.length > 0) {
          suggestedFocus = candidates[0];
        }
      }

      // F10: Log this tool invocation for session replay
      logToolCall("start_session", "success", `agent=${agent_name} verbosity=${verbosity}`);

      // ─── Build response based on verbosity ─────────────────
      if (verbosity === "minimal") {
        return success({
          session_id: sessionId,
          verbosity: "minimal",
          previous_session: lastSession
            ? { id: lastSession.id, summary: lastSession.summary, ended_at: lastSession.ended_at, agent: lastSession.agent_name }
            : null,
          counts: {
            changes_since_last: recordedChanges.length,
            active_decisions: activeDecisions.length,
            active_conventions: activeConventions.length,
            open_tasks: openTasks.length,
            triggered_events: triggeredEvents.length,
            total_files: repos.fileNotes.countAll(),
          },
          git: { branch: gitBranch, head: gitHead },
          auto_compacted: autoCompacted,
          focus: focusInfo,
          abandoned_work: abandonedWork.length > 0 ? abandonedWork.map(w => ({
            id: w.id, agent_id: w.agent_id, description: w.description,
            files: JSON.parse(w.files), started_ago_minutes: Math.round((Date.now() - w.started_at) / 60_000),
          })) : undefined,
          handoff_pending: handoffPending ? { id: handoffPending.id, from_agent: handoffPending.from_agent, reason: handoffPending.reason, next_agent_instructions: handoffPending.next_agent_instructions, resume_at: handoffPending.resume_at, git_branch: handoffPending.git_branch } : undefined,
          suggested_focus: suggestedFocus,
          update_available: updateNotification ?? undefined,
          agent_rules: AGENT_RULES,
          tool_catalog: buildToolCatalog(),
          message: `Session #${sessionId} started (minimal mode). Use engram_memory for all memory ops. See tool_catalog for available actions.${abandonedWork.length > 0 ? ` ⚠️ ${abandonedWork.length} abandoned work item(s) detected — review abandoned_work field.` : ""}${handoffPending ? ` 🤝 Handoff pending from "${handoffPending.from_agent ?? "previous agent"}" — see handoff_pending field.` : ""}${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}${updateNotification ? ` ⚡ Engram v${updateNotification.available_version} is available (currently v${updateNotification.installed_version}).` : ""}`,
        });
      }

      if (verbosity === "summary") {
        return success({
          session_id: sessionId,
          verbosity: "summary",
          previous_session: lastSession
            ? { id: lastSession.id, summary: lastSession.summary, ended_at: lastSession.ended_at, agent: lastSession.agent_name }
            : null,
          changes_since_last: {
            count: recordedChanges.length,
            recent: recordedChanges.slice(0, 5).map(c => ({
              file_path: c.file_path,
              change_type: c.change_type,
              description: truncate(c.description, 120),
              timestamp: c.timestamp,
            })),
            git_log: gitLog ? truncate(gitLog, 500) : "",
          },
          active_decisions: activeDecisions.slice(0, 5).map(d => ({
            id: d.id,
            decision: truncate(d.decision, 120),
            status: d.status,
            tags: d.tags,
          })),
          active_conventions: activeConventions.map(c => ({
            id: c.id,
            category: c.category,
            rule: truncate(c.rule, 100),
          })),
          open_tasks: openTasks.slice(0, 5).map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
          })),
          triggered_events: triggeredEvents.length > 0
            ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority }))
            : undefined,
          git: { branch: gitBranch, head: gitHead },
          git_hook_log: gitHookLog || undefined,
          total_file_notes: repos.fileNotes.countAll(),
          auto_compacted: autoCompacted,
          focus: focusInfo,
          abandoned_work: abandonedWork.length > 0 ? abandonedWork.map(w => ({
            id: w.id, agent_id: w.agent_id, description: w.description,
            files: JSON.parse(w.files), started_ago_minutes: Math.round((Date.now() - w.started_at) / 60_000),
          })) : undefined,
          handoff_pending: handoffPending ? { id: handoffPending.id, from_agent: handoffPending.from_agent, reason: handoffPending.reason, next_agent_instructions: handoffPending.next_agent_instructions, resume_at: handoffPending.resume_at, git_branch: handoffPending.git_branch } : undefined,
          suggested_focus: suggestedFocus,
          update_available: updateNotification ?? undefined,
          agent_rules: AGENT_RULES,
          tool_catalog: buildToolCatalog(),
          message: lastSession
            ? `Session #${sessionId} started. Resuming from session #${lastSession.id} (${lastSession.agent_name}). ${recordedChanges.length} changes since then. Use engram_memory for all memory ops — see tool_catalog.${abandonedWork.length > 0 ? ` ⚠️ ${abandonedWork.length} abandoned work item(s) — check abandoned_work field.` : ""}${handoffPending ? ` 🤝 Handoff pending from "${handoffPending.from_agent ?? "previous agent"}" — see handoff_pending.` : ""}${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}${autoCompacted ? " [Auto-compacted old sessions.]" : ""}${updateNotification ? ` ⚡ Engram v${updateNotification.available_version} available.` : ""}`
            : `Session #${sessionId} started. First session — no prior memory. Use engram_memory for all memory ops — see tool_catalog.`,
        });
      }

      // ─── verbosity === "full" ──────────────────────────────
      const context: SessionContext & {
        git?: { branch: string | null; head: string | null };
        project_snapshot?: ProjectSnapshot | null;
        git_hook_log?: string;
        triggered_events?: ScheduledEventRow[];
        abandoned_work?: Array<{ id: number; agent_id: string; description: string; files: unknown; started_ago_minutes: number }>;
        handoff_pending?: { id: number; from_agent: string | null; reason: string; next_agent_instructions: string | null; resume_at: string | null; git_branch: string | null };
        suggested_focus?: string;
        update_available?: typeof updateNotification;
        agent_rules?: unknown;
        tool_catalog?: unknown;
      } = {
        session_id: sessionId,
        previous_session: lastSession
          ? {
            id: lastSession.id,
            summary: lastSession.summary,
            ended_at: lastSession.ended_at,
            agent: lastSession.agent_name,
          }
          : null,
        changes_since_last: {
          recorded: recordedChanges,
          git_log: gitLog,
        },
        active_decisions: activeDecisions,
        active_conventions: activeConventions,
        open_tasks: openTasks,
        project_snapshot_age_minutes: projectSnapshot ? 0 : null,
        focus: focusInfo,
        suggested_focus: suggestedFocus,
        git: { branch: gitBranch, head: gitHead },
        project_snapshot: projectSnapshot,
        git_hook_log: gitHookLog || undefined,
        triggered_events: triggeredEvents.length > 0 ? triggeredEvents : undefined,
        abandoned_work: abandonedWork.length > 0 ? abandonedWork.map(w => ({
          id: w.id, agent_id: w.agent_id, description: w.description,
          files: JSON.parse(w.files), started_ago_minutes: Math.round((Date.now() - w.started_at) / 60_000),
        })) : undefined,
        handoff_pending: handoffPending ? { id: handoffPending.id, from_agent: handoffPending.from_agent, reason: handoffPending.reason, next_agent_instructions: handoffPending.next_agent_instructions, resume_at: handoffPending.resume_at, git_branch: handoffPending.git_branch } : undefined,
        update_available: updateNotification ?? undefined,
        agent_rules: AGENT_RULES,
        tool_catalog: buildToolCatalog(),
        message: lastSession
          ? `Session #${sessionId} started (full). Resuming from session #${lastSession.id} (${lastSession.agent_name}). ${recordedChanges.length} recorded changes since then. Use engram_memory for all memory ops — see tool_catalog.${abandonedWork.length > 0 ? ` ⚠️ ${abandonedWork.length} abandoned work item(s) — check abandoned_work field.` : ""}${handoffPending ? ` 🤝 Handoff pending from "${handoffPending.from_agent ?? "previous agent"}" — see handoff_pending.` : ""}${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}${autoCompacted ? " [Auto-compacted.]" : ""}${updateNotification ? ` ⚡ Engram v${updateNotification.available_version} available.` : ""}`
          : `Session #${sessionId} started (full). First session. Use engram_memory for all memory ops — see tool_catalog.`,
      };

      return success(context as unknown as Record<string, unknown>);
    }
  );

  // ─── END SESSION ────────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_end_session`,
    {
      title: "End Session",
      description: `End the current working session with a summary of accomplishments. The summary is critical — it becomes the starting context for the next session. Be specific about what was done, what's pending, and any blockers.

Args:
  - summary (string): Detailed summary of what was accomplished this session
  - tags (array of strings, optional): Tags for categorizing the session (e.g., "refactoring", "feature/auth", "bugfix")

Returns:
  Confirmation with session stats.`,
      inputSchema: {
        summary: z.string().min(10).describe("Detailed summary of session accomplishments, pending work, and blockers"),
        tags: coerceStringArray().optional().describe("Tags for session categorization"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ summary, tags }) => {
      const repos = getRepos();
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      if (!sessionId) {
        return error("No active session to end. Start one with engram_start_session first.");
      }

      // Q4: Warn on unclosed claimed tasks before closing
      const sessionRow = repos.sessions.getById(sessionId) as { agent_name?: string } | null;
      const agentName = sessionRow?.agent_name ?? null;
      let claimedTasksWarning: Array<{ id: number; title: string; status: string }> | undefined;
      if (agentName) {
        try {
          const unclosed = db.prepare(
            "SELECT id, title, status FROM tasks WHERE claimed_by = ? AND status NOT IN ('done', 'cancelled')"
          ).all(agentName) as Array<{ id: number; title: string; status: string }>;
          if (unclosed.length > 0) claimedTasksWarning = unclosed;
        } catch { /* tasks may not have claimed_by on older schemas */ }
      }

      // Get session stats before closing
      const changeCount = repos.changes.countBySession(sessionId);
      const decisionCount = repos.sessions.countBySession(sessionId, "decisions");
      const tasksDone = repos.tasks.countDoneInSession(sessionId);

      // F10: Log before closing so session_id is still valid
      logToolCall("end_session", "success", `changes=${changeCount} decisions=${decisionCount} tasks_done=${tasksDone}`);

      // Close the session
      repos.sessions.close(sessionId, timestamp, summary, tags);

      return success({
        message: `Session #${sessionId} ended successfully.${claimedTasksWarning ? ` ⚠️ ${claimedTasksWarning.length} claimed task(s) still open — release or complete them.` : ""}`,
        stats: {
          changes_recorded: changeCount,
          decisions_made: decisionCount,
          tasks_completed: tasksDone,
        },
        summary,
        ...(claimedTasksWarning ? {
          claimed_tasks_warning: {
            message: `You have ${claimedTasksWarning.length} uncompleted claimed task(s). Call engram_release_task or engram_update_task (status: 'done') for each.`,
            tasks: claimedTasksWarning,
          },
        } : {}),
      });
    }
  );

  // ─── GET SESSION HISTORY ────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_get_session_history`,
    {
      title: "Get Session History",
      description: `Retrieve past session summaries to understand project evolution over time.

Args:
  - limit (number, optional): Max sessions to return (default 10)
  - agent_name (string, optional): Filter by specific agent
  - offset (number, optional): Skip N sessions for pagination

Returns:
  Array of past sessions with summaries, timestamps, and tags.`,
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe("Max sessions to return"),
        agent_name: z.string().optional().describe("Filter by agent name"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit, agent_name, offset }) => {
      const repos = getRepos();

      const sessions = repos.sessions.getHistory(limit, offset, agent_name);
      const total = repos.sessions.countAll();

      return success({ sessions, total, has_more: offset + limit < total });
    }
  );

  // -- SUGGEST COMMIT -------------------------------------------------------
  server.registerTool(
    `${TOOL_PREFIX}_suggest_commit`,
    {
      title: "Suggest Commit Message",
      description: "Analyze changes in the current session and generate a conventional commit message.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const sessionId = getCurrentSessionId();
      if (!sessionId) {
        return error("No active session. Start a session with engram_start_session first.");
      }

      const repos = getRepos();
      const changes = repos.changes.getBySession(sessionId);

      if (changes.length === 0) {
        return success({
          message: "No changes recorded in the current session.",
          suggested_message: null,
          breakdown: null,
        });
      }

      // Group by change_type
      const typeCounts: Record<string, number> = {};
      for (const c of changes) {
        typeCounts[c.change_type] = (typeCounts[c.change_type] || 0) + 1;
      }

      // Determine commit type
      const created = typeCounts["created"] || 0;
      const modified = typeCounts["modified"] || 0;
      const refactored = typeCounts["refactored"] || 0;
      const total = changes.length;
      let commitType: string;
      if (created > total / 2) {
        commitType = "feat";
      } else if (refactored > modified && refactored > created) {
        commitType = "refactor";
      } else if (modified > total / 2) {
        commitType = "fix";
      } else {
        commitType = "chore";
      }

      // Scope: most common directory prefix among changed files
      const dirCounts: Record<string, number> = {};
      for (const c of changes) {
        const parts = c.file_path.replace(/\\/g, "/").split("/");
        if (parts.length >= 2) {
          const scopeKey = parts.length >= 3 && parts[0] === "src"
            ? parts[1]
            : parts[0];
          dirCounts[scopeKey] = (dirCounts[scopeKey] || 0) + 1;
        }
      }
      const scope = Object.keys(dirCounts).sort((a, b) => dirCounts[b] - dirCounts[a])[0] || "app";

      // Build body from top-5 changes
      const top5 = changes.slice(0, 5);
      const bodyLines = top5.map(c => {
        const desc = truncate(c.description, 80);
        return `- ${c.file_path}: ${desc}`;
      });
      if (changes.length > 5) {
        bodyLines.push(`- ...and ${changes.length - 5} more change(s)`);
      }

      const subject = `${commitType}(${scope}): summarize changes from session #${sessionId}`;
      const body = bodyLines.join("\n");
      const suggestedMessage = `${subject}

${body}`;

      return success({
        suggested_message: suggestedMessage,
        breakdown: {
          type: commitType,
          scope,
          files_changed: changes.length,
          change_types: typeCounts,
        },
      });
    }
  );

  // ─── HANDOFF ────────────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_handoff`,
    {
      title: "Create Agent Handoff",
      description: `Create a structured handoff packet for the next agent when your context is nearly exhausted. The handoff is surfaced automatically in start_session as handoff_pending. Call this BEFORE context is completely exhausted so your instructions are preserved.

Args:
  - reason (string): Why you are handing off (e.g., "context_exhausted", "task_complete", "blocked")
  - next_agent_instructions (string, optional): Specific instructions for the incoming agent — what to do next, what to avoid, key context to know
  - resume_at (string, optional): Specific file, function, or task to resume at (e.g., "src/tools/sessions.ts line 300", "Task #5")

Returns:
  Handoff ID and confirmation. The next agent will see this in start_session.`,
      inputSchema: {
        reason: z.string().min(3).describe("Why you are handing off"),
        next_agent_instructions: z.string().optional().describe("Instructions for the next agent"),
        resume_at: z.string().optional().describe("File, function, or task to resume at"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ reason, next_agent_instructions, resume_at }) => {
      const db = getDb();
      const sessionId = getCurrentSessionId();
      const repos = getRepos();
      const services = getServices();

      if (!sessionId) {
        return error("No active session. Start one with engram_start_session first.");
      }

      // Gather context for the handoff packet
      const gitBranch = services.git.getBranch();
      const openTasks = repos.tasks.getOpen(20);
      const openTaskIds = openTasks.map(t => t.id);

      // Last touched file: most recent change in this session
      const recentChanges = repos.changes.getBySession(sessionId);
      const lastFileTouched = recentChanges.length > 0
        ? recentChanges[recentChanges.length - 1].file_path
        : null;

      const fromAgent = (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? "unknown";

      const result = db.prepare(`
        INSERT INTO handoffs (from_session_id, from_agent, created_at, reason, next_agent_instructions, resume_at, git_branch, open_task_ids, last_file_touched)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        fromAgent,
        Date.now(),
        reason,
        next_agent_instructions ?? null,
        resume_at ?? null,
        gitBranch,
        openTaskIds.length > 0 ? JSON.stringify(openTaskIds) : null,
        lastFileTouched
      );

      const handoffId = result.lastInsertRowid as number;

      return success({
        handoff_id: handoffId,
        message: `Handoff #${handoffId} created. The next agent will see this in start_session as handoff_pending.`,
        snapshot: {
          from_agent: fromAgent,
          git_branch: gitBranch,
          open_task_count: openTaskIds.length,
          last_file_touched: lastFileTouched,
          resume_at: resume_at ?? null,
        },
      });
    }
  );

  // ─── ACKNOWLEDGE HANDOFF ─────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_acknowledge_handoff`,
    {
      title: "Acknowledge Handoff",
      description: `Mark a handoff as acknowledged after reading it in start_session. This clears it from future start_session responses so it is not surfaced again.

Args:
  - id (number): Handoff ID to acknowledge (from start_session handoff_pending.id)

Returns:
  Confirmation.`,
      inputSchema: {
        id: z.number().int().describe("Handoff ID to acknowledge"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const db = getDb();
      const repos = getRepos();
      const sessionId = getCurrentSessionId();
      const fromAgent = sessionId
        ? (repos.sessions.getById(sessionId) as { agent_name?: string } | null)?.agent_name ?? "unknown"
        : "unknown";

      const result = db.prepare(`
        UPDATE handoffs SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL
      `).run(Date.now(), fromAgent, id);

      if ((result.changes as number) === 0) {
        return error(`Handoff #${id} not found or already acknowledged.`);
      }

      return success({ message: `Handoff #${id} acknowledged. It will no longer appear in start_session.` });
    }
  );
}

// ============================================================================
// engram_session — Lean Surface Dispatcher (v1.6)
// Routes action:"start" | "end" | "get_history" | "handoff" to session logic.
// ============================================================================

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
            tool_catalog: buildToolCatalog(),
            triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
          };

          if (verbosity === "nano") {
            return success({
              session_id: sessionId,
              verbosity: "nano",
              counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: activeConventions.length, tasks: openTasks.length, files: repos.fileNotes.countAll() },
              agent_rules: rulesResult.rules,
              agent_rules_source: rulesResult.source,
              tool_catalog: buildToolCatalog(),
              triggered_events: triggeredEvents.length > 0 ? triggeredEvents.map(e => ({ id: e.id, title: e.title, priority: e.priority })) : undefined,
              update_available: updateNotification ?? undefined,
              message: `Session #${sessionId} started (nano). Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}`,
            });
          }

          if (verbosity === "minimal") {
            return success({ ...baseResponse, verbosity: "minimal", counts: { changes: recordedChanges.length, decisions: activeDecisions.length, conventions: activeConventions.length, tasks: openTasks.length, files: repos.fileNotes.countAll() }, message: `Session #${sessionId} started. Use engram_memory for all ops — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` });
          }

          if (verbosity === "summary") {
            return success({ ...baseResponse, verbosity: "summary", changes_since_last: { count: recordedChanges.length, recent: recordedChanges.slice(0, 5).map(c => ({ file_path: c.file_path, change_type: c.change_type, description: truncate(c.description, 120), timestamp: c.timestamp })), git_log: gitLog ? truncate(gitLog, 500) : "" }, active_decisions: activeDecisions.slice(0, 5).map(d => ({ id: d.id, decision: truncate(d.decision, 120), status: d.status, tags: d.tags })), active_conventions: activeConventions.map(c => ({ id: c.id, category: c.category, rule: truncate(c.rule, 100) })), open_tasks: openTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })), total_file_notes: repos.fileNotes.countAll(), git_hook_log: gitHookLog || undefined, message: lastSession ? `Session #${sessionId} started. Resuming from #${lastSession.id}. ${recordedChanges.length} changes since. Use engram_memory — see tool_catalog.${suggestedFocus ? ` 💡 Suggested focus: "${suggestedFocus}".` : ""}` : `Session #${sessionId} started. First session. Use engram_memory — see tool_catalog.` });
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
