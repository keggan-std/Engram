// ============================================================================
// Engram MCP Server — Task Management Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, now, getCurrentSessionId } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success, error } from "../response.js";
import type { TaskRow } from "../types.js";

export function registerTaskTools(server: McpServer): void {
  // ─── CREATE TASK ────────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_create_task`,
    {
      title: "Create Task",
      description: `Create a work item that persists across sessions. Tasks ensure continuity — nothing falls through the cracks between sessions. Use for TODOs, bugs, features, or any work that needs tracking.

Args:
  - title (string): Short, descriptive task title
  - description (string, optional): Detailed description of the work
  - priority: "critical" | "high" | "medium" | "low" (default: "medium")
  - status: "backlog" | "in_progress" | "blocked" | "review" (default: "backlog")
  - assigned_files (array, optional): Files this task relates to
  - tags (array, optional): Categorization tags
  - blocked_by (array of numbers, optional): Task IDs that block this task

Returns:
  Task ID and confirmation.`,
      inputSchema: {
        title: z.string().min(3).describe("Short task title"),
        description: z.string().optional().describe("Detailed description"),
        priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
        status: z.enum(["backlog", "in_progress", "blocked", "review"]).default("backlog"),
        assigned_files: z.array(z.string()).optional().describe("Related files"),
        tags: z.array(z.string()).optional().describe("Tags"),
        blocked_by: z.array(z.number().int()).optional().describe("Blocking task IDs"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, description, priority, status, assigned_files, tags, blocked_by }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      const result = db.prepare(`
        INSERT INTO tasks (session_id, created_at, updated_at, title, description, status, priority, assigned_files, tags, blocked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, timestamp, timestamp, title,
        description || null,
        status, priority,
        assigned_files ? JSON.stringify(assigned_files) : null,
        tags ? JSON.stringify(tags) : null,
        blocked_by ? JSON.stringify(blocked_by) : null,
      );

      return success({
        task_id: Number(result.lastInsertRowid),
        message: `Task #${result.lastInsertRowid} created: "${title}" [${priority}/${status}]`,
      });
    }
  );

  // ─── UPDATE TASK ────────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_update_task`,
    {
      title: "Update Task",
      description: `Update a task's status, priority, or other fields. Use when progressing, completing, or blocking tasks.

Args:
  - id (number): Task ID to update
  - status (string, optional): New status
  - priority (string, optional): New priority
  - description (string, optional): Updated description
  - blocked_by (array, optional): Updated blocking task IDs
  - assigned_files (array, optional): Updated related files
  - tags (array, optional): Updated tags

Returns:
  Updated task.`,
      inputSchema: {
        id: z.number().int().describe("Task ID"),
        status: z.enum(["backlog", "in_progress", "blocked", "review", "done", "cancelled"]).optional(),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        description: z.string().optional(),
        blocked_by: z.array(z.number().int()).optional(),
        assigned_files: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, status, priority, description, blocked_by, assigned_files, tags }) => {
      const db = getDb();
      const timestamp = now();

      // Build dynamic update
      const updates: string[] = ["updated_at = ?"];
      const params: unknown[] = [timestamp];

      if (status) {
        updates.push("status = ?"); params.push(status);
        if (status === "done" || status === "cancelled") {
          updates.push("completed_at = ?"); params.push(timestamp);
        }
      }
      if (priority) { updates.push("priority = ?"); params.push(priority); }
      if (description !== undefined) { updates.push("description = ?"); params.push(description); }
      if (blocked_by) { updates.push("blocked_by = ?"); params.push(JSON.stringify(blocked_by)); }
      if (assigned_files) { updates.push("assigned_files = ?"); params.push(JSON.stringify(assigned_files)); }
      if (tags) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }

      params.push(id);
      const result = db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);

      if (result.changes === 0) {
        return error(`Task #${id} not found.`);
      }

      // If task was marked done, trigger any scheduled events waiting on it
      let triggeredEventCount = 0;
      if (status === "done") {
        try {
          const triggerResult = db.prepare(
            `UPDATE scheduled_events SET status = 'triggered', triggered_at = ?
             WHERE status = 'pending' AND trigger_type = 'task_complete' AND trigger_value = ?`
          ).run(timestamp, String(id));
          triggeredEventCount = triggerResult.changes;
        } catch { /* scheduled_events table may not exist yet */ }
      }

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
      if (triggeredEventCount > 0) {
        updated._triggered_events = `${triggeredEventCount} scheduled event(s) triggered by this task completion. Use engram_check_events to review.`;
      }
      return success(updated);
    }
  );

  // ─── GET TASKS ──────────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_get_tasks`,
    {
      title: "Get Tasks",
      description: `Retrieve tasks with optional filtering. Returns open tasks by default.

Args:
  - status (string, optional): Filter by status
  - priority (string, optional): Filter by priority
  - tag (string, optional): Filter by tag
  - include_done (boolean, optional): Include completed/cancelled tasks (default: false)
  - limit (number, optional): Max results (default 20)

Returns:
  Array of tasks sorted by priority then creation date.`,
      inputSchema: {
        status: z.enum(["backlog", "in_progress", "blocked", "review", "done", "cancelled"]).optional(),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        tag: z.string().optional(),
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
    async ({ status, priority, tag, include_done, limit }) => {
      const db = getDb();
      let query = "SELECT * FROM tasks WHERE 1=1";
      const params: unknown[] = [];

      if (!include_done) { query += " AND status NOT IN ('done', 'cancelled')"; }
      if (status) { query += " AND status = ?"; params.push(status); }
      if (priority) { query += " AND priority = ?"; params.push(priority); }
      if (tag) { query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; params.push(tag); }

      query += ` ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        created_at ASC
        LIMIT ?`;
      params.push(limit);

      const tasks = db.prepare(query).all(...params) as unknown[] as TaskRow[];
      const openCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status NOT IN ('done','cancelled')").get() as { c: number }).c;

      return success({ total_open: openCount, returned: tasks.length, tasks });
    }
  );
}
