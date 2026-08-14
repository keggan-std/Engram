// ============================================================================
// Golden fixture — migrations must carry REAL data forward
//
// Foundations Review FR-0f item 1. This is FR-D1's §5 binding: the mechanism
// that fails the day migration breaks, rather than the day someone goes looking.
//
// Every other suite in this repo builds a fresh in-memory database and runs the
// migration chain against EMPTY TABLES. That is the standard way migration
// tests give false confidence: "migrations would pass CI tests but fail in
// production because of the data in the production database." So V23's backfill
// (which only touches pre-existing rows) and V19's idempotency guards have
// never executed against data here. 33% branch coverage on migrations.ts
// against 91% statement coverage is that gap, measured.
//
// tests/fixtures/golden-memory.db is this project's own memory store, captured
// live and sanitised by scripts/make-golden-fixture.mjs: 16 sessions, 94 file
// notes, 57 observations, 19 decisions, 28 tasks, 33 changes. Real shapes,
// including the awkward ones — NULLs, superseded decisions, JSON blobs,
// unacknowledged handoffs, 2,000-character summaries.
//
// HONEST LIMIT: the fixture is captured at V25, so migrating it to a V25 head
// is a no-op TODAY. Its value starts at V26 — every migration added from now on
// must carry this data. The historical V1->V25-with-data gap is task #7 and
// stays open. Everything below is written so the suite is not merely decoration
// in the meantime: it asserts counts, integrity invariants, idempotency, and
// the sanitisation contract.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/migrations.js";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "fixtures", "golden-memory.db");

/** Tables whose contents must survive a migration unchanged. */
const CORE_TABLES = [
    "sessions", "decisions", "file_notes", "observations",
    "tasks", "changes", "conventions", "handoffs", "milestones",
] as const;

let tmpDir: string;
let workingCopy: string;

function open(file: string): Database.Database {
    const db = new Database(file);
    db.pragma("foreign_keys = ON");
    return db;
}

function counts(db: Database.Database): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of CORE_TABLES) {
        out[t] = (db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get() as { n: number }).n;
    }
    return out;
}

function schemaVersion(db: Database.Database): string | undefined {
    return (db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined)?.value;
}

/** Head version, derived from a freshly-migrated database — never hardcoded,
 *  so this suite cannot drift out of date when a migration is added. */
function headVersion(): string | undefined {
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    const v = schemaVersion(fresh);
    fresh.close();
    return v;
}

beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "engram-golden-"));
    workingCopy = path.join(tmpDir, "memory.db");
});

afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe("golden fixture — the file itself", () => {
    it("exists, and is committed to the repo", () => {
        expect(existsSync(FIXTURE)).toBe(true);
    });

    it("has exactly the contents it was captured with", () => {
        const db = open(FIXTURE);
        const c = counts(db);
        db.close();
        // PINNED ON PURPOSE. The first version asserted loose bounds
        // (file_notes > 50, observations > 20) and a proof run showed it missed
        // the case that matters: deleting 5 observations from the fixture passed
        // the whole suite, because the migration test only compares before/after
        // WITHIN one run — data already lost before migration is invisible to it.
        //
        // A committed fixture is a fixed artifact, so its counts are constants.
        // Rebuilding it is a deliberate act (scripts/make-golden-fixture.mjs) and
        // must show up here as a diff someone approves, exactly like
        // CAPABILITY-SURFACE.md. Silent erosion is the thing being prevented.
        expect(c).toEqual({
            sessions: 16,
            decisions: 19,
            file_notes: 94,
            observations: 57,
            tasks: 28,
            changes: 33,
            conventions: 7,
            handoffs: 4,
            milestones: 1,
        });
    });

    // The sanitisation contract, enforced forever rather than at build time only.
    // Without this, a future rebuild on a different machine silently commits
    // that machine's absolute paths and identity into the repository.
    it("contains no machine identity", () => {
        const db = open(FIXTURE);
        const leaked = ["machine_id", "instance_id", "http_token", "dashboard_token"]
            .filter(k => db.prepare("SELECT 1 FROM config WHERE key = ?").get(k));
        db.close();
        expect(leaked).toEqual([]);
    });

    it("contains no absolute filesystem paths, in any text column of any table", () => {
        const db = open(FIXTURE);
        const ABSOLUTE = /\b[A-Za-z]:(?:\\\\|[\\/])/;
        const tables = (db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'"
        ).all() as { name: string }[]).map(r => r.name);

        const offenders: string[] = [];
        for (const t of tables) {
            for (const row of db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]) {
                for (const [col, v] of Object.entries(row)) {
                    if (typeof v === "string" && ABSOLUTE.test(v)) offenders.push(`${t}.${col}`);
                }
            }
        }
        db.close();
        expect([...new Set(offenders)]).toEqual([]);
    });
});

describe("golden fixture — migrating real data to head", () => {
    it("migrates without throwing, and lands on the current schema version", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        const from = schemaVersion(db);

        expect(() => runMigrations(db)).not.toThrow();

        const to = schemaVersion(db);
        db.close();

        expect(to).toBe(headVersion());
        // Recorded rather than asserted: while the fixture sits at head this is a
        // no-op, and the day it is not, the diff is the interesting part.
        expect(Number(to)).toBeGreaterThanOrEqual(Number(from));
    });

    it("preserves every row of every core table", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        const before = counts(db);
        runMigrations(db);
        const after = counts(db);
        db.close();
        expect(after).toEqual(before);
    });

    it("is idempotent — migrating twice changes nothing", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        runMigrations(db);
        const once = counts(db);
        const v1 = schemaVersion(db);

        expect(() => runMigrations(db)).not.toThrow();

        const twice = counts(db);
        const v2 = schemaVersion(db);
        db.close();
        expect(twice).toEqual(once);
        expect(v2).toBe(v1);
    });
});

describe("golden fixture — integrity invariants after migration", () => {
    it("no decision is superseded by an EARLIER decision (the V25 corruption)", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        runMigrations(db);
        // superseded_by was written backwards before V25, leaving the CURRENT
        // decision marked as superseded by its own predecessor. A migration that
        // reintroduces that inversion fails here.
        const inverted = db.prepare(`
            SELECT d.id, d.superseded_by
            FROM decisions d JOIN decisions p ON d.superseded_by = p.id
            WHERE d.superseded_by IS NOT NULL AND p.id < d.id
        `).all();
        db.close();
        expect(inverted).toEqual([]);
    });

    it("every foreign-key reference still resolves", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        runMigrations(db);
        const violations = db.pragma("foreign_key_check") as unknown[];
        db.close();
        expect(violations).toEqual([]);
    });

    it("passes SQLite's own integrity check", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        runMigrations(db);
        const result = db.pragma("integrity_check", { simple: true });
        db.close();
        expect(result).toBe("ok");
    });

    it("full-text search still returns rows after migration", () => {
        copyFileSync(FIXTURE, workingCopy);
        const db = open(workingCopy);
        runMigrations(db);
        // FTS tables are the part most likely to be silently left behind by a
        // migration: the base table survives, the index does not, and retrieval
        // degrades to nothing without any error.
        let hits = 0;
        try {
            hits = (db.prepare("SELECT COUNT(*) n FROM fts_decisions").get() as { n: number }).n;
        } finally {
            db.close();
        }
        expect(hits).toBeGreaterThan(0);
    });
});
