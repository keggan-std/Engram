// ============================================================================
// Tests — PM Knowledge Base Public API
// ============================================================================

import { describe, it, expect } from "vitest";
import {
    getPrinciples,
    getPhase,
    getAllPhases,
    getChecklist,
    getInstructions,
    getInstruction,
    getEstimationGuide,
    getPMConventions,
    getPhaseOverview,
    findByTag,
    getKnowledge,
    PRINCIPLES,
    PHASES,
    CHECKLISTS,
    INSTRUCTIONS,
    ESTIMATION_GUIDE,
    PM_CONVENTIONS,
} from "../../src/knowledge/index.js";

// ─── Structural integrity ────────────────────────────────────────────────────

describe("Knowledge base structural integrity", () => {
    it("PRINCIPLES has exactly 5 entries", () => {
        expect(PRINCIPLES).toHaveLength(5);
    });

    it("PHASES has exactly 6 entries numbered 1-6", () => {
        expect(PHASES).toHaveLength(6);
        const numbers = PHASES.map(p => p.number);
        expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("CHECKLISTS has exactly 5 entries (phases 1→2 through 5→6)", () => {
        expect(CHECKLISTS).toHaveLength(5);
        const transitions = CHECKLISTS.map(c => `${c.fromPhase}→${c.toPhase}`);
        expect(transitions).toEqual(["1→2", "2→3", "3→4", "4→5", "5→6"]);
    });

    it("PM_CONVENTIONS has exactly 5 entries", () => {
        expect(PM_CONVENTIONS).toHaveLength(5);
    });

    it("INSTRUCTIONS has entries for all 6 phases", () => {
        const phases = new Set(INSTRUCTIONS.map(i => i.phase).filter(Boolean));
        expect(phases.size).toBe(6);
        for (let p = 1; p <= 6; p++) {
            expect(phases.has(p)).toBe(true);
        }
    });

    it("ESTIMATION_GUIDE has expected structure", () => {
        expect(ESTIMATION_GUIDE.method).toBe("PERT");
        expect(ESTIMATION_GUIDE.formula).toContain("(O + 4M + P)");
        expect(ESTIMATION_GUIDE.commitFormula).toContain("σ");
        expect(ESTIMATION_GUIDE.examples).toHaveLength(3);
    });
});

// ─── Compact field length ─────────────────────────────────────────────────────

describe("Compact field length constraint (≤80 chars)", () => {
    it("all PRINCIPLES compact fields are ≤80 chars", () => {
        for (const p of PRINCIPLES) {
            expect(p.compact.length).toBeLessThanOrEqual(80);
        }
    });

    it("all PHASES compact fields are ≤80 chars", () => {
        for (const p of PHASES) {
            expect(p.compact.length).toBeLessThanOrEqual(80);
        }
    });

    it("all INSTRUCTIONS compact fields are ≤80 chars", () => {
        for (const i of INSTRUCTIONS) {
            expect(i.compact.length).toBeLessThanOrEqual(80);
        }
    });

    it("all PM_CONVENTIONS compact fields are ≤80 chars", () => {
        for (const c of PM_CONVENTIONS) {
            expect(c.compact.length).toBeLessThanOrEqual(80);
        }
    });

    it("ESTIMATION_GUIDE compact field is ≤100 chars", () => {
        expect(ESTIMATION_GUIDE.compact.length).toBeLessThanOrEqual(100);
    });
});

// ─── getPrinciples() ─────────────────────────────────────────────────────────

describe("getPrinciples()", () => {
    it("returns 5 principles", () => {
        expect(getPrinciples()).toHaveLength(5);
    });

    it("compact=true (default) strips full text", () => {
        const results = getPrinciples(true);
        for (const p of results) {
            expect(p.full).toBe("");
        }
    });

    it("compact=false includes full text", () => {
        const results = getPrinciples(false);
        for (const p of results) {
            expect(p.full.length).toBeGreaterThan(0);
        }
    });

    it("all principles have id, compact, tags, locale", () => {
        for (const p of getPrinciples()) {
            expect(p.id).toBeTruthy();
            expect(p.compact).toBeTruthy();
            expect(p.tags.length).toBeGreaterThan(0);
            expect(p.locale).toBe("en");
        }
    });

    it("principle IDs use kebab-case 'principle-' prefix", () => {
        for (const p of getPrinciples()) {
            expect(p.id).toMatch(/^principle-/);
        }
    });
});

// ─── getPhase() + getAllPhases() ──────────────────────────────────────────────

describe("getPhase()", () => {
    it("returns phase 1 (Initiation)", () => {
        const phase = getPhase(1);
        expect(phase).not.toBeNull();
        expect(phase!.name).toBe("initiation");
        expect(phase!.label).toBe("Initiation");
    });

    it("returns phase 3 (Execution)", () => {
        const phase = getPhase(3);
        expect(phase!.name).toBe("execution");
    });

    it("returns phase 6 (Handover)", () => {
        const p = getPhase(6);
        expect(p!.number).toBe(6);
        expect(p!.name).toBe("handover");
    });

    it("returns null for phase 0", () => {
        expect(getPhase(0)).toBeNull();
    });

    it("returns null for phase 7", () => {
        expect(getPhase(7)).toBeNull();
    });

    it("all phases have entry and exit criteria", () => {
        for (let i = 1; i <= 6; i++) {
            const p = getPhase(i)!;
            expect(p.entryCriteria.length).toBeGreaterThan(0);
            expect(p.exitCriteria.length).toBeGreaterThan(0);
        }
    });
});

describe("getAllPhases()", () => {
    it("returns all 6 phases", () => {
        expect(getAllPhases()).toHaveLength(6);
    });
});

// ─── getChecklist() ───────────────────────────────────────────────────────────

describe("getChecklist()", () => {
    it("returns gate 1→2 checklist with mandatory and optional items", () => {
        const cl = getChecklist(1);
        expect(cl).not.toBeNull();
        expect(cl!.fromPhase).toBe(1);
        expect(cl!.toPhase).toBe(2);
        expect(cl!.items.length).toBeGreaterThan(0);
        expect(cl!.items.some(i => i.mandatory)).toBe(true);
    });

    it("returns gate 3→4 checklist", () => {
        const cl = getChecklist(3);
        expect(cl!.fromPhase).toBe(3);
        expect(cl!.toPhase).toBe(4);
    });

    it("returns null for phase 6 (no next phase)", () => {
        expect(getChecklist(6)).toBeNull();
    });

    it("returns null for out-of-range phase", () => {
        expect(getChecklist(0)).toBeNull();
        expect(getChecklist(99)).toBeNull();
    });

    it("all checklist items have unique IDs within their checklist", () => {
        for (let p = 1; p <= 5; p++) {
            const cl = getChecklist(p)!;
            const ids = cl.items.map(i => i.id);
            const unique = new Set(ids);
            expect(unique.size).toBe(ids.length);
        }
    });
});

// ─── getInstructions() ────────────────────────────────────────────────────────

describe("getInstructions()", () => {
    it("returns instructions for phase 1", () => {
        const results = getInstructions(1);
        expect(results.length).toBeGreaterThan(0);
    });

    it("compact=true (default) strips full text", () => {
        const results = getInstructions(3, true);
        for (const i of results) {
            expect(i.full).toBe("");
        }
    });

    it("compact=false includes full text", () => {
        const results = getInstructions(3, false);
        for (const i of results) {
            expect(i.full.length).toBeGreaterThan(0);
        }
    });

    it("returns empty array for out-of-range phase", () => {
        expect(getInstructions(99)).toHaveLength(0);
    });
});

describe("getInstruction()", () => {
    it("returns a specific instruction by ID", () => {
        const inst = getInstruction("inst-3-changes");
        expect(inst).not.toBeNull();
        expect(inst!.phase).toBe(3);
    });

    it("returns null for unknown ID", () => {
        expect(getInstruction("non-existent-id")).toBeNull();
    });
});

// ─── getEstimationGuide() ──────────────────────────────────────────────────────

describe("getEstimationGuide()", () => {
    it("compact=true returns guide without examples", () => {
        const guide = getEstimationGuide(true) as Record<string, unknown>;
        expect(guide.method).toBe("PERT");
        expect(guide).not.toHaveProperty("examples");
    });

    it("compact=false includes examples", () => {
        const guide = getEstimationGuide(false);
        expect(guide).toHaveProperty("examples");
    });

    it("PERT formula is correct", () => {
        const guide = getEstimationGuide(false);
        expect(guide.formula).toContain("(O + 4M + P)");
        expect(guide.formula).toContain("/ 6");
    });

    it("commit formula references sigma", () => {
        const guide = getEstimationGuide(false);
        expect(guide.commitFormula).toContain("σ");
    });

    it("examples have correct PERT math", () => {
        const guide = getEstimationGuide(false);
        for (const ex of guide.examples) {
            const expectedE = (ex.optimistic + 4 * ex.mostLikely + ex.pessimistic) / 6;
            expect(ex.expected).toBeCloseTo(expectedE, 1);
            const expectedSigma = (ex.pessimistic - ex.optimistic) / 6;
            expect(ex.sigma).toBeCloseTo(expectedSigma, 1);
            expect(ex.commit).toBeCloseTo(ex.mostLikely + expectedSigma, 1);
        }
    });
});

// ─── getPMConventions() ────────────────────────────────────────────────────────

describe("getPMConventions()", () => {
    it("returns 5 conventions", () => {
        expect(getPMConventions()).toHaveLength(5);
    });

    it("strips full text (compact delivery)", () => {
        for (const c of getPMConventions()) {
            expect(c.full).toBe("");
        }
    });

    it("all conventions have category 'convention'", () => {
        for (const c of getPMConventions()) {
            expect(c.category).toBe("convention");
        }
    });

    it("convention IDs use 'pmconv-' prefix", () => {
        for (const c of getPMConventions()) {
            expect(c.id).toMatch(/^pmconv-/);
        }
    });
});

// ─── getPhaseOverview() ───────────────────────────────────────────────────────

describe("getPhaseOverview()", () => {
    it("returns overview for phase 2 with instructions", () => {
        const ov = getPhaseOverview(2);
        expect(ov).not.toBeNull();
        expect(ov!.phase).toBe(2);
        expect(ov!.name).toBe("planning");
        expect(ov!.instructionSummaries.length).toBeGreaterThan(0);
        // All instruction summaries should be compact (≤80 chars)
        for (const s of ov!.instructionSummaries) {
            expect(s.length).toBeLessThanOrEqual(80);
        }
    });

    it("returns null for invalid phase", () => {
        expect(getPhaseOverview(0)).toBeNull();
        expect(getPhaseOverview(7)).toBeNull();
    });

    it("includes entry and exit criteria", () => {
        const ov = getPhaseOverview(3)!;
        expect(ov.entryCriteria.length).toBeGreaterThan(0);
        expect(ov.exitCriteria.length).toBeGreaterThan(0);
    });
});

// ─── findByTag() ──────────────────────────────────────────────────────────────

describe("findByTag()", () => {
    it("finds entries tagged with 'risk'", () => {
        const results = findByTag("risk");
        expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown tag", () => {
        const results = findByTag("xyzunknowntagabc123");
        expect(results).toHaveLength(0);
    });

    it("is case-insensitive", () => {
        const lower = findByTag("risk");
        const upper = findByTag("RISK");
        expect(lower.length).toBe(upper.length);
    });

    it("strips full text from results", () => {
        const results = findByTag("planning");
        for (const r of results) {
            expect(r.full).toBe("");
        }
    });
});

// ─── getKnowledge() dispatcher ────────────────────────────────────────────────

describe("getKnowledge() dispatcher", () => {
    it("type='principles' returns principles array", () => {
        const result = getKnowledge("principles") as { principles: unknown[] };
        expect(result.principles).toHaveLength(5);
    });

    it("type='phase_info' with phase=2 returns phase overview", () => {
        const result = getKnowledge("phase_info", 2) as { phase: number; name: string };
        expect(result.phase).toBe(2);
        expect(result.name).toBe("planning");
    });

    it("type='phase_info' without phase returns error", () => {
        const result = getKnowledge("phase_info") as { error: string };
        expect(result.error).toBeTruthy();
    });

    it("type='checklist' with phase=3 returns checklist", () => {
        const result = getKnowledge("checklist", 3) as { items: unknown[] };
        expect(result).toHaveProperty("items");
    });

    it("type='checklist' without phase returns error", () => {
        const result = getKnowledge("checklist") as { error: string };
        expect(result.error).toBeTruthy();
    });

    it("type='instructions' with phase=1 returns instructions", () => {
        const result = getKnowledge("instructions", 1) as { instructions: unknown[] };
        expect(result.instructions.length).toBeGreaterThan(0);
    });

    it("type='estimation' returns PERT guide", () => {
        const result = getKnowledge("estimation") as { method: string };
        expect(result.method).toBe("PERT");
    });

    it("type='conventions' returns PM conventions", () => {
        const result = getKnowledge("conventions") as { pm_conventions: unknown[] };
        expect(result.pm_conventions).toHaveLength(5);
    });

    it("type='all' with phase returns all knowledge categories", () => {
        const result = getKnowledge("all", 2) as Record<string, unknown>;
        expect(result).toHaveProperty("principles");
        expect(result).toHaveProperty("estimation");
        expect(result).toHaveProperty("pm_conventions");
        expect(result).toHaveProperty("phase_info");
        expect(result).toHaveProperty("checklist");
        expect(result).toHaveProperty("instructions");
    });

    it("type='all' without phase skips phase-specific entries", () => {
        const result = getKnowledge("all") as Record<string, unknown>;
        expect(result).toHaveProperty("principles");
        expect(result).not.toHaveProperty("phase_info");
    });
});
