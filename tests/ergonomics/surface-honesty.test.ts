// ============================================================================
// Surface honesty — FR-D7's §5 binding
//
// Domain 7 owns the agent's experience of the tool surface: the action count,
// selection accuracy, token cost per tier, the agent rules, catalog tiering.
// Its finding is that the surface DESCRIBES ITSELF INACCURATELY, and that the
// eight agent rules are replayed into every agent's context at every session
// start while nothing whatsoever enforces them. Measured: 24 of the 114 distinct
// files this project has edited since it started using Engram on itself ever got
// a `changes` row — 21.1% compliance with AR-01, which is priority CRITICAL.
//
// WHY THESE ASSERTIONS AND NOT OTHERS.
//
// "Compliance is low" cannot be a test — it is a property of agents, not of this
// repo, and a CI job cannot observe it. So this suite binds the two things that
// CAN drift silently in source and that the finding actually rests on:
//
//   1. THE RULE REGISTRY. Every entry in AGENT_RULES must be classified here as
//      either enforced-by-a-named-mechanism or explicitly UNENFORCED against a
//      task number. Adding a ninth rule fails this suite until someone decides
//      which it is. That is the point: the project's repeated finding is that a
//      rule shipped without a mechanism changes nothing, and this is the gate
//      that stops another one being added on the assumption that it will.
//      A "mechanism" is checked by resolving it in source, so a registry entry
//      naming a function that has been deleted or renamed fails too.
//
//   2. SELF-DESCRIPTION. Each dispatcher advertises its own action list in the
//      description string an agent reads before choosing to call it. Those lists
//      have drifted out of sync with the enums they describe. An action missing
//      from the description is an action a non-`engram_find`-using agent may
//      never learn exists, and the catalog-tiering feature — which deliberately
//      sends LESS on repeat contact — rests on the assumption that the full
//      surface was communicated on first contact.
//
// A count assertion ("there are 83 actions") was deliberately rejected: it
// passes for a surface that is complete and wrong, and it fails for every
// legitimate addition, which is how a gate gets switched off. Every list here is
// DERIVED from the source of truth, never restated.
//
// PINNED DEFECTS. Per the D3/D6 precedent, assertions marked `DEFECT:` assert
// TODAY'S WRONG VALUE against a named task. They are not describing intended
// behaviour. The suite must never sit green over a known bug, so fixing the bug
// BREAKS the test and forces the assertion to be edited in the same commit a
// human reviews.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_RULES, MEMORY_CATALOG, ADMIN_CATALOG } from "../../src/tools/find.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8");

const memorySrc = read("tools/dispatcher-memory.ts");
const adminSrc = read("tools/dispatcher-admin.ts");

/**
 * Pull an action enum out of a dispatcher's source rather than importing it —
 * these arrays are `as const` locals, and reading the text is what makes the
 * test fail when the array and the description drift apart, which is the whole
 * subject of this file.
 */
