// ============================================================================
// Engram MCP Server — Agents Repository (multi-agent coordination)
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { AgentRow } from "../types.js";

export class AgentsRepo {
    constructor(private db: DatabaseType) { }

    /** Upsert an agent heartbeat. Creates the record on first sync, updates on subsequent. */
    upsert(id: string, name: string, nowMs: number, status: string, currentTaskId?: number | null): void {
        this.db.prepare(`
            INSERT INTO agents (id, name, last_seen, current_task_id, status)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                last_seen = excluded.last_seen,
                current_task_id = excluded.current_task_id,
                status = excluded.status
        `).run(id, name, nowMs, currentTaskId ?? null, status);
    }

    getAll(): AgentRow[] {
        return this.db.prepare(
            "SELECT * FROM agents ORDER BY last_seen DESC"
        ).all() as AgentRow[];
    }

    getById(id: string): AgentRow | null {
        return (this.db.prepare(
            "SELECT * FROM agents WHERE id = ?"
        ).get(id) as AgentRow | undefined) ?? null;
    }

    /** Mark agents as idle if their last heartbeat was more than timeoutMs ago. */
    releaseStale(nowMs: number, timeoutMs: number): number {
        return this.db.prepare(
            "UPDATE agents SET status = 'stale', current_task_id = NULL WHERE status = 'working' AND last_seen < ?"
        ).run(nowMs - timeoutMs).changes;
    }
}
