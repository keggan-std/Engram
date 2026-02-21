// ============================================================================
// Engram MCP Server — Session Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getDb, now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getDbSizeKb, backupDatabase } from "../database.js";
import { getGitLogSince, getGitBranch, getGitHead, isGitRepo, minutesSince, scanFileTree, detectLayer, safeJsonParse } from "../utils.js";
import { TOOL_PREFIX, SNAPSHOT_TTL_MINUTES, COMPACTION_THRESHOLD_SESSIONS, DB_DIR_NAME, MAX_FILE_TREE_DEPTH } from "../constants.js";
import type { ChangeRow, DecisionRow, ConventionRow, TaskRow, SessionContext, ProjectSnapshot, ScheduledEventRow } from "../types.js";

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

      // ─── Auto-compaction ────────────────────────────────────
      let autoCompacted = false;
      try {
        // Check config for threshold (fallback to constant)
        let threshold = COMPACTION_THRESHOLD_SESSIONS;
        try {
          const configRow = db.prepare("SELECT value FROM config WHERE key = 'compact_threshold'").get() as { value: string } | undefined;
          if (configRow) threshold = parseInt(configRow.value, 10);
        } catch { /* config table may not exist yet */ }

        const totalSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NOT NULL").get() as { c: number }).c;
        if (totalSessions > threshold) {
          // Check if auto_compact is enabled
          let autoCompactEnabled = true;
          try {
            const autoRow = db.prepare("SELECT value FROM config WHERE key = 'auto_compact'").get() as { value: string } | undefined;
            if (autoRow) autoCompactEnabled = autoRow.value === 'true';
          } catch { /* default to enabled */ }

          if (autoCompactEnabled) {
            console.error(`[Engram] Auto-compacting: ${totalSessions} sessions exceed threshold of ${threshold}`);
            try { backupDatabase(); } catch { /* best effort */ }

            // Compact: keep recent sessions, summarize old changes
            const cutoff = db.prepare(
              "SELECT id FROM sessions ORDER BY id DESC LIMIT 1 OFFSET ?"
            ).get(threshold) as { id: number } | undefined;

            if (cutoff) {
              const doCompact = db.transaction(() => {
                const oldSessions = db.prepare(
                  "SELECT id FROM sessions WHERE id <= ? AND ended_at IS NOT NULL"
                ).all(cutoff.id) as Array<{ id: number }>;

                for (const s of oldSessions) {
                  const changes = db.prepare(
                    "SELECT change_type, file_path, description FROM changes WHERE session_id = ? AND file_path != '(compacted)'"
                  ).all(s.id) as Array<{ change_type: string; file_path: string; description: string }>;

                  if (changes.length > 0) {
                    const summary = changes.map(c => `[${c.change_type}] ${c.file_path}`).join("; ");
                    db.prepare(
                      "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, impact_scope) VALUES (?, ?, ?, ?, ?, ?)"
                    ).run(s.id, now(), "(compacted)", "modified", `Compacted ${changes.length} changes: ${summary.slice(0, 2000)}`, "global");
                  }
                  db.prepare("DELETE FROM changes WHERE session_id = ? AND file_path != '(compacted)'").run(s.id);
                }
              });
              doCompact();
              autoCompacted = true;
              console.error(`[Engram] Auto-compaction complete.`);
            }
          }
        }
      } catch (e) {
        console.error(`[Engram] Auto-compaction skipped: ${e}`);
      }

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

      // ─── Auto Project Scan ───────────────────────────────────
      let projectSnapshot: ProjectSnapshot | null = null;
      try {
        const cached = db.prepare("SELECT * FROM snapshot_cache WHERE key = 'project_structure'").get() as { value: string; updated_at: string } | undefined;
        const snapshotAge = cached ? minutesSince(cached.updated_at) : null;

        if (cached && snapshotAge !== null && snapshotAge < SNAPSHOT_TTL_MINUTES) {
          // Serve from cache
          projectSnapshot = safeJsonParse<ProjectSnapshot>(cached.value, null as unknown as ProjectSnapshot);
        } else {
          // Stale or missing — perform a fresh scan
          const fileTree = scanFileTree(projectRoot, MAX_FILE_TREE_DEPTH);
          const layerDist: Record<string, number> = {};
          for (const f of fileTree) {
            if (f.endsWith("/")) continue;
            const layer = detectLayer(f);
            layerDist[layer] = (layerDist[layer] || 0) + 1;
          }
          const fileNotes = db.prepare("SELECT * FROM file_notes ORDER BY file_path").all();
          const decisions = db.prepare("SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT 20").all();
          const conventions = db.prepare("SELECT * FROM conventions WHERE enforced = 1 ORDER BY category").all();

          projectSnapshot = {
            project_root: projectRoot,
            file_tree: fileTree,
            total_files: fileTree.filter((f: string) => !f.endsWith("/")).length,
            file_notes: fileNotes,
            recent_decisions: decisions,
            active_conventions: conventions,
            layer_distribution: layerDist,
            generated_at: now(),
          } as unknown as ProjectSnapshot;

          // Persist to cache
          db.prepare(
            "INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES ('project_structure', ?, ?, ?)"
          ).run(JSON.stringify(projectSnapshot), now(), SNAPSHOT_TTL_MINUTES);
        }
      } catch { /* scan is best-effort — never block session start */ }

      // ─── Ingest git-changes.log (from post-commit hook) ─────
      let gitHookLog = "";
      try {
        const hookLogPath = path.join(projectRoot, DB_DIR_NAME, "git-changes.log");
        if (fs.existsSync(hookLogPath)) {
          const raw = fs.readFileSync(hookLogPath, "utf-8");
          // Only include entries since last session
          if (lastSession?.ended_at) {
            const lines = raw.split("\n");
            const cutoffDate = new Date(lastSession.ended_at);
            const relevantBlocks: string[] = [];
            let inBlock = false;
            let blockLines: string[] = [];
            let blockDate: Date | null = null;

            for (const line of lines) {
              if (line.startsWith("--- COMMIT")) {
                if (inBlock && blockDate && blockDate > cutoffDate) {
                  relevantBlocks.push(blockLines.join("\n"));
                }
                inBlock = true;
                blockLines = [line];
                blockDate = null;
              } else if (inBlock && line.startsWith("date:")) {
                blockLines.push(line);
                try { blockDate = new Date(line.replace("date:", "").trim()); } catch { /* skip */ }
              } else if (inBlock) {
                blockLines.push(line);
              }
            }
            // Flush last block
            if (inBlock && blockDate && blockDate > cutoffDate) {
              relevantBlocks.push(blockLines.join("\n"));
            }
            gitHookLog = relevantBlocks.join("\n\n");
          } else {
            // First session — include last 20 lines as a hint
            gitHookLog = raw.split("\n").slice(-20).join("\n");
          }
        }
      } catch { /* git-changes.log is optional */ }

      // Snapshot age (for message)
      const snapshotAge = projectSnapshot ? 0 : null;

      // Git context
      const gitBranch = isGitRepo(projectRoot) ? getGitBranch(projectRoot) : null;
      const gitHead = isGitRepo(projectRoot) ? getGitHead(projectRoot) : null;

      // ─── Check Scheduled Event Triggers ──────────────────────────
      let triggeredEvents: ScheduledEventRow[] = [];
      try {
        const timestamp = now();

        // Auto-trigger 'next_session' events
        db.prepare(
          `UPDATE scheduled_events SET status = 'triggered', triggered_at = ?
           WHERE status = 'pending' AND trigger_type = 'next_session'`
        ).run(timestamp);

        // Auto-trigger 'datetime' events that have passed
        db.prepare(
          `UPDATE scheduled_events SET status = 'triggered', triggered_at = ?
           WHERE status = 'pending' AND trigger_type = 'datetime' AND trigger_value <= ?`
        ).run(timestamp, timestamp);

        // Auto-trigger 'every_session' recurring events
        db.prepare(
          `UPDATE scheduled_events SET status = 'triggered', triggered_at = ?
           WHERE status = 'pending' AND recurrence = 'every_session'`
        ).run(timestamp);

        // Fetch all triggered events
        triggeredEvents = db.prepare(
          `SELECT * FROM scheduled_events WHERE status = 'triggered'
           ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`
        ).all() as unknown[] as ScheduledEventRow[];
      } catch { /* scheduled_events table may not exist yet */ }

      // Build response
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
        project_snapshot_age_minutes: snapshotAge,
        git: { branch: gitBranch, head: gitHead },
        project_snapshot: projectSnapshot,
        git_hook_log: gitHookLog || undefined,
        triggered_events: triggeredEvents.length > 0 ? triggeredEvents : undefined,
        message: lastSession
          ? `Session #${sessionId} started. Resuming from session #${lastSession.id} (${lastSession.agent_name}, ended ${lastSession.ended_at}). ${recordedChanges.length} recorded changes since then.${autoCompacted ? " [Auto-compacted old sessions.]" : ""}${projectSnapshot ? ` Project snapshot included (${projectSnapshot.total_files} files).` : ""}${triggeredEvents.length > 0 ? ` ⚡ ${triggeredEvents.length} scheduled event(s) triggered — review and acknowledge.` : ""}`
          : `Session #${sessionId} started. This is the first session — no prior memory.${projectSnapshot ? ` Project snapshot included (${projectSnapshot.total_files} files).` : ""}`,
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
