// ============================================================================
// Engram — PM Knowledge Base: Phase Definitions
// ============================================================================
// Six sequential project execution phases. Each has entry/exit criteria.
// Phase number maps directly to PHASE_MAP in src/constants.ts.

import type { PhaseDefinition } from "./types.js";

/** All six phase definitions. Index using phaseIdToNumber or getPhase(). */
export const PHASES: PhaseDefinition[] = [
    {
        number: 1,
        name: "initiation",
        label: "Initiation",
        compact: "Define objectives, scope, constraints, and success criteria.",
        full: `**Initiation** is where the project is formally defined. The deliverable is a clear project charter or initiation document that answers: Why does this project exist? What are its boundaries? What does success look like? Who are the stakeholders? What are the constraints and assumptions? Without a completed initiation phase, the project has no north star — teams drift, scope expands, and goals get reinterpreted. Initiation is complete when the team can answer all five questions from memory.`,
        entryCriteria: [
            "Business need or opportunity is identified",
            "Sponsor or project owner is assigned",
            "High-level budget and timeline are provisionally available",
        ],
        exitCriteria: [
            "Project objectives documented with measurable success criteria",
            "Scope boundaries explicitly defined (in-scope AND out-of-scope)",
            "Key stakeholders identified with roles documented",
            "Major constraints and assumptions recorded",
            "Project charter or equivalent document approved by sponsor",
        ],
        tags: ["initiation", "charter", "objectives", "scope-definition", "phase-1"],
    },
    {
        number: 2,
        name: "planning",
        label: "Planning",
        compact: "Create WBS, estimates, risk register, and delivery schedule.",
        full: `**Planning** translates the project charter into an executable plan. The deliverables are a Work Breakdown Structure (WBS), a risk register, effort estimates using PERT, a committed delivery schedule, and documented assumptions. Planning is not done when a plan document exists — it is done when every deliverable has a task, every task has an estimate, every estimate has been risk-adjusted, and the schedule has been validated against availability and dependencies. Over-planning is rare; under-planning is the norm and the primary cause of execution failure.`,
        entryCriteria: [
            "Initiation phase gate passed (charter approved)",
            "Scope is baselined and change-controlled",
        ],
        exitCriteria: [
            "WBS is fully decomposed to task level (no deliverable unaccounted)",
            "All tasks have PERT estimates (O, M, P values documented)",
            "Risk register complete with probability/impact scores and mitigations",
            "Schedule committed with milestones and checkpoints",
            "Resource allocation confirmed",
            "Assumptions documented and validated with stakeholders",
        ],
        tags: ["planning", "wbs", "estimation", "risk-register", "schedule", "phase-2"],
    },
    {
        number: 3,
        name: "execution",
        label: "Execution & Building",
        compact: "Build and implement per the plan. Record all changes made.",
        full: `**Execution** is where the plan becomes reality. The deliverable is a built, working artifact that satisfies the scope defined in planning. During execution, every file change is recorded, every decision that deviates from plan is logged, and scope changes are handled through the formal change process (not silently absorbed). Progress is measured against the WBS, not against a narrative. Blockers are raised early. The daily operational standard is: record what you build, why you deviated, and what you decided.`,
        entryCriteria: [
            "Planning phase gate passed (WBS, estimates, risk register approved)",
            "Environment and toolchain ready",
            "Team briefed on scope and plan",
        ],
        exitCriteria: [
            "All planned deliverables built and demonstrable",
            "Changes log reflects all file modifications",
            "Scope additions documented and approved via change process",
            "All critical decisions logged with rationale",
            "No unresolved blockers from risk register",
        ],
        tags: ["execution", "building", "implementation", "changes", "phase-3"],
    },
    {
        number: 4,
        name: "quality",
        label: "Testing & Quality Validation",
        compact: "Test all deliverables against acceptance criteria. Fix before closing.",
        full: `**Quality** ensures that what was built meets what was specified. The deliverable is a validated, tested, defect-resolved build ready for stakeholder acceptance. Testing is not a phase you do at the end — it is a continuous activity elevated to gate status here. The quality gate cannot be passed by self-attestation ("it works on my machine"). It requires objective evidence: test results, coverage reports, acceptance criteria checked off, defects logged and resolved. Quality is the hardest gate to enforce and the most skipped. It is also the one that causes the most expensive post-delivery failures when skipped.`,
        entryCriteria: [
            "Execution phase gate passed (all deliverables built)",
            "Test environment available and representative of production",
            "Acceptance criteria documented (from initiation/planning)",
        ],
        exitCriteria: [
            "All planned test cases executed with results documented",
            "All critical and high-severity defects resolved or formally deferred",
            "Acceptance criteria verified with evidence (logs, screenshots, test reports)",
            "Performance and non-functional requirements validated",
            "Stakeholder acceptance sign-off obtained",
        ],
        tags: ["quality", "testing", "validation", "acceptance", "phase-4"],
    },
    {
        number: 5,
        name: "finalization",
        label: "Finalization",
        compact: "Complete all deliverables, docs, and retrospective. Close cleanly.",
        full: `**Finalization** is the disciplined closure of the project. Deliverables: all documentation complete and archived, final deployment executed, retrospective conducted and learnings documented, Engram memory reflects the completed state. The temptation is to declare done when the software works. Finalization is done when the project can be fully understood, maintained, and handed over by someone who was not on the team. Retrospective outputs must be committed as future-facing conventions or decisions, not archived as meeting notes.`,
        entryCriteria: [
            "Quality phase gate passed (acceptance sign-off received)",
        ],
        exitCriteria: [
            "All documentation complete (technical docs, user guides, runbooks)",
            "Final deployment verified in production environment",
            "Retrospective conducted and learnings documented",
            "Key retrospective items committed as Engram decisions/conventions",
            "Project closure report signed off by sponsor",
            "Team debriefed and transitioned",
        ],
        tags: ["finalization", "documentation", "retrospective", "closure", "phase-5"],
    },
    {
        number: 6,
        name: "handover",
        label: "Handover & Knowledge Transfer",
        compact: "Transfer ownership and knowledge. Ensure maintainability.",
        full: `**Handover** is the transition from project delivery to operational ownership. It is not done until the receiving party can operate, maintain, and evolve what was built without the original team. The Engram memory for the project serves as the primary handover artifact — decisions, conventions, and file notes encode the institutional knowledge that would otherwise exist only in the team's heads. The handover gate requires a demonstrated capability transfer, not just a handover document.`,
        entryCriteria: [
            "Finalization phase gate passed",
            "Operations team or future maintainers identified",
        ],
        exitCriteria: [
            "Handover documentation complete (architecture guide, runbook, decision log)",
            "Receiving party has demonstrated ability to operate the system",
            "Engram memory cleaned, annotated, and handed over",
            "Support and escalation paths documented",
            "Formal handover sign-off obtained from receiving party",
        ],
        tags: ["handover", "knowledge-transfer", "documentation", "transition", "phase-6"],
    },
];
