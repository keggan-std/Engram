// ============================================================================
// Tests — V26: fts_file_notes is actually populated and stays in sync
// ============================================================================
//
// fts_file_notes was created by V2 and then left out of both the trigger block
// and the backfill, so the inverted index was never written by any code path at
// any time and file-note search silently returned nothing for the life of the
// product.
//
// THE OBVIOUS TEST FOR THIS IS VACUOUS AND WILL REPORT SUCCESS ON THE BROKEN
// CODE. For an external-content fts5 table, `SELECT * FROM fts_file_notes`
// reads the columns back THROUGH file_notes by rowid, so counts and values
// agree perfectly whether or not an index exists. Everything below therefore
// asserts on MATCH results or on fts_file_notes_data, the only two things that
// touch the actual index. Do not "simplify" these into count comparisons.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, runMigrationsTo } from "../../src/migrations.js";

/** fts5 keeps a fixed number of bookkeeping rows in an empty index. */
const EMPTY_INDEX_DATA_ROWS = 2;

function note(db: Database.Database, filePath: string, fields: {
  purpose?: string; notes?: string; summary?: string;
} = {}): void {
  db.prepare(
    `INSERT INTO file_notes (file_path, purpose, notes, executive_summary)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       purpose = excluded.purpose,
       notes = excluded.notes,
       executive_summary = excluded.executive_summary`
  ).run(filePath, fields.purpose ?? null, fields.notes ?? null, fields.summary ?? null);
}

const match = (db: Database.Database, q: string): number =>
  (db.prepare("SELECT COUNT(*) c FROM fts_file_notes WHERE fts_file_notes MATCH ?").get(q) as { c: number }).c;

const dataRows = (db: Database.Database): number =>
  (db.prepare("SELECT COUNT(*) c FROM fts_file_notes_data").get() as { c: number }).c;

