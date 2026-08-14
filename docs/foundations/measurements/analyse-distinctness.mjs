// ============================================================================
// FR-0c measurement 1 — distinctness analysis
//
// Computes, from the three raters' blind routings:
//   - first-choice agreement (all three same / majority / three-way split)
//   - self-reported discrimination (clear / close / coinflip)
//   - the collision graph: which actions shadow which, from runner-up pairs
//
// Reads distinctness-raters.json and distinctness-phrases.json.
// Usage: node analyse-distinctness.mjs [--json <out>]
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const raters = JSON.parse(readFileSync(path.join(here, "distinctness-raters.json"), "utf8"));
const phrases = JSON.parse(readFileSync(path.join(here, "distinctness-phrases.json"), "utf8"));
const jsonFlag = process.argv.indexOf("--json");
const jsonOut = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;

const byId = new Map(phrases.phrases.map((p) => [p.id, p]));
const R = raters.raters;
const ids = R[0].routings.map((r) => r.id);

const get = (rater, id) => rater.routings.find((r) => r.id === id);

const rows = ids.map((id) => {
  const picks = R.map((r) => get(r, id));
  const actions = picks.map((p) => p.action);
  const uniq = [...new Set(actions)];
  const margins = picks.map((p) => p.margin);
  const runnersUp = [...new Set(picks.map((p) => p.runner_up).filter((x) => x && x !== "none"))];

  let agreement;
  if (uniq.length === 1) agreement = "unanimous";
  else if (uniq.length === 2) agreement = "majority";
  else agreement = "three-way-split";

  // "Soft ambiguity": everyone agreed on the action, but at least one rater said
  // it was a close call or a coin flip. Unanimity with low confidence is still a
  // collision — it just happens to resolve the same way each time.
  const lowConfidence = margins.some((m) => m !== "clear");

  return {
    id,
    cluster: byId.get(id)?.cluster,
    phrase: byId.get(id)?.text,
    actions,
    agreement,
    margins,
    low_confidence: lowConfidence,
    runners_up: runnersUp,
  };
});

const count = (pred) => rows.filter(pred).length;
const n = rows.length;
const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;

const unanimous = count((r) => r.agreement === "unanimous");
const majority = count((r) => r.agreement === "majority");
const split = count((r) => r.agreement === "three-way-split");
const cleanAndConfident = count((r) => r.agreement === "unanimous" && !r.low_confidence);
const unanimousButShaky = count((r) => r.agreement === "unanimous" && r.low_confidence);

// ─── Collision graph ─────────────────────────────────────────────────────────
// An edge chosen -> runner_up means "this action was nearly chosen instead".
// Weighted by how often it appears across all raters and phrases.
const edges = new Map();
for (const rater of R) {
  for (const r of rater.routings) {
    if (!r.runner_up || r.runner_up === "none") continue;
    const key = `${r.action} -> ${r.runner_up}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}
const topEdges = [...edges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

// How often does each action appear as a runner-up at all? A high count means
// the action shadows broadly — it is "almost right" for many different intents.
const shadowCount = new Map();
for (const rater of R) {
  for (const r of rater.routings) {
    if (!r.runner_up || r.runner_up === "none") continue;
    shadowCount.set(r.runner_up, (shadowCount.get(r.runner_up) ?? 0) + 1);
  }
}
const topShadows = [...shadowCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

// ─── Per-cluster ─────────────────────────────────────────────────────────────
const clusters = {};
for (const r of rows) {
  const c = (clusters[r.cluster] ??= { n: 0, unanimous: 0, low_confidence: 0 });
  c.n++;
  if (r.agreement === "unanimous") c.unanimous++;
  if (r.low_confidence) c.low_confidence++;
}

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\n=== Action catalog distinctness — ${n} phrases x ${R.length} blind raters ===\n`);
console.log(`LIMITATION: ${raters.limitation}\n`);

console.log(`First-choice agreement`);
console.log(`  unanimous ................. ${unanimous}/${n}  ${pct(unanimous)}`);
console.log(`  majority (2 of 3) ......... ${majority}/${n}  ${pct(majority)}`);
console.log(`  three-way split ........... ${split}/${n}  ${pct(split)}`);

console.log(`\nDiscrimination (the number that actually matters)`);
console.log(`  unanimous AND all "clear" . ${cleanAndConfident}/${n}  ${pct(cleanAndConfident)}   <- genuinely distinct`);
console.log(`  unanimous BUT close/coinflip ${unanimousButShaky}/${n}  ${pct(unanimousButShaky)}   <- resolves the same way, but not distinct`);
console.log(`  any disagreement .......... ${majority + split}/${n}  ${pct(majority + split)}`);
console.log(`  AMBIGUOUS (either signal) . ${n - cleanAndConfident}/${n}  ${pct(n - cleanAndConfident)}`);

console.log(`\nBy cluster`);
console.log(`  ${"cluster".padEnd(18)} ${"n".padStart(3)} ${"unanimous".padStart(10)} ${"low-conf".padStart(9)}`);
for (const [name, c] of Object.entries(clusters)) {
  console.log(`  ${name.padEnd(18)} ${String(c.n).padStart(3)} ${String(c.unanimous).padStart(10)} ${String(c.low_confidence).padStart(9)}`);
}

console.log(`\nPhrases with any disagreement`);
for (const r of rows.filter((r) => r.agreement !== "unanimous")) {
  console.log(`  #${r.id} [${r.cluster}] "${r.phrase}"`);
  console.log(`      -> ${r.actions.join(" | ")}   (margins: ${r.margins.join(", ")})`);
}

console.log(`\nPhrases everyone agreed on but nobody was sure about`);
for (const r of rows.filter((r) => r.agreement === "unanimous" && r.low_confidence)) {
  console.log(`  #${r.id} [${r.cluster}] ${r.actions[0].padEnd(20)} margins: ${r.margins.join(", ")}  vs: ${r.runners_up.join(", ")}`);
}

console.log(`\nStrongest collision pairs (chosen -> nearly chosen instead)`);
for (const [pair, weight] of topEdges) console.log(`  ${String(weight).padStart(2)}x  ${pair}`);

console.log(`\nBroadest shadowers (appears as runner-up across many different intents)`);
for (const [action, weight] of topShadows) console.log(`  ${String(weight).padStart(2)}x  ${action}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    analysed_at: new Date().toISOString(),
    limitation: raters.limitation,
    totals: { n, unanimous, majority, split, cleanAndConfident, unanimousButShaky, ambiguous: n - cleanAndConfident },
    clusters,
    rows,
    collision_pairs: topEdges.map(([pair, w]) => ({ pair, weight: w })),
    broadest_shadowers: topShadows.map(([action, w]) => ({ action, weight: w })),
  }, null, 2));
  console.log(`\nWrote ${jsonOut}`);
}
