// ============================================================================
// Engram MCP Server — Sessions Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { SessionRow } from "../types.js";

export class SessionsRepo {
    constructor(private db: DatabaseType) { }

    create(agentName: string, projectRoot: string, timestamp: string, parentSessionId?: number | null): number {
        const result = this.db.prepare(
            "INSERT INTO sessions (started_at, agent_name, project_root, parent_session_id) VALUES (?, ?, ?, ?)"
        ).run(timestamp, agentName, projectRoot, parentSessionId ?? null);
        return result.lastInsertRowid as number;
    }

    /**
     * Close a session with a summary. Returns true only if this call did the
     * closing — an already-closed session is left untouched.
     *
     * The `ended_at IS NULL` guard is the fix for audit N3a: without it, one
     * agent's summary could overwrite the summary already written to a
     * different agent's closed session record.
     */
    close(id: number, timestamp: string, summary: string, tags?: string[]): boolean {
        const result = this.db.prepare(
            "UPDATE sessions SET ended_at = ?, summary = ?, tags = ? WHERE id = ? AND ended_at IS NULL"
        ).run(timestamp, summary, tags ? JSON.stringify(tags) : null, id);
        return (result.changes as number) > 0;
    }

    /** Retire a still-open session. No-op if it is already closed. */
    autoClose(id: number, timestamp: string): boolean {
        const result = this.db.prepare(
            "UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ? AND ended_at IS NULL"
        ).run(timestamp, "(auto-closed: new session started)", id);
        return (result.changes as number) > 0;
    }

    /**
     * Newest open session, optionally scoped to one agent.
     *
     * AUDIT N3a: the unscoped form answers "the newest open session belonging
     * to ANYONE", which is why sub-agents and orchestrators used to destroy
     * each other's records. Callers that know who they are MUST pass
     * `agentName`; the unscoped form is retained only for legacy call sites
     * that have no identity available.
     */
    getOpenSessionId(agentName?: string): number | null {
        const row = (agentName
            ? this.db.prepare(
                "SELECT id FROM sessions WHERE ended_at IS NULL AND agent_name = ? ORDER BY id DESC LIMIT 1"
            ).get(agentName)
            : this.db.prepare(
                "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
            ).get()) as { id: number } | undefined;
        return row ? row.id : null;
    }

    /** Every currently-open session, newest first. Used to detect concurrency. */
    getOpenSessions(): Array<{ id: number; agent_name: string; started_at: string; parent_session_id: number | null }> {
        return this.db.prepare(
            "SELECT id, agent_name, started_at, parent_session_id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC"
        ).all() as Array<{ id: number; agent_name: string; started_at: string; parent_session_id: number | null }>;
    }

    getLastCompleted(): { id: number; ended_at: string; summary: string | null; agent_name: string } | null {
        const row = this.db.prepare(
            "SELECT id, ended_at, summary, agent_name FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1"
        ).get() as { id: number; ended_at: string; summary: string | null; agent_name: string } | undefined;
        return row ?? null;
    }

    getHistory(limit: number, offset: number, agentName?: string): SessionRow[] {
        if (agentName) {
            return this.db.prepare(
                "SELECT * FROM sessions WHERE agent_name = ? ORDER BY id DESC LIMIT ? OFFSET ?"
            ).all(agentName, limit, offset) as SessionRow[];
        }
        return this.db.prepare(
            "SELECT * FROM sessions ORDER BY id DESC LIMIT ? OFFSET ?"
        ).all(limit, offset) as SessionRow[];
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
    }

    countCompleted(): number {
        return (this.db.prepare(
            "SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NOT NULL"
        ).get() as { c: number }).c;
    }

    getOldest(): string | null {
        const row = this.db.prepare(
            "SELECT started_at FROM sessions ORDER BY id ASC LIMIT 1"
        ).get() as { started_at: string } | undefined;
        return row?.started_at ?? null;
    }

    getNewest(): string | null {
        const row = this.db.prepare(
            "SELECT started_at FROM sessions ORDER BY id DESC LIMIT 1"
        ).get() as { started_at: string } | undefined;
        return row?.started_at ?? null;
    }

    /** Get the ID at a given offset position (used for compaction cutoff). */
    getIdAtOffset(offset: number): number | null {
        const row = this.db.prepare(
            "SELECT id FROM sessions ORDER BY id DESC LIMIT 1 OFFSET ?"
        ).get(offset) as { id: number } | undefined;
        return row?.id ?? null;
    }

    /** Get IDs of completed sessions at or before a given ID. */
    getCompletedBeforeId(cutoffId: number): number[] {
        const rows = this.db.prepare(
            "SELECT id FROM sessions WHERE id <= ? AND ended_at IS NOT NULL"
        ).all(cutoffId) as Array<{ id: number }>;
        return rows.map(r => r.id);
    }

    countBySession(sessionId: number, table: string): number {
        return (this.db.prepare(
            `SELECT COUNT(*) as c FROM ${table} WHERE session_id = ?`
        ).get(sessionId) as { c: number }).c;
    }
    getDurationStats(): { avg_minutes: number; max_minutes: number; sessions_last_7_days: number } {
        const durRow = this.db.prepare(
            `SELECT ROUND(AVG((julianday(ended_at) - julianday(started_at)) * 1440), 1) as avg_minutes,
                    ROUND(MAX((julianday(ended_at) - julianday(started_at)) * 1440), 1) as max_minutes
             FROM sessions WHERE ended_at IS NOT NULL`
        ).get() as { avg_minutes: number | null; max_minutes: number | null } | undefined;

        const recentRow = this.db.prepare(
            "SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-7 days')"
        ).get() as { c: number } | undefined;

        return {
            avg_minutes: durRow?.avg_minutes ?? 0,
            max_minutes: durRow?.max_minutes ?? 0,
            sessions_last_7_days: recentRow?.c ?? 0,
        };
    }

    getById(id: number): import("../types.js").SessionRow | null {
        const row = this.db.prepare(
            "SELECT * FROM sessions WHERE id = ?"
        ).get(id) as import("../types.js").SessionRow | undefined;
        return row ?? null;
    }
}
