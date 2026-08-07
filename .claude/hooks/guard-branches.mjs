#!/usr/bin/env node
// ============================================================================
// PreToolUse guard — protected branches, and push-as-disclosure
//
// Enforces two project rules that have so far existed only as text:
//
//   1. Convention #6 — never commit, merge or hard-reset on `main` or
//      `develop`. `main` is the published line and stays always-releasable;
//      tripwire patch releases are cut from it.
//
//   2. DEFERRED-CHANGES D11 is explicit that **pushing IS disclosure**, so a
//      push must be a deliberate human decision, never a reflex.
//
//      CORRECTED 2026-08-07 (senior review S2). This block used to end with
//      "nothing is disclosed while the branch is unpushed". THE BRANCH IS
//      PUSHED — it has tracked `origin/v2-foundations` since before v1.13.0
//      shipped — and v1.13.0 is live on npm as `latest`. That sentence was one
//      of THREE registers still telling every agent the opposite; the other two
//      were D11 itself and docs/STATE.md.
//
//      This matters more than ordinary staleness because it is a SAFETY claim.
//      An agent reading "nothing is disclosed" reasons that a hazard is
//      contained when it is already public. The premise inverted and the
//      warning did not.
//
//      tests/process/register-truth.test.ts now fails if this file claims the
//      branch is unpushed while git reports an upstream.
//
// WHY A HOOK AND NOT A RULE
// -------------------------
// Because rules do not work. Measured: agents ignore explicit logging
// instructions ~67% of the time, with 27% compliance even when the
// instructions are detailed (observation #41). Demonstrated, in the session
// that produced this file: I made the same tool-call syntax error four times
// within an hour of writing the convention forbidding it. A protocol that
// cannot survive the agent who authored it forty minutes earlier will not
// survive a fresh agent in three weeks.
//
// A hook is run by the harness, not by the agent's goodwill. That is the
// entire point.
//
// WHAT THIS IS NOT
// ----------------
// Not a security control, and not a merge gate. It constrains THIS agent in
// THIS harness. It does nothing about a human with a terminal, an agent in a
// different tool, or CI. Git's own hooks are worse — `--no-verify` bypasses
// them and `.git/hooks` is not shared by clone — so neither mechanism is a
// real gate. The threat model here is AGENT FORGETFULNESS, which is precisely
// what this does address, and overselling it would repeat the mistake the
// charter's §5 grading exists to prevent.
//
// FAILS OPEN, DELIBERATELY. Any error exits 0 with no decision. A guard
// against forgetfulness must never be able to wedge a session; a guard
// against an adversary would have to fail closed, and this is not that.
// ============================================================================

import { execSync } from "node:child_process";

const PROTECTED = ["main", "develop"];

/** Write a PreToolUse decision and leave. Exit 0 — exit 2 is documented to make
 *  the model stop and defer to the user rather than self-correct. */
function decide(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason,
    },
  }));
  process.exit(0);
}

let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw || "{}");
    if (input.tool_name !== "Bash") process.exit(0);

    const cmd = String(input.tool_input?.command ?? "");
    if (!/\bgit\b/.test(cmd)) process.exit(0);

    // ── Rule 2: any push is a disclosure decision, so ask a human ───────────
    if (/\bgit\s+(-\S+\s+)*push\b/.test(cmd)) {
      decide(
        "ask",
        "PUSH = DISCLOSURE. DEFERRED-CHANGES D11 states that pushing inverts the " +
        "entire risk calculus, and pushing also fires the D11 tripwire, which " +
        "commits to cutting a release that week. NOTE: this branch is ALREADY " +
        "pushed and v1.13.0 is already live on npm, so the question is not whether " +
        "to disclose but what this specific push adds to what is public. This must " +
        "be a deliberate human decision — confirm only if that is genuinely intended."
      );
    }

    // ── Rule 1: no writing history on a protected branch ────────────────────
    const writesHistory = /\bgit\s+(-\S+\s+)*(commit|merge|rebase|cherry-pick)\b/.test(cmd)
      || /\bgit\s+(-\S+\s+)*reset\s+.*--hard/.test(cmd);
    if (!writesHistory) process.exit(0);

    let branch = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: input.cwd || process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch { process.exit(0); } // not a repo, or git unavailable — no opinion

    if (PROTECTED.includes(branch)) {
      decide(
        "deny",
        `Refusing to write history on "${branch}" — convention #6. main is the ` +
        `published line and stays ALWAYS RELEASABLE, because tripwire patch releases ` +
        `are cut from it (docs/foundations/tripwire-patch-runbook.md). Work belongs ` +
        `on v2-foundations, or a branch off it: fr/d1-durability, fr/0g-state-register, ` +
        `etc. Create one with: git checkout -b fr/<name>`
      );
    }

    process.exit(0);
  } catch {
    process.exit(0); // fail open — see the header
  }
});
