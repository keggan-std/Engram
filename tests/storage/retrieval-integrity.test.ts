// ============================================================================
// Retrieval integrity — FR-D3's §5 binding
//
// Domain 3 owns "can we get it back, and is it the right thing". Storage is
// sound here; RETRIEVAL is where it fails. Two defects motivated this suite and
// both are silent, so nothing in the product reports them:
//
//   1. fts_file_notes had no triggers and no writer anywhere in src/. All 96
//      file notes were unsearchable, and `search` returned zero without being
//      able to distinguish that from "nothing matched".
//      FIXED — migration V26, 2026-08-07. The three pinned assertions in the
//      first describe block were tightened to the correct values in the same
//      commit, exactly as the PINNED DEFECTS note below requires. Lifecycle
//      coverage (sync on edit/delete, soft delete, backfill, idempotency) lives
//      in tests/storage/fts-file-notes.test.ts; the parity binding stays here.
//   2. set_file_notes re-stat'd the file on EVERY write, so a one-field
//      drive-by flipped a correctly-`stale` note to confidence "high" while
//      leaving another agent's now-false summary in place — and AR-02 then told
//      the next agent not to open the file.
//      FIXED 2026-08-12 — task #64 (this block previously cited #60, which is
//      the file-coordination task, not this one). set_file_notes and
//      set_file_notes_batch now refresh file_mtime/content_hash only when the
//      write supplies every content field the row already holds
//      (certifiesContent, dispatcher-memory.ts). The pinned assertion below was
//      flipped from "high" to "stale" in the same commit, exactly as the PINNED
//      DEFECTS note requires, and two tests were added for the kill switch: a
//      genuine full re-read must still certify, or the fix would make `stale`
//      permanent and the feature net-negative.
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
import { certifiesContent } from "../../src/tools/dispatcher-memory.js";
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

        // FIXED by V26 (task #35). This was pinned to `["fts_file_notes"]` while
        // that table had no triggers; it is now empty, as this suite's header
        // required the fix to make it. Tightened, not relaxed — every
        // external-content FTS table must index what its base table receives.
        expect(unindexed).toEqual([]);
    });

    it("a file note written through the real repo is searchable (task #35, fixed in V26)", () => {
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
        expect(viaMatch).toBe(1);        // and so does the index, since V26
    });

    it("executive_summary is indexed (task #35, second half)", () => {
        const ddl = (db.prepare(
            "SELECT sql FROM sqlite_master WHERE name='fts_file_notes'"
        ).get() as { sql: string }).sql;

        // AR-06 mandates executive_summary as the "fast future read" field. It
        // was absent from V2's column list, so restoring the triggers alone
        // would have left the one required field unsearchable. V26 recreates
        // the table with it — fts5 columns cannot be ALTERed.
        expect(ddl).toContain("executive_summary");
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Freshness cannot be laundered by a write that did not read the file", () => {
    const FILE_MTIME_STALE_HOURS = 24;
    const rel = "src/target.ts";

    /**
     * Mirrors the real set_file_notes path, INCLUDING its certification gate.
     *
     * This used to replicate the unconditional re-stat that was the defect.
     * Now it calls the production predicate, so the suite exercises the real
     * rule rather than a copy of it that could drift away from the code it is
     * supposed to be protecting.
     */
    function setFileNotes(
        repo: FileNotesRepo,
        params: { purpose?: string; notes?: string; executive_summary?: string },
        sessionId: number,
    ) {
        const refresh = certifiesContent(repo.getByPath(rel), params);
        repo.upsert(rel, new Date().toISOString(), sessionId, {
            ...params,
            file_mtime: refresh ? getFileMtime(rel, tmp) : undefined,
            content_hash: refresh ? getFileHash(rel, tmp) : undefined,
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

    it("FIXED (task #64): a one-field write can no longer flip stale back to high", () => {
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

        // The false summary still survives — COALESCE(?, col) is unchanged and
        // preserving an omitted field is correct behaviour on its own.
        expect(row.executive_summary).toBe("Safe to ignore when tracing behaviour.");

        // What must NOT happen is that surviving text being certified fresh.
        // AR-02 is CRITICAL and tells the next agent to open the file only if
        // the note is absent or stale, so a laundered `high` here does not just
        // misinform — it instructs the next agent not to look.
        expect(
            confidence(),
            "a write that supplied only `purpose` re-certified an executive_summary it never read",
        ).toBe("stale");
    });

    it("a full re-read still marks the note fresh — the fix must not make `stale` permanent", () => {
        // The kill switch from 03-storage.md §4 T1: a signal that always says
        // stale is a slower way of saying "always open the file", and would
        // make the feature net-negative. An agent that genuinely re-reads and
        // rewrites every content field must be able to certify that.
        mkdirSync(path.join(tmp, "src"), { recursive: true });
        const abs = path.join(tmp, rel);
        writeFileSync(abs, "export const VERSION = 1;\n");

        const repo = new FileNotesRepo(db);
        setFileNotes(repo, { purpose: "p", notes: "n", executive_summary: "e" }, 100);

        writeFileSync(abs, "export async function migrate() {}\n");
        const future = new Date(Date.now() + 72 * 3600_000);
        utimesSync(abs, future, future);
        expect(confidence()).toBe("stale");

        // Agent re-reads and rewrites everything the note holds.
        setFileNotes(repo, { purpose: "p2", notes: "n2", executive_summary: "e2" }, 200);
        expect(confidence()).toBe("high");
    });

    it("a first write on a fresh note certifies — there is nothing to launder", () => {
        mkdirSync(path.join(tmp, "src"), { recursive: true });
        writeFileSync(path.join(tmp, rel), "export const A = 1;\n");
        const repo = new FileNotesRepo(db);
        setFileNotes(repo, { purpose: "only a purpose" }, 300);
        expect(confidence()).toBe("high");
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Field coercion is uniform", () => {
    const CLEARABLE = ["executive_summary", "git_branch", "content_hash"];
    const NOT_CLEARABLE = ["purpose", "notes", "layer", "complexity"];

    // FIXED, task #65. This asserted the split on purpose until now: `?? null`
    // for four fields, `|| null` for the other four, in one method. Combined
    // with COALESCE(?, col) that made "" CLEAR one group and be IGNORED by the
    // other. purpose and notes — exactly the fields an agent would want to
    // correct after finding an earlier note wrong — were in the uncorrectable
    // group. The two lists above are kept as the record of which was which.
    it("upsert uses ONE null coercion, so every field clears the same way", () => {
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

        // Collapsed to a single expectation, as task #65 requires.
        expect(cleared.sort()).toEqual([...CLEARABLE, ...NOT_CLEARABLE].sort());
        expect(ignored).toEqual([]);
    });

    it("an omitted key still PRESERVES — clearing must need an explicit value", () => {
        // The other half of the rule, and the one that would break silently if
        // someone "simplified" the fix by dropping COALESCE. Without it, every
        // partial write would blank the fields it did not mention — which is
        // task #64's freshness-laundering hazard with the data destroyed too.
        const repo = new FileNotesRepo(db);
        const P = "src/preserve.ts";
        db.prepare("DELETE FROM file_notes WHERE file_path=?").run(P);
        repo.upsert(P, "2026-01-01T00:00:00.000Z", 1, { purpose: "KEEP", notes: "KEEP TOO" });
        repo.upsert(P, "2026-01-02T00:00:00.000Z", 2, { purpose: "CHANGED" });

        const row = db.prepare("SELECT purpose, notes FROM file_notes WHERE file_path=?")
            .get(P) as { purpose: string; notes: string };
        expect(row.purpose).toBe("CHANGED");
        expect(row.notes, "a key that was not supplied is preserved").toBe("KEEP TOO");
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

    // FIXED, task #67 T6. `affected_files LIKE '%path%'` bound the value — so
    // never an injection — but left '_' as a single-character wildcard AND
    // matched substrings of a JSON array. Now json_each equality.
    it("getByFile matches the exact path, not a LIKE pattern", () => {
        const repo = new DecisionsRepo(db);
        const ts = new Date().toISOString();
        repo.create(1, ts, "about hyphen file", "r", ["src/file-notes.repo.ts"], null);
        repo.create(1, ts, "about underscore file", "r", ["src/file_notes.repo.ts"], null);

        const got = repo.getByFile("src/file_notes.repo.ts");

        expect(got.length, "'_' is no longer a wildcard").toBe(1);
        expect(got[0].decision).toBe("about underscore file");
    });

    it("getByFile does not match a longer path that merely contains this one", () => {
        // The other half of T6, and the half a wildcard-only fix would miss:
        // it was a SUBSTRING match, so src/a.ts matched src/a.ts.bak.
        const repo = new DecisionsRepo(db);
        const ts = new Date().toISOString();
        repo.create(1, ts, "about the backup", "r", ["src/subset.ts.bak"], null);

        expect(repo.getByFile("src/subset.ts").length).toBe(0);
        expect(repo.getByFile("src/subset.ts.bak").length).toBe(1);
    });

    // FIXED, task #67 T7. upsert() wrote ttl_minutes on every call; getCached
    // never read it and never compared updated_at against now, so entries were
    // immortal and the TTL was decoration.
    it("getCached returns null once the TTL has passed", () => {
        const snap = new SnapshotRepo(db);
        snap.upsert("k", "ORIGINAL", "2020-01-01T00:00:00.000Z", 5);

        const stored = db.prepare("SELECT ttl_minutes FROM snapshot_cache WHERE key='k'")
            .get() as { ttl_minutes: number };
        expect(stored.ttl_minutes).toBe(5);

        // Six years past a five-minute TTL.
        expect(snap.getCached("k")).toBeNull();
    });

    it("getCached still returns an entry inside its TTL", () => {
        // The control. A TTL fix that expires everything is not a fix, and
        // asserting only the null case above would not notice.
        const snap = new SnapshotRepo(db);
        snap.upsert("fresh", "CURRENT", new Date().toISOString(), 5);
        expect(snap.getCached("fresh")?.value).toBe("CURRENT");
    });

    it("an unparseable updated_at is treated as expired, not as fresh forever", () => {
        const snap = new SnapshotRepo(db);
        db.prepare("INSERT OR REPLACE INTO snapshot_cache (key, value, updated_at, ttl_minutes) VALUES (?,?,?,?)")
            .run("junk", "VALUE", "not-a-date", 5);
        expect(snap.getCached("junk")).toBeNull();
    });

    it("DEFECT: deleted_at exists on four tables and no src/ code path writes it", () => {
        // Narrowed from "nothing reads or writes it" — V26's fts_file_notes
        // triggers now READ the column, so soft-deleted notes stay out of the
        // search index if the feature is ever wired up. Nothing WRITES it: the
        // column was added by V19 for "soft-delete support" that was never
        // implemented, and a grep of src/ for an assignment finds none. The
        // read paths below are still unfiltered, which is the live defect.
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
