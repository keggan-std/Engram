// ============================================================================
// Engram MCP Server — Scheduled Events Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { ScheduledEventRow } from "../types.js";

export class EventsRepo {
    constructor(private db: DatabaseType) { }

    create(
        sessionId: number | null,
        timestamp: string,
        data: {
            title: string;
            description?: string | null;
            trigger_type: string;
            trigger_value?: string | null;
            requires_approval?: boolean;
            action_summary?: string | null;
            action_data?: string | null;
            priority?: string;
            tags?: string[] | null;
            recurrence?: string | null;
        }
    ): number {
        const result = this.db.prepare(
            `INSERT INTO scheduled_events (session_id, created_at, title, description, trigger_type, trigger_value,
       status, requires_approval, action_summary, action_data, priority, tags, recurrence)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
        ).run(
            sessionId, timestamp,
            data.title, data.description || null,
            data.trigger_type, data.trigger_value || null,
            data.requires_approval !== false ? 1 : 0,
            data.action_summary || null, data.action_data || null,
            data.priority || "medium",
            data.tags ? JSON.stringify(data.tags) : null,
            data.recurrence || "once",
        );
        return result.lastInsertRowid as number;
    }

    triggerNextSession(timestamp: string): void {
        this.db.prepare(
            "UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND trigger_type = 'next_session'"
        ).run(timestamp);
    }

    triggerExpiredDatetime(timestamp: string): void {
        this.db.prepare(
            "UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND trigger_type = 'datetime' AND trigger_value <= ?"
        ).run(timestamp, timestamp);
    }

    triggerEverySession(timestamp: string): void {
        this.db.prepare(
            "UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND recurrence = 'every_session'"
        ).run(timestamp);
    }

    triggerTaskComplete(taskId: number, timestamp: string): void {
        this.db.prepare(
            "UPDATE scheduled_events SET status = 'triggered', triggered_at = ? WHERE status = 'pending' AND trigger_type = 'task_complete' AND trigger_value = ?"
        ).run(timestamp, String(taskId));
    }

    getTriggered(): ScheduledEventRow[] {
        return this.db.prepare(
            "SELECT * FROM scheduled_events WHERE status = 'triggered' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END"
        ).all() as ScheduledEventRow[];
    }

    getFiltered(filters: {
        status?: string;
        trigger_type?: string;
        tag?: string;
        include_past?: boolean;
        limit: number;
    }): ScheduledEventRow[] {
        let query = "SELECT * FROM scheduled_events WHERE 1=1";
        const params: unknown[] = [];

        if (filters.status) { query += " AND status = ?"; params.push(filters.status); }
        if (filters.trigger_type) { query += " AND trigger_type = ?"; params.push(filters.trigger_type); }
        if (filters.tag) { query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; params.push(filters.tag); }
        if (!filters.include_past) { query += " AND status NOT IN ('executed', 'cancelled')"; }

        query += " ORDER BY created_at DESC LIMIT ?";
        params.push(filters.limit);

        return this.db.prepare(query).all(...params) as ScheduledEventRow[];
    }

    getById(id: number): ScheduledEventRow | null {
        return (this.db.prepare(
            "SELECT * FROM scheduled_events WHERE id = ?"
        ).get(id) as ScheduledEventRow | undefined) ?? null;
    }

    updateStatus(id: number, status: string, extraFields?: Record<string, unknown>): number {
        const sets = ["status = ?"];
        const params: unknown[] = [status];

        if (extraFields) {
            for (const [key, value] of Object.entries(extraFields)) {
                sets.push(`${key} = ?`);
                params.push(value);
            }
        }

        params.push(id);
        return this.db.prepare(
            `UPDATE scheduled_events SET ${sets.join(", ")} WHERE id = ?`
        ).run(...params).changes;
    }

    acknowledge(id: number, timestamp: string): number {
        return this.db.prepare(
            "UPDATE scheduled_events SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?"
        ).run(timestamp, id).changes;
    }
}
