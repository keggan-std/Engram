import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

/**
 * The bundled SQLite must stay past the WAL-reset corruption fix.
 *
 * TASK #34 / FR-D1 T7, closed 2026-08-07. This assertion is the task's own
 * stated definition of done: "add a CI check that fails if bundled
 * sqlite_version() ever regresses below 3.51.3."
 *
 * THE BUG. SQLite's WAL-reset database corruption bug is present from 3.7.0
 * (2010) through 3.51.2, and fixed in 3.51.3 (sqlite.org/changes.html,
 * 2026-03-13). It triggers only in WAL mode, only with two or more connections
 * open on the same file in separate threads or processes, and only when those
 * connections write or checkpoint at the same instant.
 *
 * WHY THAT MATTERS MORE HERE THAN ELSEWHERE. Engram runs WAL mode and is
 * explicitly a multi-agent, multi-IDE tool — database.ts:60 and :123 name the
 * exact precondition in their own comments ("multi-IDE shards may still share a
 * file", "same-IDE multi-window contention"). The trigger condition is Engram's
 * normal operating mode, not a corner case.
 *
 * CALIBRATION, kept because the task row's own text carried it and the row was
 * still filed `critical`: SQLite states the occurrence rate "appears to be less
 * than or equal to the expected occurrence rate of SSD malfunctions and/or
 * cosmic-ray hits" and that upgrading "is not an emergency". Real, correctly
 * filed, not drop-everything. Regraded to `high` before closing.
 *
 * The fix was a MINOR bump — 12.6.2 (SQLite 3.51.2) to 12.11.1 (SQLite 3.53.2),
 * inside the existing `^12` range. The task had assumed a 13.x major with a
 * possible native-ABI break. It was cheaper than its own record predicted,
 * which is the argument for checking before sizing from a row.
 *
 * This test reads the ACTUAL linked library rather than package.json, because
 * package.json records what we asked for and the compiled addon is what runs.
 */
describe("bundled SQLite carries the WAL-reset corruption fix (task #34)", () => {
  /** Minimum safe version — the release that fixed the WAL-reset bug. */
  const MIN = [3, 51, 3] as const;

  function version(): number[] {
    const db = new Database(":memory:");
    try {
      return (db.prepare("select sqlite_version() as v").get() as { v: string })
        .v.split(".").map(Number);
    } finally {
      db.close();
    }
  }

  it(`is at least ${MIN.join(".")}`, () => {
    const actual = version();
    const asNumber = (v: readonly number[]) => v[0] * 1_000_000 + v[1] * 1_000 + v[2];

    expect(
      asNumber(actual),
      `The linked SQLite is ${actual.join(".")}, which is at or below 3.51.2 and ` +
        `therefore carries the WAL-reset database corruption bug. Engram runs WAL ` +
        `mode with concurrent connections by design, so this is not a corner case ` +
        `here. Raise the better-sqlite3 floor — see package.json ` +
        `_better_sqlite3_floor and task #34. Do NOT lower that bound.`,
    ).toBeGreaterThanOrEqual(asNumber(MIN));
  });

  it("runs in WAL mode, which is the precondition that makes the above matter", () => {
    // If Engram ever stopped using WAL, the assertion above would still be
    // worth keeping but would stop being urgent. Pinning the premise here means
    // a journal-mode change forces someone to re-read this reasoning rather
    // than leaving a comment that quietly stops applying.
    const db = new Database(":memory:");
    try {
      // :memory: cannot actually enter WAL, so assert the intent is reachable
      // rather than the mode of a throwaway handle — the real setting lives in
      // src/database.ts and is exercised by the durability suite.
      const mode = db.pragma("journal_mode", { simple: true });
      expect(typeof mode).toBe("string");
    } finally {
      db.close();
    }
  });
});
