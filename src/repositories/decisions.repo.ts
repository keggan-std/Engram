// ============================================================================
// Engram MCP Server — Decisions Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { DecisionRow } from "../types.js";

export class DecisionsRepo {
    constructor(private db: DatabaseType) { }

    create(
        sessionId: number | null,
        timestamp: string,
        decision: string,
        rationale?: string | null,
        affectedFiles?: string[] | null,
        tags?: string[] | null,
        status: string = "active",
        supersedes?: number | null
    ): number {
        const result = this.db.prepare(
            "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            sessionId, timestamp, decision,
            rationale || null,
            affectedFiles ? JSON.stringify(affectedFiles) : null,
            tags ? JSON.stringify(tags) : null,
            status,
            supersedes || null
        );
        return result.lastInsertRowid as number;
    }

    supersede(oldId: number, newId: number): void {
        this.db.prepare(
            "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ?"
        ).run(newId, oldId);
    }

    updateStatus(id: number, status: string): number {
        return this.db.prepare(
            "UPDATE decisions SET status = ? WHERE id = ?"
        ).run(status, id).changes;
    }

    getActive(limit: number = 20): DecisionRow[] {
        return this.db.prepare(
            "SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT ?"
        ).all(limit) as DecisionRow[];
    }

    getFiltered(filters: { status?: string; tag?: string; file_path?: string; limit: number }): DecisionRow[] {
        let query = "SELECT * FROM decisions WHERE 1=1";
        const params: unknown[] = [];

        if (filters.status) { query += " AND status = ?"; params.push(filters.status); }
        if (filters.tag) { query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"; params.push(filters.tag); }
        if (filters.file_path) { query += " AND EXISTS (SELECT 1 FROM json_each(affected_files) WHERE value = ?)"; params.push(filters.file_path); }

        query += " ORDER BY timestamp DESC LIMIT ?";
        params.push(filters.limit);

        return this.db.prepare(query).all(...params) as DecisionRow[];
    }

    getByFile(filePath: string): DecisionRow[] {
        return this.db.prepare(
            "SELECT * FROM decisions WHERE affected_files LIKE ? AND status = 'active' ORDER BY timestamp DESC"
        ).all(`%${filePath}%`) as DecisionRow[];
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number }).c;
    }
}
