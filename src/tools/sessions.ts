// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getDbSizeKb } from "../database.js";
import { getGitLogSince, getGitBranch, getGitHead, isGitRepo, minutesSince } from "../utils.js";
import { TOOL_PREFIX, SNAPSHOT_TTL_MINUTES } from "../constants.js";
import type { ChangeRow, DecisionRow, ConventionRow, TaskRow, SessionContext } from "../types.js";

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

Returns:
  SessionContext object with previous session info, changes, decisions, conventions, and open tasks.`,
      inputSchema: {
        agent_name: z.string().default("unknown").describe("Name of the agent starting the session"),
        resume_task: z.string().optional().describe("Title of a task to resume, for focused context"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ agent_name, resume_task }) => {
      const db = getDb();
      const projectRoot = getProjectRoot();
      const timestamp = now();

      // Check for an already-open session and close it
      const openSession = getCurrentSessionId();
      if (openSession) {
        db.prepare("UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?")
          .run(timestamp, "(auto-closed: new session started)", openSession);
      }

      // Get previous session context
      const lastSession = getLastCompletedSession();

      // Create new session
      const result = db.prepare(
        "INSERT INTO sessions (started_at, agent_name, project_root) VALUES (?, ?, ?)"
      ).run(timestamp, agent_name, projectRoot);
      const sessionId = result.lastInsertRowid as number;

      // Gather changes since last session
      let recordedChanges: ChangeRow[] = [];
      let gitLog = "";

      if (lastSession?.ended_at) {
        recordedChanges = db.prepare(
          "SELECT * FROM changes WHERE timestamp > ? ORDER BY timestamp"
        ).all(lastSession.ended_at) as unknown[] as ChangeRow[];

        if (isGitRepo(projectRoot)) {
          gitLog = getGitLogSince(projectRoot, lastSession.ended_at);
        }
      }

      // Active decisions
      const activeDecisions = db.prepare(
        "SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT 20"
      ).all() as unknown[] as DecisionRow[];

      // Active conventions
      const activeConventions = db.prepare(
        "SELECT * FROM conventions WHERE enforced = 1 ORDER BY category, id"
      ).all() as unknown[] as ConventionRow[];

      // Open tasks
      let openTasks: TaskRow[];
      if (resume_task) {
        openTasks = db.prepare(
          "SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') AND title LIKE ? ORDER BY priority, created_at"
        ).all(`%${resume_task}%`) as unknown[] as TaskRow[];
        // If specific task not found, return all open tasks
        if (openTasks.length === 0) {
          openTasks = db.prepare(
            "SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY priority, created_at"
          ).all() as unknown[] as TaskRow[];
        }
      } else {
        openTasks = db.prepare(
          "SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY priority, created_at LIMIT 15"
        ).all() as unknown[] as TaskRow[];
      }

      // Snapshot age
      const snapshotRow = db.prepare("SELECT updated_at FROM snapshot_cache WHERE key = 'project_structure'").get() as { updated_at: string } | undefined;
      const snapshotAge = snapshotRow ? minutesSince(snapshotRow.updated_at) : null;

      // Git context
      const gitBranch = isGitRepo(projectRoot) ? getGitBranch(projectRoot) : null;
      const gitHead = isGitRepo(projectRoot) ? getGitHead(projectRoot) : null;

      // Build response
      const context: SessionContext & { git?: { branch: string | null; head: string | null } } = {
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
        project_snapshot_age_minutes: snapshotAge,
        git: { branch: gitBranch, head: gitHead },
        message: lastSession
          ? `Session #${sessionId} started. Resuming from session #${lastSession.id} (${lastSession.agent_name}, ended ${lastSession.ended_at}). ${recordedChanges.length} recorded changes since then.${snapshotAge && snapshotAge > SNAPSHOT_TTL_MINUTES ? " Project snapshot is stale — consider refreshing with engram_scan_project." : ""}`
          : `Session #${sessionId} started. This is the first session — no prior memory. Use engram_scan_project to build an initial project snapshot.`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      };
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
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      if (!sessionId) {
        return {
          isError: true,
          content: [{ type: "text", text: "No active session to end. Start one with engram_start_session first." }],
        };
      }

      // Get session stats before closing
      const changeCount = (db.prepare("SELECT COUNT(*) as c FROM changes WHERE session_id = ?").get(sessionId) as { c: number }).c;
      const decisionCount = (db.prepare("SELECT COUNT(*) as c FROM decisions WHERE session_id = ?").get(sessionId) as { c: number }).c;
      const tasksDone = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE session_id = ? AND status = 'done'").get(sessionId) as { c: number }).c;

      // Close the session
      db.prepare("UPDATE sessions SET ended_at = ?, summary = ?, tags = ? WHERE id = ?")
        .run(timestamp, summary, tags ? JSON.stringify(tags) : null, sessionId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Session #${sessionId} ended successfully.`,
            stats: {
              changes_recorded: changeCount,
              decisions_made: decisionCount,
              tasks_completed: tasksDone,
            },
            summary,
          }, null, 2),
        }],
      };
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
      const db = getDb();

      let sessions;
      if (agent_name) {
        sessions = db.prepare(
          "SELECT * FROM sessions WHERE agent_name = ? ORDER BY id DESC LIMIT ? OFFSET ?"
        ).all(agent_name, limit, offset);
      } else {
        sessions = db.prepare(
          "SELECT * FROM sessions ORDER BY id DESC LIMIT ? OFFSET ?"
        ).all(limit, offset);
      }

      const total = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ sessions, total, has_more: offset + limit < total }, null, 2),
        }],
      };
    }
  );
}
