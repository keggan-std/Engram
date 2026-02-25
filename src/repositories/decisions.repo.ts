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
        supersedes?: number | null,
        dependsOn?: number[] | null
    ): number {
        const result = this.db.prepare(
            "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status, superseded_by, depends_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            sessionId, timestamp, decision,
            rationale || null,
            affectedFiles ? JSON.stringify(affectedFiles) : null,
            tags ? JSON.stringify(tags) : null,
            status,
            supersedes || null,
            dependsOn && dependsOn.length > 0 ? JSON.stringify(dependsOn) : null
        );
        return result.lastInsertRowid as number;
    }

    /** Returns all active decisions that list the given ID in their depends_on array. */
    getDependents(decisionId: number): DecisionRow[] {
        try {
            return this.db.prepare(
                `SELECT * FROM decisions
                 WHERE status = 'active'
                   AND depends_on IS NOT NULL
                   AND EXISTS (SELECT 1 FROM json_each(depends_on) WHERE value = ?)
                 ORDER BY timestamp DESC`
            ).all(decisionId) as DecisionRow[];
        } catch {
            return [];
        }
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

    /**
     * FTS5-ranked active decisions filtered by a focus query.
     * Falls back to getActive() if FTS tables are unavailable.
     */
    getActiveFocused(ftsQuery: string, limit: number = 15): DecisionRow[] {
        try {
            return this.db.prepare(`
                WITH ranked AS (
                    SELECT rowid, rank FROM fts_decisions WHERE fts_decisions MATCH ?
                )
                SELECT d.* FROM decisions d
                JOIN ranked ON ranked.rowid = d.id
                WHERE d.status = 'active'
                ORDER BY ranked.rank
                LIMIT ?
            `).all(ftsQuery, limit) as DecisionRow[];
        } catch {
            return this.getActive(limit);
        }
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

    createBatch(
        decisions: Array<{
            decision: string;
            rationale?: string | null;
            affected_files?: string[] | null;
            tags?: string[] | null;
            status?: string;
        }>,
        sessionId: number | null,
        timestamp: string
    ): number[] {
        const ids: number[] = [];
        const tx = this.db.transaction(() => {
            for (const d of decisions) {
                const result = this.db.prepare(
                    "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ).run(
                    sessionId, timestamp, d.decision,
                    d.rationale || null,
                    d.affected_files ? JSON.stringify(d.affected_files) : null,
                    d.tags ? JSON.stringify(d.tags) : null,
                    d.status || "active",
                    null
                );
                ids.push(result.lastInsertRowid as number);
            }
        });
        tx();
        return ids;
    }

    findSimilar(decisionText: string, limit: number = 5): DecisionRow[] {
        // FTS5-powered similarity search — more accurate than LIKE
        const words = decisionText.trim().split(/\s+/).filter(w => w.length > 3).slice(0, 6);
        if (words.length > 0) {
            try {
                const ftsQuery = words.map(w => `"${w.replace(/"/g, "")}"`).join(" OR ");
                return this.db.prepare(`
                    WITH ranked AS (
                        SELECT rowid, rank FROM fts_decisions WHERE fts_decisions MATCH ?
                    )
                    SELECT d.* FROM decisions d
                    JOIN ranked ON ranked.rowid = d.id
                    WHERE d.status = 'active'
                    ORDER BY ranked.rank
                    LIMIT ?
                `).all(ftsQuery, limit) as DecisionRow[];
            } catch { /* FTS unavailable, fall through */ }
        }

        // LIKE fallback
        if (words.length === 0) return [];
        const conditions = words.map(() => "decision LIKE ?");
        const params: unknown[] = words.map(w => `%${w}%`);
        params.push(limit);
        return this.db.prepare(
            `SELECT * FROM decisions WHERE status = 'active' AND (${conditions.join(" OR ")}) ORDER BY timestamp DESC LIMIT ?`
        ).all(...params) as DecisionRow[];
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number }).c;
    }
}
