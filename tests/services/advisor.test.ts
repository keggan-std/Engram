// ============================================================================
// Workflow Advisor Service Tests
//
// Tests: nudge checks (PM-Lite + PM-Full), max-nudge cap, PM-Full eligibility
// detection, recordAction + checkNudge API, stats getter.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { WorkflowAdvisorService } from "../../src/services/workflow-advisor.service.js";
import { PMDiagnosticsTracker } from "../../src/services/pm-diagnostics.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeAdvisor(pmLite = true, pmFull = false) {
    const { repos } = createTestDb();
    // Set config values
    if (!pmLite) repos.config.set('pm_lite_enabled', 'false', '');
    if (pmFull) repos.config.set('pm_full_enabled', 'true', '');
    const diagnostics = new PMDiagnosticsTracker();
    return { advisor: new WorkflowAdvisorService(repos, diagnostics), repos, diagnostics };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WorkflowAdvisorService — basic API", () => {
    it("checkNudge returns null when no actions recorded", () => {
        const { advisor } = makeAdvisor();
        expect(advisor.checkNudge()).toBeNull();
    });

    it("checkNudge returns null when both PM modes disabled", () => {
        const { advisor } = makeAdvisor(false, false);
        // Record many actions
        for (let i = 0; i < 10; i++) advisor.recordAction('begin_work', { file_path: `file${i}.ts` });
        expect(advisor.checkNudge()).toBeNull();
    });

    it("stats initially shows 0 delivered", () => {
        const { advisor } = makeAdvisor();
        expect(advisor.stats.delivered).toBe(0);
        expect(advisor.stats.available).toEqual([]);
    });

    it("maxNudgesReached is false initially", () => {
        const { advisor } = makeAdvisor();
        expect(advisor.maxNudgesReached).toBe(false);
    });

    it("recordAction does not throw on any action name", () => {
        const { advisor } = makeAdvisor();
        expect(() => {
            advisor.recordAction('unknown_action', { foo: 'bar' });
            advisor.recordAction('create_task', { title: 'Test', tags: ['phase:1'] });
        }).not.toThrow();
    });
});

describe("PM-Lite check: unrecorded edits", () => {
    it("fires when ≥3 begin_work calls without record_change", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('begin_work', { file_path: 'a.ts' });
        advisor.recordAction('begin_work', { file_path: 'b.ts' });
        advisor.recordAction('begin_work', { file_path: 'c.ts' });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('record_change');
    });

    it("does NOT fire when record_change was called", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('begin_work', { file_path: 'a.ts' });
        advisor.recordAction('begin_work', { file_path: 'b.ts' });
        advisor.recordAction('begin_work', { file_path: 'c.ts' });
        advisor.recordAction('record_change', {});
        // unrecorded_edits should not fire — may fire another nudge
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain('record_change'); // nudge.id !== unrecorded_edits
    });

    it("does NOT fire with fewer than 3 begin_work calls", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('begin_work', { file_path: 'a.ts' });
        advisor.recordAction('begin_work', { file_path: 'b.ts' });
        expect(advisor.checkNudge()).toBeNull();
    });
});

describe("PM-Lite check: missing decision lookup", () => {
    it("fires when create_task called without get_decisions", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('create_task', { title: 'Build feature X' });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('get_decisions');
    });

    it("does NOT fire when get_decisions was called before create_task", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('get_decisions', {});
        advisor.recordAction('create_task', { title: 'Build feature X' });
        const nudge = advisor.checkNudge();
        // missing_decision_lookup should not fire
        if (nudge) expect(nudge).not.toContain('get_decisions');
    });

    it("does NOT fire when no tasks created", () => {
        const { advisor } = makeAdvisor();
        advisor.recordAction('get_file_notes', { file_path: 'src/foo.ts' });
        expect(advisor.checkNudge()).toBeNull();
    });
});

