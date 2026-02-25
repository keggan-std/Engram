// ============================================================================
// Engram MCP Server — Broadcasts Repository (multi-agent messaging)
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { BroadcastRow } from "../types.js";
import { safeJsonParse } from "../utils.js";

export class BroadcastsRepo {
    constructor(private db: DatabaseType) { }

    create(fromAgent: string, message: string, nowMs: number, expiresInMs?: number): number {
        const result = this.db.prepare(`
            INSERT INTO broadcasts (from_agent, message, created_at, expires_at, read_by)
            VALUES (?, ?, ?, ?, '[]')
        `).run(fromAgent, message, nowMs, expiresInMs ? nowMs + expiresInMs : null);
        return result.lastInsertRowid as number;
    }

    /** Get broadcasts not yet read by agentId and not expired. */
    getUnread(agentId: string, nowMs: number): BroadcastRow[] {
        const rows = this.db.prepare(`
            SELECT * FROM broadcasts
            WHERE (expires_at IS NULL OR expires_at > ?)
              AND NOT EXISTS (
                  SELECT 1 FROM json_each(read_by) WHERE value = ?
              )
            ORDER BY created_at DESC
            LIMIT 20
        `).all(nowMs, agentId) as BroadcastRow[];
        return rows;
    }

    /** Mark a broadcast as read by agentId. */
    markRead(id: number, agentId: string): void {
        const row = this.db.prepare(
            "SELECT read_by FROM broadcasts WHERE id = ?"
        ).get(id) as { read_by: string } | undefined;
        if (!row) return;

        const readers = safeJsonParse<string[]>(row.read_by, []);
        if (!readers.includes(agentId)) {
            readers.push(agentId);
            this.db.prepare(
                "UPDATE broadcasts SET read_by = ? WHERE id = ?"
            ).run(JSON.stringify(readers), id);
        }
    }

    getAll(nowMs: number): BroadcastRow[] {
        return this.db.prepare(`
            SELECT * FROM broadcasts
            WHERE expires_at IS NULL OR expires_at > ?
            ORDER BY created_at DESC LIMIT 50
        `).all(nowMs) as BroadcastRow[];
    }
}
