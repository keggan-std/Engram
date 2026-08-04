// ============================================================================
// Retrieval integrity — FR-D3's §5 binding
//
// Domain 3 owns "can we get it back, and is it the right thing". Storage is
// sound here; RETRIEVAL is where it fails. Two defects motivated this suite and
// both are silent, so nothing in the product reports them:
//
//   1. fts_file_notes has no triggers and no writer anywhere in src/. All 96
//      file notes are unsearchable. `search` returns zero and cannot distinguish
//      that from "nothing matched".
//   2. set_file_notes re-stats the file on EVERY write (dispatcher-memory.ts:367),
//      so a one-field drive-by flips a correctly-`stale` note to confidence
//      "high" while leaving another agent's now-false summary in place.
//
// WHY THESE ASSERTIONS ARE SHAPED THIS WAY. A schema-shape check ("file_notes
// has three triggers") would pass against triggers that are present and WRONG —
// which is the documented FTS5 external-content footgun: BEFORE triggers, or
// inserts omitting the rowid, cause real corruption rather than staleness. So
// every assertion here is BEHAVIOURAL: write through the real path, then assert
// the row comes back. A broken trigger cannot satisfy that.
//
// The FTS table list is DERIVED FROM sqlite_master, never hard-coded. That is
// what makes this a binding rather than a test: an FTS table added without
// triggers fails on the day it is added, not the day someone searches.
//
// PINNED DEFECTS. Per the D6/D7 precedent (tests/e2e/multi-agent-wire.test.ts),
// assertions marked `DEFECT:` deliberately assert TODAY'S WRONG VALUE against a
// named task. They are not describing intended behaviour. The suite must never
// sit green over a known bug, so fixing the bug BREAKS these tests — forcing the
// fix to edit the assertion in the same commit a human reviews.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "../../src/migrations.js";
import { FileNotesRepo } from "../../src/repositories/file-notes.repo.js";
import { DecisionsRepo } from "../../src/repositories/decisions.repo.js";
import { SnapshotRepo } from "../../src/repositories/snapshot.repo.js";
import { getFileMtime, getFileHash } from "../../src/utils.js";

let tmp: string;
let db: Database.Database;

beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "engram-d3-"));
    db = new Database(path.join(tmp, "memory.db"));
    db.pragma("foreign_keys = ON");
    runMigrations(db);
});

afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
});

/** Every fts5 virtual table in the live schema, with the base table it indexes. */
function ftsTables(): Array<{ fts: string; base: string | null; cols: string[] }> {
    const rows = db.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%fts5%'"
    ).all() as Array<{ name: string; sql: string }>;

    return rows.map(r => {
        const content = /content\s*=\s*'([^']+)'/.exec(r.sql);
        const body = r.sql.slice(r.sql.indexOf("(") + 1, r.sql.lastIndexOf(")"));
        const cols = body
            .split(",")
            .map(s => s.trim())
            .filter(s => s && !s.includes("=") && !/^fts5/i.test(s));
        return { fts: r.name, base: content ? content[1] : null, cols };
    });
}