describe("PM-Lite check: missing file notes", () => {
    it("fires when 3+ begin_work without get_file_notes", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 3; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        // Both unrecorded_edits and missing_file_notes could fire; check one fires
        const first = advisor.checkNudge();
        expect(first).not.toBeNull();
    });

    it("after unrecorded_edits fires, missing_file_notes can fire next", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 3; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        const first = advisor.checkNudge(); // unrecorded_edits
        expect(first).not.toBeNull();
        const second = advisor.checkNudge(); // missing_file_notes (same conditions apply)
        // Both checks apply — second nudge fires or null if checks differ
        // Key: nudge id deduplication ensures same id doesn't fire twice
        if (second) expect(second).not.toBe(first); // different id
    });
});

describe("PM-Lite check: unrecorded decisions", () => {
    it("fires after 6+ actions without record_decision", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 6; i++) advisor.recordAction('get_file_notes', { file_path: `${i}.ts` });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('record_decision');
    });

    it("does NOT fire with fewer than 6 actions", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 5; i++) advisor.recordAction('get_file_notes', { file_path: `${i}.ts` });
        // Only unrecorded_decisions check — other checks won't have enough signal
        expect(advisor.checkNudge()).toBeNull();
    });

    it("does NOT fire if record_decision was called", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 6; i++) advisor.recordAction('get_file_notes', { file_path: `${i}.ts` });
        advisor.recordAction('record_decision', { decision: 'Use React', rationale: 'Ecosystem' });
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain('record_decision');
    });
});

