// ============================================================================
// CI parity — the master plan's sequencing item 0, made a binding
//
// THE FINDING THIS BINDS. `main` and `v2-foundations` carry different CI
// workflows. PROVEN, 2026-08-05:
//
//   main            on: push/PR → [main]        jobs: test  (npm ci · build · test)
//   v2-foundations  on: push/PR → [main, develop, v2-foundations, fr/**]
//                                                jobs: test + surface
//                                                surface adds the two generator
//                                                --check gates and knip
//
// So CI *has* run — on the published line, executing a workflow that omits
// every gate this review built. Charter §2's survival criterion ("coupled to
// something that breaks a build or blocks a merge") was satisfied by ZERO of
// the ten domain bindings, and no one noticed for 69 commits.
//
// WHY THE EXISTING BINDING COULD NOT SEE IT. `anti-drift.test.ts` asserts that
// each GATED artifact "names a CI step that actually exists" by reading
// `.github/workflows/ci.yml`. That file is *the one on the branch running the
// test*. A test can only ever read its own branch's workflow, so a suite that
// checks ci.yml is structurally incapable of detecting cross-branch workflow
// divergence — which is exactly the shape of the defect. The gate was green on
// the branch where it did not matter.
//
// WHY A TEST AND NOT A SECOND CI JOB ON `main`.
//
// Adding the `surface` job to main's workflow makes the gates run on main
// *today* and re-creates the divergence class *tomorrow*: two workflow files
// that must be kept in step by hand, which is the mechanism that produced the
// finding. Both workflows already run `npm test`. Putting the gates inside the
// test suite means:
//
//   - they execute on every branch, under either workflow, unchanged;
//   - they execute locally, before a push, not only after one;
//   - they travel with a cherry-pick — Release A carries its own gates;
//   - deleting the CI job can no longer silence them.
//
// It removes the divergence surface rather than policing it. The `surface` job
// stays in ci.yml because it isolates the failure and because
// `anti-drift.test.ts`'s GATED registry resolves against it.
//
// KNOWN RESIDUAL, stated rather than hidden: `knip` is deliberately NOT run
// here. It is `npx -y knip@5`, a network fetch of a ~30 MB tool on a cold
// cache, and a gate that needs the network to pass is a gate that gets switched
// off the first time a developer is on a plane (charter §2, and the reasoning in
// `scripts/generate-state.mjs`'s own header). It remains CI-only and therefore
// remains vulnerable to workflow divergence — Engram task #95.
// ============================================================================

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");
const DIST = path.join(ROOT, "dist");

/**
 * Run a generator in --check mode and return its exit code plus output.
 *
 * Both generators load `dist/`, so this is the one place in the suite that
 * tests the *compiled* artifact rather than the source vitest imports.
 */
