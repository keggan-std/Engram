// ============================================================================
// Engram MCP Server — Sessions Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { SessionRow } from "../types.js";

export class SessionsRepo {
    constructor(private db: DatabaseType) { }

    create(agentName: string, projectRoot: string, timestamp: string): number {
        const result = this.db.prepare(
            "INSERT INTO sessions (started_at, agent_name, project_root) VALUES (?, ?, ?)"
        ).run(timestamp, agentName, projectRoot);
        return result.lastInsertRowid as number;
    }

    close(id: number, timestamp: string, summary: string, tags?: string[]): void {
        this.db.prepare(
            "UPDATE sessions SET ended_at = ?, summary = ?, tags = ? WHERE id = ?"
        ).run(timestamp, summary, tags ? JSON.stringify(tags) : null, id);
    }

    autoClose(id: number, timestamp: string): void {
        this.db.prepare(
            "UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?"
        ).run(timestamp, "(auto-closed: new session started)", id);
    }

    getOpenSessionId(): number | null {
        const row = this.db.prepare(
            "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
        ).get() as { id: number } | undefined;
        return row ? row.id : null;
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
}
