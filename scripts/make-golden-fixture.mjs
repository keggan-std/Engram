#!/usr/bin/env node
// ============================================================================
// Golden fixture builder  —  Foundations Review FR-0f item 1 / FR-D1 binding
//
//   node scripts/make-golden-fixture.mjs            # rebuild the fixture
//   node scripts/make-golden-fixture.mjs --db <p>   # from a different store
//
// Captures the live Engram database, strips identity and machine-specific
// paths, and writes tests/fixtures/golden-memory.db — a REAL memory store with
// real shapes, committed to the repo so every future migration must carry it
// forward. tests/migrations/golden-fixture.test.ts is the gate.
//
// WHY REAL DATA AND NOT A SYNTHETIC FIXTURE
// -----------------------------------------
// Engram's central promise is that your memory survives an upgrade, and it is
// the one path with no coverage: every existing suite builds a fresh in-memory
// database and runs the whole migration chain against EMPTY TABLES. So V23's
// backfill (which only touches pre-existing rows) and V19's idempotency guards
// have never once executed against data. migrations.ts is 91% statement but
// 33% BRANCH coverage, and that gap is the signature.
//
// This is not a niche concern — it is the standard failure. From the migration
// literature: "Testing migrations against an empty database is insufficient, as
// migrations would pass CI tests but fail in production because of the data in
// the production database." GitLab's database team requires migrations that can
// cause incidents to be tested against a production clone before approval, and
// uses anonymisation to widen who can run those tests. That is exactly this
// script.
//
// HONEST LIMIT — READ THIS BEFORE TRUSTING THE GATE
// -------------------------------------------------
// The fixture is captured at whatever schema version was live when it was
// built (V25 at first capture). Migrating a V25 fixture to a V25 head is a
// NO-OP. So this gate does not retroactively prove V1 -> V25 works with data;
// it proves that every migration added FROM NOW ON carries real data forward.
// The historical gap is Engram task #7 and stays open.
//
// To stop the gate being decoration in the meantime, the test asserts far more
// than "migration did not throw": row counts per table, schema version, and
// integrity invariants including the exact decision-supersession corruption
// that V25 was written to repair.
//
// The fixture is REBUILT DELIBERATELY, never automatically — regenerating it
// from a newer store would silently move the baseline and destroy the point.
// ============================================================================

import { copyFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const Database = require("better-sqlite3");

const dbArg = process.argv.indexOf("--db");
const SRC = dbArg > -1 ? process.argv[dbArg + 1] : path.join(root, ".engram", "memory.db");
const OUT_DIR = path.join(root, "tests", "fixtures");
const OUT = path.join(OUT_DIR, "golden-memory.db");

if (!existsSync(SRC)) {
  console.error(`No database at ${SRC}`);
  process.exit(1);
}

// ── Secrets and identity: dropped outright, not blanked ──────────────────────
const DROP_CONFIG_EXACT = new Set([
  "machine_id", "instance_id", "instance_label", "instance_created_at",
  "http_token", "dashboard_token", "auth_token", "api_key",
  "auto_update_changelog", "auto_update_available", "auto_update_last_check",
]);
const DROP_CONFIG_PREFIX = ["catalog_delivered_"];
const DROP_CONFIG_PATTERN = /token|secret|password|api[_-]?key/i;

// Derived, machine-specific caches. Emptied rather than redacted — a cached
// filesystem scan is not memory, and it is worth nothing in a fixture.
const CLEAR_TABLES = ["snapshot_cache"];

// Tables whose row counts are expected to change during sanitisation.
const COUNT_EXEMPT = new Set(["config", ...CLEAR_TABLES]);

/**
 * Every text column in every real table — discovered, never hand-listed.
 *
 * The first version of this script carried a hand-written list of 18 columns.
 * It missed snapshot_cache.value, which held the absolute project path in
 * JSON-escaped form, and the fixture would have shipped with it. A curated list
 * of "the columns that matter" is the same artifact as a hand-maintained
 * register: correct the day it is written, wrong the day a table is added, and
 * silent about the difference.
 */
function textColumns(db) {
  const out = [];
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'"
  ).all().map(r => r.name);
  for (const t of tables) {
    for (const c of db.prepare(`PRAGMA table_info("${t}")`).all()) {
      const type = String(c.type || "").toUpperCase();
      if (type === "" || type.includes("CHAR") || type.includes("TEXT") || type.includes("CLOB") || type.includes("BLOB")) {
        out.push([t, c.name]);
      }
    }
  }
  return out;
}

