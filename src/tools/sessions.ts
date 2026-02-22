// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getRepos, getServices } from "../database.js";
import { TOOL_PREFIX, COMPACTION_THRESHOLD_SESSIONS } from "../constants.js";
import { log } from "../logger.js";
import { truncate } from "../utils.js";
import { success, error } from "../response.js";
import type { SessionContext, ProjectSnapshot, ScheduledEventRow } from "../types.js";

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

Returns:
  SessionContext object with previous session info, changes, decisions, conventions, and open tasks.`,
      inputSchema: {
        agent_name: z.string().default("unknown").describe("Name of the agent starting the session"),
        resume_task: z.string().optional().describe("Title of a task to resume, for focused context"),
        verbosity: z.enum(["full", "summary", "minimal"]).default("summary").describe("Response detail level: full, summary, or minimal"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ agent_name, resume_task, verbosity }) => {
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

      // Active decisions, conventions, open tasks
      const activeDecisions = repos.decisions.getActive(20);
      const activeConventions = repos.conventions.getActive();

      const openTasks = repos.tasks.getOpen(15, resume_task || undefined);

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
          message: `Session #${sessionId} started (minimal mode). Use engram_get_* tools to load details on demand.`,
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
          message: lastSession
            ? `Session #${sessionId} started (summary mode). Resuming from session #${lastSession.id} (${lastSession.agent_name}). ${recordedChanges.length} changes since then.${autoCompacted ? " [Auto-compacted old sessions.]" : ""}${triggeredEvents.length > 0 ? ` ${triggeredEvents.length} scheduled event(s) triggered.` : ""}`
            : `Session #${sessionId} started (summary mode). First session — no prior memory.`,
        });
      }

      // ─── verbosity === "full" ──────────────────────────────
      const context: SessionContext & {
        git?: { branch: string | null; head: string | null };
        project_snapshot?: ProjectSnapshot | null;
        git_hook_log?: string;
        triggered_events?: ScheduledEventRow[];
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
        git: { branch: gitBranch, head: gitHead },
        project_snapshot: projectSnapshot,
        git_hook_log: gitHookLog || undefined,
        triggered_events: triggeredEvents.length > 0 ? triggeredEvents : undefined,
        message: lastSession
          ? `Session #${sessionId} started (full mode). Resuming from session #${lastSession.id} (${lastSession.agent_name}, ended ${lastSession.ended_at}). ${recordedChanges.length} recorded changes since then.${autoCompacted ? " [Auto-compacted old sessions.]" : ""}${projectSnapshot ? ` Project snapshot included (${projectSnapshot.total_files} files).` : ""}${triggeredEvents.length > 0 ? ` ${triggeredEvents.length} scheduled event(s) triggered — review and acknowledge.` : ""}`
          : `Session #${sessionId} started (full mode). This is the first session — no prior memory.${projectSnapshot ? ` Project snapshot included (${projectSnapshot.total_files} files).` : ""}`,
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
        tags: z.array(z.string()).optional().describe("Tags for session categorization"),
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
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      if (!sessionId) {
        return error("No active session to end. Start one with engram_start_session first.");
      }

      // Get session stats before closing
      const changeCount = repos.changes.countBySession(sessionId);
      const decisionCount = repos.sessions.countBySession(sessionId, "decisions");
      const tasksDone = repos.tasks.countDoneInSession(sessionId);

      // Close the session
      repos.sessions.close(sessionId, timestamp, summary, tags);

      return success({
        message: `Session #${sessionId} ended successfully.`,
        stats: {
          changes_recorded: changeCount,
          decisions_made: decisionCount,
          tasks_completed: tasksDone,
        },
        summary,
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
}