describe("V26 — fts_file_notes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
  });

  // ─── The regression ────────────────────────────────────────────────

  test("a newly written note is findable", () => {
    note(db, "src/widget.ts", { purpose: "renders the widget", notes: "uses the flux capacitor" });
    expect(match(db, "capacitor")).toBe(1);
  });

  test("the index is genuinely written, not read back through the base table", () => {
    expect(dataRows(db)).toBe(EMPTY_INDEX_DATA_ROWS);
    for (let i = 0; i < 20; i++) note(db, `src/f${i}.ts`, { notes: `distinctive token${i} here` });
    expect(dataRows(db)).toBeGreaterThan(EMPTY_INDEX_DATA_ROWS);
  });

  test("every indexed column is searchable", () => {
    note(db, "src/alpha.ts", {
      purpose: "purposeword",
      notes: "notesword",
      summary: "summaryword",
    });
    for (const token of ["alpha", "purposeword", "notesword", "summaryword"]) {
      expect(match(db, token), `'${token}' should be findable`).toBe(1);
    }
  });

  test("executive_summary is indexed — AR-06 requires every agent to write it", () => {
    // Restoring the triggers alone would have left this one unsearchable, since
    // V2's column list was file_path, purpose, notes.
    note(db, "src/beta.ts", { summary: "onlyinthesummary" });
    expect(match(db, "onlyinthesummary")).toBe(1);
  });

  // ─── Sync ──────────────────────────────────────────────────────────

  test("an edit replaces the old terms rather than accumulating them", () => {
    note(db, "src/gamma.ts", { notes: "originalterm" });
    expect(match(db, "originalterm")).toBe(1);

    note(db, "src/gamma.ts", { notes: "replacementterm" });
    expect(match(db, "replacementterm")).toBe(1);
    expect(match(db, "originalterm"), "stale term still indexed after edit").toBe(0);
  });

  test("a deleted note leaves nothing behind", () => {
    note(db, "src/delta.ts", { notes: "doomedterm" });
    expect(match(db, "doomedterm")).toBe(1);
    db.prepare("DELETE FROM file_notes WHERE file_path = ?").run("src/delta.ts");
    expect(match(db, "doomedterm")).toBe(0);
  });

  test("repeated edits do not corrupt the index", () => {
    for (let i = 0; i < 25; i++) note(db, "src/churn.ts", { notes: `revision${i}` });
    expect(match(db, "revision24")).toBe(1);
    expect(match(db, "revision0")).toBe(0);
    // fts5 validates its own structures here; a desynced external-content
    // index raises rather than returning a wrong answer.
    expect(() =>
      db.prepare("INSERT INTO fts_file_notes(fts_file_notes) VALUES('integrity-check')").run()
    ).not.toThrow();
  });

  // ─── Soft delete ───────────────────────────────────────────────────

  test("a soft-deleted note is not findable", () => {
    note(db, "src/epsilon.ts", { notes: "secretterm" });
    expect(match(db, "secretterm")).toBe(1);
    db.prepare("UPDATE file_notes SET deleted_at = ? WHERE file_path = ?").run(Date.now(), "src/epsilon.ts");
    expect(match(db, "secretterm"), "soft-deleted note resurrected by search").toBe(0);
  });

  test("a note inserted already-deleted is never indexed", () => {
    db.prepare(
      "INSERT INTO file_notes (file_path, notes, deleted_at) VALUES (?, ?, ?)"
    ).run("src/zeta.ts", "bornedeadterm", Date.now());
    expect(match(db, "bornedeadterm")).toBe(0);
  });

  test("undeleting restores searchability", () => {
    note(db, "src/eta.ts", { notes: "returningterm" });
    db.prepare("UPDATE file_notes SET deleted_at = ? WHERE file_path = ?").run(Date.now(), "src/eta.ts");
    expect(match(db, "returningterm")).toBe(0);
    db.prepare("UPDATE file_notes SET deleted_at = NULL WHERE file_path = ?").run("src/eta.ts");
    expect(match(db, "returningterm")).toBe(1);
  });

  test("deleting a soft-deleted row does not corrupt the index", () => {
    // The delete trigger must not issue fts5's 'delete' command for a row that
    // was never indexed — that is how an external-content index goes bad.
    note(db, "src/theta.ts", { notes: "keeperterm" });
    db.prepare("INSERT INTO file_notes (file_path, notes, deleted_at) VALUES (?, ?, ?)")
      .run("src/iota.ts", "ghostterm", Date.now());
    db.prepare("DELETE FROM file_notes WHERE file_path = ?").run("src/iota.ts");

    expect(() =>
      db.prepare("INSERT INTO fts_file_notes(fts_file_notes) VALUES('integrity-check')").run()
    ).not.toThrow();
    expect(match(db, "keeperterm")).toBe(1);
  });

  // ─── The upgrade path ──────────────────────────────────────────────

  test("existing notes are backfilled when an old database upgrades", () => {
    // The point of the migration for every user who already has a store: their
    // 96 unsearchable notes become searchable without rewriting one of them.
    const old = new Database(":memory:");
    runMigrationsTo(old, 25);
    for (let i = 0; i < 5; i++) {
      old.prepare(
        "INSERT INTO file_notes (file_path, purpose, notes, executive_summary) VALUES (?, ?, ?, ?)"
      ).run(`src/legacy${i}.ts`, "legacy purpose", `legacyterm${i}`, "legacy summary");
    }
    old.prepare("INSERT INTO file_notes (file_path, notes, deleted_at) VALUES (?, ?, ?)")
      .run("src/legacy-gone.ts", "goneterm", Date.now());

    expect(match(old, "legacyterm0"), "precondition: pre-V26 index is empty").toBe(0);

    runMigrations(old); // now apply V26
    expect(match(old, "legacyterm0")).toBe(1);
    expect(match(old, "legacy")).toBe(5);
    expect(match(old, "goneterm"), "soft-deleted row backfilled").toBe(0);
    old.close();
  });

  test("the migration is idempotent", () => {
    note(db, "src/kappa.ts", { notes: "idempotentterm" });
    const before = match(db, "idempotentterm");
    // Re-running the chain must not double-index or throw.
    expect(() => runMigrations(db)).not.toThrow();
    expect(match(db, "idempotentterm")).toBe(before);
  });

  // ─── Derived: no other content table lost its triggers ──────────────

  test("every content-backed FTS table is maintained on insert, update and delete", () => {
    // Derived from the schema, so an FTS table added later without a full
    // trigger set fails here instead of shipping silently — which is exactly
    // how fts_file_notes survived from V2 to V26.
    //
    // Derived from the trigger BODIES, not their names. An earlier version of
    // this test assumed the name `trg_<base>_<ai|au|ad>` and reported
    // fts_events as having no triggers at all; its real trigger is called
    // `fts_events_insert`. The name convention is not the invariant — "some
    // trigger on the base table writes this index for each of the three
    // events" is.
    const ftsTables = (db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%USING fts5%'`
    ).all() as Array<{ name: string; sql: string }>)
      .filter(t => /content\s*=\s*'/.test(t.sql))
      .map(t => ({ fts: t.name, base: /content\s*=\s*'([^']+)'/.exec(t.sql)![1] }));

    expect(ftsTables.length).toBeGreaterThan(5);

    const triggers = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL"
    ).all() as Array<{ name: string; sql: string }>;

    const gaps: string[] = [];
    for (const { fts, base } of ftsTables) {
      for (const [event, verb] of [["INSERT", "insert"], ["UPDATE", "update"], ["DELETE", "delete"]] as const) {
        const covered = triggers.some(t =>
          new RegExp(`AFTER\\s+${event}\\s+ON\\s+["'\`]?${base}["'\`]?\\b`, "i").test(t.sql) &&
          new RegExp(`\\b${fts}\\b`).test(t.sql)
        );
        if (!covered) gaps.push(`${fts}: nothing maintains it on ${verb}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  test("scheduled_events edits and deletions reach fts_events", () => {
    // The gap the derived test above found. fts_events had only an INSERT
    // trigger, so an edited event kept its old terms and a deleted one kept
    // all of them — pointing, in an external-content index, at a base row that
    // had changed or gone.
    const insert = db.prepare(
      `INSERT INTO scheduled_events (title, description, trigger_type, trigger_value, created_at, status)
       VALUES (?, ?, 'manual', 'x', ?, 'pending')`
    );
    const eventMatch = (q: string): number =>
      (db.prepare("SELECT COUNT(*) c FROM fts_events WHERE fts_events MATCH ?").get(q) as { c: number }).c;

    insert.run("canary", "originaleventterm", new Date().toISOString());
    expect(eventMatch("originaleventterm")).toBe(1);

    db.prepare("UPDATE scheduled_events SET description = ? WHERE title = ?").run("editedeventterm", "canary");
    expect(eventMatch("editedeventterm")).toBe(1);
    expect(eventMatch("originaleventterm"), "stale term survived the edit").toBe(0);

    db.prepare("DELETE FROM scheduled_events WHERE title = ?").run("canary");
    expect(eventMatch("editedeventterm"), "term survived the delete").toBe(0);
  });
});