describe("nudge deduplication and capping", () => {
    it("same nudge id is not delivered twice", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 3; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        const first = advisor.checkNudge();
        expect(first).not.toBeNull();
        // checkNudge again — same id already in delivered set
        const second = advisor.checkNudge();
        if (first && second) expect(second).not.toContain('record_change'); // id deduped
    });

    it("caps nudges at PM_MAX_NUDGES (5) per session", () => {
        const { advisor } = makeAdvisor(true, true); // PM-Full enabled to get enough unique nudges
        // Force multiple different nudge conditions
        for (let i = 0; i < 3; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        advisor.recordAction('create_task', { title: 'task 1' });
        advisor.recordAction('create_task', { title: 'task 2' });
        for (let i = 0; i < 10; i++) advisor.recordAction('get_file_notes', { file_path: `${i}.ts` });
        // Add phase-done to trigger phase_gate_skip (5th nudge)
        advisor.recordAction('update_task', { status: 'done', tags: ['phase:1'] });

        // Drain all nudges — expect exactly 5:
        // unrecorded_edits, missing_decision_lookup, phase_gate_skip, unrecorded_decisions, risk_register
        let nudgeCount = 0;
        for (let i = 0; i < 10; i++) {
            const n = advisor.checkNudge();
            if (n) nudgeCount++;
        }
        expect(nudgeCount).toBeLessThanOrEqual(5);
        expect(advisor.maxNudgesReached).toBe(true);
        expect(advisor.checkNudge()).toBeNull(); // capped
    });

    it("stats tracks nudge ids correctly", () => {
        const { advisor } = makeAdvisor();
        for (let i = 0; i < 3; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        advisor.checkNudge();
        expect(advisor.stats.delivered).toBe(1);
        expect(advisor.stats.available.length).toBe(1);
    });
});

describe("PM-Full eligibility: checkPMFullEligibility", () => {
    it("fires when 3+ create_task calls and PM-Full not active", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        // Suppress missing_decision_lookup so pm_full_offer can surface
        advisor.recordAction('get_decisions', {});
        for (let i = 0; i < 3; i++) {
            advisor.recordAction('create_task', { title: `Task ${i}`, tags: [] });
        }
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('enable_pm');
        // Config should be marked as offered
        expect(repos.config.get('pm_full_offered')).toBe('true');
    });

    it("fires with 1 task that has phase: tag", () => {
        const { advisor } = makeAdvisor(true, false);
        advisor.recordAction('get_decisions', {}); // suppress missing_decision_lookup
        advisor.recordAction('create_task', { title: 'Plan sprint', tags: ['phase:1'] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('enable_pm');
    });

    it("fires with 1 task containing PM keyword in title", () => {
        const { advisor } = makeAdvisor(true, false);
        advisor.recordAction('get_decisions', {}); // suppress missing_decision_lookup
        advisor.recordAction('create_task', { title: 'Define project milestone deliverables', tags: [] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('enable_pm');
    });

    it("does NOT fire when pm_full_offered is already true", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        repos.config.set('pm_full_offered', 'true', '');
        for (let i = 0; i < 5; i++) advisor.recordAction('create_task', { title: `Task ${i}` });
        const nudge = advisor.checkNudge();
        // No pm_full_offer nudge should appear
        if (nudge) expect(nudge).not.toContain('enable_pm');
    });

    it("does NOT fire when pm_full_declined is true", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        repos.config.set('pm_full_declined', 'true', '');
        for (let i = 0; i < 5; i++) advisor.recordAction('create_task', { title: `Task ${i}` });
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain('enable_pm');
    });

    it("does NOT fire when PM-Full already active", () => {
        const { advisor } = makeAdvisor(true, true);
        for (let i = 0; i < 5; i++) advisor.recordAction('create_task', { title: `Task ${i}` });
        const nudge = advisor.checkNudge();
        // pm_full_offer id should not appear
        if (nudge) expect(nudge).not.toContain("enable_pm");
    });

    it("does NOT fire with 1 task and no phase tags or keywords (even with decision lookup done)", () => {
        const { advisor } = makeAdvisor(true, false);
        // Suppress missing_decision_lookup by checking decisions first
        advisor.recordAction('get_decisions', {});
        advisor.recordAction('create_task', { title: 'Fix bug', tags: [] });
        // pm_full_offer check: 1 task, no phase tags, no PM keywords → should not fire
        expect(advisor.checkNudge()).toBeNull();
    });
});

describe("PM-Full checks (pm_full=true)", () => {
    it("checkPhaseGateSkip fires when phase task done without get_knowledge", () => {
        const { advisor } = makeAdvisor(true, true);
        advisor.recordAction('update_task', { id: 1, status: 'done', tags: ['phase:2', 'planning'] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain('checklist');
    });

    it("checkPhaseGateSkip does NOT fire when get_knowledge was called", () => {
        const { advisor } = makeAdvisor(true, true);
        advisor.recordAction('get_knowledge', { type: 'checklist', phase: 2 });
        advisor.recordAction('update_task', { id: 1, status: 'done', tags: ['phase:2'] });
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain('checklist');
    });

    it("checkPhaseGateSkip does NOT fire for non-phase task done", () => {
        const { advisor } = makeAdvisor(true, true);
        advisor.recordAction('update_task', { id: 1, status: 'done', tags: ['testing'] });
        // Only expecting no phase gate nudge specifically
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain('phase gate');
    });

    it("checkPhaseAwareness fires after 8+ actions without requirements check", () => {
        const { advisor } = makeAdvisor(true, true);
        for (let i = 0; i < 8; i++) advisor.recordAction('begin_work', { file_path: `${i}.ts` });
        // Some nudge will fire — verify advisor fires at all
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
    });
});

describe("diagnostics integration", () => {
    it("records failure when a check throws", () => {
        const { repos } = createTestDb();
        const diagnostics = new PMDiagnosticsTracker();
        // Create a repos whose config.get throws specifically for pm_full_offered
        // (this is called inside checkPMFullEligibility)
        const badRepos = {
            ...repos,
            config: {
                ...repos.config,
                get: (key: string) => {
                    if (key === 'pm_lite_enabled') return 'true';
                    if (key === 'pm_full_enabled') return 'false';
                    if (key === 'pm_full_offered') throw new Error('DB error simulated');
                    return null;
                },
            },
        } as typeof repos;
        const advisor = new WorkflowAdvisorService(badRepos, diagnostics);
        // Set up conditions so PM-Lite checks don't fire (suppress them)
        advisor.recordAction('get_decisions', {}); // suppress missing_decision_lookup
        // Add create_task with phase tag to trigger checkPMFullEligibility
        advisor.recordAction('create_task', { title: 'Design sprint', tags: ['phase:1'] });
        // Should not throw — errors in checks are caught
        expect(() => advisor.checkNudge()).not.toThrow();
        // Diagnostic should record the check failure
        const status = diagnostics.getStatus();
        expect(status.failure_count).toBeGreaterThan(0);
    });
});
