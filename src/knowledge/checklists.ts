// ============================================================================
// Engram — PM Knowledge Base: Phase Gate Checklists
// ============================================================================
// One checklist per phase transition (phase N → phase N+1).
// Mandatory items block phase advance. Optional items are recommended.

import type { PhaseChecklist } from "./types.js";

/** All phase gate checklists. Access via getChecklist(fromPhase). */
export const CHECKLISTS: PhaseChecklist[] = [
    {
        fromPhase: 1,
        toPhase: 2,
        label: "Gate 1→2: Initiation → Planning",
        items: [
            { id: "g1-1", check: "Project objectives documented with measurable success criteria", mandatory: true },
            { id: "g1-2", check: "Scope boundaries defined (in-scope AND explicitly out-of-scope)", mandatory: true },
            { id: "g1-3", check: "Key stakeholders identified with roles and responsibilities", mandatory: true },
            { id: "g1-4", check: "Major constraints documented (budget, timeline, technical, regulatory)", mandatory: true },
            { id: "g1-5", check: "Assumptions logged in Engram decisions", mandatory: true },
            { id: "g1-6", check: "Project charter or equivalent document created and approved", mandatory: true },
            { id: "g1-7", check: "Sponsor formal sign-off obtained", mandatory: false, note: "Required for client-facing projects" },
            { id: "g1-8", check: "Success criteria are objectively verifiable (not subjective)", mandatory: true },
        ],
    },
    {
        fromPhase: 2,
        toPhase: 3,
        label: "Gate 2→3: Planning → Execution",
        items: [
            { id: "g2-1", check: "Work Breakdown Structure (WBS) is fully decomposed to task level", mandatory: true },
            { id: "g2-2", check: "All tasks have PERT estimates (O, M, P values documented)", mandatory: true },
            { id: "g2-3", check: "Risk register complete with probability/impact scores", mandatory: true },
            { id: "g2-4", check: "Mitigation strategies documented for all critical/high risks", mandatory: true },
            { id: "g2-5", check: "Delivery schedule committed with milestones", mandatory: true },
            { id: "g2-6", check: "Resource allocation confirmed — no assumed availability", mandatory: true },
            { id: "g2-7", check: "Assumptions validated with stakeholders (not just inferred)", mandatory: true },
            { id: "g2-8", check: "Dependencies mapped and owners identified", mandatory: false },
            { id: "g2-9", check: "Team briefed on scope, plan, and ground rules", mandatory: false },
            { id: "g2-10", check: "Development environment verified ready", mandatory: false },
        ],
    },
    {
        fromPhase: 3,
        toPhase: 4,
        label: "Gate 3→4: Execution → Quality",
        items: [
            { id: "g3-1", check: "All WBS deliverables built and demonstrable", mandatory: true },
            { id: "g3-2", check: "Changes log reflects ALL file modifications made", mandatory: true },
            { id: "g3-3", check: "All decisions logged with rationale in Engram", mandatory: true },
            { id: "g3-4", check: "Scope additions were documented and approved via change process", mandatory: true },
            { id: "g3-5", check: "Known defects are logged and triaged", mandatory: true },
            { id: "g3-6", check: "Code/artifact review completed by second party", mandatory: false },
            { id: "g3-7", check: "Test environment available and representative of production", mandatory: true },
            { id: "g3-8", check: "No unresolved critical blockers from risk register", mandatory: true },
        ],
    },
    {
        fromPhase: 4,
        toPhase: 5,
        label: "Gate 4→5: Quality → Finalization",
        items: [
            { id: "g4-1", check: "All planned test cases executed and results documented", mandatory: true },
            { id: "g4-2", check: "All critical and high-severity defects resolved or formally deferred", mandatory: true },
            { id: "g4-3", check: "Acceptance criteria verified with objective evidence", mandatory: true },
            { id: "g4-4", check: "Performance/non-functional requirements validated", mandatory: true },
            { id: "g4-5", check: "Stakeholder acceptance sign-off obtained", mandatory: true },
            { id: "g4-6", check: "Security review completed (if applicable)", mandatory: false, note: "Mandatory for public-facing systems" },
            { id: "g4-7", check: "Regression suite passes with no new failures", mandatory: false },
        ],
    },
    {
        fromPhase: 5,
        toPhase: 6,
        label: "Gate 5→6: Finalization → Handover",
        items: [
            { id: "g5-1", check: "All documentation complete (technical docs, user guides, runbooks)", mandatory: true },
            { id: "g5-2", check: "Final deployment verified in production", mandatory: true },
            { id: "g5-3", check: "Retrospective conducted and learnings documented", mandatory: true },
            { id: "g5-4", check: "Key retrospective items committed as Engram decisions/conventions", mandatory: true },
            { id: "g5-5", check: "Project closure report signed off by sponsor", mandatory: false },
            { id: "g5-6", check: "Team debriefed and new assignments confirmed", mandatory: false },
            { id: "g5-7", check: "Open items and known risks documented for operations team", mandatory: true },
        ],
    },
];
