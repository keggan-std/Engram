// ============================================================================
// CLAUDE.md — the entry-point instruction file's binding
//
// WHY THIS EXISTS. Charter §2's survival criterion: "the source of truth must
// be coupled to something that breaks a build or blocks a merge when it is
// stale." A hand-written instruction file loaded into every session is exactly
// the artifact class that criterion rejects — it is `archive/cross-instance-
// sharing-bugs.md` with a wider blast radius, because every agent reads it
// first and nothing ever re-checks it. Finding F5, at the entry point.
//
// Charter §12 puts skills and playbooks in Phase 3, *after* the review, on the
// grounds that "a watchlist written before the review is a guess; written
// after, it is a summary of what was actually found." Phase 1 and Phase 2 are
// complete, so this file is allowed to exist — and it inherits the same rule
// every domain doc has: name a mechanism that fails when it drifts.
//
// WHAT THIS BINDS, AND WHY THESE FOUR.
//
//   1. EVERY PATH IT NAMES RESOLVES. The whole value of the file is that it
//      routes a fresh agent. A route to a moved file is worse than no route:
//      the agent reads nothing and believes it read the map. This mirrors
//      anti-drift's §2 assertion for domain-doc bindings.
//
//   2. NO PRISM MARKERS. PROVEN 2026-08-06 by headless probe: a canary
//      CLAUDE.md was read back from a live session's context and the `[A:gist]`
//      line inside an HTML comment was ABSENT while both the plain prose and
//      the prose inside the `[H]` zone ARRIVED. Claude Code strips block-level
//      HTML comments from CLAUDE.md before injection, so prism-encoding this
//      file deletes every compressed directive and delivers every word of the
//      prose the convention meant to hide — the exact inverse of its purpose,
//      and silent in both directions. The hazard is undocumented in the prism
//      spec and in the Claude Code docs, which is why it is pinned here rather
//      than trusted to memory.
//
//   3. IT DECLARES ITSELF A RECALL CHANNEL. Charter §10.4a is normative:
//      "recall is any path by which stored Engram content re-enters an agent's
//      context." It enumerates three channels, all found the hard way, after
//      both pre-registered suppression arms had already leaked. CLAUDE.md is a
//      fourth — it restates convention #7's write-order rule, which cannot be
//      obtained any other way before a session's first write. The mitigation
//      the charter chose for channel 1 (STATE.md) was to make the file DECLARE
//      itself at the point of reading rather than to instruct agents not to
//      read it, because "an instruction contradicting the entry-point document
//      will lose." Same mitigation, same reason, now enforced.
//
//   4. IT STAYS UNDER 200 LINES. Files load in full on every session forever.
//      The threshold is where measured adherence starts degrading, and a
//      budget nothing checks is a budget that is already blown.
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT. Not the prose, not the rules, not
// whether an agent obeyed them. FR-D7 measured agent-rule compliance at 21.1%
// and the lesson taken was that replaying a rule is not enforcing it. This
// suite therefore binds only what is mechanically checkable about the file
// itself; the one rule in it that genuinely must not be ignored — never write
// history on a protected branch — is enforced by a PreToolUse hook instead,
// and assertion 5 pins that the file's description of the hook stays true.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const CLAUDE_MD = "CLAUDE.md";
const body = read(CLAUDE_MD);

/**
 * Path-shaped tokens that are references to a FILE CLASS rather than to a file
 * in this tree, classified rather than silently skipped — the anti-drift
 * registry pattern. A token may only be here with a reason.
 */
const NOT_A_PATH_IN_THIS_TREE: Record<string, string> = {
  "CLAUDE.local.md":
    "A file class, not a file. It is gitignored by convention and exists only in the " +
    "worktree where someone created one, so asserting its presence would fail for " +
    "every clone. Named in the prism hazard because the hazard applies to it too.",
};

