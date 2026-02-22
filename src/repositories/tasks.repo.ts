// ============================================================================
// Engram MCP Server — Tasks Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { TaskRow } from "../types.js";

export class TasksRepo {
    constructor(private db: DatabaseType) { }

    create(
        sessionId: number | null,
        timestamp: string,
        data: {
            title: string;
            description?: string | null;
            priority?: string;
            status?: string;
            assigned_files?: string[] | null;
            tags?: string[] | null;
            blocked_by?: number[] | null;
        }
    ): number {
        const result = this.db.prepare(
            "INSERT INTO tasks (session_id, created_at, updated_at, title, description, status, priority, assigned_files, tags, blocked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            sessionId, timestamp, timestamp,
            data.title,
            data.description || null,
            data.status || "backlog",
            data.priority || "medium",
            data.assigned_files ? JSON.stringify(data.assigned_files) : null,
            data.tags ? JSON.stringify(data.tags) : null,
            data.blocked_by ? JSON.stringify(data.blocked_by) : null,
        );
        return result.lastInsertRowid as number;
    }

    update(
        id: number,
        timestamp: string,
        fields: {
            status?: string;
            priority?: string;
            description?: string;
            assigned_files?: string[];
            tags?: string[];
            blocked_by?: number[];
            completed_at?: string | null;
        }
    ): number {
        const sets: string[] = ["updated_at = ?"];
        const params: unknown[] = [timestamp];

        if (fields.status !== undefined) { sets.push("status = ?"); params.push(fields.status); }
        if (fields.priority !== undefined) { sets.push("priority = ?"); params.push(fields.priority); }
        if (fields.description !== undefined) { sets.push("description = ?"); params.push(fields.description); }
        if (fields.assigned_files !== undefined) { sets.push("assigned_files = ?"); params.push(JSON.stringify(fields.assigned_files)); }
        if (fields.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(fields.tags)); }
        if (fields.blocked_by !== undefined) { sets.push("blocked_by = ?"); params.push(JSON.stringify(fields.blocked_by)); }
        if (fields.completed_at !== undefined) { sets.push("completed_at = ?"); params.push(fields.completed_at); }

        params.push(id);
        return this.db.prepare(
            `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`
        ).run(...params).changes;
    }

    getById(id: number): TaskRow | null {
        return (this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined) ?? null;
    }

    getOpen(limit: number, resumeTask?: string): TaskRow[] {
        if (resumeTask) {
            const results = this.db.prepare(
                "SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') AND title LIKE ? ORDER BY priority, created_at"
            ).all(`%${resumeTask}%`) as TaskRow[];
            if (results.length > 0) return results;
        }
        return this.db.prepare(
            "SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY priority, created_at LIMIT ?"
        ).all(limit) as TaskRow[];
    }

    getFiltered(filters: {
        status?: string;
        priority?: string;
        tag?: string;
        includeDone?: boolean;
        limit: number;
    }): TaskRow[] {
        let query = "SELECT * FROM tasks WHERE 1=1";
        const params: unknown[] = [];

        if (filters.status) { query += " AND status = ?"; params.push(filters.status); }
        if (filters.priority) { query += " AND priority = ?"; params.push(filters.priority); }
        if (filters.tag) { query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; params.push(filters.tag); }
        if (!filters.includeDone) { query += " AND status NOT IN ('done', 'cancelled')"; }

        query += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at LIMIT ?";
        params.push(filters.limit);

        return this.db.prepare(query).all(...params) as TaskRow[];
    }

    getByStatus(): Array<{ status: string; count: number }> {
        return this.db.prepare(
            "SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC"
        ).all() as Array<{ status: string; count: number }>;
    }

    countDoneInSession(sessionId: number): number {
        return (this.db.prepare(
            "SELECT COUNT(*) as c FROM tasks WHERE session_id = ? AND status = 'done'"
        ).get(sessionId) as { c: number }).c;
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    }
}