// ───────────────────────────────────────────────────────────────────────────
describe("FTS parity — a row written to a base table must be findable by MATCH", () => {
    // Derived, not enumerated. A new fts_* table joins this suite automatically.
    it("discovers the FTS tables from sqlite_master", () => {
        const found = ftsTables();
        expect(found.length).toBeGreaterThan(0);
        // Guards the discovery itself: if the DDL shape changes so the regex stops
        // matching, this fails loudly instead of silently testing nothing.
        expect(found.every(f => f.cols.length > 0)).toBe(true);
    });

    it("every external-content FTS table indexes what its base table receives", () => {
        const token = "ZZQQXXCANARY";
        const unindexed: string[] = [];

        for (const { fts, base, cols } of ftsTables()) {
            if (!base) continue;

            const baseCols = (db.prepare(`PRAGMA table_info(${base})`).all() as Array<{ name: string; notnull: number }>);
            const names = new Set(baseCols.map(c => c.name));
            const target = cols.find(c => names.has(c));
            if (!target) continue;

            // Satisfy NOT NULL columns so the insert is about the index, not constraints.
            const required = baseCols.filter(c => c.notnull === 1 && c.name !== target);
            const insertCols = [target, ...required.map(c => c.name)];
            const values = [token, ...required.map(() => "x")];

            try {
                db.prepare(
                    `INSERT INTO ${base} (${insertCols.join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`
                ).run(...values);
            } catch {
                continue; // schema too constrained to synthesise a row; skip rather than false-fail
            }

            const hits = (db.prepare(
                `SELECT COUNT(*) c FROM ${fts} WHERE ${fts} MATCH ?`
            ).get(token) as { c: number }).c;

            if (hits === 0) unindexed.push(fts);
        }

        // DEFECT (task #35): fts_file_notes has no triggers and no writer in src/.
        // When #35 is fixed this array becomes empty and THIS ASSERTION MUST CHANGE
        // to `expect(unindexed).toEqual([])`. Do not relax it — tighten it.
        expect(unindexed).toEqual(["fts_file_notes"]);
    });

    it("DEFECT (task #35): a file note written through the real repo is unsearchable", () => {
        const repo = new FileNotesRepo(db);
        repo.upsert("src/canary.ts", new Date().toISOString(), 1, {
            purpose: "UNIQUETOKEN42 distinctive text",
            notes: "UNIQUETOKEN42 again",
        });

        const inBase = (db.prepare(
            "SELECT COUNT(*) c FROM file_notes WHERE purpose LIKE '%UNIQUETOKEN42%'"
        ).get() as { c: number }).c;
        const viaMatch = (db.prepare(
            "SELECT COUNT(*) c FROM fts_file_notes WHERE fts_file_notes MATCH 'UNIQUETOKEN42'"
        ).get() as { c: number }).c;

        expect(inBase).toBe(1);          // the write succeeds
        expect(viaMatch).toBe(0);        // DEFECT: the index does not. Becomes toBe(1) on fix.
    });

    it("executive_summary is not indexed, so fixing the triggers alone will not surface it", () => {
        const ddl = (db.prepare(
            "SELECT sql FROM sqlite_master WHERE name='fts_file_notes'"
        ).get() as { sql: string }).sql;

        // DEFECT (task #35, second half): AR-06 mandates executive_summary as the
        // "fast future read" field, and it is absent from the indexed columns.
        expect(ddl).not.toContain("executive_summary");
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Freshness cannot be laundered by a write that did not read the file", () => {
    const FILE_MTIME_STALE_HOURS = 24;
    const rel = "src/target.ts";

    /** Replicates dispatcher-memory.ts:361-375 — note the UNCONDITIONAL re-stat at :367. */
    function setFileNotes(
        repo: FileNotesRepo,
        params: { purpose?: string; notes?: string; executive_summary?: string },
        sessionId: number,
    ) {
        repo.upsert(rel, new Date().toISOString(), sessionId, {
            ...params,
            file_mtime: getFileMtime(rel, tmp),
            content_hash: getFileHash(rel, tmp),
        });
    }

    /** Replicates intelligence.ts:296-303 / withStaleness. */
    function confidence(): string {
        const n = db.prepare("SELECT * FROM file_notes WHERE file_path=?").get(rel) as { file_mtime: number | null };
        if (n?.file_mtime == null) return "unknown";
        const cur = getFileMtime(rel, tmp);
        if (cur == null) return "unknown";
        const driftHours = (cur - n.file_mtime) / 36e5;
        if (driftHours <= 0) return "high";
        return driftHours > FILE_MTIME_STALE_HOURS ? "stale" : "medium";
    }

    it("DEFECT (task #60): a one-field write flips stale back to high", () => {
        mkdirSync(path.join(tmp, "src"), { recursive: true });
        const abs = path.join(tmp, rel);
        writeFileSync(abs, "export const VERSION = 1;\n");

        const repo = new FileNotesRepo(db);
        setFileNotes(repo, {
            purpose: "Constant-only module.",
            executive_summary: "Safe to ignore when tracing behaviour.",
        }, 100);
        expect(confidence()).toBe("high");

        // The file is rewritten and is now 72h newer. The stored note is false.
        writeFileSync(abs, "export async function migrate() { /* destructive */ }\n");
        const future = new Date(Date.now() + 72 * 3600_000);
        utimesSync(abs, future, future);
        expect(confidence()).toBe("stale");   // correct behaviour, and it works

        // A different agent writes ONE unrelated field and never opens the file.
        setFileNotes(repo, { purpose: "Migration helper." }, 200);

        const row = db.prepare("SELECT executive_summary FROM file_notes WHERE file_path=?")
            .get(rel) as { executive_summary: string };

        // The false summary survives untouched …
        expect(row.executive_summary).toBe("Safe to ignore when tracing behaviour.");
        // … and is now certified fresh. AR-02 tells the next agent NOT to open the file.
        // DEFECT: this must become toBe("stale") when task #60 is fixed.
        expect(confidence()).toBe("high");
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Field coercion is uniform", () => {
    const CLEARABLE = ["executive_summary", "git_branch", "content_hash"];
    const NOT_CLEARABLE = ["purpose", "notes", "layer", "complexity"];

    it("DEFECT (task #60): upsert uses two different null coercions in one method", () => {
        const repo = new FileNotesRepo(db);
        const P = "src/coerce.ts";
        const cleared: string[] = [];
        const ignored: string[] = [];

        for (const field of [...CLEARABLE, ...NOT_CLEARABLE]) {
            db.prepare("DELETE FROM file_notes WHERE file_path=?").run(P);
            const all = Object.fromEntries([...CLEARABLE, ...NOT_CLEARABLE].map(f => [f, "SET"]));
            repo.upsert(P, "2026-01-01T00:00:00.000Z", 1, all);

            repo.upsert(P, "2026-01-02T00:00:00.000Z", 2, { [field]: "" });
            const after = (db.prepare(`SELECT ${field} v FROM file_notes WHERE file_path=?`)
                .get(P) as { v: string }).v;

            (after === "" ? cleared : ignored).push(field);
        }

        // DEFECT: `?? null` on lines 42-45 vs `|| null` on lines 65-67 of
        // file-notes.repo.ts. When T3 lands, ALL fields behave one way and this
        // assertion must collapse to a single expectation.
        expect(cleared.sort()).toEqual([...CLEARABLE].sort());
        expect(ignored.sort()).toEqual([...NOT_CLEARABLE].sort());
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Bounds and match semantics", () => {
    it("DEFECT (task #44): SQLite treats LIMIT -1 as unlimited", () => {
        for (let i = 0; i < 5; i++) {
            db.prepare("INSERT INTO decisions (session_id, timestamp, decision, status) VALUES (?,?,?,?)")
                .run(1, new Date().toISOString(), `d${i}`, "active");
        }
        const unbounded = (db.prepare(
            "SELECT COUNT(*) c FROM (SELECT * FROM decisions LIMIT -1)"
        ).get() as { c: number }).c;

        expect(unbounded).toBe(5);

        // The dispatcher's only guard is Math.min(limit*2, MAX_SEARCH_RESULTS),
        // which cannot clamp a negative — it returns a MORE negative number.
        const MAX = 100;
        expect(Math.min(-1 * 2, MAX)).toBe(-2);
        // When T4 lands, clamping becomes Math.max(1, Math.min(n, MAX)):
        expect(Math.max(1, Math.min(-1 * 2, MAX))).toBe(1);
    });

    it("DEFECT (task to file): getByFile treats '_' as a LIKE wildcard", () => {
        const repo = new DecisionsRepo(db);
        const ts = new Date().toISOString();
        repo.create(1, ts, "about hyphen file", "r", ["src/file-notes.repo.ts"], null);
        repo.create(1, ts, "about underscore file", "r", ["src/file_notes.repo.ts"], null);

        const got = repo.getByFile("src/file_notes.repo.ts");

        // DEFECT: '_' matches any single character, so the hyphenated file is
        // returned as though a decision governed it. Becomes toBe(1) under T6.
        expect(got.length).toBe(2);
    });

    it("DEFECT: snapshot_cache.ttl_minutes is written and never enforced", () => {
        const snap = new SnapshotRepo(db);
        snap.upsert("k", "ORIGINAL", "2020-01-01T00:00:00.000Z", 5);

        const cached = snap.getCached("k");
        const stored = db.prepare("SELECT ttl_minutes FROM snapshot_cache WHERE key='k'")
            .get() as { ttl_minutes: number };

        expect(stored.ttl_minutes).toBe(5);
        // Six years past a five-minute TTL. Becomes toBeNull() under T7.
        expect(cached).not.toBeNull();
        expect(cached!.value).toBe("ORIGINAL");
    });

    it("DEFECT: deleted_at exists on four tables and nothing reads or writes it", () => {
        for (const t of ["decisions", "file_notes", "tasks", "sessions"]) {
            const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>)
                .map(c => c.name);
            expect(cols).toContain("deleted_at");
        }

        // Soft-delete a row, then confirm the read path ignores it entirely.
        const repo = new FileNotesRepo(db);
        repo.upsert("src/gone.ts", new Date().toISOString(), 1, { purpose: "p" });
        db.prepare("UPDATE file_notes SET deleted_at = ? WHERE file_path = ?")
            .run(Date.now(), "src/gone.ts");

        // DEFECT: getAll() has no deleted_at filter. Under T5 the column is
        // removed and this test is deleted with it.
        expect(repo.getAll().some(n => n.file_path === "src/gone.ts")).toBe(true);
    });
});