/** Redact machine-specific strings. Order matters: longest/most specific first. */
function redact(value) {
  if (typeof value !== "string" || !value) return value;
  let out = value;
  const home = os.homedir();
  for (const [needle, token] of [[root, "<repo>"], [home, "<home>"]]) {
    // Backslash paths get JSON-escaped when stored inside a JSON blob, so the
    // stored form is `d:\\Projects\\...`. Redacting only the raw form misses it.
    const backslash = needle.replace(/\//g, "\\");
    for (const variant of [needle, needle.replace(/\\/g, "/"), backslash, backslash.replace(/\\/g, "\\\\")]) {
      if (!variant) continue;
      out = out.split(variant).join(token);
      // Windows paths are case-insensitive in practice; catch a differing drive case.
      const alt = variant.charAt(0).toLowerCase() + variant.slice(1);
      if (alt !== variant) out = out.split(alt).join(token);
      const altU = variant.charAt(0).toUpperCase() + variant.slice(1);
      if (altU !== variant) out = out.split(altU).join(token);
    }
  }
  // Anything still carrying a drive letter is machine-specific by definition.
  // `\b` before the single letter is what keeps this from eating "https://" —
  // in a URL the scheme letter is preceded by a word character, so there is no
  // boundary there.
  out = out.replace(/\b[A-Za-z]:(?:\\\\|[\\/])[^\s"'`,;)\]]*/g, "<path>");
  return out;
}

// ── Build ────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(OUT)) rmSync(OUT);
copyFileSync(SRC, OUT);
// A WAL sidecar would carry un-checkpointed real data; do not copy it, and make
// sure the fixture is a self-contained rollback-journal file.
const db = new Database(OUT);
db.pragma("journal_mode = DELETE");

const before = {};
const TABLES = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'"
).all().map(r => r.name);
for (const t of TABLES) before[t] = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;

let droppedConfig = 0, redactedCells = 0;

db.exec("BEGIN");

// 1. Identity and secrets
for (const { key } of db.prepare("SELECT key FROM config").all()) {
  const drop = DROP_CONFIG_EXACT.has(key)
    || DROP_CONFIG_PREFIX.some(p => key.startsWith(p))
    || DROP_CONFIG_PATTERN.test(key);
  if (drop) { db.prepare("DELETE FROM config WHERE key = ?").run(key); droppedConfig++; }
}

// 2. Derived machine-specific caches
let clearedRows = 0;
for (const t of CLEAR_TABLES) {
  try { clearedRows += db.prepare(`DELETE FROM "${t}"`).run().changes; } catch { /* absent */ }
}

// 3. Project root becomes a stable placeholder
db.prepare("UPDATE sessions SET project_root = '<repo>' WHERE project_root IS NOT NULL").run();

// 4. Absolute paths inside any text cell, in any table
const COLUMNS = textColumns(db);
for (const [table, col] of COLUMNS) {
  let rows;
  try { rows = db.prepare(`SELECT rowid AS rid, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL`).all(); }
  catch { continue; } // e.g. a WITHOUT ROWID table
  const upd = db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`);
  for (const r of rows) {
    if (typeof r.v !== "string") continue;
    const clean = redact(r.v);
    if (clean !== r.v) { upd.run(clean, r.rid); redactedCells++; }
  }
}

db.exec("COMMIT");
db.exec("VACUUM");

// ── Verify: the script must FAIL rather than ship a leaky fixture ────────────

const problems = [];
for (const key of DROP_CONFIG_EXACT) {
  if (db.prepare("SELECT 1 FROM config WHERE key = ?").get(key)) problems.push(`config key survived: ${key}`);
}
// Verify with the SAME predicate used to redact. An independent SQL LIKE was
// tried first and was wrong: '%:/%' matches "https://" and flagged the cited
// research URLs as machine paths. A check that disagrees with the transform it
// is checking reports on itself, not on the data.
const ABSOLUTE_PATH = /\b[A-Za-z]:(?:\\\\|[\\/])/;
const USERNAME = new RegExp(path.basename(os.homedir()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
for (const [table, col] of COLUMNS) {
  let rows;
  try { rows = db.prepare(`SELECT "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL`).all(); }
  catch { continue; }
  for (const r of rows) {
    if (typeof r.v !== "string") continue;
    if (ABSOLUTE_PATH.test(r.v)) { problems.push(`${table}.${col}: absolute path survived`); break; }
    if (USERNAME.test(r.v)) { problems.push(`${table}.${col}: username survived`); break; }
  }
}
const after = {};
for (const t of TABLES) after[t] = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
for (const t of TABLES) {
  if (COUNT_EXEMPT.has(t)) continue;
  if (before[t] !== after[t]) problems.push(`row count changed in ${t}: ${before[t]} -> ${after[t]}`);
}

const version = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get()?.value;
db.close();

if (problems.length) {
  console.error("FIXTURE REJECTED — sanitisation incomplete:");
  for (const p of problems) console.error(`  - ${p}`);
  rmSync(OUT, { force: true });
  process.exit(1);
}

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`tests/fixtures/golden-memory.db written — schema V${version}, ${kb} KB`);
console.log(`  dropped ${droppedConfig} config key(s), cleared ${clearedRows} cache row(s), redacted ${redactedCells} text cell(s) across ${COLUMNS.length} columns`);
console.log(`  ${["sessions", "decisions", "file_notes", "observations", "tasks", "changes", "conventions", "handoffs"]
  .map(t => `${after[t] ?? 0} ${t}`).join(", ")}`);
