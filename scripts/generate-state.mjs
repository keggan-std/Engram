#!/usr/bin/env node
// ============================================================================
// Project state generator  —  Foundations Review FR-0g
//
// Emits docs/STATE.md from Engram's own memory database: where the project is,
// who worked last and why, what is open or blocked, and what previous agents
// flagged as worth improving.
//
//   node scripts/generate-state.mjs           # write the file
//   node scripts/generate-state.mjs --check   # exit 1 if content is stale
//
// WHY THIS EXISTS
// ---------------
// Agents sign in, change things, and sign out. Without one place that answers
// "where are we", each new agent re-derives the project from five documents and
// a task board, and the answers drift apart. That is the mess this prevents.
//
// WHY IT IS GENERATED, NOT WRITTEN
// --------------------------------
// This project already had a hand-maintained register. docs/archive/cross-
// instance-sharing-bugs.md asserted "not yet fixed" for eight versions after the
// fix shipped — audit finding F5. A register whose accuracy depends on someone
// remembering is not neutral when it rots; it lies with confidence, and an agent
// trusting it burns a session re-fixing solved problems. Engram observation #30
// states the rule this script obeys:
//
//     Do not build a ledger whose integrity depends on discipline.
//     The ledger claims; the artifact proves.
//
// So: generated only. **If docs/STATE.md is ever hand-edited, delete it.**
//
// WHY --check IS NOT THE CAPABILITY-SURFACE CHECK
// -----------------------------------------------
// generate-capability-surface.mjs reads src/, which changes only when code
// changes, so any diff is a real drift and can block a merge. This script reads
// .engram/memory.db, which changes on every session — a byte-diff gate would
// fail constantly and be switched off within a week. So --check normalises the
// generated-on date out and compares only the *content*.
//
// And the honest limit: .gitignore ignores .engram/, so the database is local
// only and **CI cannot run this at all**. The binding is a local git hook
// (engram_admin install_hooks) plus this check. That is weaker than a merge
// gate. It is stated here rather than glossed, because overselling a binding is
// how §5 of the charter template becomes decoration.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const Database = require("better-sqlite3");

const OUT = path.join(root, "docs", "STATE.md");
const CHECK = process.argv.includes("--check");

// Per-IDE sharding means several DBs can exist side by side (observation #7).
// Default to the canonical one; --db overrides.
const dbArg = process.argv.indexOf("--db");
const DB = dbArg > -1 ? process.argv[dbArg + 1] : path.join(root, ".engram", "memory.db");

if (!existsSync(DB)) {
  console.error(`No database at ${DB}. Nothing to generate.`);
  process.exit(1);
}
const db = new Database(DB, { readonly: true });

// ─── helpers ────────────────────────────────────────────────────────────────

const parseJson = (t, fallback = []) => {
  try { return JSON.parse(t) ?? fallback; } catch { return t ? [t] : fallback; }
};

/** Collapse to one line. */
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Derive a one-line headline from a long free-text summary.
 *
 * Sessions have no `headline` column, so this takes the first sentence and caps
 * it. That is a workaround, not a design: session #15's summary is ~2,000
 * characters and no amount of clever truncation makes it a headline. The real
 * fix is a bounded `headline` written at engram_session(end) — Engram schema
 * gap 1, observation #54.
 */
const headline = (s, max = 200) => {
  const t = flat(s);
  if (!t) return null;
  const firstSentence = t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t;
  const pick = firstSentence.length > 40 ? firstSentence : t;
  return pick.length > max ? pick.slice(0, max - 1).trimEnd() + "…" : pick;
};

const mdEsc = (s) => String(s ?? "").replace(/\|/g, "\\|");

/**
 * Timestamps are not stored consistently: sessions/decisions/observations hold
 * ISO text, handoffs hold integer epoch milliseconds. Handle both rather than
 * printing a raw epoch, which is what the first run of this script did.
 */
const day = (ts) => {
  if (ts === null || ts === undefined || ts === "") return "—";
  if (typeof ts === "number") return new Date(ts).toISOString().slice(0, 10);
  return String(ts).slice(0, 10);
};

