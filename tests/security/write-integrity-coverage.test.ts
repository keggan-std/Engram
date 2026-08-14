// ============================================================================
// Write integrity — COVERAGE. Every live write surface must run the check.
//
// WHY THIS FILE EXISTS, AND IT IS NOT A STYLE RULE.
//
// The malformed-write rejection shipped (task #91, commit 1fbda4b) wired into
// engram_memory's dispatch ALONE. Two live write dispatchers were left
// uncovered, and the one nobody named was the expensive one.
//
// MEASURED on this project's own store, 2026-08-07, with the shipped detector:
// 12 of 61 rows written through engram_session carry the corruption signature —
// 9 of 44 session summaries and 3 of 17 handoffs. Handoffs #8 and #9 arrived
// with next_agent_instructions EMPTY, the entire payload folded into `reason`
// (7,114 and 7,684 characters, against 79-289 for every other handoff). Four
// sessions lost `tags` outright. A handoff is the record the next agent reads
// FIRST, and unlike an observation there is no update_ action to repair it.
//
// So the gap was not "engram_admin is also a write path". It was that the
// project had a per-call-site rule with no mechanism to find call site N+1 —
// the exact defect FR-D5 found in the installer, where a filename rule was
// hand-copied at four sites and the fifth (removal) was simply never written.
//
// This suite is that mechanism. The list of dispatchers is DERIVED from what
// src/index.ts actually registers, so a fifth dispatcher added tomorrow fails
// here until it is covered. It is not a restated list; charter §2 rejects
// those, and a restated list is what would have missed engram_session again.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectMalformedWrite } from "../../src/write-integrity.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// ─── Derivation: what does src/index.ts actually register? ──────────────────

/**
 * Resolve every `registerX(instrumented)` call in index.ts's standard-mode
 * block back to the source file it was imported from.
 *
 * Deliberately keyed on the REGISTRATION SITE and not on a glob of
 * src/tools/*.ts. Most files in that directory are the deliberately frozen
 * dead surface (master plan §5.2, Knight Capital cited) — they register tools
 * that nothing reaches, and requiring a check inside them would pressure an
 * edit to frozen code to make a test go green.
 */
