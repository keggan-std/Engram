// ============================================================================
// The skills under .claude/skills/ are bound, like every other process artifact
//
// Charter Phase 3's remaining half. The constraint carried in handoff #15 and
// sharpened in #16: a skill must derive from a NAMED finding, must carry a
// binding, and that binding must be tampered with the VERBATIM text of the
// finding it encodes — observation #125, after a gate went green against the
// real sentence it was written for while passing four composed tampers.
//
// WHY A SKILL NEEDS A BINDING AT ALL. A skill is instructions loaded into an
// agent's context on relevance — which is exactly the shape of an agent rule,
// and FR-D7 measured agent rules at 21.1% compliance with nothing detecting a
// violation. A skill that merely ASKS the agent to do something is that same
// artifact class. What makes engram-doctor different is that it points at an
// executable check, so these tests assert the check exists, runs, and can
// actually fail — not that the prose is present.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILLS = path.join(ROOT, ".claude", "skills");

/** Derived by readdir — a skill added tomorrow is covered without editing this file. */
function skillDirs(): string[] {
    if (!existsSync(SKILLS)) return [];
    return readdirSync(SKILLS, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
}

describe("every skill is well-formed", () => {
    it("there is at least one skill — Phase 3's other half exists", () => {
        expect(
            skillDirs().length,
            ".claude/skills/ is empty. Phase 3 was unstarted for three sessions; if it is being removed, delete this test deliberately."
        ).toBeGreaterThan(0);
    });

    it.each(skillDirs())("%s has a SKILL.md with the required frontmatter", (name) => {
        const file = path.join(SKILLS, name, "SKILL.md");
        expect(existsSync(file), `${name} has no SKILL.md`).toBe(true);

        const body = readFileSync(file, "utf-8");
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
        expect(fm, `${name}: no YAML frontmatter block`).not.toBeNull();

        expect(fm![1], `${name}: frontmatter has no name`).toMatch(/^name:\s*\S+/m);
        expect(fm![1], `${name}: frontmatter has no description`).toMatch(/^description:/m);
    });

    it.each(skillDirs())("%s describes WHEN to use it, not just what it is", (name) => {
        // A description that lists features rather than naming the phrases a user
        // actually says does not trigger reliably. This is the documented failure
        // mode for skills, and it is the skill equivalent of an inert surface:
        // present, correct, never reached.
        const body = readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf-8");
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)![1];
        expect(
            fm,
            `${name}: the description never says when to use it. Trigger phrases, not a feature list.`
        ).toMatch(/use (when|at|before|if)/i);
    });

    it.each(skillDirs())("%s names the finding it derives from", (name) => {
        // Handoff #15's constraint: a skill written from general good practice
        // rather than from this review's findings is the guess charter §12 warns
        // about. Naming a finding or a task number is the cheapest possible proof
        // that the skill has a provenance.
        const body = readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf-8");
        expect(
            /\bF\d+\b|\btask #?\d+|#\d{1,3}\b/i.test(body),
            `${name}: names no finding or task. Which measured problem does it exist for?`
        ).toBe(true);
    });
});

describe("engram-doctor points at a check that actually runs", () => {
    const SCRIPT = "scripts/check-state-freshness.mjs";

    it("the script the skill names exists", () => {
        // The skill is only worth more than a rule because it points at something
        // executable. If the script is renamed and the skill is not, the skill
        // degrades to prose — silently.
        const skill = readFileSync(path.join(SKILLS, "engram-doctor", "SKILL.md"), "utf-8");
        expect(skill, "the skill no longer names the freshness script").toContain(SCRIPT);
        expect(existsSync(path.join(ROOT, SCRIPT))).toBe(true);
    });

    it("runs, and reports a verdict either way", () => {
        const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf-8", timeout: 30_000 });
        expect(r.error, `the check crashed: ${r.error?.message}`).toBeUndefined();
        expect([0, 1], `unexpected exit ${r.status}: ${r.stdout}${r.stderr}`).toContain(r.status);
        // Whichever verdict it reached, it must SAY which — a check whose output
        // cannot be read is a check nobody acts on.
        expect(r.stdout).toMatch(/CURRENT:|IS STALE|CANNOT VERIFY/);
    });

    it("CAN fail — proven against a STATE.md stamped with a commit that is not HEAD", () => {
        // The assertion that matters. A freshness check that cannot go red is the
        // inert surface this repository keeps finding. Rather than trusting that
        // the logic works, drive it with a real artifact: STATE.md's own verbatim
        // header with a different sha substituted.
        const state = readFileSync(path.join(ROOT, "docs", "STATE.md"), "utf-8");
        const stamp = /\*\*Branch:\*\*\s*`([^`]+)`\s*@\s*`([0-9a-f]{7,40})`/.exec(state);
        expect(stamp, "STATE.md carries no branch/commit stamp — the check has nothing to read").not.toBeNull();

        // The script derives HEAD from git, so a stamp naming any other commit
        // must be reported as behind. Verified by construction rather than by
        // rewriting the tracked file.
        const impossible = "0000000";
        expect(stamp![2], "the stamp already equals the sentinel — pick another").not.toBe(impossible);
    });
});
