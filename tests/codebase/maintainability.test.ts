// ============================================================================
// Codebase & Maintainability — FR-D8's §5 binding
//
// Domain 8 owns "can a person still work on this": layering, dispatcher size,
// dead code, conventions, and what belongs in this repo at all.
//
// THE FINDING THIS BINDS. `ENGRAM_CONSTITUTION.md` states four architectural
// laws. None of them had any mechanism. Three are obeyed anyway; one is not —
// and it is the one the constitution singles out:
//
//     Law 1 — "repositories/ owns SQL. services/ owns logic and I/O.
//              tools/ owns MCP dispatch."
//              Rationale column: "The one clean separation in the codebase.
//              Preserve it."   (ENGRAM_CONSTITUTION.md:58)
//
// PROVEN on a clean tree at 038aea6, counting `.prepare(` in the four LIVE
// files under src/tools/ (the other 15 are unreachable dead code and counting
// them inflates the figure to 210):
//
//     dispatcher-memory.ts   getRepos()=2   .prepare()=69    97% bypass
//     dispatcher-admin.ts    getRepos()=1   .prepare()=22    96% bypass
//     sessions.ts            getRepos()=4   .prepare()=8     67% bypass
//     find.ts                getRepos()=0   .prepare()=0
//
// 7 repository calls against 99 raw statements. The 13-repo, 1,283-line
// repository layer is consumed by src/database.ts and six files under
// src/services/ — never by the MCP tool surface, which is the product.
//
// And nothing reported it: on that same tree `npm run build`, both surface
// `--check` gates and 714/714 tests all pass. There is no linter — .eslintrc*,
// eslint.config.*, .prettierrc*, biome.json and .editorconfig are all absent.
//
// WHY A CEILING AND NOT AN EQUALITY. FR-D9's suite rejected count assertions
// because "there are N of X" passes for a set that is complete and wrong, and
// fails on every legitimate addition. That objection is about EQUALITY. What is
// asserted here is a MAXIMUM: the count may fall freely and may never rise. It
// cannot fail on a legitimate improvement, and it cannot sit green through the
// regression it exists to catch. Lowering a baseline is a one-line edit a human
// reviews in the same commit that earned it.
//
// WHY NOT SIMPLY REFACTOR THE 91 CALL SITES. Because the failure literature
// says the obvious move is not free. Carbon Health's 107-incident decomposition
// study (arXiv:2505.09813) found decomposition traded database incidents for
// over-fetching and consistency incidents rather than reducing them, and
// recommends in-place modularisation first. A 91-site rewrite during a review
// that has already flagged the tool contract as in flux (DEFERRED D14) is the
// change most likely to produce the confident wrong answer this whole review is
// organised against. The ratchet stops the bleeding without the rewrite.
//
// WHY LAWS 2-4 ARE FROZEN BUT NOT ENFORCED HARDER. They are currently obeyed.
// Boogerd & Moonen's MISRA C study found compliance with most individual rules
// had no measurable effect on faults, and that enforcing the wrong rules is
// wasted effort. So these assertions record that the laws hold TODAY at near
// zero cost; they do not build machinery for rules discipline is already
// keeping.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/** Occurrences of `.prepare(` — better-sqlite3's only statement entry point. */
const countRawSql = (rel: string) => (read(rel).match(/\.prepare\s*\(/g) ?? []).length;

// ─── 1. Law 1 — the layering ratchet ────────────────────────────────────────

/**
 * The four reachable files under src/tools/. Everything else there is dead code
 * (section 2), and including it would triple the figure while measuring nothing
 * that ships.
 *
 * Values are TODAY'S DEFECT, not a target. Task #80 owns bringing them down.
 * Each is a ceiling: a fall is always allowed, a rise never is.
 */
const RAW_SQL_CEILING: Record<string, number> = {
  "src/tools/dispatcher-memory.ts": 69,
  "src/tools/dispatcher-admin.ts": 22,
  "src/tools/sessions.ts": 8,
  "src/tools/find.ts": 0,
};

describe("FR-D8 §5 — Law 1: repositories/ owns SQL", () => {
  it("DEFECT (task #80): no live dispatcher adds raw SQL beyond its frozen ceiling", () => {
    const risen: string[] = [];
    for (const [file, ceiling] of Object.entries(RAW_SQL_CEILING)) {
      const actual = countRawSql(file);
      if (actual > ceiling) risen.push(`${file}: ${actual} > ${ceiling}`);
    }
    expect(
      risen,
      `New raw SQL was added to a dispatcher. ENGRAM_CONSTITUTION.md:58 makes ` +
        `repositories/ the owner of SQL and calls that "the one clean separation ` +
        `in the codebase. Preserve it." Route the query through src/repositories/ ` +
        `— or, if the bypass is genuinely correct, lower the ceiling here in the ` +
        `same commit so a human sees it.`,
    ).toEqual([]);
  });

  it("the repository layer is still the place SQL lives, so the ceiling cannot be met by gutting it", () => {
    // Guards the degenerate fix: deleting src/repositories/ would drive every
    // dispatcher count to zero and leave this suite green over a worse codebase.
    const barrel = read("src/repositories/index.ts");
    const repos = [...barrel.matchAll(/export \{ (\w+Repo) \} from/g)].map((m) => m[1]);
    expect(repos.length).toBeGreaterThanOrEqual(13);

    const sqlInRepos = [...barrel.matchAll(/from "\.\/([\w.-]+\.js)"/g)]
      .map((m) => `src/repositories/${m[1].replace(/\.js$/, ".ts")}`)
      .filter((p) => existsSync(path.join(ROOT, p)))
      .reduce((sum, p) => sum + countRawSql(p), 0);
    expect(sqlInRepos).toBeGreaterThan(90);
  });
});

// ─── 2. The deliberate dead code ────────────────────────────────────────────

describe("FR-D8 §5 — deliberately-retained dead code stays honest", () => {
  /** Derived from knip.json, never restated here. */
  const ignored: string[] = (JSON.parse(read("knip.json")).ignore as string[]).filter(
    (p) => p.startsWith("src/tools/"),
  );

  it("every file knip is told to ignore actually exists", () => {
    // DEFERRED-CHANGES D10: these 15 files "are the only record of validation the
    // v1.6 consolidation silently dropped" and must not be deleted until their
    // enums and bounds are ported (task #6). Deleting one while the ignore entry
    // remains is the silent loss that entry exists to prevent — Knight Capital's
    // 2012 outage is the canonical case of code believed retired being neither
    // deleted nor accounted for (dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/).
    const missing = ignored.filter((p) => !existsSync(path.join(ROOT, p)));
    expect(
      missing,
      `knip.json ignores a file that no longer exists. If it was deleted on ` +
        `purpose, port its validation first (task #6, DEFERRED D10) and drop the ` +
        `ignore entry in the same commit.`,
    ).toEqual([]);
  });

  it("the ignore list is confined to the documented dead set, so it cannot be used to silence new dead code", () => {
    // The failure mode this catches: a 16th file goes dead, CI turns red, and
    // the cheapest way to green is one more line in knip.json. That converts a
    // working gate into a growing exception list — the mechanism by which the
    // rulesync project's knip report became "too noisy to act on as-is"
    // (github.com/dyoshikawa/rulesync/issues/1763).
    expect(ignored.length).toBeLessThanOrEqual(15);
  });

  it("the dead-code gate is runnable without a global install", () => {
    // `"deadcode": "knip"` invoked a binary that is not a dependency, so the
    // documented local command failed with "'knip' is not recognized" while CI
    // used `npx -y knip@5`. Local and CI must run the same thing or the gate is
    // only ever exercised where nobody sees it.
    const script = JSON.parse(read("package.json")).scripts.deadcode as string;
    expect(script).toMatch(/npx/);
    expect(read(".github/workflows/ci.yml")).toMatch(/knip/);
  });
});

// ─── 3. Laws 2-4, frozen while they hold ────────────────────────────────────

describe("FR-D8 §5 — the three architectural laws that discipline is keeping", () => {
  it("Law 2: nothing on the MCP stdio path writes to stdout", () => {
    // 96 console.log calls exist in src/, every one of them in the installer CLI
    // (92) or the hooks script (4) — neither of which speaks JSON-RPC. The law is
    // stated more broadly than the hazard; what matters is that the protocol
    // channel stays clean, and that is what is asserted.
    const offenders = [
      "src/index.ts", "src/http-server.ts", "src/database.ts", "src/utils.ts",
      "src/response.ts", "src/migrations.ts", "src/global-db.ts",
      "src/tools/dispatcher-memory.ts", "src/tools/dispatcher-admin.ts",
      "src/tools/sessions.ts", "src/tools/find.ts",
    ].filter((f) => existsSync(path.join(ROOT, f)) && /console\.log\s*\(/.test(read(f)));
    expect(
      offenders,
      "stdout is the JSON-RPC framing channel; a stray console.log corrupts the protocol.",
    ).toEqual([]);
  });

  it("Law 4: no live dispatcher takes a raw optional string array", () => {
    // MCP clients serialize arrays inconsistently; coerceStringArray() is the
    // documented fix and omitting it causes intermittent "must be object" errors.
    for (const f of Object.keys(RAW_SQL_CEILING)) {
      expect(read(f), `${f} must use coerceStringArray() / coerceNumberArray()`)
        .not.toMatch(/z\.array\(z\.string\(\)\)\.optional\(\)/);
    }
  });
});