function actionsFrom(src: string, constName: string): string[] {
    const m = src.match(new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) throw new Error(`could not locate ${constName} — the binding cannot run`);
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** The description string an agent actually reads when deciding to call a tool. */
function descriptionFrom(src: string): string {
    const m = src.match(/description:\s*`([\s\S]*?)`/);
    if (!m) throw new Error("could not locate the dispatcher description");
    return m[1];
}

// ─── 1. The rule registry ───────────────────────────────────────────────────

/**
 * Every agent rule, classified. `mechanism` names something that must resolve in
 * source. `UNENFORCED` records the honest state against the task that owns it.
 *
 * DO NOT add a rule to AGENT_RULES without adding it here. That coupling is the
 * binding.
 */
const RULE_ENFORCEMENT: Record<string, { mechanism: string; file: string } | { unenforced: string }> = {
    // A soft nudge, not enforcement: session-scoped, in-memory, capped at 5 per
    // session, never keyed to the rule id, and silently disabled by config. It
    // is registered here because it exists and must not be deleted unnoticed —
    // not because it makes AR-01 enforced. AR-01 measured 21.1%.
    "AR-01": { mechanism: "checkUnrecordedEdits", file: "services/workflow-advisor.service.ts" },
    "AR-02": { mechanism: "checkMissingFileNotes", file: "services/workflow-advisor.service.ts" },
    "AR-03": { unenforced: "task #69 — nothing observes process exit; 27 of 34 sessions ended" },
    "AR-04": { mechanism: "checkUnrecordedDecisions", file: "services/workflow-advisor.service.ts" },
    "AR-05": { mechanism: "checkUnrecordedDecisions", file: "services/workflow-advisor.service.ts" },
    "AR-06": { unenforced: "task #69 — executive_summary is never required, checked, or counted" },
    "AR-07": { unenforced: "task #69 — impact_scope accuracy is unverifiable by construction" },
    "AR-08": { unenforced: "task #69 — nothing detects a missing checkpoint" },
};

describe("FR-D7 §5 — agent rules cannot ship without a decision about enforcement", () => {
    it("every rule in AGENT_RULES is classified in the registry", () => {
        const missing = AGENT_RULES.filter((r) => !(r.id in RULE_ENFORCEMENT)).map((r) => r.id);
        expect(
            missing,
            `Rule(s) ${missing.join(", ")} were added to AGENT_RULES with no entry in RULE_ENFORCEMENT. ` +
            `Decide: name the mechanism that makes the rule true, or record it as UNENFORCED against a task. ` +
            `A rule with neither is text that costs tokens on every session start and changes nothing — ` +
            `this project has measured that at 21.1% for AR-01.`
        ).toEqual([]);
    });

    it("the registry has no entries for rules that no longer exist", () => {
        const ids = new Set(AGENT_RULES.map((r) => r.id));
        expect([...Object.keys(RULE_ENFORCEMENT)].filter((k) => !ids.has(k))).toEqual([]);
    });

    it("every named mechanism actually resolves in source", () => {
        for (const [id, entry] of Object.entries(RULE_ENFORCEMENT)) {
            if ("unenforced" in entry) continue;
            const src = read(entry.file);
            expect(
                src.includes(entry.mechanism),
                `${id} claims enforcement by ${entry.mechanism} in ${entry.file}, and it is not there. ` +
                `Either the mechanism was renamed or removed — in which case the rule is now unenforced and ` +
                `the registry must say so.`
            ).toBe(true);
        }
    });

    it("DEFECT: no CRITICAL rule has a hard mechanism — task #69", () => {
        // Pinned. AR-01/02 have a capped, session-scoped, config-disablable text
        // nudge; AR-03 has nothing. If a real mechanism lands, this breaks and
        // the assertion must be edited in the same commit.
        const critical = AGENT_RULES.filter((r) => r.priority === "CRITICAL").map((r) => r.id);
        expect(critical).toEqual(["AR-01", "AR-02", "AR-03"]);
        const advisor = read("services/workflow-advisor.service.ts");
        expect(advisor).toMatch(/PM_MAX_NUDGES|maxNudges/);
        expect(RULE_ENFORCEMENT["AR-03"]).toHaveProperty("unenforced");
    });
});

// ─── 2. Self-description ────────────────────────────────────────────────────

describe("FR-D7 §5 — a dispatcher must enumerate its own actions truthfully", () => {
    const cases = [
        { tool: "engram_memory", src: memorySrc, constName: "MEMORY_ACTIONS", catalog: MEMORY_CATALOG },
        { tool: "engram_admin", src: adminSrc, constName: "ADMIN_ACTIONS", catalog: ADMIN_CATALOG },
    ];

    for (const c of cases) {
        it(`${c.tool}: every action is reachable through engram_find`, () => {
            const actions = actionsFrom(c.src, c.constName);
            const missing = actions.filter((a) => !(a in c.catalog));
            expect(
                missing,
                `${c.tool} action(s) ${missing.join(", ")} have no engram_find catalog entry. ` +
                `The README instructs agents to "use engram_find when unsure which action to call — never ` +
                `guess parameter names". For these actions that instruction is a dead end.`
            ).toEqual([]);
        });

        it(`${c.tool}: DEFECT — its description omits actions from its own enum (task #70)`, () => {
            const actions = actionsFrom(c.src, c.constName);
            const desc = descriptionFrom(c.src);
            const omitted = actions.filter((a) => !desc.includes(a));
            // Pinned at today's wrong value. When the descriptions are fixed this
            // fails, and the fix must change the expectation here in the same commit.
            const expected: Record<string, string[]> = {
                engram_memory: ["get_knowledge"],
                engram_admin: [
                    "install_hooks", "remove_hooks", "generate_report", "get_global_knowledge",
                    "get_instance_info", "import_from_instance", "set_instance_label",
                ],
            };
            expect(
                omitted.sort(),
                `${c.tool}'s advertised action list drifted from its enum. An action absent from the ` +
                `description is one an agent that never calls engram_find may never learn exists — and ` +
                `catalog tiering deliberately sends LESS on repeat contact, on the assumption that first ` +
                `contact was complete.`
            ).toEqual(expected[c.tool].sort());
        });
    }
});

// ─── 3. The advertised call shape must be the working one ───────────────────

describe("FR-D7 §5 — the schema must not advertise parameters an action cannot use", () => {
    it("DEFECT: one flattened schema serves every action — task #71", () => {
        // engram_memory declares every parameter of all 38 actions as an optional
        // top-level field, so the schema an agent reads advertises ~79 parameters
        // for an action that accepts one. `record_change` is the measured case:
        // `file_path`, `change_type` and `description` are all present at the top
        // level and all ignored — the handler requires a `changes` ARRAY and
        // rejects everything else. FR-D7 hit this on its first write of the
        // session, having just read a warning about the surface.
        const schema = memorySrc.slice(memorySrc.indexOf("inputSchema: {"));
        const topLevel = [...schema.matchAll(/^ {8}([a-z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]);
        expect(topLevel).toContain("file_path");
        expect(topLevel).toContain("description");
        expect(topLevel).toContain("changes");
        expect(topLevel.length).toBeGreaterThan(70);

        // The handler's rejection is the proof that the flat form does not work.
        expect(memorySrc).toContain('return error("changes array required.")');

        // And the tool's own description concedes the schema is not authoritative.
        expect(descriptionFrom(memorySrc)).toContain("engram_find");
    });

    it("DEFECT: update_task advertises `owner`, which is not a column — task #72", () => {
        // It writes to `claimed_by`, conflating "assigned owner" with "atomic
        // claim lock". Two concepts, one advertised name.
        expect(memorySrc).toMatch(/owner:\s*z\.string\(\)\.optional\(\)/);
        expect(memorySrc).toMatch(/claimed_by\s*=\s*\?/);
        expect(memorySrc).not.toMatch(/\bowner\s+TEXT\b/);
    });
});
