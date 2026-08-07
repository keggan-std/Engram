#!/usr/bin/env node
// ============================================================================
// Is docs/STATE.md telling the truth about where the project is?
//
// WHY THIS EXISTS. STATE.md is generated from Engram and is the first thing
// CLAUDE.md tells every agent to read. Nothing regenerates it. Task #74 records
// that its own generator names a binding which does not exist, and task #57
// found the same gap independently. So the register every agent trusts goes
// stale by default — finding F5, at the entry point.
//
// WHY IT IS NOT A TEST. A suite that failed whenever HEAD moved ahead of
// STATE.md would go red on every commit, and a gate that fails constantly is
// one a developer switches off inside a week — the exact failure this project
// has already documented. So this REPORTS a distance and exits non-zero only
// when the register is behind. It is meant to be read, by an agent or a human,
// not to block a commit.
//
// WHAT IT CHECKS, all derived — nothing restated:
//   1. The commit STATE.md names in its own header, versus HEAD.
//   2. How many commits have landed since, and whether any touched src/.
//   3. Whether the generator itself is newer than the artifact.
//
// Exit 0 = current. Exit 1 = behind, with the reason on stdout.
// ============================================================================

import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const STATE = "docs/STATE.md";
const GENERATOR = "scripts/generate-state.mjs";

const git = (cmd) => {
    try { return execSync(`git ${cmd}`, { encoding: "utf-8" }).trim(); }
    catch { return ""; }
};

function fail(lines) {
    for (const l of lines) console.log(l);
    process.exit(1);
}

if (!existsSync(STATE)) {
    fail([`STALE: ${STATE} does not exist. Regenerate with: npm run state`]);
}

const body = readFileSync(STATE, "utf-8");

// The header records the branch and commit it was generated from. Derived from
// the artifact itself, so a change to the generator's header format shows up
// here as "cannot parse" rather than as a silent pass.
const stamped = /\*\*Branch:\*\*\s*`([^`]+)`\s*@\s*`([0-9a-f]{7,40})`/.exec(body);
if (!stamped) {
    fail([
        `CANNOT VERIFY: ${STATE} does not record the branch and commit it was generated from.`,
        `The header format may have changed. Expected: **Branch:** \`<branch>\` @ \`<sha>\``,
        `Without that stamp, nothing can tell whether this file is current.`,
    ]);
}

const [, stampedBranch, stampedCommit] = stamped;
const head = git("rev-parse --short HEAD");
const branch = git("rev-parse --abbrev-ref HEAD");
const problems = [];

if (stampedCommit !== head) {
    const behind = git(`rev-list --count ${stampedCommit}..HEAD`) || "?";
    const srcTouched = git(`diff --name-only ${stampedCommit}..HEAD -- src/`)
        .split("\n").filter(Boolean).length;
    problems.push(
        `BEHIND: generated at ${stampedCommit}, HEAD is ${head} — ${behind} commit(s) since.`,
        srcTouched > 0
            ? `  ${srcTouched} file(s) under src/ changed in that range. The register describes a tree that no longer exists.`
            : `  No src/ changes in that range — the drift is documentation only.`,
    );
}

if (stampedBranch !== branch) {
    problems.push(`WRONG BRANCH: generated on \`${stampedBranch}\`, currently on \`${branch}\`.`);
}

if (existsSync(GENERATOR) && statSync(GENERATOR).mtimeMs > statSync(STATE).mtimeMs) {
    problems.push(`GENERATOR IS NEWER: ${GENERATOR} was modified after ${STATE} was written.`);
}

if (problems.length === 0) {
    console.log(`CURRENT: ${STATE} is generated at ${head} on \`${branch}\`.`);
    process.exit(0);
}

fail([
    `${STATE} IS STALE — do not plan from it until it is regenerated.`,
    ``,
    ...problems,
    ``,
    `Regenerate:  npm run state`,
    `Why it matters: CLAUDE.md tells every agent to read this file FIRST.`,
    `A stale register is finding F5 at the project's entry point.`,
]);