/** Raw, UNTRIMMED. Trimming corrupts `git status --porcelain`, whose first
 *  column is a significant leading space for unstaged changes. */
const gitRaw = (cmd) => {
  try { return execSync(`git ${cmd}`, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
};
const git = (cmd, fallback = "—") => gitRaw(cmd)?.trim() ?? fallback;

// ─── gather ─────────────────────────────────────────────────────────────────

const branch = git("rev-parse --abbrev-ref HEAD");
const head = git("log -1 --format=%h");
const headSubject = git("log -1 --format=%s");
const dirty = (gitRaw("status --porcelain") ?? "").split("\n").filter(Boolean);
const mainRef = git("log -1 --format=%h main");
const mainSubject = git("log -1 --format=%s main");
// A configured remote does not mean this branch was pushed. Only an upstream does.
const pushed = gitRaw("rev-parse --abbrev-ref @{u}") !== null;

const sessions = db.prepare(`
  SELECT id, started_at, ended_at, summary, agent_name
  FROM sessions WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 3
`).all();

const tasks = db.prepare(`
  SELECT id, title, status, priority, blocked_by, tags
  FROM tasks
  WHERE deleted_at IS NULL AND status NOT IN ('done', 'cancelled')
  ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                         WHEN 'medium' THEN 2 ELSE 3 END, id
`).all();

// Read ALL handoffs, not just unacknowledged ones.
//
// The first version of this script selected `WHERE acknowledged_at IS NULL` and
// called the newest of those "live". That is backwards, and it produced a
// register that told the next agent to read handoff #2 — a stale one from a
// session closed days earlier — while the genuinely current handoff (#4) was
// hidden precisely BECAUSE it had been acknowledged. A wrong recall is worse
// than no recall (charter §10.3); the fix is to derive "live" from recency
// across all handoffs, and treat unacknowledged older ones as the debris.
const allHandoffs = db.prepare(`
  SELECT id, from_agent, created_at, reason, acknowledged_at
  FROM handoffs ORDER BY id DESC
`).all();
const liveHandoff = allHandoffs[0] ?? null;
const staleHandoffs = allHandoffs.filter((h) => h.acknowledged_at === null && h.id !== liveHandoff?.id);

const topDecision = db.prepare(`
  SELECT id, decision FROM decisions
  WHERE deleted_at IS NULL AND status = 'active' ORDER BY id DESC LIMIT 1
`).get();

// Observations have no lifecycle column, so "still relevant" is not a query —
// newest-first is the best available proxy. Engram schema gap 2, observation #54.
const flags = db.prepare(`
  SELECT id, category, content FROM observations
  WHERE category IN ('concern', 'idea', 'friction') ORDER BY id DESC LIMIT 8
`).all();

const counts = {
  sessions: db.prepare("SELECT COUNT(*) n FROM sessions WHERE deleted_at IS NULL").get().n,
  decisions: db.prepare("SELECT COUNT(*) n FROM decisions WHERE deleted_at IS NULL").get().n,
  observations: db.prepare("SELECT COUNT(*) n FROM observations").get().n,
  fileNotes: db.prepare("SELECT COUNT(*) n FROM file_notes").get().n,
  // Engram tracks its schema version in schema_meta, NOT in the user_version
  // pragma — which is 0 and would have printed "V0" against a V25 database.
  schema: (() => {
    try { return db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get()?.value ?? "?"; }
    catch { return "?"; }
  })(),
};

db.close();

// ─── render ─────────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().slice(0, 10);
const inProgress = tasks.filter((t) => t.status === "in_progress");
const gate = tasks.filter((t) => t.status !== "in_progress").slice(0, 5);

let m = `# Project State — read this first

**Generated:** ${stamp} · **Source:** Engram \`${path.basename(DB)}\` · **Branch:** \`${branch}\` @ \`${head}\`

> **Generated artifact — never hand-edit.** Produced by
> [\`scripts/generate-state.mjs\`](../scripts/generate-state.mjs) from Engram's own memory.
> If you find yourself editing this file, the answer is to fix the record it came from.
> A register kept by discipline is audit finding F5 repeating (observation #30).

> ⚠️ **This file IS Engram recall.** It is generated *from* the store, so reading it
> delivers decisions, sessions, tasks and observations into your context — even if you
> never call a recall action. **If you are running a suppressed arm of the charter §10
> experiment, you have just been contaminated; record it.** Both pre-registered arms
> leaked through this file before anyone noticed. See
> [\`foundations/00-CHARTER.md\`](foundations/00-CHARTER.md) §10.4a.

---

## Where we are

| | |
|---|---|
| **Working branch** | \`${branch}\` @ \`${head}\` — ${mdEsc(headSubject)} |
| **Published line** | \`main\` @ \`${mainRef}\` — ${mdEsc(mainSubject)} |
| **Pushed?** | ${pushed ? `pushed — upstream \`${git("rev-parse --abbrev-ref @{u}")}\`` : "**No. This branch has no upstream — nothing has been published from it.**"} |
| **Uncommitted** | ${dirty.length === 0 ? "clean" : `**${dirty.length} file(s)** — ${dirty.slice(0, 4).map((l) => `\`${l.slice(3)}\``).join(", ")}${dirty.length > 4 ? " …" : ""}`} |
| **Store** | schema V${counts.schema} · ${counts.sessions} sessions · ${counts.decisions} decisions · ${counts.observations} observations · ${counts.fileNotes} file notes |
`;

