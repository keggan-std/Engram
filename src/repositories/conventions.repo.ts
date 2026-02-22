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
        examples?: string[] | null
    ): number {
        const result = this.db.prepare(
            "INSERT INTO conventions (session_id, timestamp, category, rule, examples) VALUES (?, ?, ?, ?, ?)"
        ).run(sessionId, timestamp, category, rule, examples ? JSON.stringify(examples) : null);
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
