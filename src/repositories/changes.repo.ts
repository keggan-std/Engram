// ============================================================================
// Engram MCP Server — Changes Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { ChangeRow } from "../types.js";
import { normalizePath } from "../utils.js";

export class ChangesRepo {
    constructor(private db: DatabaseType) { }

    recordBulk(
        changes: Array<{
            file_path: string;
            change_type: string;
            description: string;
            diff_summary?: string | null;
            impact_scope: string;
        }>,
        sessionId: number | null,
        timestamp: string
    ): number {
        const insert = this.db.prepare(
            "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );

        const tx = this.db.transaction(() => {
            for (const c of changes) {
                const fp = normalizePath(c.file_path);
                insert.run(sessionId, timestamp, fp, c.change_type, c.description, c.diff_summary || null, c.impact_scope);

                if (sessionId) {
                    this.db.prepare(
                        "UPDATE file_notes SET last_modified_session = ? WHERE file_path = ?"
                    ).run(sessionId, fp);
                }
            }
        });

        tx();
        return changes.length;
    }

    getByFile(filePath: string, limit: number): ChangeRow[] {
        return this.db.prepare(
            "SELECT * FROM changes WHERE file_path = ? ORDER BY timestamp DESC LIMIT ?"
        ).all(normalizePath(filePath), limit) as ChangeRow[];
    }

    getSince(timestamp: string): ChangeRow[] {
        return this.db.prepare(
            "SELECT * FROM changes WHERE timestamp > ? ORDER BY timestamp"
        ).all(timestamp) as ChangeRow[];
    }

    getBySession(sessionId: number): Array<{ change_type: string; file_path: string; description: string }> {
        return this.db.prepare(
            "SELECT change_type, file_path, description FROM changes WHERE session_id = ? AND file_path != '(compacted)'"
        ).all(sessionId) as Array<{ change_type: string; file_path: string; description: string }>;
    }

    getBySessionFull(sessionId: number): Array<{ change_type: string; file_path: string; description: string }> {
        return this.db.prepare(
            "SELECT change_type, file_path, description FROM changes WHERE session_id = ?"
        ).all(sessionId) as Array<{ change_type: string; file_path: string; description: string }>;
    }

    insertCompacted(sessionId: number, timestamp: string, summary: string): void {
        this.db.prepare(
            "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, impact_scope) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(sessionId, timestamp, "(compacted)", "modified", summary, "global");
    }

    deleteNonCompacted(sessionId: number): void {
        this.db.prepare(
            "DELETE FROM changes WHERE session_id = ? AND file_path != '(compacted)'"
        ).run(sessionId);
    }

    getMostChanged(limit: number): Array<{ file_path: string; change_count: number }> {
        return this.db.prepare(
            "SELECT file_path, COUNT(*) as change_count FROM changes GROUP BY file_path ORDER BY change_count DESC LIMIT ?"
        ).all(limit) as Array<{ file_path: string; change_count: number }>;
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM changes").get() as { c: number }).c;
    }

    countBySession(sessionId: number): number {
        return (this.db.prepare(
            "SELECT COUNT(*) as c FROM changes WHERE session_id = ?"
        ).get(sessionId) as { c: number }).c;
    }

    countBeforeCutoff(cutoffId: number): number {
        return (this.db.prepare(
            "SELECT COUNT(*) as c FROM changes WHERE session_id <= ?"
        ).get(cutoffId) as { c: number }).c;
    }
}
