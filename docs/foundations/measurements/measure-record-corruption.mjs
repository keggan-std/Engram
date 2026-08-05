#!/usr/bin/env node
/**
 * measure-record-corruption.mjs — FR-D9
 *
 * Scans an Engram store for records corrupted by the convention #7 failure:
 * the agent-harness transport folds trailing tool-call parameters into the
 * *preceding* string parameter, so the last field written swallows every
 * parameter that followed it.
 *
 * Convention #7 has been re-litigated eleven times across five agents and two
 * model families because it states a VERDICT ("this is the agent's syntax
 * error") and no re-runnable check. This is the check. It answers the two
 * questions the convention never did:
 *
 *   1. How many stored records carry the signature?
 *   2. Of those, how many actually LOST a field — i.e. the swallowed parameter's
 *      own column is NULL/empty — versus merely being ugly?
 *
 * (2) is the one that matters. Prior sessions concluded "content is intact,
 * nothing was lost" from a single hand-inspected row. That generalises only if
 * measured, and it does not hold.
 *
 * Per charter §11b.3, this copies the database to a temp root; it never opens
 * the live store for writing.
 *
 * Usage:  node docs/foundations/measurements/measure-record-corruption.mjs [--db <path>] [--json]
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const dbFlag = argv.indexOf('--db');
const LIVE_DB =
  dbFlag !== -1 && argv[dbFlag + 1]
    ? path.resolve(argv[dbFlag + 1])
    : path.join(REPO_ROOT, '.engram', 'memory.db');

if (!existsSync(LIVE_DB)) {
  console.error(`No database at ${LIVE_DB}`);
  process.exit(2);
}

// Copy, never touch the live store (charter §11b.3).
const scratch = mkdtempSync(path.join(tmpdir(), 'engram-corruption-'));
const DB_PATH = path.join(scratch, 'memory.db');
copyFileSync(LIVE_DB, DB_PATH);
for (const sidecar of ['-wal', '-shm']) {
  if (existsSync(LIVE_DB + sidecar)) copyFileSync(LIVE_DB + sidecar, DB_PATH + sidecar);
}

const db = new Database(DB_PATH, { readonly: true });

/**
 * The signature — FOUR shapes, not one.
 *
 * The first version of this harness matched only `<parameter name="X">` and
 * reported 31 records. That was WRONG IN THE SAFE DIRECTION, which is still
 * wrong: decisions #23 and #24 end in `</decision>\n</invoke>` with no
 * `<parameter` token at all, and session #24 ends in a malformed `<tags">`.
 * Handoff #9 warned "check your denominator" about a number that agreed with
 * the thesis; this is that warning arriving a second time, so the shapes are
 * enumerated rather than assumed.
 *
 *   S1  `<parameter name="X">`   — the following parameter, swallowed whole
 *   S2  `</invoke>` / `</invoke>` — the call envelope itself leaked in
 *   S3  `</X>` where X names a column of this table or a known tool parameter
 *   S4  `<X">` / `</X">` — malformed quote, same cause
 *
 * S3 is deliberately narrow: a bare closing tag is only counted when its name
 * matches a real field, so prose *about* XML does not register. That keeps the
 * false-positive rate at zero at the cost of missing exotic shapes — the
 * conservative direction, stated rather than hidden.
 */
const S1 = /<parameter\s+name="([a-zA-Z_][a-zA-Z0-9_]*)"\s*>/g;
const S2 = /<\/(?:antml:)?invoke>/g;
const S4 = /<\/?([a-zA-Z_][a-zA-Z0-9_]*)">/g;

/** Parameter names the MCP tools accept — used to make S3 precise. */
const KNOWN_PARAMS = new Set([
  'content', 'decision', 'rationale', 'tags', 'affected_files', 'summary', 'reason',
  'next_agent_instructions', 'observation_category', 'file_path', 'rule', 'examples',
  'category', 'description', 'title', 'notes', 'purpose', 'priority', 'status',
  'agent_name', 'session_id', 'progress', 'current_understanding', 'message',
  'executive_summary', 'diff_summary', 'impact_scope', 'change_type', 'query',
]);

