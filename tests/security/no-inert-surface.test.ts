// ============================================================================
// No inert surface — FR-D2 §5, the binding for target T4
//
// An INERT SURFACE is code that is documented, exposed and tested, but never
// wired to anything. It is the most expensive kind of dead code, because it
// does not read as dead: users and agents change their behaviour on the
// strength of a feature that never executes.
//
// The finding that produced this gate (docs/foundations/02-trust-safety.md,
// D2-C25): `sensitive_data` tells the user and the AI agent that locked records
// are "hidden from cross-instance queries". filterSensitive() and
// isAccessApproved() have zero callers; cross-instance.service.ts contains no
// occurrence of "sensitive" and queries with plain SELECT *. It is documented,
// exposed as three MCP actions, and unit-tested in isolation — so the tests
// passed while the feature was unwired. That is exactly what this suite exists
// to make impossible to repeat quietly.
//
// It would also have caught, earlier and cheaper:
//   - FR-D1 T1: backup.ts held a restore that ABORTS on a failed safety backup,
//     while the live path swallowed the failure. registerBackupTools: 0 callers.
//   - Audit N5: every bounded `limit: .min(1).max(100)` lives in an unreferenced
//     module, while both live dispatchers use `z.number().int().optional()`.
//   - Audit N4: "23% of src/tools is unreachable", measured by hand, once.
//
// HOW IT BINDS. The unreferenced set is compared to a committed baseline, the
// same shape as docs/CAPABILITY-SURFACE.md: a NEW inert module fails CI
// immediately, and REMOVING one fails until someone updates the baseline — as a
// diff a human approves. The baseline is accepted debt, written down, with a
// reason per entry. It is not a permission slip; it is an inventory that cannot
// grow silently.
//
// WHAT THIS DOES NOT CATCH, stated rather than glossed: a module that IS
// referenced but whose feature is still inert further down (a called function
// whose result is discarded). Reachability of the entry point is what is
// mechanised here; the rest is review.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..", "..", "src");

/**
 * Registration entry points that are known to be unreferenced today.
 *
 * This is ACCEPTED DEBT, not approval. Audit finding N4 measured it at ~4,057
 * lines / 23% of src/tools. The v1.6 consolidation replaced fifteen
 * single-purpose tool modules with three dispatchers and left the originals in
 * the tree. Removing them is domain 8's call, not this suite's — but the set may
 * not grow, and the reason each is dangerous to leave is worth naming:
 *
 *   - backup.ts       — its restore is SAFER than the live one (FR-D1 T1)
 *   - export-import.ts — its import is the most dangerous code in the repo:
 *                        JSON.parse of an arbitrary path, `enforced` taken from
 *                        the file, INSERT OR REPLACE over file_notes. Unreachable
 *                        today, which is the only reason it is not a finding.
 *   - changes/conventions/decisions/milestones/scheduler/tasks/knowledge
 *                     — all carry `limit: .min(1).max(100)` bounds that the live
 *                       dispatchers dropped (audit N5, still open)
 *   - intelligence.ts — queries fts_file_notes at :200; cited in observation #62
 *                       as a live call site, which was wrong. It is dead.
 *   - compaction / coordination / file-notes / report / stats
 *                     — superseded by the dispatchers
 */
const KNOWN_INERT = [
    "registerBackupTools",
    "registerChangeTools",
    "registerCompactionTools",
    "registerConventionTools",
    "registerCoordinationTools",
    "registerDecisionTools",
    "registerExportImportTools",
    "registerFileNoteTools",
    "registerIntelligenceTools",
    "registerKnowledgeTools",
    "registerMilestoneTools",
    "registerReportTools",
    "registerSchedulerTools",
    "registerStatsTools",
    "registerTaskTools",
].sort();

function allTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) allTsFiles(full, out);
        else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

/** Every `export function register*` symbol, mapped to the file declaring it. */
function registrationSymbols(files: string[]): Map<string, string> {
    const found = new Map<string, string>();
    for (const file of files) {
        const src = readFileSync(file, "utf-8");
        for (const m of src.matchAll(/export\s+function\s+(register[A-Za-z0-9_]*)\s*\(/g)) {
            found.set(m[1], file);
        }
    }
    return found;
}

/** Symbols with no reference anywhere in src/ outside their own declaring file. */
function unreferenced(symbols: Map<string, string>, files: string[]): string[] {
    const contents = new Map(files.map(f => [f, readFileSync(f, "utf-8")]));
    const dead: string[] = [];
    for (const [symbol, declaredIn] of symbols) {
        const referenced = files.some(f =>
            f !== declaredIn && new RegExp(`\\b${symbol}\\b`).test(contents.get(f)!)
        );
        if (!referenced) dead.push(symbol);
    }
    return dead.sort();
}

describe("no inert surface — registration entry points", () => {
    const files = allTsFiles(SRC);
    const symbols = registrationSymbols(files);

    it("finds the registration entry points at all (guards the detector itself)", () => {
        // A regex that silently stops matching would make every assertion below
        // pass vacuously. Pin the shape: the live dispatchers must be present.
        expect(symbols.size).toBeGreaterThanOrEqual(20);
        for (const live of [
            "registerMemoryDispatcher",
            "registerAdminDispatcher",
            "registerSessionDispatcher",
            "registerFindTool",
            // Lives outside src/tools/ — a first count scoped to that directory
            // missed it and reported the ratio as 15 of 19. Pinned here so a
            // narrowed scan cannot quietly reproduce that error.
            "registerUniversalMode",
        ]) {
            expect([...symbols.keys()]).toContain(live);
        }
    });

    it("has no unreferenced registration beyond the committed baseline", () => {
        const dead = unreferenced(symbols, files);
        const added = dead.filter(s => !KNOWN_INERT.includes(s));

        // The message is the point of the test — a bare array diff would not
        // tell the next person what they are looking at.
        expect(added, added.length === 0 ? "" : [
            "",
            `NEW INERT SURFACE: ${added.join(", ")}`,
            "",
            "These registration functions are declared and exported but never called,",
            "so whatever they expose does not execute. If the feature is real, wire it.",
            "If it is not, delete it — do NOT add it to KNOWN_INERT to make this pass.",
            "The baseline is a record of debt that predates this gate, not a waiver.",
            "See docs/foundations/02-trust-safety.md §5.",
            "",
        ].join("\n")).toEqual([]);
    });

    it("keeps the baseline honest — every entry in it is still genuinely inert", () => {
        const dead = unreferenced(symbols, files);
        const resurrected = KNOWN_INERT.filter(s => symbols.has(s) && !dead.includes(s));
        const vanished = KNOWN_INERT.filter(s => !symbols.has(s));

        // Wiring one up or deleting it is GOOD — this fails so the baseline is
        // updated in the same commit, exactly like docs/CAPABILITY-SURFACE.md.
        expect(
            { resurrected, vanished },
            "A baseline entry changed state. If you wired it up or deleted it, remove it from KNOWN_INERT in this file.",
        ).toEqual({ resurrected: [], vanished: [] });
    });

    it("records the ratio, so the debt is visible rather than merely permitted", () => {
        const dead = unreferenced(symbols, files);
        // Not a threshold that fails — a number that appears in the diff when it
        // moves. 15 of 19 today. A gate that fails on a ratio would be switched
        // off; a number that changes visibly gets discussed.
        expect(dead.length).toBe(KNOWN_INERT.length);
        expect(symbols.size).toBe(20);   // 15 inert of 20 registration entry points
    });
});
