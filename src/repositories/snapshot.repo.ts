// ============================================================================
// Engram MCP Server — Snapshot Cache Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";

export class SnapshotRepo {
    constructor(private db: DatabaseType) { }

    /**
     * A cached snapshot, or null if it has expired.
     *
     * TASK #67 T7. upsert() writes ttl_minutes on every call. This method
     * selected only value and updated_at, never read ttl_minutes, and never
     * compared updated_at against now. MEASURED: an entry written with
     * ttl_minutes=5 and updated_at=2020-01-01 was returned unchanged. Cache
     * entries were immortal, and the TTL the caller passed was decoration.
     *
     * Rejected: dropping the column as dead weight, the way task #66 drops
     * deleted_at. Unlike deleted_at this column has a live writer on every
     * upsert, so an unenforced TTL is a correctness bug, not dead schema.
     *
     * An unparseable or missing updated_at is treated as EXPIRED. The cost of
     * being wrong that way is one recomputation; the cost of the other way is
     * serving a snapshot of unknown age forever, which is the bug being fixed.
     */
    getCached(key: string): { value: string; updated_at: string } | null {
        const row = this.db.prepare(
            "SELECT value, updated_at, ttl_minutes FROM snapshot_cache WHERE key = ?"
        ).get(key) as { value: string; updated_at: string; ttl_minutes: number | null } | undefined;
        if (!row) return null;

        const writtenAt = Date.parse(row.updated_at);
        if (!Number.isFinite(writtenAt)) return null;

        // A null or non-positive TTL means "no expiry was requested". Honour
        // that rather than inventing a default: a caller that passed nothing
        // did not ask for a five-minute cache.
        const ttl = row.ttl_minutes;
        if (ttl != null && ttl > 0 && Date.now() - writtenAt > ttl * 60_000) return null;

        return { value: row.value, updated_at: row.updated_at };
    }

    upsert(key: string, value: string, timestamp: string, ttlMinutes: number): void {
        this.db.prepare(
            "INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES (?, ?, ?, ?)"
        ).run(key, value, timestamp, ttlMinutes);
    }
}
