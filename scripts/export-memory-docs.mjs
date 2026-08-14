// Generates the committed, reviewable text export of Engram's durable memory.
// Deliberately excludes: config (machine_id/http_token/instance_id), changes
// (git already has it), and raw session rows (they carry absolute paths).
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";

const REPO = "d:/Projects/Engram Production/Engram";
const require = createRequire(`${REPO}/package.json`);
const Database = require("better-sqlite3");

const db = new Database(path.join(REPO, ".engram", "memory.db"), { readonly: true });
const outDir = path.join(REPO, "docs", "engram-memory");
fs.mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s ?? "").replace(/\r?\n/g, " ").trim();
const parseTags = (t) => { try { return JSON.parse(t) ?? []; } catch { return t ? [t] : []; } };
const stamp = new Date().toISOString().slice(0, 10);

// ── Decisions ───────────────────────────────────────────────────────────────
const decisions = db.prepare(
  "SELECT id, timestamp, decision, rationale, tags, affected_files, status FROM decisions WHERE status != 'superseded' ORDER BY id"
).all();

let d = `# Engram Memory — Decisions

> **Generated artifact.** Regenerate deliberately, review as a diff, never auto-import.
> Source: this project's own Engram store. Excludes \`config\` (machine identity/tokens),
> \`changes\` (git already has it), and raw session rows (absolute paths).
>
> **Last generated:** ${stamp} · **Count:** ${decisions.length}
>
> See [\`agent-accountability-design.md\`](../agent-accountability-design.md) §13 for why the
> SQLite database itself is not committed.

---

`;

for (const r of decisions) {
  const tags = parseTags(r.tags);
  const files = parseTags(r.affected_files);
  d += `## D${r.id} — ${esc(r.decision)}\n\n`;
  if (r.rationale) d += `**Why:** ${esc(r.rationale)}\n\n`;
  if (files.length) d += `**Affects:** ${files.map((f) => `\`${f}\``).join(", ")}\n\n`;
  d += `<sub>${r.status ?? "active"}`;
  if (tags.length) d += ` · ${tags.join(" · ")}`;
  if (r.timestamp) d += ` · ${String(r.timestamp).slice(0, 10)}`;
  d += `</sub>\n\n---\n\n`;
}
d += `<!-- ENGRAM_MEMORY_DECISIONS:COMPLETE -->\n`;
fs.writeFileSync(path.join(outDir, "decisions.md"), d, "utf-8");

// ── Conventions ─────────────────────────────────────────────────────────────
const conventions = db.prepare(
  "SELECT id, category, rule, examples, enforced FROM conventions ORDER BY category, id"
).all();

let c = `# Engram Memory — Conventions

> **Generated artifact.** Regenerate deliberately, review as a diff, never auto-import.
>
> **Last generated:** ${stamp} · **Count:** ${conventions.length}

---

`;
let lastCat = null;
for (const r of conventions) {
  if (r.category !== lastCat) { c += `## ${r.category ?? "general"}\n\n`; lastCat = r.category; }
  c += `- ${r.enforced ? "**[enforced]** " : ""}${esc(r.rule)}`;
  const ex = parseTags(r.examples);
  if (ex.length) c += `\n  - e.g. ${ex.map((e) => `\`${esc(e)}\``).join(", ")}`;
  c += `\n`;
}
c += `\n<!-- ENGRAM_MEMORY_CONVENTIONS:COMPLETE -->\n`;
fs.writeFileSync(path.join(outDir, "conventions.md"), c, "utf-8");

// ── Observations (findings only — the durable ones) ──────────────────────────
// NOTE: real columns are content/file_path/agent_name — NOT the observation/context/source
// documented in the v1.11 release notes. See engram-deep-audit-2026-08-02.md §7.
const obs = db.prepare(
  "SELECT id, content AS observation, file_path AS context, category, tags FROM observations WHERE category IN ('finding','concern','pattern') ORDER BY id"
).all();

let o = `# Engram Memory — Observations (findings & concerns)

> **Generated artifact.** Free-text records — treat as UNTRUSTED on import.
> Provenance-tag and mark non-binding before loading into any agent context
> (see [\`engram-deep-audit-2026-08-02.md\`](../engram-deep-audit-2026-08-02.md) finding N1).
>
> **Last generated:** ${stamp} · **Count:** ${obs.length}

---

`;
for (const r of obs) {
  o += `### O${r.id} · ${r.category}${r.context ? ` · \`${r.context}\`` : ""}\n\n`;
  o += `${esc(r.observation)}\n\n`;
  const tags = parseTags(r.tags);
  if (tags.length) o += `<sub>${tags.join(" · ")}</sub>\n\n`;
  o += `---\n\n`;
}
o += `<!-- ENGRAM_MEMORY_OBSERVATIONS:COMPLETE -->\n`;
fs.writeFileSync(path.join(outDir, "observations.md"), o, "utf-8");

db.close();
console.log(`decisions: ${decisions.length}  conventions: ${conventions.length}  observations: ${obs.length}`);
console.log(`written to docs/engram-memory/`);