if (topDecision) {
  m += `
**Latest active decision — #${topDecision.id}:** ${mdEsc(headline(topDecision.decision, 240))}
`;
}

m += `
${inProgress.length
    ? `**In progress:** ${inProgress.map((t) => `#${t.id} ${mdEsc(flat(t.title))}`).join(" · ")}`
    : "**Nothing is marked in progress.**"}

---

## Last ${sessions.length} session${sessions.length === 1 ? "" : "s"}

| # | Agent | Did what |
|---|---|---|
`;

for (const s of sessions) {
  const who = s.agent_name ?? "—";
  const suspect = !s.agent_name || s.agent_name === "agent_name" ? " ⚠️" : "";
  const what = s.ended_at ? mdEsc(headline(s.summary)) ?? "_(ended with no summary)_" : "_(in progress)_";
  m += `| **${s.id}** | \`${who}\`${suspect} | ${what} |\n`;
}

if (sessions.some((s) => s.agent_name === "agent_name")) {
  m += `
⚠️ A session is recorded under the literal placeholder \`"agent_name"\`. Attribution in the
table this register is built on is already polluted — Engram schema gap 4, observation #54.
`;
}

m += `
Summaries above are the **first sentence** of a much longer record — sessions have no
\`headline\` field yet (schema gap 1). Full text: \`engram_session(action:"get_history")\`.

---

## Open and blocked

**${tasks.length} open task${tasks.length === 1 ? "" : "s"}.** The ones that gate everything else:

| # | Task | State |
|---|---|---|
`;

for (const t of [...inProgress, ...gate]) {
  const blocked = parseJson(t.blocked_by);
  const state = t.status === "in_progress"
    ? "**in progress**"
    : blocked.length ? `blocked by ${blocked.map((b) => `#${b}`).join(", ")}` : `${t.priority ?? "—"} · ${t.status}`;
  m += `| **${t.id}** | ${mdEsc(flat(t.title))} | ${state} |\n`;
}

