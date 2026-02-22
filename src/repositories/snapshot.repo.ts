// ============================================================================
// Engram MCP Server — Snapshot Cache Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";

export class SnapshotRepo {
    constructor(private db: DatabaseType) { }

    getCached(key: string): { value: string; updated_at: string } | null {
        const row = this.db.prepare(
            "SELECT value, updated_at FROM snapshot_cache WHERE key = ?"
        ).get(key) as { value: string; updated_at: string } | undefined;
        return row ?? null;
    }

    upsert(key: string, value: string, timestamp: string, ttlMinutes: number): void {
        this.db.prepare(
            "INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES (?, ?, ?, ?)"
        ).run(key, value, timestamp, ttlMinutes);
    }
}
