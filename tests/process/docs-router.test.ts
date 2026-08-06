// ============================================================================
// docs/README.md — the documentation router's binding
//
// WHY THIS EXISTS. `CLAUDE.md` got a binding in session 41 because a hand-written
// file auto-loaded into every session, that nothing ever re-checks, is finding F5
// at the entry point. `docs/README.md` is the *other* entry point — the file
// CLAUDE.md's read order sends every agent to second, and the file that decides
// what the agent reads next. It had no binding at all, and by 2026-08-06 it had
// drifted in three independent ways at once:
//
//   (a) FIVE OF TEN COMPLETED DOMAIN DOCS WERE UNROUTED. Phase 1 finished all ten
//       domains. The router's foundations table named 01, 02, 04, 05 and 06.
//       Domains 03, 07, 08, 09 and 10 existed, were complete, and were reachable
//       only by someone who already knew they were there — including 09, which
//       owns the anti-drift machinery, and 10, which owns the public surface.
//       An agent following the documented read order missed half the review.
//
//   (b) THE ACTIVE-SET COUNT WAS WRONG. "eleven files", above a five-row table,
//       in a section that continues for three more tables.
//
//   (c) FOUR LIVE STORE COUNTS WERE RESTATED AND ALL FOUR WERE WRONG — 90 file
//       notes (96), 11 open tasks (70), 14 decisions (34), 20+ observations
//       (123). PROVEN by `engram_admin(action:"stats")`, 2026-08-06. They sat
//       under a heading reading "Where the current state actually lives", in a
//       paragraph whose own first sentence is "Documents describe. Engram itself
//       holds the live state." The document contradicted itself in situ.
//
// This is the same shape observation #123 caught in this same file one session
// earlier — the router had never named `STATE.md` while `STATE.md` had always
// named the router. That was fixed by hand, and nothing held it. Assertion 4
// holds it now.
//
// WHY THESE FOUR ASSERTIONS.
//
//   1. EVERY DOMAIN DOC IS ROUTED. Derived by reading `docs/foundations/`, never
//      restated here — the anti-drift house rule. A count assertion ("there are
//      eleven") was rejected for the reason anti-drift's header already gives:
//      it passes for a set that is complete and wrong, and fails on every
//      legitimate addition, which is how a gate gets switched off. This is the
//      assertion that would have caught (a) the day domain 3 landed.
//
//   2. EVERY LINK RESOLVES. A route to a moved file is worse than no route: the
//      agent reads nothing and believes it read the map. Same reasoning as
//      `claude-md.test.ts` assertion 2.
//
//   3. NO LIVE COUNT — OF THE STORE OR OF THE TREE. One rule, stated once: the
//      router ROUTES; it does not RESTATE. It exists to say which document owns
//      a number, and every number it quotes instead is one more copy to keep in
//      step by hand.
//
//      For STORE counts the ABSENCE form is the only one possible, for the
//      reason that makes `STATE.md` UNGATED in `anti-drift.test.ts`: the store
//      lives in `.engram/`, which `.gitignore` excludes, so CI cannot read the
//      source and cannot know whether a quoted number is right.
//
//      For TREE counts a MATCHING form *would* be possible — `src/` is
//      committed and CI can count it. It is still rejected, and this is the
//      part worth carrying forward: the router said "All 90 `src/` files" while
//      `ENGRAM_CONSTITUTION.md` §13 — the document that sentence describes —
//      had been re-measured to **91** the day before, and says of itself
//      "nothing recomputes this table; treat every number here as of its stamp
//      date" (task #81). A matching assertion would have kept the copy correct
//      and left the deeper defect intact: two documents owning one fact. The
//      fix is for the router to name the owner and stop carrying the value.
//
//   4. BOTH ENTRY POINTS POINT AT EACH OTHER. `STATE.md` and `CLAUDE.md` must be
//      named. A one-directional pointer between entry points is how a generated
//      register goes unread while everyone follows the process correctly.
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT.
//
//   - Backticked path tokens, which `claude-md.test.ts` does check. A router
//     names runtime paths (`.engram/`, `memory.db`) that exist on a developer's
//     machine and never in CI. A binding that is green locally and red in CI is
//     worse than none — it gets switched off, and then the markdown-link half
//     goes with it. Markdown link targets are unambiguous; that is the half kept.
//
//   - Spelled-out counts ("eleven files"). Assertion 3 matches digits only.
//     `\b(two|three|ten)\s+decisions\b` fires on ordinary prose, and a gate with
//     false positives is a gate someone deletes. Residual stated rather than
//     hidden: a future "ninety file notes" passes this suite.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS = path.join(ROOT, "docs");
const ROUTER = "docs/README.md";
const body = readFileSync(path.join(ROOT, ROUTER), "utf-8");

