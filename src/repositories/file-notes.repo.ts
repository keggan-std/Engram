// ============================================================================
// Engram MCP Server — File Notes Repository
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import type { FileNoteRow } from "../types.js";
import { normalizePath } from "../utils.js";

export class FileNotesRepo {
    constructor(private db: DatabaseType) { }

    upsert(
        filePath: string,
        timestamp: string,
        sessionId: number | null,
        data: {
            purpose?: string | null;
            dependencies?: string[] | null;
            dependents?: string[] | null;
            layer?: string | null;
            complexity?: string | null;
            notes?: string | null;
        }
    ): void {
        const normalizedPath = normalizePath(filePath);
        const deps = data.dependencies ? JSON.stringify(data.dependencies.map(d => normalizePath(d))) : null;
        const depnts = data.dependents ? JSON.stringify(data.dependents.map(d => normalizePath(d))) : null;

        this.db.prepare(`
      INSERT INTO file_notes (file_path, purpose, dependencies, dependents, layer, last_reviewed, last_modified_session, notes, complexity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        purpose = COALESCE(?, purpose),
        dependencies = COALESCE(?, dependencies),
        dependents = COALESCE(?, dependents),
        layer = COALESCE(?, layer),
        last_reviewed = ?,
        last_modified_session = COALESCE(?, last_modified_session),
        notes = COALESCE(?, notes),
        complexity = COALESCE(?, complexity)
    `).run(
            normalizedPath,
            data.purpose || null, deps, depnts,
            data.layer || null, timestamp, sessionId,
            data.notes || null, data.complexity || null,
            // Update values
            data.purpose || null, deps, depnts,
            data.layer || null, timestamp, sessionId,
            data.notes || null, data.complexity || null,
        );
    }

    upsertBatch(
        entries: Array<{
            file_path: string;
            purpose?: string | null;
            dependencies?: string[] | null;
            dependents?: string[] | null;
            layer?: string | null;
            complexity?: string | null;
            notes?: string | null;
        }>,
        timestamp: string,
        sessionId: number | null
    ): number {
        const tx = this.db.transaction(() => {
            for (const entry of entries) {
                this.upsert(entry.file_path, timestamp, sessionId, {
                    purpose: entry.purpose,
                    dependencies: entry.dependencies,
                    dependents: entry.dependents,
                    layer: entry.layer,
                    complexity: entry.complexity,
                    notes: entry.notes,
                });
            }
        });
        tx();
        return entries.length;
    }

    getByPath(filePath: string): FileNoteRow | null {
        return (this.db.prepare(
            "SELECT * FROM file_notes WHERE file_path = ?"
        ).get(normalizePath(filePath)) as FileNoteRow | undefined) ?? null;
    }

    getFiltered(filters: { layer?: string; complexity?: string }): FileNoteRow[] {
        let query = "SELECT * FROM file_notes WHERE 1=1";
        const params: unknown[] = [];

        if (filters.layer) { query += " AND layer = ?"; params.push(filters.layer); }
        if (filters.complexity) { query += " AND complexity = ?"; params.push(filters.complexity); }
        query += " ORDER BY file_path";

        return this.db.prepare(query).all(...params) as FileNoteRow[];
    }

    getAll(): FileNoteRow[] {
        return this.db.prepare("SELECT * FROM file_notes ORDER BY file_path").all() as FileNoteRow[];
    }

    countAll(): number {
        return (this.db.prepare("SELECT COUNT(*) as c FROM file_notes").get() as { c: number }).c;
    }

    getLayerDistribution(): Array<{ layer: string; count: number }> {
        return this.db.prepare(
            "SELECT layer, COUNT(*) as count FROM file_notes WHERE layer IS NOT NULL GROUP BY layer ORDER BY count DESC"
        ).all() as Array<{ layer: string; count: number }>;
    }
}
