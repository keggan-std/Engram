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
        // TASK #65 — `??` throughout, one rule.
        //
        // This method used to coerce with TWO different operators. mtime,
        // branch, hash and executive_summary used `?? null`; purpose, notes,
        // layer and complexity used `|| null`. Combined with COALESCE(?, col)
        // in the UPDATE clause that produced two opposite behaviours in one
        // method: MEASURED across seven fields, each set then rewritten with
        // "", the `??` group CLEARED and the `||` group was IGNORED — the empty
        // string collapsed to NULL, COALESCE kept the old value, and the field
        // could never be cleared by any caller.
        //
        // purpose and notes are exactly the fields a later agent would want to
        // correct after finding an earlier note wrong, and they were the ones
        // that could not be corrected. That compounds task #64: stale content
        // that gets re-certified as fresh was also content that could not be
        // cleared.
        //
        // THE RULE, and it is now the same for every field: an explicit null
        // clears, an omitted key preserves, "" is stored as "".
        //
        // Rejected: `||` throughout. Consistent, and it makes every field
        // permanently uncorrectable — ratifying the accident as design.
        // Rejected: leaving the split and documenting it. Documentation is not
        // a binding per charter §7, and it does not survive the next field
        // being added by copy-paste, which is how the split arose.
        const purpose = data.purpose ?? null;
        const layer = data.layer ?? null;
        const notes = data.notes ?? null;
        const complexity = data.complexity ?? null;
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
            purpose, deps, depnts,
            layer, timestamp, sessionId,
            notes, complexity, mtime, branch, hash, exec_summary,
            // Update values
            purpose, deps, depnts,
            layer, timestamp, sessionId,
            notes, complexity, mtime, branch, hash, exec_summary,
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