/** Every markup token in `val` that names a field of this table or a tool param. */
function detectSwallowed(val, colNames) {
  const names = new Set();
  let envelopeLeak = false;

  S1.lastIndex = 0;
  for (const m of val.matchAll(S1)) names.add(m[1]);

  if (S2.test(val)) envelopeLeak = true;
  S2.lastIndex = 0;

  S4.lastIndex = 0;
  for (const m of val.matchAll(S4)) {
    if (KNOWN_PARAMS.has(m[1]) || colNames.includes(m[1])) names.add(m[1]);
  }

  // S3 — bare closing tags, only when the name is a real field.
  for (const m of val.matchAll(/<\/([a-zA-Z_][a-zA-Z0-9_]*)>/g)) {
    if (KNOWN_PARAMS.has(m[1]) || colNames.includes(m[1])) names.add(m[1]);
  }

  return { names: [...names], envelopeLeak };
}

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'
      ORDER BY name`,
  )
  .all()
  .map((r) => r.name);

const hits = [];

for (const table of tables) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const colNames = cols.map((c) => c.name);
  const textCols = cols
    .filter((c) => !/^(INTEGER|REAL|BLOB|NUMERIC)$/i.test(c.type || ''))
    .map((c) => c.name);
  if (textCols.length === 0) continue;

  const pk = colNames.includes('id') ? 'id' : (cols.find((c) => c.pk)?.name ?? 'rowid');
  const rows = db.prepare(`SELECT rowid AS _rowid, * FROM ${table}`).all();

  for (const row of rows) {
    for (const col of textCols) {
      const val = row[col];
      if (typeof val !== 'string' || !val.includes('<')) continue;

      const { names: swallowed, envelopeLeak } = detectSwallowed(val, colNames);
      if (swallowed.length === 0 && !envelopeLeak) continue;

      // Did any swallowed parameter correspond to a real column that is now empty?
      const lost = [];
      const survived = [];
      for (const name of swallowed) {
        if (!colNames.includes(name)) {
          // The parameter is not a column of this table (e.g. `session_id` on a
          // call whose row stores it elsewhere). Unclassifiable, not counted.
          continue;
        }
        if (name === col) continue; // the field's own closing tag, not a sibling
        const target = row[name];
        if (target === null || target === undefined || target === '') lost.push(name);
        else survived.push(name);
      }

      hits.push({
        table,
        id: row[pk] ?? row._rowid,
        column: col,
        swallowed,
        envelopeLeak,
        lost,
        survived,
        chars: val.length,
      });
    }
  }
}

const withLoss = hits.filter((h) => h.lost.length > 0);
const lossyFields = withLoss.reduce((n, h) => n + h.lost.length, 0);

// Which agents/sessions produced them — is this one bad agent or everybody?
const sessionOf = new Map();
try {
  for (const s of db.prepare(`SELECT id, agent_name FROM sessions`).all()) {
    sessionOf.set(s.id, s.agent_name);
  }
} catch {
  /* sessions table shape differs; attribution is a bonus, not the measurement */
}
const agents = new Set();
for (const h of hits) {
  const cols = db.prepare(`PRAGMA table_info(${h.table})`).all().map((c) => c.name);
  if (!cols.includes('session_id')) continue;
  const r = db.prepare(`SELECT session_id FROM ${h.table} WHERE rowid = ? OR id = ?`).get(h.id, h.id);
  const a = sessionOf.get(r?.session_id);
  if (a) agents.add(a);
}

const report = {
  database: LIVE_DB,
  scanned_tables: tables.length,
  corrupted_records: hits.length,
  records_with_field_loss: withLoss.length,
  fields_actually_lost: lossyFields,
  distinct_agents_affected: agents.size,
  agents: [...agents].sort(),
  detail: hits,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nEngram record corruption (convention #7 signature)`);
  console.log(`  database:            ${LIVE_DB}`);
  console.log(`  tables scanned:      ${tables.length}`);
  console.log(`  corrupted records:   ${hits.length}`);
  console.log(`  ...of which LOST a field: ${withLoss.length}  (${lossyFields} fields destroyed)`);
  console.log(`  distinct agents hit: ${agents.size}${agents.size ? '  — ' + [...agents].sort().join(', ') : ''}`);
  console.log('');
  for (const h of hits) {
    const verdict = h.lost.length ? `LOST: ${h.lost.join(', ')}` : 'no field loss';
    console.log(
      `  ${h.table}#${h.id}.${h.column}  swallowed [${h.swallowed.join(', ')}]  → ${verdict}`,
    );
  }
  console.log('');
}

db.close();

// Exit non-zero only when a field was genuinely destroyed. Ugly-but-intact is
// not a build failure; silent data loss is.
process.exit(withLoss.length > 0 ? 1 : 0);