/** Markdown link targets, resolved relative to `docs/`. Derived, never restated. */
function linkTargets(): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].trim();
    if (/^(https?:|#|mailto:)/.test(t)) continue;
    found.add(t.replace(/#.*$/, ""));
  }
  return [...found].sort();
}

describe("docs/README.md — the router's binding", () => {
  it("routes every domain doc in docs/foundations/", () => {
    // Discovery pattern deliberately identical to anti-drift.test.ts §2, so the
    // two suites cannot disagree about what a domain doc is.
    const domainDocs = readdirSync(path.join(DOCS, "foundations"))
      .filter((f) => /^\d\d-.*\.md$/.test(f))
      .sort();

    expect(domainDocs.length, "no domain docs discovered — did foundations/ move?").toBeGreaterThan(
      0,
    );

    const unrouted = domainDocs.filter((f) => !body.includes(`foundations/${f}`));

    expect(
      unrouted,
      "these domain docs are complete and the router does not name them. An agent " +
        "following the documented read order will never reach them.",
    ).toEqual([]);
  });

  it("every path it links resolves", () => {
    const broken = linkTargets().filter((rel) => !existsSync(path.join(DOCS, rel)));

    expect(
      broken,
      "the router sends a fresh agent to these, and they do not exist in this tree",
    ).toEqual([]);
  });

  it("quotes no live count of the store or the tree — it routes, it does not restate", () => {
    // The defect signature, verbatim: a digit, then a noun naming something that
    // changes underneath the sentence. The first six are store facts and belong
    // to `docs/STATE.md`, which is regenerated. `files` is a tree fact and
    // belongs to `ENGRAM_CONSTITUTION.md` §13, which stamps its own date.
    //
    // Up to two intervening word-shaped tokens are allowed between the number
    // and the noun, and that allowance is not decoration: the real sentence was
    // "All 90 `src/` files", and the first version of this assertion — which
    // required the noun to follow the digit directly — passed on it. Found by
    // tampering rather than by reading, which is the whole reason charter §5
    // requires a binding be PROVEN able to fail before it is believed.
    const NOUNS = "file notes|open tasks|decisions|observations|conventions|sessions|files";
    const GAP = "(?:[`'\"*_A-Za-z0-9./-]{1,16}\\s+){0,2}";
    const offences = [
      ...body.matchAll(new RegExp(`\\b\\d[\\d,]*\\+?\\s+${GAP}(?:${NOUNS})\\b`, "gi")),
    ]
      .map((m) => m[0])
      .sort();

    expect(
      offences,
      "a live count reappeared in the router. It will be wrong within a session (store) or " +
        "within a commit (tree) — name the document that owns the number instead: " +
        "docs/STATE.md for the store, ENGRAM_CONSTITUTION.md §13 for the tree.",
    ).toEqual([]);
  });

  it("names both of the other entry points", () => {
    // STATE.md has always ended with "go to README next". Until 2026-08-06 the
    // router never named STATE.md — observation #123. Pinned so it cannot be
    // dropped again by an edit that is only reading prose.
    expect(body, "the router does not name docs/STATE.md").toMatch(/\(STATE\.md\)/);
    expect(body, "the router does not name CLAUDE.md").toMatch(/\(\.\.\/CLAUDE\.md\)/);
  });
});
