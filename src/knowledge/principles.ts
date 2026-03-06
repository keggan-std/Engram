// ============================================================================
// Engram — PM Knowledge Base: Core Principles
// ============================================================================
// Five cross-cutting principles that apply across all phases and all projects.
// These are the backbone of the methodology. PM-Full injects these as conventions
// on session start.

import type { KnowledgeEntry } from "./types.js";

/** The five core PM principles, each with compact (≤80 char) and full forms. */
export const PRINCIPLES: KnowledgeEntry[] = [
    {
        id: "principle-intentionality",
        category: "principle",
        compact: "Act with clear purpose. No undocumented decisions.",
        full: `**Intentionality** means every action, decision, and direction change is deliberate and recorded. Agents and project managers must be able to answer "why did we do this?" at any point in the project. Decisions that live only in chat history or an agent's context window are invisible to the next session, the next agent, and the project audit. Record decisions with rationale. Record file changes with descriptions. Build a navigable trail.`,
        tags: ["intentionality", "decisions", "documentation", "principle"],
        locale: "en",
    },
    {
        id: "principle-traceability",
        category: "principle",
        compact: "Every decision requires a rationale. No undocumented choices.",
        full: `**Traceability** means you can trace any implementation artifact backward to its originating decision and forward to its deliverable. A function exists because of a decision. A decision was made because of a requirement. A requirement was scoped because of a constraint. Breaking this chain means you cannot explain, defend, or safely change anything. Use Engram's decisions log with explicit rationale. Link decisions to tasks. Link tasks to deliverables.`,
        tags: ["traceability", "decisions", "rationale", "principle"],
        locale: "en",
    },
    {
        id: "principle-incremental-proof",
        category: "principle",
        compact: "Ship working increments. Prove progress with deliverables, not words.",
        full: `**Incremental Proof** means progress is demonstrated by working artifacts, not verbal reports or promise of completion. A planning session that ends with "we have a plan" has proven nothing. A planning session that ends with a documented WBS, a recorded risk list, and a committed milestone has proven the plan exists. At every phase, the exit criteria require tangible deliverables — documents, tests, demos, deployed increments — not status updates.`,
        tags: ["incremental", "deliverables", "proof", "principle"],
        locale: "en",
    },
    {
        id: "principle-risk-first",
        category: "principle",
        compact: "Identify risks before committing to estimates or approaches.",
        full: `**Risk-First Planning** means risk identification precedes commitment. You cannot produce a credible estimate without first identifying what could make the estimate wrong. You cannot choose an architecture without first identifying technical risks. The risk register is not a formality completed after decisions are made — it is the input to those decisions. Identify, score (probability × impact), and document mitigation for every non-trivial risk before beginning work.`,
        tags: ["risk", "estimation", "planning", "principle"],
        locale: "en",
    },
    {
        id: "principle-scope-control",
        category: "principle",
        compact: "Track scope changes formally. No silent additions.",
        full: `**Scope Control** means any change to what is being built is explicitly documented, assessed for impact, and approved before execution. "While I'm here" additions, undiscussed requirement expansions, and gold plating are the primary cause of missed estimates and schedule overruns. Every scope change must be logged, its effect on timeline and effort estimated, and the tradeoff explicitly acknowledged. Use the changes log for all scope adjustments.`,
        tags: ["scope", "changes", "control", "principle"],
        locale: "en",
    },
];
