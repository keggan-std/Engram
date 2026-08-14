// ============================================================================
// Every parameter engram_memory ADVERTISES must be READ by something
//
// TASK #103. engram_memory takes ONE flat Zod schema for ~40 actions, so every
// parameter validates for every action and the schema can never say "not for
// this one". Three parameters were declared and consumed by nothing on the
// path that advertised them, each failing silently and each failing WIDE:
//
//   get_tasks       accepted `query`   — SQL built from status/priority/tag only
//   get_tasks       accepted `compact` — full descriptions shipped regardless.
//                   MEASURED 2026-08-13: {compact:true, limit:60} returned
//                   120,020 characters and overflowed the tool result.
//   get_file_notes  accepted `file_path_filter` — wired to get_decisions alone.
//                   Returned all 96 notes at 99,655 characters, on the call
//                   made specifically to keep the read small.
//
// WHY THE EXISTING GATE CANNOT CATCH THIS, and this is the point of the file.
// scripts/generate-capability-surface.mjs derives from the Zod schemas, and the
// Zod schemas are ACCURATE — the parameter really is declared. The divergence
// is between schema and HANDLER, and nothing read both. This suite is the thing
// that reads both.
//
// DERIVED, NOT RESTATED. A hand-kept map of action -> parameters would be the
// same defect one layer up, and this project has hit that shape four times
// (installer filename rule FR-D5, addToConfig #127, the cross-instance
// whitelist F4, the FTS trigger set #35). Both sides are read out of the source
// at test time: the declared side from the schema literal, the consumed side
// from `params.<name>` occurrences in the same file.
//
// HONEST ABOUT ITS CEILING. This is a whole-file check, not a per-action one.
// It proves a declared parameter is read SOMEWHERE, which would not by itself
// have caught `file_path_filter` being read by the wrong action. Per-action
// attribution needs the handler split into case blocks and each block's reads
// attributed, which is defeated by the shared helpers above the switch. What
// this DOES catch is the cheapest and commonest form: a parameter added to the
// schema and never wired to anything. The remaining half is recorded on #103.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Parameter names from a `const X_INPUT_SCHEMA = { ... }` literal.
 *
 * Keyed off the schema const the dispatcher actually registers, so a renamed
 * or added parameter is covered the day it lands — the same derivation
 * tests/security/write-integrity-coverage.test.ts uses for its sibling list.
 */
function declaredParams(source: string, constName: string): string[] {
    const start = source.indexOf(`const ${constName}`);
    expect(start, `${constName} not found — was it renamed?`).toBeGreaterThan(-1);
    const open = source.indexOf("{", start);
    expect(open, `${constName} has no opening brace`).toBeGreaterThan(start);

    // Depth-aware, because indentation is not. `changes` is
    // z.array(z.object({ file_path, change_type, ... })) and its ITEM fields
    // are not top-level parameters — an indentation-based scan reported three
    // of them as inert on the first run of this suite, which would have sent
    // someone to "fix" a schema that was correct.
    // Depth is sampled at the START of each line, not the end. A top-level key
    // whose value OPENS nesting — `changes: z.array(z.object({` — sits at depth
    // 1 when the line begins and depth 4 when it ends, so an end-of-line sample
    // silently drops exactly the parameters most worth checking.
    const names: string[] = [];
    let depth = 0;
    let line = "";
    let depthAtLineStart = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === "\n") {
            if (depthAtLineStart === 1) {
                const m = line.match(/^\s*(\w+)\s*:\s*z\./);
                if (m) names.push(m[1]);
            }
            line = "";
            depthAtLineStart = depth;
            continue;
        }
        line += ch;
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") {
            depth--;
            if (depth === 0) break;
        }
    }
    return names;
}

/** Parameter names actually read out of `params` anywhere in the file. */
function consumedParams(source: string): Set<string> {
    const names = new Set<string>();
    // params.foo   /   params["foo"]   /   params?.foo
    for (const m of source.matchAll(/\bparams\??\.(\w+)/g)) names.add(m[1]);
    for (const m of source.matchAll(/\bparams\??\[["'](\w+)["']\]/g)) names.add(m[1]);
    // Destructured: const { a, b } = params
    for (const m of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*params\b/g)) {
        for (const piece of m[1].split(",")) {
            const name = piece.split(":")[0].trim();
            if (name) names.add(name);
        }
    }
    return names;
}

describe("FR-D7 / task #103 — the schema may not advertise what nothing reads", () => {
    it("every parameter engram_memory declares is consumed by its handler", () => {
        const source = read("src/tools/dispatcher-memory.ts");
        const declared = declaredParams(source, "MEMORY_INPUT_SCHEMA");
        const consumed = consumedParams(source);

        expect(declared.length, "the schema literal parsed to zero parameters — the parser broke, not the schema")
            .toBeGreaterThan(20);

        const inert = declared.filter(p => !consumed.has(p));

        expect(
            inert,
            `These parameters are ADVERTISED to every agent and READ BY NOTHING. An ` +
            `agent that passes one gets no error and a wider result than it asked ` +
            `for — task #103's two measured instances both overflowed a tool result ` +
            `on a call made to keep the read small. Either wire the parameter to a ` +
            `handler, or delete it from the schema. Do not add it to an exception ` +
            `list: a hand-kept exception list is the same defect one layer up.`,
        ).toEqual([]);
    });

    it("engram_admin declares nothing it does not read either", () => {
        const source = read("src/tools/dispatcher-admin.ts");
        const match = source.match(/const (\w*INPUT_SCHEMA)/);
        expect(match, "no *INPUT_SCHEMA const in dispatcher-admin.ts").toBeTruthy();

        const declared = declaredParams(source, match![1]);
        const consumed = consumedParams(source);
        expect(declared.filter(p => !consumed.has(p))).toEqual([]);
    });

    it("the parser can actually fail — a fabricated parameter is caught", () => {
        // Guards the degenerate pass. If declaredParams() silently returned []
        // or consumedParams() returned everything, the tests above would be
        // green over a broken check — the inert-surface defect this suite
        // exists to stop, reproduced inside the suite itself.
        const fake = [
            "const FAKE_INPUT_SCHEMA = {",
            "        realOne: z.string().optional(),",
            "        neverRead: z.number().int().optional(),",
            "  } as const;",
            "function h(params: any) { return params.realOne; }",
        ].join("\n");

        expect(declaredParams(fake, "FAKE_INPUT_SCHEMA").sort()).toEqual(["neverRead", "realOne"]);
        expect([...consumedParams(fake)]).toEqual(["realOne"]);
    });

    it("nested object fields are NOT counted as top-level parameters", () => {
        // The first run of this suite reported change_type, diff_summary and
        // impact_scope as inert. They are fields of the `changes` ARRAY ITEM,
        // and an indentation-based scan cannot tell those from top-level keys.
        // A false positive here sends someone to fix a schema that is correct,
        // so the discriminator gets its own test.
        const fake = [
            "const NESTED_INPUT_SCHEMA = {",
            "        top: z.string().optional(),",
            "        changes: z.array(z.object({",
            "          inner: z.string(),",
            "        })).optional(),",
            "  } as const;",
        ].join("\n");

        expect(declaredParams(fake, "NESTED_INPUT_SCHEMA")).toEqual(["top", "changes"]);
    });
});