function runGate(script: string) {
  const r = spawnSync(process.execPath, [path.join("scripts", script), "--check"], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Newest mtime under a directory, for the files that matter to the gates. */
function newestMtime(dir: string, ext: string): number {
  let newest = 0;
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(ext)) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

// ─── 1. The build the gates actually inspect ────────────────────────────────

describe("item 0 — the surface gates have something real to check", () => {
  it("dist/ exists", () => {
    expect(
      existsSync(DIST),
      "dist/ is missing, so the surface gates cannot read the compiled schema. " +
        "Run `npm run build` first. This is not skipped on purpose: a gate that " +
        "quietly does nothing when its input is absent is the inert-capability " +
        "shape this whole review is about.",
    ).toBe(true);
  });

  it("dist/ is not older than src/ — a stale build makes the gates lie", () => {
    // The gates compare a doc generated from `dist/` against the doc committed
    // in `docs/`. If `dist/` predates a `src/` edit, --check passes by testing
    // yesterday's schema: a false green, which is worse than a red.
    //
    // DEFERRED-CHANGES D1 already records "dist/ must be rebuilt after any src/
    // change, and there is no mechanism that does this for you." This is that
    // mechanism, as far as a test can be one.
    const src = newestMtime(path.join(ROOT, "src"), ".ts");
    const dist = newestMtime(DIST, ".js");
    expect(
      dist,
      "dist/ is older than the newest file in src/. Run `npm run build` — until " +
        "you do, the surface gates below are checking a stale schema.",
    ).toBeGreaterThanOrEqual(src);
  });
});

// ─── 2. The gates themselves, run here rather than only in a CI job ─────────

describe("item 0 — the generator gates run inside `npm test`", () => {
  it("capability surface is up to date", () => {
    const { code, out } = runGate("generate-capability-surface.mjs");
    expect(code, `generate-capability-surface.mjs --check failed:\n${out}`).toBe(0);
  }, 120_000);

  it("HTTP surface is up to date", () => {
    const { code, out } = runGate("generate-http-surface.mjs");
    expect(code, `generate-http-surface.mjs --check failed:\n${out}`).toBe(0);
  }, 120_000);
});

// ─── 3. The ratchet — no new gate may be CI-only without a decision ─────────

/**
 * Gate commands in ci.yml that are deliberately NOT mirrored into `npm test`,
 * each against a task. Classified here for the same reason
 * `anti-drift.test.ts` classifies generated artifacts: adding a fourth gate
 * fails this suite until someone decides which it is.
 */
const CI_ONLY_GATES: Record<string, { task: string; why: string }> = {
  "npx -y knip@5 --no-progress": {
    task: "#95",
    why:
      "Fetches a ~30 MB tool from the network on a cold cache. A gate that " +
      "cannot pass offline is a gate a developer switches off, so it stays in " +
      "CI where the network is a given. The cost is that knip alone remains " +
      "exposed to the workflow-divergence defect item 0 was raised over.",
  },
};

describe("item 0 — every CI gate is either mirrored here or classified", () => {
  /** Derived from ci.yml, never restated: every `run:` line in the surface job. */
  function ciRunSteps(): string[] {
    const ci = read(".github/workflows/ci.yml");
    return [...ci.matchAll(/^\s*run:\s*(.+?)\s*$/gm)]
      .map((m) => m[1])
      .filter((cmd) => !/^npm (ci|run build|test)$/.test(cmd));
  }

  it("there is at least one gate step to classify", () => {
    expect(ciRunSteps().length).toBeGreaterThan(0);
  });

  it("every gate step in ci.yml is run by this file or listed as CI-only", () => {
    const self = read("tests/process/ci-parity.test.ts");
    for (const cmd of ciRunSteps()) {
      if (CI_ONLY_GATES[cmd]) continue;
      // A mirrored gate is one whose script name appears in a runGate() call.
      const script = /node scripts\/([\w.-]+\.mjs)/.exec(cmd)?.[1];
      expect(
        script && self.includes(`runGate("${script}")`),
        `ci.yml runs \`${cmd}\`, which neither runs in this file nor appears in ` +
          `CI_ONLY_GATES. A gate that exists only in a workflow file is one ` +
          `branch away from not existing at all — that is item 0's finding. ` +
          `Mirror it above, or classify it with a task and a reason.`,
      ).toBe(true);
    }
  });

  it("every CI-only gate names a task and says why", () => {
    for (const [cmd, entry] of Object.entries(CI_ONLY_GATES)) {
      expect(entry.task, `${cmd} is CI-only but names no task`).toMatch(/^#\d+$/);
      expect(entry.why.length, `${cmd} must say why`).toBeGreaterThan(80);
    }
  });

  it("a classified CI-only gate is still actually in ci.yml", () => {
    // Otherwise the registry outlives the gate and becomes the decoration the
    // charter's survival criterion exists to reject.
    const ci = read(".github/workflows/ci.yml");
    for (const cmd of Object.keys(CI_ONLY_GATES)) {
      expect(ci, `CI_ONLY_GATES lists \`${cmd}\`, which is no longer in ci.yml`).toContain(cmd);
    }
  });
});

// ─── 4. The published line — the pin that was here is discharged ───────────

describe("item 0 — the published line's half", () => {
  it("this branch carries every gate input — the DEFECT pin is discharged", () => {
    // WHAT THE PIN USED TO SAY, edited here rather than deleted.
    //
    // On the review line this was a DEFECT pin against task #93: PROVEN by
    // `git cat-file -e main:<path>`, the published branch carried NONE of the
    // five inputs the surface gates need. `main` ran build + test only, so
    // every gate the Foundations Review built had never once executed on the
    // branch users install from, and the survival criterion those bindings
    // were written against was satisfied by none of them.
    //
    // v1.13.0 is the release that changes it. The pin is edited in the same
    // commit that discharges it, which is the discipline it existed to force.
    for (const f of [
      "scripts/generate-capability-surface.mjs",
      "scripts/generate-http-surface.mjs",
      "knip.json",
      "docs/CAPABILITY-SURFACE.md",
      "docs/HTTP-SURFACE.md",
    ]) {
      expect(existsSync(path.join(ROOT, f)), `${f} is a gate input and must exist`).toBe(true);
    }
  });

  it("the workflow on this branch actually runs the gates", () => {
    // The review line could not assert this about the published line: a test
    // reads only its own branch's tree. Here they are the same branch.
    const ci = read(".github/workflows/ci.yml");
    for (const step of [
      "node scripts/generate-capability-surface.mjs --check",
      "node scripts/generate-http-surface.mjs --check",
      "npx -y knip@5 --no-progress",
    ]) {
      expect(ci, "ci.yml no longer runs: " + step).toContain(step);
    }
  });
});
