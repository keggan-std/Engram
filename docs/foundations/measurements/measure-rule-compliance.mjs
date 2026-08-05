#!/usr/bin/env node
/**
 * FR-D7 measurement 5 — do the agent rules change agent behaviour?
 *
 *   node docs/foundations/measurements/measure-rule-compliance.mjs "<repo-root>" [--json out.json]
 *
 * WHY THIS EXISTS
 * Engram ships eight agent rules (AR-01..AR-08). They are injected into every
 * agent's context at session start, two of them at priority CRITICAL, and they
 * cost tokens on every single session. Nothing anywhere measures whether an
 * agent that receives them behaves any differently from one that does not.
 * That is the whole claim of the feature, and it has never been checked.
 *
 * THE DENOMINATOR IS THE HARD PART, AND IT IS WHERE THE LAST VACUOUS CHECK DIED
 * (handoff #8: a file-notes/FTS comparison returned 96 vs 96 and 0 drift, and
 * was meaningless because both sides read the same base table). So:
 *
 *   - AR-01 says "record_change after every file edit". The numerator is rows in
 *     `changes` for the session. The denominator must be FILE EDITS THAT ACTUALLY
 *     HAPPENED, which Engram does not know. We take it from git: distinct files
 *     touched by commits authored inside the session window.
 *   - Git is a LOWER BOUND on edits — work can be edited and not committed, and
 *     a session can edit a file ten times and commit once. A lower bound biases
 *     the compliance ratio UPWARDS, i.e. in the rules' favour. If compliance
 *     still looks bad against a generous denominator, the result is safe.
 *   - Sessions whose denominator is 0 (pure review, no commits) are EXCLUDED,
 *     not scored as 0/0 = fail. Counting them would manufacture the result.
 *
 * AR-02 ("get_file_notes before opening any file") can only be measured from
 * `tool_call_log`, which was not instrumented until 5ff7e2f. Sessions before
 * that commit are reported as NO TELEMETRY rather than as zero — the distinction
 * measurement 2 in this directory paid to learn.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? process.cwd());
const jsonAt = process.argv.indexOf("--json");
const JSON_OUT = jsonAt > -1 ? process.argv[jsonAt + 1] : null;

// Node resolves better-sqlite3 from the *script's* directory. When this is run
// from elsewhere that fails, so resolve against the project's own package.json.
const require = createRequire(resolve(ROOT, "package.json"));
const Database = require("better-sqlite3");

const db = new Database(resolve(ROOT, ".engram/memory.db"), { readonly: true });
const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// ─── the telemetry cutoff ───────────────────────────────────────────────────
// Measurement 2 established that only 3 of 75 actions logged before 5ff7e2f.
// Anything earlier has no telemetry; that is not the same as no calls.
let telemetryFrom = null;
try {
  telemetryFrom = ms(git("show", "-s", "--format=%cI", "5ff7e2f").trim());
} catch {
  /* commit not reachable — every session is reported as unknown telemetry */
}

// ─── git: files touched per commit, with author time ────────────────────────
const commits = [];
{
  const raw = git("log", "--all", "--no-merges", "--pretty=format:%x01%H%x02%cI", "--name-only");
  for (const block of raw.split("\x01").slice(1)) {
    const [header, ...rest] = block.split("\n");
    const [sha, iso] = header.split("\x02");
    const files = rest.map((l) => l.trim()).filter(Boolean);
    commits.push({ sha: sha.slice(0, 7), at: ms(iso), files });
  }
}

const sessions = db
  .prepare("SELECT id, agent_name, started_at, ended_at FROM sessions ORDER BY id")
  .all();

const totalChangesAll = db.prepare("SELECT COUNT(*) n FROM changes").get().n;

const changesBySession = new Map();
for (const r of db.prepare("SELECT session_id, COUNT(*) n FROM changes GROUP BY session_id").all())
  changesBySession.set(r.session_id, r.n);

const notesBySession = new Map();
for (const r of db
  .prepare("SELECT last_modified_session s, COUNT(*) n FROM file_notes GROUP BY s")
  .all())
  notesBySession.set(r.s, r.n);

const callsBySession = new Map();
for (const r of db
  .prepare("SELECT session_id, tool_name, COUNT(*) n FROM tool_call_log GROUP BY session_id, tool_name")
  .all()) {
  if (!callsBySession.has(r.session_id)) callsBySession.set(r.session_id, new Map());
  callsBySession.get(r.session_id).set(r.tool_name, r.n);
}

// ─── per session ────────────────────────────────────────────────────────────
const rows = [];
for (const s of sessions) {
  const from = ms(s.started_at);
  // An open session runs to now; a closed one to its recorded end.
  const to = s.ended_at ? ms(s.ended_at) : Date.now();
  if (!Number.isFinite(from)) continue;

  const touched = new Set();
  let nCommits = 0;
  for (const c of commits) {
    if (c.at >= from && c.at <= to) {
      nCommits++;
      for (const f of c.files) touched.add(f);
    }
  }

  const calls = callsBySession.get(s.id) ?? new Map();
  const totalCalls = [...calls.values()].reduce((a, b) => a + b, 0);
  const getFileNotes = [...calls].filter(([k]) => k.includes("get_file_notes")).reduce((a, [, v]) => a + v, 0);

  rows.push({
    session: s.id,
    agent: s.agent_name ?? "(unnamed)",
    ended: s.ended_at ? "yes" : "NO",
    edits: touched.size,        // AR-01 denominator (lower bound)
    commits: nCommits,
    changes: changesBySession.get(s.id) ?? 0,  // AR-01 numerator
    notes: notesBySession.get(s.id) ?? 0,      // AR-06 numerator
    telemetry: telemetryFrom === null ? "?" : from >= telemetryFrom ? "yes" : "no",
    calls: totalCalls,
    getFileNotes,
  });
}

