// ============================================================================
// Upgrade path — an EXISTING user's memory must survive the update
//
// Task #7. This is the half of charter §11b.1 that tests/migrations/golden-fixture.test.ts
// states, in its own header, that it cannot do:
//
//   "HONEST LIMIT: the fixture is captured at V25, so migrating it to a V25 head
//    is a no-op TODAY. [...] The historical V1->V25-with-data gap is task #7 and
//    stays open."
//
// PROVEN 2026-08-07, before this file existed: the golden fixture sits at V25 and
// head is V25, so the pending-migration count for that suite is ZERO. Every
// migration assertion in this repo ran against a database that needed no
// migrating.
//
// That matters because FOUR migrations mutate rows that already exist, and a
// migration which only touches pre-existing rows is INVISIBLE to a test that
// starts from an empty database at head:
//
//   V2   builds the FTS5 indexes and backfills them from existing rows
//   V23  ALTERs conventions, then backfills summary from rule       <-- and DROPs the FTS table
//   V24  creates observations and backfills
//   V25  repairs decisions.superseded_by written backwards
//
// Measured on the live fixture: V25 would repair 0 rows in it and V23 would
// backfill 7 — so the repair migrations had never once executed against a row
// they were written to repair.
//
// WHAT THIS SUITE DOES INSTEAD. It builds a database at a genuinely historical
// schema version with runMigrationsTo(), seeds it with the REAL rows from the
// golden fixture projected onto that version's columns, and then runs the real
// chain forward to head. Real shapes — NULLs, JSON blobs, superseded decisions,
// multi-thousand-character summaries — through the real migrations.
//
// The start versions are not arbitrary:
//   V24 is what every user on published v1.12.0 is running right now.
//   V22 is the last version before the conventions ALTER + FTS rebuild.
//   V1  is the full history, which is what task #7 asked for.
// ============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, runMigrationsTo } from "../../src/migrations.js";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "fixtures", "golden-memory.db");

const q = (s: string) => `"${s}"`;

function userTables(db: Database.Database): string[] {
    return (db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'`
    ).all() as { name: string }[]).map(r => r.name);
}

function columnsOf(db: Database.Database, table: string): string[] {
    return (db.pragma(`table_info(${q(table)})`) as { name: string }[]).map(c => c.name);
}

function schemaVersion(db: Database.Database): number {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
}

/** Head, derived from a fresh migrate — never hardcoded, so adding a migration
 *  cannot leave this suite quietly asserting an old target. */
function headVersion(): number {
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    const v = schemaVersion(fresh);
    fresh.close();
    return v;
}

/**
 * Seed `target` with the golden fixture's real rows, projected onto whatever
 * columns exist at the target's CURRENT schema version.
 *
 * Derived, not hand-written: the column list comes from PRAGMA table_info on
 * both databases, so a schema change cannot leave a stale copy of it here.
 * Tables that do not exist yet at this version are skipped — that IS the
 * historical situation, not a shortcut.
 *
 * Returns the row count actually seeded per table, which is what the
 * post-migration assertions compare against.
 */
function seedFromFixture(target: Database.Database): Record<string, number> {
    const fixture = new Database(FIXTURE, { readonly: true });
    const seeded: Record<string, number> = {};
    try {
        const targetTables = new Set(userTables(target));
        // Seeding a snapshot, not simulating an application: insert order is
        // arbitrary, so enforcement goes off here and foreign_key_check runs
        // for real after the migration instead.
        target.pragma("foreign_keys = OFF");

        for (const table of userTables(fixture)) {
            if (!targetTables.has(table)) continue;   // table not born yet at this version
            if (table === "schema_meta") continue;    // would overwrite the version under test

            const targetCols = new Set(columnsOf(target, table));
            const shared = columnsOf(fixture, table).filter(c => targetCols.has(c));
            if (shared.length === 0) continue;

            const rows = fixture.prepare(
                `SELECT ${shared.map(q).join(", ")} FROM ${q(table)}`
            ).all() as Record<string, unknown>[];
            if (rows.length === 0) continue;

            const stmt = target.prepare(
                `INSERT OR IGNORE INTO ${q(table)} (${shared.map(q).join(", ")})
                 VALUES (${shared.map(() => "?").join(", ")})`
            );
            const insertAll = target.transaction((rs: Record<string, unknown>[]) => {
                for (const r of rs) stmt.run(shared.map(c => r[c] as never));
            });
            insertAll(rows);

            seeded[table] = (target.prepare(`SELECT COUNT(*) n FROM ${q(table)}`).get() as { n: number }).n;
        }
        target.pragma("foreign_keys = ON");
    } finally {
        fixture.close();
    }
    return seeded;
}

