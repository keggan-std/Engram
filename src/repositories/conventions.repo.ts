// ============================================================================
// Engram MCP Server — Conventions Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { ConventionRow } from "../types.js";

export class ConventionsRepo {
    constructor(private db: DatabaseType) { }

    create(
        sessionId: number | null,
        timestamp: string,
        category: string,
        rule: string,
        examples?: string[] | null,
        summary?: string | null,
        tags?: string[] | null
    ): number {
        const result = this.db.prepare(
            "INSERT INTO conventions (session_id, timestamp, category, rule, examples, summary, tags) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(
            sessionId,
            timestamp,
            category,
            rule,
            examples ? JSON.stringify(examples) : null,
            summary ?? null,
            tags ? JSON.stringify(tags) : null
        );
        return result.lastInsertRowid as number;
    }

    getActive(limit?: number): ConventionRow[] {
        if (limit) {
            return this.db.prepare(
                "SELECT * FROM conventions WHERE enforced = 1 ORDER BY category, id LIMIT ?"
            ).all(limit) as ConventionRow[];
        }
        return this.db.prepare(
            "SELECT * FROM conventions WHERE enforced = 1 ORDER BY category, id"
        ).all() as ConventionRow[];
    }

    /**
     * FTS5-ranked convention retrieval filtered by focus query.
     * Falls back to `getActive(limit)` when FTS fails or when ftsQuery is blank.
     *
     * @param ftsQuery  The focus string from session start (e.g. "authentication refactoring").
     * @param limit     Maximum number of conventions to return (default 10).
     */
    getActiveFocused(ftsQuery: string, limit: number = 10): ConventionRow[] {
        if (!ftsQuery?.trim()) {
            return this.getActive(limit);
        }
        try {
            const rows = this.db.prepare(`
                SELECT c.*
                FROM conventions c
                JOIN fts_conventions fts ON fts.rowid = c.id
                WHERE c.enforced = 1
                  AND fts_conventions MATCH ?
                ORDER BY rank
                LIMIT ?
            `).all(ftsQuery.trim(), limit) as ConventionRow[];
            // If FTS returned nothing, fall back to regular ordering for better UX
            return rows.length > 0 ? rows : this.getActive(limit);
        } catch {
            // FTS not available (pre-V23 DB or corrupt index) — degrade gracefully
            return this.getActive(limit);
        }
    }

    getFiltered(filters: { category?: string; includeDisabled: boolean }): ConventionRow[] {
        let query = "SELECT * FROM conventions WHERE 1=1";
        const params: unknown[] = [];

        if (!filters.includeDisabled) { query += " AND enforced = 1"; }
        if (filters.category) { query += " AND category = ?"; params.push(filters.category); }
        query += " ORDER BY category, id";

        return this.db.prepare(query).all(...params) as ConventionRow[];
    }

    toggle(id: number, enforced: boolean): number {
        return this.db.prepare(
            "UPDATE conventions SET enforced = ? WHERE id = ?"
        ).run(enforced ? 1 : 0, id).changes;
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM conventions").get() as { c: number }).c;
    }
}