// ─── report ─────────────────────────────────────────────────────────────────
const pad = (v, n) => String(v).padStart(n);
const padR = (v, n) => String(v).padEnd(n);

console.log(`\nFR-D7 — agent-rule compliance, per session   (repo: ${ROOT})`);
console.log(`telemetry instrumented from: ${telemetryFrom ? new Date(telemetryFrom).toISOString() : "unknown (5ff7e2f not reachable)"}\n`);
console.log(
  `${padR("sess", 5)}${padR("agent", 30)}${pad("edits", 6)}${pad("changes", 8)}${pad("AR-01", 7)}${pad("notes", 6)}${pad("ended", 6)}${pad("tlm", 5)}${pad("calls", 6)}${pad("gfn", 5)}`
);
console.log("-".repeat(84));

let scored = 0, complied = 0, totalEdits = 0, totalChanges = 0, excluded = 0;
for (const r of rows) {
  const scoreable = r.edits > 0;
  if (scoreable) {
    scored++;
    totalEdits += r.edits;
    totalChanges += r.changes;
    if (r.changes > 0) complied++;
  } else excluded++;
  const ar01 = scoreable ? `${r.changes}/${r.edits}` : "  n/a";
  console.log(
    `${padR(r.session, 5)}${padR(r.agent.slice(0, 29), 30)}${pad(r.edits, 6)}${pad(r.changes, 8)}${pad(ar01, 7)}${pad(r.notes, 6)}${pad(r.ended, 6)}${pad(r.telemetry, 5)}${pad(r.calls, 6)}${pad(r.getFileNotes, 5)}`
  );
}

const ended = rows.filter((r) => r.ended === "yes").length;
const withTelemetry = rows.filter((r) => r.telemetry === "yes");
const usedGfn = withTelemetry.filter((r) => r.getFileNotes > 0).length;

// ─── the overlap-free denominator ───────────────────────────────────────────
// THE PER-SESSION COLUMNS ABOVE DOUBLE-COUNT AND MUST NOT BE SUMMED. Sub-agent
// sessions run concurrently with their lead, so one commit falls inside several
// windows at once — sessions 25/26/27 each report the same 18 files. Summing
// them would inflate the denominator and flatter the result in the direction I
// already expect, which is the way to get this wrong.
//
// So the headline is computed WITHOUT session attribution: of the distinct files
// this project edited while Engram was in use, how many ever got a change row?
// No window, no overlap, nothing to double-count.
const firstSessionAt = Math.min(...rows.map((r) => ms(sessions.find((s) => s.id === r.session).started_at)));
const editedFiles = new Set();
for (const c of commits) if (c.at >= firstSessionAt) for (const f of c.files) editedFiles.add(f);
const recordedFiles = new Set(
  db.prepare("SELECT DISTINCT file_path FROM changes").all().map((r) => r.file_path)
);
const covered = [...editedFiles].filter((f) => recordedFiles.has(f)).length;

console.log("-".repeat(84));
console.log(`
SESSIONS                    ${rows.length} total, ${excluded} excluded (no commits in window — denominator 0)
                            ${rows.length - excluded} scoreable; NOTE the per-session 'edits' column
                            double-counts across concurrent sub-agent sessions and must not be summed.

AR-01  record_change after every file edit          [CRITICAL]
  -- overlap-free, the headline --
  distinct files edited since Engram was first used here         ${editedFiles.size}
  of those, files that ever got a change row                     ${covered}   ${((covered / editedFiles.size) * 100).toFixed(1)}%
  total change rows in the store, all time                       ${recordedFiles.size} distinct paths / ${totalChangesAll} rows
  -- per-session, overlap-inflated, reported only for shape --
  sessions that edited files and recorded at least one change   ${complied} / ${scored}   ${((complied / scored) * 100).toFixed(1)}%

AR-02  get_file_notes before opening any file       [CRITICAL]
  sessions with telemetry                                       ${withTelemetry.length}
  of those, sessions that called get_file_notes at all          ${usedGfn} / ${withTelemetry.length}
  (sessions before 5ff7e2f are 'no telemetry', NOT zero)

AR-03  end the session before terminating           [CRITICAL]
  sessions with a recorded end                                  ${ended} / ${rows.length}   ${((ended / rows.length) * 100).toFixed(1)}%
`);

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      { generated: new Date().toISOString(), root: ROOT, telemetryFrom, rows,
        summary: { sessions: rows.length, excluded, scored, complied, ended,
                   filesEdited: editedFiles.size, filesWithChangeRow: covered,
                   changeRows: totalChangesAll, distinctChangePaths: recordedFiles.size,
                   telemetrySessions: withTelemetry.length, usedGetFileNotes: usedGfn },
        note: "Per-session 'edits' double-counts across concurrent sub-agent sessions and must not be summed. The AR-01 headline is the overlap-free filesWithChangeRow / filesEdited." },
      null, 2
    ) + "\n",
    "utf-8"
  );
  console.log(`wrote ${JSON_OUT}`);
}
