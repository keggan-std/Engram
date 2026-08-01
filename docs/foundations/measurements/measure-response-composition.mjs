// ============================================================================
// FR-0c measurement 3b — where the session-start tokens actually go
//
// The aggregate cost number says a response is expensive. It does not say what
// to cut. This breaks one response down field by field so the ergonomics domain
// has something actionable rather than a total.
//
// Usage: node measure-response-composition.mjs <repo-root> [verbosity] [intent]
// ============================================================================

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = process.argv[2] ?? process.cwd();
const VERBOSITY = process.argv[3] ?? "summary";
const INTENT = process.argv[4] ?? "full_context";

const root = mkdtempSync(path.join(tmpdir(), "engram-comp-"));
mkdirSync(path.join(root, ".engram"), { recursive: true });
const live = path.join(REPO, ".engram", "memory.db");
if (existsSync(live)) copyFileSync(live, path.join(root, ".engram", "memory.db"));

const s = spawn(process.execPath, [path.join(REPO, "dist", "index.js"), "--project-root", root], { stdio: ["pipe", "pipe", "pipe"] });
let buf = ""; const p = new Map();
s.stdout.on("data", c => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; let m; try { m = JSON.parse(l) } catch { continue } if (m.id !== undefined && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } } });
s.stderr.on("data", () => { });
let id = 1;
const rpc = (method, params) => new Promise(r => { const i = id++; p.set(i, r); s.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n") });

const est = (n) => Math.round(n / 4);

try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "comp", version: "1" } });
  s.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const res = await rpc("tools/call", {
    name: "engram_session",
    arguments: { action: "start", agent_name: `comp-${Math.random().toString(36).slice(2, 8)}`, verbosity: VERBOSITY, intent: INTENT },
  });
  const text = res?.result?.content?.[0]?.text ?? "";
  const obj = JSON.parse(text);

  const rows = Object.entries(obj)
    .map(([k, v]) => {
      const chars = JSON.stringify(v ?? null).length;
      return { field: k, chars, tokens: est(chars), pct: 0 };
    })
    .sort((a, b) => b.chars - a.chars);

  const total = rows.reduce((n, r) => n + r.chars, 0);
  for (const r of rows) r.pct = +(100 * r.chars / total).toFixed(1);

  console.log(`\nSession-start response composition — verbosity=${VERBOSITY} intent=${INTENT}`);
  console.log(`Total ${text.length} chars ≈ ${est(text.length)} tokens (estimate, ~4 chars/token)\n`);
  console.log(`${"field".padEnd(26)} ${"tokens".padStart(8)} ${"share".padStart(7)}`);
  console.log("-".repeat(44));
  for (const r of rows) {
    if (r.tokens < 1) continue;
    console.log(`${r.field.padEnd(26)} ${String(r.tokens).padStart(8)} ${String(r.pct + "%").padStart(7)}`);
  }

  const top3 = rows.slice(0, 3);
  console.log(`\nTop 3 fields = ${top3.reduce((n, r) => n + r.pct, 0).toFixed(1)}% of the response:`);
  for (const r of top3) console.log(`  ${r.field}: ~${r.tokens} tokens`);
} finally {
  try { s.kill(); } catch { /* dead */ }
  await new Promise(r => setTimeout(r, 400));
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* OS reaps temp */ }
}
