// ============================================================================
// Engram MCP Server — Milestones Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { MilestoneRow } from "../types.js";

export class MilestonesRepo {
    constructor(private db: DatabaseType) { }

    create(
        sessionId: number | null,
        timestamp: string,
        title: string,
        description?: string | null,
        version?: string | null,
        tags?: string[] | null
    ): number {
        const result = this.db.prepare(
            "INSERT INTO milestones (session_id, timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(sessionId, timestamp, title, description || null, version || null, tags ? JSON.stringify(tags) : null);
        return result.lastInsertRowid as number;
    }

    getAll(limit: number): MilestoneRow[] {
        return this.db.prepare(
            "SELECT * FROM milestones ORDER BY timestamp DESC LIMIT ?"
        ).all(limit) as MilestoneRow[];
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM milestones").get() as { c: number }).c;
    }
}
