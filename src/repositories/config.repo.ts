// ============================================================================
// Engram MCP Server — Config Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";

export class ConfigRepo {
    constructor(private db: DatabaseType) { }

    get(key: string): string | null {
        try {
            const row = this.db.prepare(
                "SELECT value FROM config WHERE key = ?"
            ).get(key) as { value: string } | undefined;
            return row?.value ?? null;
        } catch {
            return null; // config table may not exist yet
        }
    }

    getOrDefault(key: string, defaultValue: string): string {
        return this.get(key) ?? defaultValue;
    }

    getInt(key: string, defaultValue: number): number {
        const val = this.get(key);
        if (val === null) return defaultValue;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    getBool(key: string, defaultValue: boolean): boolean {
        const val = this.get(key);
        if (val === null) return defaultValue;
        return val === "true";
    }

    set(key: string, value: string, timestamp: string): void {
        this.db.prepare(
            "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)"
        ).run(key, value, timestamp);
    }
}
