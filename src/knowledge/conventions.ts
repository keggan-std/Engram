// ============================================================================
// Engram — PM Knowledge Base: Default PM Conventions
// ============================================================================
// These 5 conventions are injected into session start when PM-Full is active.
// They are NOT stored in the user's conventions table. They are shipped with
// the package and keyed by their principle IDs (see principles.ts).
//
// Category uses the 'pm-' prefix to distinguish them from user conventions
// in session start delivery. The category field matches ConventionCategory
// union type values used in the rest of the system.

import type { KnowledgeEntry } from "./types.js";

/**
 * PM principle conventions — injected after user conventions when PM-Full is ON.
 * Rule text must survive 100-char truncation (front-load the imperative).
 */
export const PM_CONVENTIONS: KnowledgeEntry[] = [
    {
        id: "pmconv-phase-gates",
        category: "convention",
        compact: "Never advance a phase without documented exit criteria met.",
        full: "Before advancing from any phase to the next, verify and document that all exit criteria for the current phase are satisfied. Use get_knowledge(phase:N, type:'checklist') to retrieve the phase gate checklist. Do not mark a phase complete based on subjective confidence — require objective evidence for each exit criterion.",
        tags: ["phase-gates", "workflow", "discipline", "pm-workflow"],
        locale: "en",
    },
    {
        id: "pmconv-traceability",
        category: "convention",
        compact: "Every decision requires a rationale. No undocumented choices.",
        full: "Every architectural, implementation, or scope decision must be recorded in Engram with an explicit rationale. A decision without a rationale is indistinguishable from a mistake. Future sessions, future agents, and post-project reviews require the 'why', not just the 'what'. Use record_decision for all non-trivial choices.",
        tags: ["decisions", "rationale", "traceability", "pm-discipline"],
        locale: "en",
    },
    {
        id: "pmconv-incremental-proof",
        category: "convention",
        compact: "Ship working increments. Prove progress with deliverables, not words.",
        full: "Progress is measured by working, demonstrable artifacts — not by confidence statements, plans, or partially-complete work. Each phase must produce concrete deliverables that can be verified against acceptance criteria. 'We have a plan' is not a deliverable. 'Here is the WBS with PERT estimates and an approved risk register' is a deliverable.",
        tags: ["deliverables", "proof", "increments", "pm-quality"],
        locale: "en",
    },
    {
        id: "pmconv-risk-first",
        category: "convention",
        compact: "Identify risks before committing to estimates or approaches.",
        full: "Risk identification precedes commitment. Before providing estimates or committing to an approach, identify what could invalidate the estimate or block the approach. Use the risk register format: risk ID, description, probability (H/M/L), impact (H/M/L), mitigation strategy. High/High risks require contingency plans, not just awareness.",
        tags: ["risk", "estimation", "planning", "pm-risk"],
        locale: "en",
    },
    {
        id: "pmconv-scope-control",
        category: "convention",
        compact: "Track scope changes formally. No silent additions.",
        full: "Any change to the original scope must be logged as a scope change decision with an impact assessment (effort, timeline, risk). 'While I'm here' additions are not allowed without explicit approval from the decision owner. Every unlogged scope addition directly erodes estimate accuracy and makes retrospectives impossible.",
        tags: ["scope", "changes", "control", "pm-scope"],
        locale: "en",
    },
];
