// ============================================================================
// FR-0c measurement 3 — session-start response cost per tier
//
// Measures the ACTUAL size of every engram_session(action:"start") response
// shape and compares it against the token figure the tool's own .describe()
// string promises the agent at the moment it picks the parameter.
//
// Three design choices that matter:
//
//   1. Measured over real MCP stdio against the compiled dist/, not by calling
//      handlers directly. The wire path is what an agent actually pays for.
//   2. Measured against a COPY OF THE REAL DATABASE, not an empty one. An empty
//      DB measures the floor; the claim being checked is what a working project
//      costs.
//   3. EACH CONFIGURATION GETS A FRESH SERVER AND A FRESH COPY. An earlier
//      version shared one database across all thirteen configurations, so every
//      measurement polluted `previous_session` for the next and only the first
//      config saw real state — wrong in the direction that flattered the tool.
//      Re-copying per config costs seconds and removes the confound.
//
// The catalog tier is per-agent, so each config is measured twice against the
// same fresh database: a never-seen agent name (tier 2, first-session cost) and
// the same name again (tier 0, steady-state cost).
//
// Usage: node measure-session-cost.mjs <repo-root> [--json <out>]
// ============================================================================

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = process.argv[2] ?? process.cwd();
const jsonFlag = process.argv.indexOf("--json");
const jsonOut = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;
const liveDb = path.join(REPO, ".engram", "memory.db");
const seeded = existsSync(liveDb);

// Rough but honest: ~4 chars/token for JSON-ish English. Reported as an
// estimate, never as a measurement. Real tokenisers usually land slightly
// higher for punctuation-dense JSON, so this understates if anything.
const est = (chars) => Math.round(chars / 4);

// The figures the tool promises, from sessions.ts .describe() strings.
const CLAIMED = { nano: 10, quick_op: 200, full_context: 730, sub: 400 };

/** Spawn a server on a throwaway project root seeded with a fresh DB copy. */
function startServer() {
  const root = mkdtempSync(path.join(tmpdir(), "engram-cost-"));
  mkdirSync(path.join(root, ".engram"), { recursive: true });
  if (seeded) copyFileSync(liveDb, path.join(root, ".engram", "memory.db"));

  const proc = spawn(process.execPath, [path.join(REPO, "dist", "index.js"), "--project-root", root], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const pending = new Map();
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  proc.stderr.on("data", (d) => { if (process.env.VERBOSE) process.stderr.write(d); });

  let nextId = 1;
  const rpc = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name, args) => {
    const res = await rpc("tools/call", { name, arguments: args });
    return res?.result?.content?.[0]?.text ?? "";
  };
  const stop = async () => {
    try { proc.kill(); } catch { /* dead */ }
    await new Promise((r) => setTimeout(r, 400));
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* OS reaps temp */ }
  };
  return { rpc, call, stop };
}

const results = [];

async function measure(label, args, claimedKey) {
  const srv = startServer();
  try {
    await srv.rpc("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "fr-0c-cost", version: "1.0.0" },
    });
    srv.rpc("initialized", {}); // fire and forget; some servers ignore it

    let extra = {};
    if (args.agent_role === "sub") {
      const t = await srv.call("engram_memory", {
        action: "create_task", title: "cost measurement scope task", priority: "low",
        description: "Disposable. Exists only so the agent_role='sub' path has something to scope to.",
      });
      let taskId = 1;
      try { taskId = JSON.parse(t).task_id ?? 1; } catch { /* default */ }
      extra = { task_id: taskId };
    }

    const agent = `cost-${Math.random().toString(36).slice(2, 10)}`;
    const first = await srv.call("engram_session", { action: "start", ...args, ...extra, agent_name: agent });
    const repeat = await srv.call("engram_session", { action: "start", ...args, ...extra, agent_name: agent });

    if (first.length < 400) throw new Error(`"${label}" returned an error, not a session:\n${first.slice(0, 300)}`);

    const claimed = claimedKey ? CLAIMED[claimedKey] : null;
    results.push({
      config: label,
      claimed_tokens: claimed,
      first_session: { chars: first.length, est_tokens: est(first.length) },
      repeat_session: { chars: repeat.length, est_tokens: est(repeat.length) },
      overstatement_first: claimed ? +(est(first.length) / claimed).toFixed(1) : null,
      overstatement_repeat: claimed ? +(est(repeat.length) / claimed).toFixed(1) : null,
    });
  } finally {
    await srv.stop();
  }
}

for (const verbosity of ["nano", "minimal", "summary", "full"]) {
  for (const intent of ["full_context", "quick_op", "phase_work"]) {
    const claimedKey = verbosity === "nano" ? "nano" : (intent === "quick_op" ? "quick_op" : "full_context");
    await measure(`verbosity=${verbosity} intent=${intent}`, { verbosity, intent }, claimedKey);
  }
}
await measure("agent_role=sub", { agent_role: "sub" }, "sub");

// ─── Report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log(`\nEngram session-start cost — measured over MCP stdio against dist/`);
console.log(`Database: ${seeded ? "fresh copy of this repo's real .engram/memory.db PER CONFIG" : "EMPTY (live DB not found — floor only)"}`);
console.log(`Token figures are estimates at ~4 chars/token.\n`);
console.log(`${pad("config", 38)} ${lpad("claim", 6)} ${lpad("1st", 7)} ${lpad("x", 6)} ${lpad("repeat", 7)} ${lpad("x", 6)}`);
console.log("-".repeat(74));
for (const r of results) {
  console.log(
    `${pad(r.config, 38)} ${lpad(r.claimed_tokens ?? "-", 6)} ${lpad(r.first_session.est_tokens, 7)} ${lpad(r.overstatement_first ? r.overstatement_first + "x" : "-", 6)} ${lpad(r.repeat_session.est_tokens, 7)} ${lpad(r.overstatement_repeat ? r.overstatement_repeat + "x" : "-", 6)}`
  );
}

const worst = results.reduce((a, b) => (b.overstatement_first ?? 0) > (a.overstatement_first ?? 0) ? b : a);
console.log(`\nWorst overstatement: ${worst.config} — claimed ~${worst.claimed_tokens}, measured ~${worst.first_session.est_tokens} (${worst.overstatement_first}x)`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    measured_at: new Date().toISOString(),
    database: seeded ? "fresh-copy-of-real-per-config" : "empty",
    note: "token figures estimated at ~4 chars/token; chars are exact",
    results,
  }, null, 2));
  console.log(`\nWrote ${jsonOut}`);
}