/** A real on-disk database at `version`, seeded with real data. Returns the
 *  handle, the seeded counts, and a dispose function. */
function databaseAt(version: number) {
    const dir = mkdtempSync(path.join(os.tmpdir(), `engram-upgrade-v${version}-`));
    const file = path.join(dir, "memory.db");
    const db = new Database(file);
    runMigrationsTo(db, version);
    const seeded = seedFromFixture(db);
    return {
        db,
        seeded,
        dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); },
    };
}

function countsOf(db: Database.Database, tables: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of tables) {
        out[t] = (db.prepare(`SELECT COUNT(*) n FROM ${q(t)}`).get() as { n: number }).n;
    }
    return out;
}

// ─── The upgrade every published user is about to perform ──────────────────

// V24 is main's schema and therefore v1.12.0's. V22 predates the conventions
// ALTER. V1 is the whole history. Each is a real starting point, not a sample.
const START_VERSIONS = [24, 22, 1] as const;

describe.each(START_VERSIONS)("upgrading a real V%i database to head", (from) => {
    it("does not throw, and lands exactly on head", () => {
        const { db, dispose } = databaseAt(from);
        try {
            expect(schemaVersion(db)).toBe(from);
            expect(() => runMigrations(db)).not.toThrow();
            expect(schemaVersion(db)).toBe(headVersion());
        } finally { dispose(); }
    });

    it("preserves every seeded row of every table", () => {
        const { db, seeded, dispose } = databaseAt(from);
        try {
            const tables = Object.keys(seeded);
            // Guard against the vacuous pass: if seeding silently did nothing,
            // "no rows were lost" is trivially true and proves nothing.
            expect(tables.length, "seeding produced no rows — the assertion below would be vacuous").toBeGreaterThan(3);

            const before = countsOf(db, tables);
            runMigrations(db);
            const after = countsOf(db, tables);
            expect(after).toEqual(before);
        } finally { dispose(); }
    });

    it("passes SQLite's own integrity check afterwards", () => {
        const { db, dispose } = databaseAt(from);
        try {
            runMigrations(db);
            expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
        } finally { dispose(); }
    });

    it("leaves no dangling foreign key", () => {
        const { db, dispose } = databaseAt(from);
        try {
            runMigrations(db);
            expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
        } finally { dispose(); }
    });

    it("is idempotent — a second upgrade changes nothing", () => {
        const { db, seeded, dispose } = databaseAt(from);
        try {
            const tables = Object.keys(seeded);
            runMigrations(db);
            const once = countsOf(db, tables);
            const v1 = schemaVersion(db);

            expect(() => runMigrations(db)).not.toThrow();

            expect(countsOf(db, tables)).toEqual(once);
            expect(schemaVersion(db)).toBe(v1);
        } finally { dispose(); }
    });

    it("leaves full-text search able to find the migrated rows", () => {
        const { db, dispose } = databaseAt(from);
        try {
            runMigrations(db);
            // The failure this catches is silent: the base table survives, the
            // FTS index does not, and retrieval degrades to zero results with
            // no error anywhere. V2 and V23 both rebuild indexes from existing
            // rows, which is precisely the path an empty-database test skips.
            const hits = (db.prepare("SELECT COUNT(*) n FROM fts_decisions").get() as { n: number }).n;
            expect(hits, "decisions survived but became unsearchable").toBeGreaterThan(0);
        } finally { dispose(); }
    });
});

// ─── The data repairs must actually fire ───────────────────────────────────
//
// The tests above prove nothing was LOST. These prove the migrations that exist
// to CHANGE existing data did their job — which no empty-database test can ask.

