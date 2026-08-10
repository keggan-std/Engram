// ============================================================================
// Register truth — do the status-bearing documents state true things?
//
// THE FINDING THIS BINDS. The 2026-08-07 senior review's closing argument:
//
//   "This project's founding insight is correct: a claim survives only if
//    something executes it. The findings above show it is being applied TO
//    STRUCTURE AND NOT TO CONTENT. The gates check that generated files match
//    their generators, that CI steps are mirrored, that the router enumerates
//    its own set. NOT ONE CHECKS WHETHER A SENTENCE IS TRUE."
//
// Five of its eleven findings were the same shape — a statement about the world
// that no mechanism re-evaluates:
//
//   S2  `main` was not an ancestor of this branch for 7 commits. Merging would
//       have rolled package.json back to 1.12.0 and deleted v1.13.0's notes.
//       THREE separate registers said the branch was unpushed. It was pushed.
//   S3  STATE.md was stale, and its freshness gate could not reach exit 0.
//   S4  README said the dashboard ships. `npm pack` says otherwise.
//       (Bound in tests/public-surface/public-surface.test.ts.)
//   S7  docs/README.md and the constitution both said finding F4 was "still
//       open" six commits after it was closed — verbatim the harm
//       docs/archive/cross-instance-sharing-bugs.md is PRESERVED AS EVIDENCE OF.
//   S10 the constitution's version, test count and coverage were all wrong.
//
// WHY THESE ASSERTIONS AND NOT A FRESHNESS GATE. scripts/check-state-freshness.mjs
// deliberately is not a test, and its own header says why: "a gate that fails
// constantly is one a developer switches off inside a week." That reasoning is
// right, and the review's suggestion to wire it into `npm test` contradicts it.
// `generate-state.mjs --check` is worse for the purpose — it compares STATE.md
// against the LIVE Engram database, which every session mutates, and CI has no
// database at all because .engram/ is gitignored. Neither can be a gate.
//
// So this file gates the thing that IS deterministic: specific sentences,
// against the tree. Each assertion below is one line of git or one regex over
// source, cannot fail on an improvement, and could not have sat green through
// the defect it names.
//
// NO NETWORK. Same rule as public-surface.test.ts: a test that reaches the
// registry is a test that fails on a plane, and a gate that fails for reasons
// unrelated to its defect is how knip stayed red for nine sessions.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Run git with an ARGV ARRAY. Returns "" on failure.
 *
 * execFileSync, not execSync, and the reason is a bug this file hit on its own
 * first run: `git rev-parse --verify --quiet main^{commit}` through a shell on
 * Windows silently became `main{commit}`, because `^` is cmd.exe's escape
 * character. The ref resolved to nothing and the ancestry check reported
 * "cannot verify" on a repository where `main` was sitting right there.
 *
 * Same class as senior review S1, which this session fixed in src/utils.ts an
 * hour earlier — a shell eating characters out of an argument that was never
 * meant to be shell syntax. Worth leaving written down: the lesson did not
 * generalise on its own.
 */
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/** True if the git invocation exits 0, regardless of output. */
function gitOk(...args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The published line, wherever it is reachable from. */
function publishedRef(): string | null {
  for (const ref of ["main", "origin/main"]) {
    if (gitOk("rev-parse", "--verify", "--quiet", `${ref}^{commit}`)) return ref;
  }
  return null;
}

// ─── 1. The published line must not be ahead of the branch that will replace it

describe("the published line is an ancestor of this branch", () => {
  it("main is fully merged into the working branch", () => {
    // SENIOR REVIEW S2, and review action item #11: "Add a CI check that main
    // is an ancestor of the working branch. One line, and nothing performs it."
    // This is that line.
    //
    // On 2026-08-07 `git merge-base --is-ancestor main v2-foundations` was
    // FALSE. release/1.13.0 was cut from main, published to npm, and never
    // merged back. DEFERRED-CHANGES D11 exists SPECIFICALLY to prevent this and
    // described it almost verbatim — then went stale itself and asserted the
    // opposite. Finding F5 reproduced inside the anti-F5 machinery.
    const ref = publishedRef();

    // Deliberately not a silent skip. A gate that quietly does nothing when its
    // input is absent is the inert-capability shape this whole review is about
    // (ci-parity.test.ts says the same about a missing dist/).
    expect(
      ref,
      "Neither `main` nor `origin/main` resolves, so this cannot be checked. " +
        "CI must check out with fetch-depth: 0 for the ref to exist. Fix the " +
        "checkout rather than deleting this assertion.",
    ).not.toBeNull();

    const head = git("rev-parse", "HEAD");
    const isAncestor = gitOk("merge-base", "--is-ancestor", ref!, head);
    const behind = git("rev-list", "--count", `${head}..${ref}`) || "?";
    expect(
      isAncestor,
      `\`${ref}\` is NOT an ancestor of HEAD — ${behind} commit(s) on the ` +
        `published line are missing from this branch. Merging as-is would ` +
        `REVERT them, including package.json's version and RELEASE_NOTES.md. ` +
        `Run: git merge ${ref}`,
    ).toBe(true);
  });
});

// ─── 2. The version registers must agree with each other ────────────────────

describe("version claims agree across the files that carry them", () => {
  const pkg = JSON.parse(read("package.json")) as { version: string };

  it("RELEASE_NOTES.md's newest heading matches package.json's version", () => {
    // S2's concrete damage: the branch carried package.json 1.12.0 while
    // RELEASE_NOTES.md on main documented 1.13.0. Whichever way that pair is
    // resolved, they must not disagree — a release-notes file describing a
    // version the package does not claim to be is how the wrong notes get
    // published, and prepack injects this file's top section verbatim.
    const notes = read("RELEASE_NOTES.md");
    const first = /^#\s*v(\d+\.\d+\.\d+)/m.exec(notes);
    expect(first, "RELEASE_NOTES.md has no `# vX.Y.Z` heading to compare against.").not.toBeNull();

    expect(
      first![1],
      `RELEASE_NOTES.md's newest section is v${first![1]} but package.json is ` +
        `${pkg.version}. scripts/inject-release-notes.js publishes that top ` +
        `section as this version's notes, so they cannot disagree.`,
    ).toBe(pkg.version);
  });

  it("the constitution does not claim to cover a version older than the package", () => {
    // Its header read "1.11.0, schema V24" while the package was 1.12.0 and the
    // store was V26 — in the document whose stated purpose is being the one
    // place a reader trusts over the README.
    const constitution = read("docs/ENGRAM_CONSTITUTION.md");
    const covers = /\*\*Covers:\*\*[^\n]*?@\s*(\d+\.\d+\.\d+)/.exec(constitution);
    expect(covers, "The constitution's `**Covers:**` version stamp is missing or unparseable.").not.toBeNull();

    const cmp = (v: string) => v.split(".").map(Number);
    const [cMaj, cMin] = cmp(covers![1]);
    const [pMaj, pMin] = cmp(pkg.version);
    expect(
      cMaj * 1000 + cMin,
      `The constitution says it covers ${covers![1]} but package.json is ` +
        `${pkg.version}. Update the header in the same commit that bumps the ` +
        `version, or the document silently describes a tree nobody is running.`,
    ).toBeGreaterThanOrEqual(pMaj * 1000 + pMin);
  });
});

// ─── 3. A finding may not be advertised as open once the code closes it ─────

describe("closed findings are not still advertised as open", () => {
  it("no document says F4 is open while searchAll enforces permissions", () => {
    // THE most expensive kind of stale claim, and this project already has the
    // preserved evidence: docs/archive/cross-instance-sharing-bugs.md asserted
    // "not yet fixed" for EIGHT VERSIONS after the fix shipped, and is kept
    // specifically as the record of what that costs. Then docs/README.md — the
    // router, which CLAUDE.md names as required reading — did it again with F4.
    //
    // A reader who trusts the router burns a session re-fixing a solved bug.
    const service = read("src/services/cross-instance.service.ts");
    const fixed = /checkPermission/.test(service);

    // If the fix is ever reverted this assertion inverts rather than passing
    // vacuously — the docs would then be right and this test must not fail.
    if (!fixed) return;

    for (const doc of ["docs/README.md", "docs/ENGRAM_CONSTITUTION.md"]) {
      const body = read(doc);
      const offending = body
        .split("\n")
        // A QUOTED phrase is a citation, not an assertion. Both documents now
        // preserve the wrong sentence beside the correction — that is
        // convention #2, and it is the entire reason
        // archive/cross-instance-sharing-bugs.md is kept. Matching inside
        // quotes would force the next author to DELETE the historical record to
        // get the build green, which is the opposite of the point.
        .map((line, i) => [i + 1, line.replace(/"[^"]*"|“[^”]*”/g, '""')] as const)
        .filter(([, line]) => /\bF4\b/.test(line))
        // The open-claim must attach to F4 itself. A line may accurately say F4
        // is closed and separately name something that is not — constitution
        // §12.8 does exactly that, because the searchAll half is fixed while
        // the unsigned trust root is not.
        .filter(([, line]) =>
          /\bF4\b[^.]{0,80}?(still open|not yet fixed|remains open|is open\b)/i.test(line) ||
          /(still open|not yet fixed|remains open)[^.]{0,40}?\bF4\b/i.test(line),
        );

      expect(
        offending.map(([n, l]) => `${doc}:${n}: ${l.trim()}`),
        `${doc} says finding F4 is open, but cross-instance.service.ts calls ` +
          `checkPermission — it is closed (decision #38, commit cc138b6). ` +
          `Correct the document. See docs/archive/cross-instance-sharing-bugs.md ` +
          `for what this specific error has already cost.`,
      ).toEqual([]);
    }
  });

  it("DEFERRED-CHANGES D11 does not claim the release is unpublished once it is tagged", () => {
    // The senior review response listed D11 as owing a rewrite — "three of its
    // claims are false" — and noted this file covered the hook and the router
    // but NOT D11's prose. This is that coverage.
    //
    // D11 is the entry whose entire subject is the release hold. It said
    // release/1.13.0 was "not pushed and not published" and that the next
    // version "must be a major — so 2.0.0, not 1.13.0". v1.13.0 shipped on
    // 2026-08-07. The document that exists to stop a stale version claim
    // carried one for three days — the same shape as F5, inside the anti-F5
    // machinery, for the second time.
    //
    // OFFLINE BY CONSTRUCTION. The obvious check is `npm view`, and it is the
    // wrong one: a gate that reaches the registry fails on a plane. The local
    // tag plus package.json is the same fact, available offline.
    const released = gitOk("rev-parse", "--verify", "--quiet", "v1.13.0^{commit}");
    if (!released) return; // nothing shipped yet — the claim is honest again

    const doc = "docs/DEFERRED-CHANGES.md";
    const body = read(doc)
      .split("\n")
      // TWO forms of preserved-false-claim, and the gate found the second one
      // itself: it went red against the corrected document, naming the rows of
      // the correction table that QUOTE the wrong sentence beside the right one.
      //
      //   ~~struck~~  — convention #2's "leave the record, mark it dead"
      //   "quoted"    — a citation, not an assertion
      //
      // The F4 assertion above already encodes the quote rule for exactly this
      // reason. Matching inside either would force the next author to DELETE
      // the history to get the build green, which is the opposite of the point.
      .map((line, i) => [i + 1, line.replace(/~~[^~]*~~/g, "").replace(/"[^"]*"|“[^”]*”/g, '""')] as const);

    const offending = body.filter(([, line]) =>
      /not pushed and not published/i.test(line) ||
      /\bmust be a\b[^.]{0,60}\bmajor\b[^.]{0,60}\b2\.0\.0\b/i.test(line),
    );

    expect(
      offending.map(([n, l]) => `${doc}:${n}: ${l.trim()}`),
      `${doc} still asserts the 1.13.0 release is unpublished or is not the ` +
        `next version, but tag v1.13.0 exists in this repository. Strike the ` +
        `sentence and record what superseded it — do not delete it.`,
    ).toEqual([]);
  });

  it("no document claims the working branch is unpushed while it has an upstream", () => {
    // S2 again, and the one with a disclosure consequence. THREE registers said
    // "not pushed" — DEFERRED-CHANGES D11, docs/STATE.md, and the branch-guard
    // hook, whose comment read "nothing is disclosed while this branch stays
    // unpushed". The branch was pushed. The project's own tripwire says
    // "pushing IS disclosure", so this pair is a safety claim, not bookkeeping.
    const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
    if (!upstream) return; // genuinely unpushed — the claim is free again

    const hook = ".claude/hooks/guard-branches.mjs";
    const body = read(hook);
    expect(
      body,
      `${hook} still tells every agent that nothing is disclosed while this ` +
        `branch stays unpushed, but the branch has upstream \`${upstream}\`. ` +
        `The hazard calculus that comment encodes has already inverted.`,
    ).not.toMatch(/nothing is disclosed while this branch stays unpushed/i);
  });
});
