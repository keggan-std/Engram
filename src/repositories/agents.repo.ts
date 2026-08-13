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

    /**
     * Record that `id` is alive right now, without touching anything else.
     *
     * TASK #61. claim_task never registered its claimer — it only SELECTed
     * specializations, and a SELECT creates no row. So after
     * `claim_task(agent_id: "ghost-agent")` the `agents` table was EMPTY, and
     * every recovery path that starts "find the agent that holds this claim"
     * had nothing to find.
     *
     * Deliberately narrower than upsert(): status and specializations are
     * PRESERVED on conflict. A claim is evidence of liveness, not a heartbeat
     * carrying new metadata, and letting it reset an agent's declared
     * specializations to null would break route_task as a side effect of
     * claiming.
     */
    register(id: string, name: string, nowMs: number): void {
        this.db.prepare(`
            INSERT INTO agents (id, name, last_seen, status)
            VALUES (?, ?, ?, 'working')
            ON CONFLICT(id) DO UPDATE SET
                last_seen = excluded.last_seen
        `).run(id, name, nowMs);
    }

    /**
     * Release task claims held by agents that have stopped reporting in.
     *
     * TASK #61, and the predicate is the whole fix. The old sweep lived in the
     * dispatcher and read
     *
     *   ... WHERE claimed_by IN (SELECT id FROM agents WHERE status = 'working'
     *                            AND last_seen < ?)
     *
     * which had TWO independent reasons never to match: claim_task registered
     * nobody (above), and agent_sync defaults status to 'idle', so even a
     * registered agent was invisible to it. Dead by default, in two ways.
     *
     * It now keys on LAST-SEEN AGE ALONE. Rejected — per 04-concurrency.md §4
     * T3 — defaulting agent_sync to status:'working', a one-word fix that makes
     * the sweep fire on idle-but-alive agents and release claims out from under
     * them, converting a dead safety net into an active hazard.
     *
     * THE LIMIT, stated rather than left to be discovered: this is a liveness
     * lease, not a fence. An agent that is alive but silent for longer than
     * timeoutMs loses its claim and is not told — Kleppmann's fencing-token
     * objection, which is why the rejected alternative of expiring claims on
     * `claimed_at` alone is worse: that preempts a holder who is demonstrably
     * still working. Keying on the heartbeat at least requires evidence of
     * absence. Callers get the reclaimed rows back so the event can be
     * reported rather than happening silently.
     */
    reclaimStaleClaims(nowMs: number, timeoutMs: number): Array<{ task_id: number; agent_id: string }> {
        const cutoff = nowMs - timeoutMs;
        const orphaned = this.db.prepare(`
            SELECT t.id AS task_id, t.claimed_by AS agent_id
            FROM tasks t
            JOIN agents a ON a.id = t.claimed_by
            WHERE t.claimed_by IS NOT NULL
              AND t.status NOT IN ('done', 'cancelled')
              AND a.last_seen < ?
        `).all(cutoff) as Array<{ task_id: number; agent_id: string }>;

        if (orphaned.length === 0) return [];

        const release = this.db.prepare(
            "UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = ?"
        );
        const tx = this.db.transaction(() => {
            for (const row of orphaned) release.run(row.task_id);
        });
        tx();
        return orphaned;
    }

    /**
     * Mark WORKING agents stale if their last heartbeat is older than timeoutMs.
     *
     * Had ZERO callers anywhere in src/ — the method actually named for the job,
     * while the dispatcher ran its own inline copy of the same query. Task #61
     * gave it its first caller.
     *
     * The `status = 'working'` predicate is KEPT here on purpose, and that is a
     * deliberate difference from reclaimStaleClaims() above. This method is
     * bookkeeping on the agents table; that one releases another agent's claim.
     * Only the second is safety-critical, so only the second is keyed on
     * liveness alone. Widening this one to every non-stale agent would relabel
     * idle-but-registered agents on a schedule, which changes what `idle` means
     * for no gain — and claim recovery no longer depends on it either way.
     */
    releaseStale(nowMs: number, timeoutMs: number): number {
        return this.db.prepare(
            "UPDATE agents SET status = 'stale', current_task_id = NULL WHERE status = 'working' AND last_seen < ?"
        ).run(nowMs - timeoutMs).changes;
    }
}