describe("migrations that repair pre-existing data actually run", () => {
    it("V23 backfills conventions.summary for rows that predate the column", () => {
        const { db, dispose } = databaseAt(22);
        try {
            // At V22 the column does not exist, so every seeded convention is a
            // row that predates it — the exact population V23 was written for.
            expect(columnsOf(db, "conventions")).not.toContain("summary");
            const total = (db.prepare("SELECT COUNT(*) n FROM conventions").get() as { n: number }).n;
            expect(total, "no conventions seeded — this assertion would be vacuous").toBeGreaterThan(0);

            runMigrations(db);

            const unfilled = (db.prepare(
                "SELECT COUNT(*) n FROM conventions WHERE summary IS NULL"
            ).get() as { n: number }).n;
            expect(unfilled, "V23's backfill did not reach pre-existing rows").toBe(0);

            // And it must be the DEFINED value, not merely non-null.
            const wrong = (db.prepare(
                "SELECT COUNT(*) n FROM conventions WHERE summary <> SUBSTR(rule, 1, 80)"
            ).get() as { n: number }).n;
            expect(wrong).toBe(0);
        } finally { dispose(); }
    });

    it("V25 clears a superseded_by pointer written backwards on an active decision", () => {
        const { db, dispose } = databaseAt(24);
        try {
            // Reproduce the defect V25 exists to repair: the authoritative row
            // left pointing backwards at the decision it replaced, while still
            // active. Injected at V24 because that is where such rows were made.
            const victim = db.prepare(
                "SELECT id FROM decisions WHERE status <> 'superseded' ORDER BY id DESC LIMIT 1"
            ).get() as { id: number } | undefined;
            expect(victim, "no active decision seeded — cannot exercise V25").toBeDefined();

            const predecessor = db.prepare(
                "SELECT id FROM decisions WHERE id < ? ORDER BY id DESC LIMIT 1"
            ).get(victim!.id) as { id: number } | undefined;
            expect(predecessor).toBeDefined();

            db.prepare("UPDATE decisions SET superseded_by = ? WHERE id = ?")
                .run(predecessor!.id, victim!.id);

            const inverted = () => (db.prepare(
                `SELECT COUNT(*) n FROM decisions
                  WHERE superseded_by IS NOT NULL AND status <> 'superseded'`
            ).get() as { n: number }).n;

            expect(inverted(), "the defect was not successfully injected").toBe(1);

            runMigrations(db);

            expect(inverted(), "V25 did not repair the pre-existing inverted pointer").toBe(0);
        } finally { dispose(); }
    });
});

// ─── The interrupted upgrade ───────────────────────────────────────────────

describe("an upgrade interrupted part-way", () => {
    it("can be retried — V23's unconditional ALTER must not strand the database", () => {
        // src/migrations.ts's file note records the concern: V23 runs two
        // unconditional `ALTER TABLE conventions ADD COLUMN` statements, so a
        // failure after them would leave a database that cannot re-run V23.
        // Each migration runs inside db.transaction(), and SQLite's DDL is
        // transactional, so the claim is testable rather than arguable.
        //
        // This is the scenario a user hits when the machine dies mid-upgrade,
        // and the adjacent one to task #59, where two processes racing the chain
        // kill one with "duplicate column name".
        const { db, seeded, dispose } = databaseAt(22);
        try {
            const tables = Object.keys(seeded);
            const before = countsOf(db, tables);

            // Interrupt V23 by making a later statement in it fail: drop the
            // config table it writes to at step 7, so up() throws mid-migration.
            db.exec("ALTER TABLE config RENAME TO config_hidden");
            expect(() => runMigrations(db)).toThrow();

            // The transaction must have rolled the ALTERs back, leaving V22.
            expect(schemaVersion(db), "a failed migration advanced the version").toBe(22);
            expect(columnsOf(db, "conventions"), "a failed migration left its ALTER committed").not.toContain("summary");

            // Undo the sabotage; the retry must now succeed and lose nothing.
            db.exec("ALTER TABLE config_hidden RENAME TO config");
            expect(() => runMigrations(db)).not.toThrow();
            expect(schemaVersion(db)).toBe(headVersion());
            expect(countsOf(db, tables)).toEqual(before);
        } finally { dispose(); }
    });
});
