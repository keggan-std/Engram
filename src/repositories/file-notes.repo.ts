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
            dependencies?: string[] | string | null;
            dependents?: string[] | string | null;
            layer?: string | null;
            complexity?: string | null;
            notes?: string | null;
            file_mtime?: number | null;
            git_branch?: string | null;
            content_hash?: string | null;
            executive_summary?: string | null;
        }
    ): void {
        const normalizedPath = normalizePath(filePath);
        // Defensively parse dependencies/dependents — may be a raw JSON string when called
        // from Universal Mode (HandlerCapturer bypasses Zod coerceStringArray preprocessing).
        const parseDepsField = (v: unknown): string[] | null => {
            if (!v) return null;
            if (Array.isArray(v)) return v as string[];
            if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
            return null;
        };
        const depsArr = parseDepsField(data.dependencies);
        const depntsArr = parseDepsField(data.dependents);
        const deps = depsArr ? JSON.stringify(depsArr.map((d: string) => normalizePath(d))) : null;
        const depnts = depntsArr ? JSON.stringify(depntsArr.map((d: string) => normalizePath(d))) : null;
        const mtime = data.file_mtime ?? null;
        const branch = data.git_branch ?? null;
        const hash = data.content_hash ?? null;
        const exec_summary = data.executive_summary ?? null;

        this.db.prepare(`
      INSERT INTO file_notes (file_path, purpose, dependencies, dependents, layer, last_reviewed, last_modified_session, notes, complexity, file_mtime, git_branch, content_hash, executive_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        purpose = COALESCE(?, purpose),
        dependencies = COALESCE(?, dependencies),
        dependents = COALESCE(?, dependents),
        layer = COALESCE(?, layer),
        last_reviewed = ?,
        last_modified_session = COALESCE(?, last_modified_session),
        notes = COALESCE(?, notes),
        complexity = COALESCE(?, complexity),
        file_mtime = COALESCE(?, file_mtime),
        git_branch = COALESCE(?, git_branch),
        content_hash = COALESCE(?, content_hash),
        executive_summary = COALESCE(?, executive_summary)
    `).run(
            normalizedPath,
            data.purpose || null, deps, depnts,
            data.layer || null, timestamp, sessionId,
            data.notes || null, data.complexity || null, mtime, branch, hash, exec_summary,
            // Update values
            data.purpose || null, deps, depnts,
            data.layer || null, timestamp, sessionId,
            data.notes || null, data.complexity || null, mtime, branch, hash, exec_summary,
        );
    }

    upsertBatch(
        entries: Array<{
            file_path: string;
            purpose?: string | null;
            dependencies?: string[] | string | null;
            dependents?: string[] | string | null;
            layer?: string | null;
            complexity?: string | null;
            notes?: string | null;
            file_mtime?: number | null;
            git_branch?: string | null;
            content_hash?: string | null;
            executive_summary?: string | null;
        }>,        timestamp: string,
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
                    file_mtime: entry.file_mtime,
                    git_branch: entry.git_branch,
                    content_hash: entry.content_hash,
                    executive_summary: entry.executive_summary,
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