/** Repo-relative path tokens, derived from the file — never restated here. */
function citedPaths(): string[] {
  const found = new Set<string>();

  // Markdown link targets: [text](target). A 404 here is unambiguously a defect.
  for (const m of body.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].trim();
    if (!/^(https?:|#|mailto:)/.test(t)) found.add(t.replace(/#.*$/, ""));
  }

  // Backticked tokens that look like a path with a known extension, or a dir.
  for (const m of body.matchAll(/`([^`\s]+)`/g)) {
    const t = m[1];
    if (t.includes("*")) continue; // globs describe a class, not a file
    if (/^[A-Za-z0-9._\-/]+\.(md|mjs|ts|js|json|yml)$/.test(t) || /^[A-Za-z0-9._\-/]+\/$/.test(t)) {
      found.add(t);
    }
  }

  return [...found].sort();
}

describe("CLAUDE.md — charter §2 binding", () => {
  it("exists at the repository root", () => {
    expect(existsSync(path.join(ROOT, CLAUDE_MD))).toBe(true);
  });

  it("every path it names resolves", () => {
    const unclassified: string[] = [];

    for (const rel of citedPaths()) {
      if (rel in NOT_A_PATH_IN_THIS_TREE) {
        expect(
          NOT_A_PATH_IN_THIS_TREE[rel].length,
          `${rel} is classified as not-a-path but gives no reason`,
        ).toBeGreaterThan(80);
        continue;
      }
      if (!existsSync(path.join(ROOT, rel))) unclassified.push(rel);
    }

    expect(
      unclassified,
      "CLAUDE.md routes a fresh agent to these, and they do not exist. Either fix the " +
        "path, or classify it in NOT_A_PATH_IN_THIS_TREE with a reason.",
    ).toEqual([]);
  });

  it("carries no prism zone markers or gist lines — they would be stripped", () => {
    // PROVEN by headless probe, 2026-08-06: the `[A:gist]` line inside an HTML
    // comment never reached the session's context; the `[H]` prose did. Any of
    // these appearing here means the agent lost a directive and gained prose.
    const zone = /^<!--\s*\[\/?[AH](?::[a-z]+)?\]\s*-->$/m;
    const gist = /<!--\s*\[A:gist\]/;

    expect(zone.test(body), "prism zone marker found in CLAUDE.md — see the header").toBe(false);
    expect(gist.test(body), "prism gist line found in CLAUDE.md — it will be stripped").toBe(false);
  });

  it("declares itself a recall channel — charter §10.4a", () => {
    // The charter's chosen mitigation for a leak channel is self-declaration at
    // the point of reading, not an instruction elsewhere. If the declaration is
    // removed, the suppression arms silently lose a channel again.
    expect(body).toMatch(/recall channel/i);
    expect(body).toMatch(/§10\.4a/);
  });

  it("stays under the 200-line adherence budget", () => {
    const lines = body.split(/\r?\n/).length;
    expect(lines, `CLAUDE.md is ${lines} lines; it loads in full on every session`).toBeLessThan(
      200,
    );
  });

  it("its description of the branch hook is still true", () => {
    // CLAUDE.md tells the agent the hook DENIES history writes on main/develop
    // and ASKS on push. If the hook changes and this file does not, the file is
    // making a false claim about an enforcement mechanism — which is §1 of the
    // master plan ("advertised, described accurately somewhere, does not
    // execute") arriving in the entry-point document.
    const hook = read(".claude/hooks/guard-branches.mjs");
    expect(hook).toMatch(/PROTECTED\s*=\s*\[\s*"main"\s*,\s*"develop"\s*\]/);
    // Whitespace- and line-ending-insensitive: this repo is checked out CRLF.
    expect(hook, "the hook no longer DENIES on a protected branch").toMatch(/decide\(\s*"deny"/);
    expect(hook, "the hook no longer ASKS before a push").toMatch(/decide\(\s*"ask"/);

    const settings = JSON.parse(read(".claude/settings.json"));
    const commands = (settings.hooks?.PreToolUse ?? [])
      .flatMap((m: { hooks?: { command?: string }[] }) => m.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? "");
    expect(
      commands.some((c: string) => c.includes("guard-branches.mjs")),
      "CLAUDE.md claims a PreToolUse hook that settings.json no longer registers",
    ).toBe(true);
  });
});
