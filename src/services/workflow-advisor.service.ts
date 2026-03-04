// ============================================================================
// Engram MCP Server — Workflow Advisor Service
//
// Session-scoped service that observes action patterns and produces contextual
// nudges to help agents follow good workflow practices. Two-tier system:
//   PM-Lite: Basic workflow nudges (always active unless disabled)
//   PM-Full: Phase gate compliance, scope verification, risk register
//
// All state is in-memory and session-scoped. Zero persistence.
// Each PMDiagnosticsTracker failure is silently logged, never thrown.
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import { PMDiagnosticsTracker } from "./pm-diagnostics.js";
import { PM_KEYWORDS, PM_MAX_NUDGES } from "../constants.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionLog {
    action: string;
    timestamp: number;
    params?: Record<string, unknown>;
}

type NudgeResult = { id: string; message: string } | null;
type CheckFn = () => NudgeResult;

// ─── Service ─────────────────────────────────────────────────────────────────

export class WorkflowAdvisorService {
    private sessionActions: ActionLog[] = [];
    private nudgesDelivered: Set<string> = new Set();
    private pmLiteEnabled: boolean;
    private pmFullEnabled: boolean;

    constructor(
        private readonly repos: Repositories,
        private readonly diagnostics: PMDiagnosticsTracker
    ) {
        this.pmLiteEnabled = this.repos.config.get('pm_lite_enabled') !== 'false';
        this.pmFullEnabled = this.repos.config.get('pm_full_enabled') === 'true';
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Called by dispatcher before/after every tool invocation. */
    recordAction(action: string, params?: Record<string, unknown>): void {
        this.sessionActions.push({ action, timestamp: Date.now(), params });
    }

    /**
     * Returns a nudge message if one is warranted, null otherwise.
     * Each nudge id is only delivered once per session.
     * Capped at PM_MAX_NUDGES total nudges per session.
     * Individual check failures are caught and logged to diagnostics.
     */
    checkNudge(): string | null {
        if (!this.pmLiteEnabled && !this.pmFullEnabled) return null;
        if (this.nudgesDelivered.size >= PM_MAX_NUDGES) return null;

        for (const check of this.checks) {
            try {
                const result = check();
                if (result && !this.nudgesDelivered.has(result.id)) {
                    this.nudgesDelivered.add(result.id);
                    return result.message;
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Engram/PM] Advisor check failed: ${message}`);
                this.diagnostics.recordFailure('advisor_check', message);
            }
        }
        return null;
    }

    /** Whether the per-session nudge cap has been reached. */
    get maxNudgesReached(): boolean {
        return this.nudgesDelivered.size >= PM_MAX_NUDGES;
    }

    /** Diagnostic summary for pm_status action. */
    get stats(): { delivered: number; available: string[] } {
        return {
            delivered: this.nudgesDelivered.size,
            available: [...this.nudgesDelivered],
        };
    }

    // ── Check registry ────────────────────────────────────────────────────────

    private get checks(): CheckFn[] {
        const lite: CheckFn[] = this.pmLiteEnabled ? [
            () => this.checkUnrecordedEdits(),
            () => this.checkMissingDecisionLookup(),
            () => this.checkMissingFileNotes(),
            () => this.checkUnrecordedDecisions(),
        ] : [];

        const full: CheckFn[] = this.pmFullEnabled ? [
            () => this.checkPhaseGateSkip(),
            () => this.checkPhaseAwareness(),
            () => this.checkRiskRegister(),
            () => this.checkPMFullEligibility(),
        ] : [
            // PM-Full not active — only the eligibility offer
            () => this.checkPMFullEligibility(),
        ];

        return [...lite, ...full];
    }

    // ── PM-Lite checks ────────────────────────────────────────────────────────

    /**
     * Check 1: Agent started work on 3+ files without recording any changes.
     * Trigger: ≥3 begin_work calls, 0 record_change calls.
     */
    private checkUnrecordedEdits(): NudgeResult {
        const edits = this.sessionActions.filter(a => a.action === 'begin_work').length;
        if (edits < 3) return null;
        const recorded = this.sessionActions.filter(a => a.action === 'record_change').length;
        if (recorded > 0) return null;
        return {
            id: 'unrecorded_edits',
            message: "Working on 3+ files without recording changes. Use record_change to preserve context for the next agent or session. Try: engram_memory({ action: 'record_change', changes: [{ file_path, change_type, description, impact_scope }] })",
        };
    }

    /**
     * Check 2: Tasks created without checking existing decisions first.
     * Trigger: create_task called, but get_decisions never called this session.
     */
    private checkMissingDecisionLookup(): NudgeResult {
        const taskCreations = this.sessionActions.filter(a => a.action === 'create_task').length;
        if (taskCreations === 0) return null;
        const decisionsLooked = this.sessionActions.filter(a => a.action === 'get_decisions').length;
        if (decisionsLooked > 0) return null;
        return {
            id: 'missing_decision_lookup',
            message: "Tasks created without checking existing decisions. Prior architecture choices may overlap. Use engram_memory({ action: 'get_decisions' }) to review before creating new tasks.",
        };
    }

    /**
     * Check 3: Working on multiple files without checking file notes.
     * Trigger: ≥3 begin_work calls without any get_file_notes call.
     */
    private checkMissingFileNotes(): NudgeResult {
        const fileWork = this.sessionActions.filter(a => a.action === 'begin_work').length;
        if (fileWork < 3) return null;
        const noteChecks = this.sessionActions.filter(a => a.action === 'get_file_notes').length;
        if (noteChecks > 0) return null;
        return {
            id: 'missing_file_notes',
            message: "Working on multiple files without checking file notes. Use get_file_notes to load prior analysis and skip re-reading files. Try: engram_memory({ action: 'get_file_notes', file_path: '...' })",
        };
    }

    /**
     * Check 4: Extended session without recording any decisions.
     * Trigger: ≥6 total actions, 0 record_decision calls.
     */
    private checkUnrecordedDecisions(): NudgeResult {
        if (this.sessionActions.length < 6) return null;
        const decisions = this.sessionActions.filter(
            a => a.action === 'record_decision' || a.action === 'record_decisions_batch'
        ).length;
        if (decisions > 0) return null;
        return {
            id: 'unrecorded_decisions',
            message: "Extended work without recording decisions. If architectural choices were made, persist them: engram_memory({ action: 'record_decision', decision: '...', rationale: '...' })",
        };
    }

    // ── PM-Full checks ────────────────────────────────────────────────────────

    /**
     * Check 5: Phase task marked done without checking the phase gate checklist.
     * Trigger: update_task with status:'done' and phase tag, but no get_knowledge calls.
     */
    private checkPhaseGateSkip(): NudgeResult {
        const phaseDones = this.sessionActions.filter(a => {
            if (a.action !== 'update_task') return false;
            if (a.params?.status !== 'done') return false;
            const tags: string[] = (a.params?.tags as string[] | undefined) ?? [];
            return tags.some(t => t.startsWith('phase:'));
        });
        if (phaseDones.length === 0) return null;
        const knowledgeLookups = this.sessionActions.filter(a => a.action === 'get_knowledge').length;
        if (knowledgeLookups > 0) return null;
        return {
            id: 'phase_gate_skip',
            message: "Phase task completed without checking the phase gate checklist. Use get_knowledge(phase:N, type:'checklist') before advancing a phase. Missing gate checks can cause quality failures downstream.",
        };
    }

    /**
     * Check 6: Extended work without referencing requirements or prior decisions.
     * Trigger: ≥8 total actions without search, get_decisions, or get_file_notes.
     */
    private checkPhaseAwareness(): NudgeResult {
        if (this.sessionActions.length < 8) return null;
        const requirementChecks = this.sessionActions.filter(
            a => a.action === 'search' || a.action === 'get_decisions' || a.action === 'get_file_notes'
        ).length;
        if (requirementChecks > 0) return null;
        return {
            id: 'scope_verification',
            message: "Working for a while without verifying requirements or decisions. Use get_decisions or search to confirm you're aligned with prior architectural choices and scope.",
        };
    }

    /**
     * Check 7: Scope additions (new tasks) without documenting risks or decisions.
     * Trigger: ≥2 create_task calls without record_decision.
     */
    private checkRiskRegister(): NudgeResult {
        const taskCreations = this.sessionActions.filter(a => a.action === 'create_task').length;
        if (taskCreations < 2) return null;
        const decisions = this.sessionActions.filter(
            a => a.action === 'record_decision' || a.action === 'record_decisions_batch'
        ).length;
        if (decisions > 0) return null;
        return {
            id: 'risk_register',
            message: "Multiple tasks added without documenting scope decisions. Identify risks and record decisions before committing to this scope. Use record_decision with rationale.",
        };
    }

    /**
     * PM-Full eligibility: offer PM-Full when criteria are met.
     * Only fires once per project (guarded by pm_full_offered config flag).
     * Criteria: ≥3 create_task calls OR phase tags OR PM keywords in task title.
     */
    private checkPMFullEligibility(): NudgeResult {
        // Only offer when PM-Full not already active
        if (this.pmFullEnabled) return null;

        // Spam prevention: check offer/decline flags
        const offered = this.repos.config.get('pm_full_offered');
        const declined = this.repos.config.get('pm_full_declined');
        if (offered === 'true' || declined === 'true') return null;

        const taskCreations = this.sessionActions.filter(a => a.action === 'create_task');
        if (taskCreations.length === 0) return null;

        let qualifies = taskCreations.length >= 3;

        if (!qualifies) {
            // Check for explicit phase tags
            const hasPhaseTags = taskCreations.some(a => {
                const tags: string[] = (a.params?.tags as string[] | undefined) ?? [];
                return tags.some(t => t.startsWith('phase:'));
            });

            // Check for PM keyword in task title
            const hasPMKeywords = taskCreations.some(a => {
                const title = ((a.params?.title as string | undefined) ?? '').toLowerCase();
                return PM_KEYWORDS.some(kw => title.includes(kw));
            });

            qualifies = hasPhaseTags || hasPMKeywords;
        }

        if (!qualifies) return null;

        // Mark as offered to prevent re-offering
        try {
            this.repos.config.set('pm_full_offered', 'true', new Date().toISOString());
        } catch {
            // Best-effort — don't block the nudge if config write fails
        }

        return {
            id: 'pm_full_offer',
            message: "This looks like structured project work. Enable PM-Full for phase gates, checklists, and workflow guidance? Call engram_admin({ action: 'enable_pm' }) to activate, or engram_admin({ action: 'decline_pm' }) to dismiss permanently.",
        };
    }
}