function liveRegistrarModules(): Array<{ fn: string; file: string }> {
    const index = read("src/index.ts");

    const called = new Set<string>();
    for (const m of index.matchAll(/^\s*(register[A-Za-z]+)\(instrumented\);/gm)) {
        called.add(m[1]);
    }
    // Universal mode registers the same three dispatcher handlers through
    // HandlerCapturer (src/modes/universal.ts:104-117), so covering the
    // dispatchers covers universal mode too — it has no write path of its own.
    called.delete("registerUniversalMode");

    expect(called.size, "no registrar calls found in src/index.ts — the derivation broke").toBeGreaterThan(0);

    return [...called].map(fn => {
        const imp = new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(index);
        expect(imp, `no import found for ${fn} in src/index.ts`).not.toBeNull();
        return { fn, file: imp![1].replace(/^\.\//, "src/").replace(/\.js$/, ".ts") };
    });
}

/** Each registerTool( ... ) block in a module, with the bits we assert on. */
interface RegisteredTool {
    name: string;
    readOnly: boolean;
    /** The identifier passed as `inputSchema:`, or null when written inline. */
    schemaConst: string | null;
    /** Source from the handler arrow onwards. */
    handler: string;
}

function registeredTools(file: string): RegisteredTool[] {
    const src = read(file);
    const out: RegisteredTool[] = [];

    for (const m of src.matchAll(/server\.registerTool\(\s*"([a-z_]+)"/g)) {
        const from = m.index!;
        // The tool config object runs from here to the `async (params...` that
        // opens the handler. Everything after that is the handler body.
        const handlerAt = src.indexOf("async (", from);
        expect(handlerAt, `${file}: no handler found for ${m[1]}`).toBeGreaterThan(from);

        const config = src.slice(from, handlerAt);
        const readOnly = /readOnlyHint:\s*true/.test(config);
        const schemaConst = /inputSchema:\s*([A-Z][A-Z0-9_]*)\s*,/.exec(config)?.[1] ?? null;

        // Bound the handler at the next registerTool, or the end of file.
        const nextAt = src.indexOf("server.registerTool(", handlerAt);
        out.push({
            name: m[1],
            readOnly,
            schemaConst,
            handler: src.slice(handlerAt, nextAt === -1 ? undefined : nextAt),
        });
    }
    return out;
}

// ─── The binding ────────────────────────────────────────────────────────────

describe("every live write dispatcher runs the malformed-write check", () => {
    const modules = liveRegistrarModules();

    it("finds the live registrars by derivation, not by a restated list", () => {
        // A sanity floor. If index.ts stops registering these under these
        // names the derivation above is silently returning nothing useful,
        // and every assertion below would vacuously pass — which is
        // observation #125's lesson: a gate that cannot fail is not a gate.
        const files = modules.map(m => m.file);
        expect(files).toContain("src/tools/sessions.ts");
        expect(files).toContain("src/tools/dispatcher-memory.ts");
        expect(files).toContain("src/tools/dispatcher-admin.ts");
    });

    for (const { fn, file } of liveRegistrarModules()) {
        for (const tool of registeredTools(file)) {
            if (tool.readOnly) {
                it(`${tool.name} is read-only, so no check is required (${fn})`, () => {
                    expect(tool.readOnly).toBe(true);
                });
                continue;
            }

            it(`${tool.name} calls detectMalformedWrite before dispatching`, () => {
                expect(
                    tool.handler.includes("detectMalformedWrite("),
                    `${file}: ${tool.name} is a write surface (readOnlyHint: false) and never calls ` +
                    `detectMalformedWrite. Every row it stores is unprotected from ` +
                    `anthropics/claude-code#49747. See src/write-integrity.ts.`,
                ).toBe(true);
            });

            it(`${tool.name} DERIVES its sibling names from its own registered schema`, () => {
                // The whole point. Siblings passed as a hand-written array
                // would go stale the first time a parameter was added, and
                // "a parameter added tomorrow is covered on the same commit"
                // would quietly stop being true.
                expect(
                    tool.schemaConst,
                    `${file}: ${tool.name} passes an inline inputSchema. Name it as a const so ` +
                    `the write-integrity check can derive parameter names from it.`,
                ).not.toBeNull();

                expect(
                    tool.handler.includes(`Object.keys(${tool.schemaConst})`),
                    `${file}: ${tool.name} must pass Object.keys(${tool.schemaConst}) as the sibling ` +
                    `list, not a restated array.`,
                ).toBe(true);
            });
        }
    }
});

// ─── The kill switch, for the two surfaces added here ───────────────────────
//
// Task #77's condition for this feature existing at all: if it rejects a
// well-formed call even once, revert it. These use the REAL parameter names of
// engram_session and engram_admin, and the hardest input this project has —
// its own prose about the bug.

const SESSION_SIBLINGS = [
    "action", "agent_name", "session_id", "parent_session_id", "project_root",
    "resume_task", "verbosity", "focus", "agent_role", "task_id", "intent",
    "summary", "tags", "limit", "offset", "reason", "next_agent_instructions", "id",
];
const ADMIN_SIBLINGS = [
    "action", "output_path", "input_path", "confirm", "scope", "key", "value",
    "instance_id", "type", "query_type", "query", "mode", "types", "label",
    "ids", "status", "reason", "request_id", "resolved_by",
];

const LT = "<";
const closeTag = (n: string) => LT + "/" + n + ">";
const openParam = (n: string) => LT + `parameter name="${n}"` + ">";

describe("kill switch — well-formed session and admin calls must survive", () => {
    it("accepts a long, ordinary session summary", () => {
        const summary =
            "Wired the malformed-write check into engram_session and engram_admin. " +
            "Measured 12 of 61 rows on the session surface carrying the signature; " +
            "handoffs #8 and #9 lost next_agent_instructions entirely. Added a derived " +
            "coverage binding so a fifth dispatcher cannot be forgotten. Suite green, " +
            "tree clean, nothing pushed. ".repeat(12);
        expect(detectMalformedWrite({ action: "end", summary }, SESSION_SIBLINGS)).toBeNull();
    });

    it("accepts a handoff that DESCRIBES the corruption in prose", () => {
        // This repository's handoffs discuss this bug constantly. If writing
        // about it becomes unstorable, the feature has eaten its own record.
        const next_agent_instructions =
            "Convention #7 still holds. The decoder folds a trailing parameter into the " +
            "preceding string, so the " + closeTag("summary") + " marker is what the detector " +
            "looks for at the tail of a value, and prose resuming after it is how a mention " +
            "is told apart from a fold. Do not loosen that rule to fit a test.";
        expect(detectMalformedWrite({ action: "handoff", next_agent_instructions }, SESSION_SIBLINGS)).toBeNull();
    });

    it("accepts an admin config write whose value is ordinary text", () => {
        expect(detectMalformedWrite(
            { action: "config", key: "auto_update_check", value: "true" },
            ADMIN_SIBLINGS,
        )).toBeNull();
    });

    it("accepts a restore confirmation — a rejection here would block recovery", () => {
        // engram_admin owns backup and restore. A false positive on this path
        // fires exactly when someone is already in trouble.
        expect(detectMalformedWrite(
            { action: "restore", input_path: "d:/x/.engram/backups/memory-2026-08-07.db", confirm: "yes-restore" },
            ADMIN_SIBLINGS,
        )).toBeNull();
    });
});

describe("catches the corruption that actually happened on these surfaces", () => {
    it("catches the handoff shape that emptied next_agent_instructions", () => {
        // Reconstructed from handoff #8 in the live store: the instructions
        // folded into `reason` and the real column arrived empty.
        const reason =
            "FR-D3 storage domain complete. Task #35 updated in place with the PROVEN " +
            "verification and the vacuous-check warning." + closeTag("next_agent_instructions");
        const bad = detectMalformedWrite({ action: "handoff", reason }, SESSION_SIBLINGS);
        expect(bad).not.toBeNull();
        expect(bad!.field).toBe("reason");
        expect(bad!.swallowed).toBe("next_agent_instructions");
    });

    it("catches the session-end shape that emptied tags", () => {
        // Reconstructed from sessions #15, #16, #34 and #37 — all four have
        // tags = NULL and a summary ending in this exact markup.
        const summary =
            "Phase 0 complete. All tests pass, tree clean, nothing pushed." +
            closeTag("summary") + "\n" + openParam("tags") + '["foundations-review","phase-0-complete"]';
        const bad = detectMalformedWrite({ action: "end", summary }, SESSION_SIBLINGS);
        expect(bad).not.toBeNull();
        expect(bad!.field).toBe("summary");
        expect(bad!.swallowed).toBe("tags");
    });
});