if (liveHandoff) {
  m += `
### Handoff

**Read #${liveHandoff.id}** — from \`${liveHandoff.from_agent ?? "—"}\`, ${day(liveHandoff.created_at)}${liveHandoff.acknowledged_at ? " (already acknowledged)" : " — **not yet acknowledged**"}.
${mdEsc(headline(liveHandoff.reason, 200)) ?? ""}
`;
  if (staleHandoffs.length) {
    m += `
⚠️ **${staleHandoffs.length} older handoff${staleHandoffs.length === 1 ? " still shows" : "s still show"} as pending and should be ignored:** ${staleHandoffs.map((h) => `#${h.id} (\`${h.from_agent ?? "—"}\`, ${day(h.created_at)})`).join(", ")}.

They were never acknowledged, so they surface at every session start alongside the live
one, as though equally current. Handoffs do not supersede each other — Engram schema
gap 3, observation #54.
`;
  }
}

m += `
---

## What previous agents flagged as worth improving

Newest first. Suggestions left *for the next agent* — these are not tracked tasks.

| Obs | Kind | Flag |
|---|---|---|
`;

for (const f of flags) {
  m += `| **#${f.id}** | ${f.category} | ${mdEsc(headline(f.content, 190))} |\n`;
}

m += `
Observations have no resolved/superseded state, so "still relevant" cannot be queried —
this is newest-first, not open-only (schema gap 2). Full text:
\`engram_memory(action:"get_observations")\`.

---

## Where to go next

1. **This file.**
2. [\`README.md\`](README.md) — the documentation router.
3. [\`foundations/00-CHARTER.md\`](foundations/00-CHARTER.md) — the spec the review executes from.
4. \`engram_memory(action:"get_file_notes")\` **before opening any source file.**
   ${counts.fileNotes} files are already noted — do not re-read the codebase.

<!-- PROJECT_STATE:GENERATED -->
`;

// ─── write or check ─────────────────────────────────────────────────────────

/**
 * Reduce the document to the part that can meaningfully drift.
 *
 * THIS IS NOT THE CAPABILITY-SURFACE CHECK AND MUST NOT PRETEND TO BE.
 * That file is generated from src/, so any diff is real drift and can block a
 * merge. This one is generated from a live database and from git, so three of
 * its values change on their own and can never match a committed copy:
 *
 *   - the generated-on date
 *   - the branch@HEAD line, which changes with every single commit
 *   - the uncommitted-files row, which this file's own regeneration alters —
 *     write it on a clean tree and the tree is no longer clean
 *
 * The first version compared everything and was therefore ALWAYS stale: it
 * failed immediately after a clean commit, which is the definition of a gate
 * that gets switched off in a week. Normalising the volatile rows out leaves
 * the part worth guarding — tasks, sessions, handoffs, flagged observations —
 * so `--check` answers "has the memory store moved on without a regenerate?"
 *
 * Line endings are normalised too: the generator writes LF and git's autocrlf
 * rewrites the working copy to CRLF, so a byte comparison fails on Windows and
 * passes in Ubuntu CI.
 */
const normalise = (s) => s
  .replace(/\r\n/g, "\n")
  // The whole header line, not just the date: it also carries branch and HEAD,
  // which change on every commit — including the commit that stores this file.
  .replace(/^\*\*Generated:\*\*.*$/m, "**Generated:** <volatile>")
  .replace(/^\| \*\*Working branch\*\* \|.*$/m, "| **Working branch** | <volatile> |")
  .replace(/^\| \*\*Published line\*\* \|.*$/m, "| **Published line** | <volatile> |")
  .replace(/^\| \*\*Uncommitted\*\* \|.*$/m, "| **Uncommitted** | <volatile> |")
  .replace(/^\*\*Branch:\*\*.*$/m, "**Branch:** <volatile>")
  .trimEnd();

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error("docs/STATE.md does not exist. Run: node scripts/generate-state.mjs");
    process.exit(1);
  }
  const current = readFileSync(OUT, "utf-8");
  if (normalise(current) !== normalise(m)) {
    console.error("docs/STATE.md is stale — the memory store has moved on.");
    console.error("Regenerate with: node scripts/generate-state.mjs");
    process.exit(1);
  }
  console.log("docs/STATE.md is current.");
  process.exit(0);
}

writeFileSync(OUT, m, "utf-8");
console.log(
  `docs/STATE.md written — ${sessions.length} sessions, ${tasks.length} open tasks, ` +
  `live handoff ${liveHandoff ? `#${liveHandoff.id}` : "none"} (${staleHandoffs.length} stale), ` +
  `${flags.length} flags, ${m.length} chars.`
);
