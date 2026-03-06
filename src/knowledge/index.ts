// ============================================================================
// Engram — PM Knowledge Base: Public API
// ============================================================================
//
// All PM knowledge is accessed through this module. Do not import individual
// knowledge files directly — use this API so callers are decoupled from
// internal structure.
//
// IMPORTANT: Never throw from this module. Return null/empty on any failure.
// All callers use pmSafe() regardless, but defense-in-depth here protects
// against future misuse.

export type { KnowledgeEntry, PhaseDefinition, ChecklistItem, PhaseChecklist, EstimationGuide } from "./types.js";

export { PRINCIPLES } from "./principles.js";
export { PHASES } from "./phases.js";
export { CHECKLISTS } from "./checklists.js";
export { INSTRUCTIONS } from "./instructions.js";
export { ESTIMATION_GUIDE } from "./estimation.js";
export { PM_CONVENTIONS } from "./conventions.js";

import { PRINCIPLES } from "./principles.js";
import { PHASES } from "./phases.js";
import { CHECKLISTS } from "./checklists.js";
import { INSTRUCTIONS } from "./instructions.js";
import { ESTIMATION_GUIDE } from "./estimation.js";
import { PM_CONVENTIONS } from "./conventions.js";
import type { KnowledgeEntry, PhaseDefinition, PhaseChecklist } from "./types.js";

// ─── Querying API ─────────────────────────────────────────────────────────────

/**
 * Get all 5 core PM principles.
 * @param compact When true (default), returns compact forms only.
 */
export function getPrinciples(compact: boolean = true): KnowledgeEntry[] {
    if (compact) {
        return PRINCIPLES.map(p => ({ ...p, full: "" }));
    }
    return PRINCIPLES;
}

/**
 * Get a specific phase definition by phase number (1-6).
 * Returns null if the phase number is out of range.
 */
export function getPhase(phaseNumber: number): PhaseDefinition | null {
    return PHASES.find(p => p.number === phaseNumber) ?? null;
}

/**
 * Get all phase definitions.
 */
export function getAllPhases(): PhaseDefinition[] {
    return PHASES;
}

/**
 * Get the phase gate checklist for transitioning FROM a given phase number.
 * e.g., getChecklist(2) returns the Gate 2→3 checklist.
 * Returns null if no checklist exists for that transition.
 */
export function getChecklist(fromPhase: number): PhaseChecklist | null {
    return CHECKLISTS.find(c => c.fromPhase === fromPhase) ?? null;
}

/**
 * Get per-phase instruction entries for a specific phase.
 * @param phaseNumber  Phase number 1-6.
 * @param compact      When true (default), strips the `full` text for token savings.
 */
export function getInstructions(phaseNumber: number, compact: boolean = true): KnowledgeEntry[] {
    const entries = INSTRUCTIONS.filter(i => i.phase === phaseNumber);
    if (compact) {
        return entries.map(e => ({ ...e, full: "" }));
    }
    return entries;
}

/**
 * Get a single instruction entry by ID.
 * @param id  Instruction ID (e.g., "inst-3-changes").
 */
export function getInstruction(id: string): KnowledgeEntry | null {
    return INSTRUCTIONS.find(i => i.id === id) ?? null;
}

/**
 * Get PERT estimation guidance.
 * @param compact When true, returns compact form only (skips worked examples).
 */
export function getEstimationGuide(compact: boolean = true) {
    if (compact) {
        return {
            method: ESTIMATION_GUIDE.method,
            formula: ESTIMATION_GUIDE.formula,
            commitFormula: ESTIMATION_GUIDE.commitFormula,
            compact: ESTIMATION_GUIDE.compact,
        };
    }
    return ESTIMATION_GUIDE;
}

/**
 * Get PM principle conventions for PM-Full session start injection.
 * Returns compact forms only (optimised for session delivery).
 */
export function getPMConventions(): KnowledgeEntry[] {
    return PM_CONVENTIONS.map(c => ({ ...c, full: "" }));
}

/**
 * Get combined compact phase overview: phase definition + instruction summaries.
 * Used for session start injection when phase is detected.
 *
 * @param phaseNumber  Phase number 1-6.
 * @returns Compact phase info object, or null if phase not found.
 */
export function getPhaseOverview(phaseNumber: number): {
    phase: number;
    name: string;
    label: string;
    compact: string;
    entryCriteria: string[];
    exitCriteria: string[];
    instructionSummaries: string[];
} | null {
    const phase = getPhase(phaseNumber);
    if (!phase) return null;
    const instructions = getInstructions(phaseNumber, true);
    return {
        phase: phase.number,
        name: phase.name,
        label: phase.label,
        compact: phase.compact,
        entryCriteria: phase.entryCriteria,
        exitCriteria: phase.exitCriteria,
        instructionSummaries: instructions.map(i => i.compact),
    };
}

/**
 * Query knowledge entries by tag (fuzzy includes match).
 * Returns matching entries from principles, phases, and instructions.
 */
export function findByTag(tag: string): KnowledgeEntry[] {
    const lowerTag = tag.toLowerCase();
    const results: KnowledgeEntry[] = [];

    for (const p of PRINCIPLES) {
        if (p.tags.some(t => t.toLowerCase().includes(lowerTag))) {
            results.push({ ...p, full: "" });
        }
    }
    for (const i of INSTRUCTIONS) {
        if (i.tags.some(t => t.toLowerCase().includes(lowerTag))) {
            results.push({ ...i, full: "" });
        }
    }
    for (const c of PM_CONVENTIONS) {
        if (c.tags.some(t => t.toLowerCase().includes(lowerTag))) {
            results.push({ ...c, full: "" });
        }
    }

    return results;
}

/**
 * Get all knowledge entries for a given query type for the get_knowledge dispatcher action.
 *
 * @param type     Knowledge type to retrieve.
 * @param phase    Required for phase_info, checklist, and instructions.
 * @param compact  Whether to return compact forms (default: true).
 */
export function getKnowledge(
    type: "principles" | "phase_info" | "checklist" | "instructions" | "estimation" | "conventions" | "all",
    phase?: number,
    compact: boolean = true,
): unknown {
    switch (type) {
        case "principles":
            return { principles: getPrinciples(compact) };

        case "phase_info":
            if (!phase) return { error: "phase number required for phase_info" };
            return getPhaseOverview(phase) ?? { error: `Phase ${phase} not found` };

        case "checklist":
            if (!phase) return { error: "phase number required for checklist" };
            return getChecklist(phase) ?? { error: `No checklist for phase ${phase} transition` };

        case "instructions":
            if (!phase) return { error: "phase number required for instructions" };
            return { instructions: getInstructions(phase, compact) };

        case "estimation":
            return getEstimationGuide(compact);

        case "conventions":
            return { pm_conventions: getPMConventions() };

        case "all": {
            const result: Record<string, unknown> = {
                principles: getPrinciples(compact),
                estimation: getEstimationGuide(compact),
                pm_conventions: getPMConventions(),
            };
            if (phase) {
                result.phase_info = getPhaseOverview(phase);
                result.checklist = getChecklist(phase);
                result.instructions = getInstructions(phase, compact);
            }
            return result;
        }

        default:
            return { error: `Unknown knowledge type: ${type as string}` };
    }
}
