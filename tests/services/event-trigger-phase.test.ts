// ============================================================================
// Event Trigger Service — Phase Gate Tests (Step 6)
//
// Tests: detectCurrentPhase(), auto phase gate scheduling on task completion.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { EventTriggerService, detectCurrentPhase } from "../../src/services/event-trigger.service.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeService(pmFull = false) {
    const { repos, db } = createTestDb();
    if (pmFull) repos.config.set('pm_full_enabled', 'true', '');
    const service = new EventTriggerService(repos);
    return { service, repos, db };
}

const NOW = new Date().toISOString();

function createPhaseTask(repos: ReturnType<typeof createTestDb>["repos"], title: string, tag: string, status = 'backlog') {
    const id = repos.tasks.create(null, NOW, { title, status, priority: 'medium', tags: [tag] });
    return id;
}

// ─── detectCurrentPhase ───────────────────────────────────────────────────────

describe("detectCurrentPhase()", () => {
    it("returns null when no tasks exist", () => {
        const { repos } = makeService();
        expect(detectCurrentPhase(repos)).toBeNull();
    });

    it("returns null when no phase-tagged tasks exist", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Do thing', status: 'backlog', priority: 'medium' });
        expect(detectCurrentPhase(repos)).toBeNull();
    });

    it("returns phase number for single phase:planning task", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Plan it', status: 'backlog', priority: 'medium', tags: ['phase:planning'] });
        expect(detectCurrentPhase(repos)).toBe(2); // planning = 2
    });

    it("returns lowest phase number when multiple phases open", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Execute', status: 'backlog', priority: 'medium', tags: ['phase:execution'] });
        repos.tasks.create(null, NOW, { title: 'Plan', status: 'backlog', priority: 'medium', tags: ['phase:planning'] });
        // planning=2 < execution=3 → returns 2
        expect(detectCurrentPhase(repos)).toBe(2);
    });

    it("ignores done tasks when detecting phase", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Done initiation', status: 'done', priority: 'medium', tags: ['phase:initiation'] });
        repos.tasks.create(null, NOW, { title: 'Open planning', status: 'backlog', priority: 'medium', tags: ['phase:planning'] });
        // Only open tasks considered — planning=2
        expect(detectCurrentPhase(repos)).toBe(2);
    });

    it("returns null when all phase tasks are done", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Done', status: 'done', priority: 'medium', tags: ['phase:initiation'] });
        expect(detectCurrentPhase(repos)).toBeNull();
    });

    it("handles unknown phase tag gracefully", () => {
        const { repos } = makeService();
        repos.tasks.create(null, NOW, { title: 'Unknown', status: 'backlog', priority: 'medium', tags: ['phase:unknown'] });
        expect(detectCurrentPhase(repos)).toBeNull();
    });
});

// ─── Phase gate scheduling ────────────────────────────────────────────────────

describe("phase gate auto-scheduling", () => {
    it("does NOT schedule gate when PM-Full is disabled", () => {
        const { repos, service } = makeService(false);
        const taskId = createPhaseTask(repos, 'Finish planning', 'phase:planning');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-2', limit: 10 });
        expect(events).toHaveLength(0);
    });

    it("does NOT schedule gate when task has no phase tag", () => {
        const { repos, service } = makeService(true);
        const taskId = repos.tasks.create(null, NOW, { title: 'No tag', status: 'done', priority: 'medium' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ limit: 10 });
        // Only task_complete triggered events, no phase gate
        const phaseGates = events.filter(e => {
            const tags: string[] = e.tags ? JSON.parse(e.tags) : [];
            return tags.some(t => t.startsWith('phase-gate'));
        });
        expect(phaseGates).toHaveLength(0);
    });

    it("does NOT schedule gate when other phase tasks are still open", () => {
        const { repos, service } = makeService(true);
        createPhaseTask(repos, 'Task A', 'phase:planning'); // still open
        const taskId = createPhaseTask(repos, 'Task B', 'phase:planning');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-2', limit: 10 });
        expect(events).toHaveLength(0);
    });

    it("schedules gate event when all phase tasks complete (PM-Full enabled)", () => {
        const { repos, service } = makeService(true);
        const taskId = createPhaseTask(repos, 'Only planning task', 'phase:planning');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-2', limit: 10 });
        expect(events).toHaveLength(1);
        expect(events[0].title).toContain('Phase Gate 2');
        expect(events[0].trigger_type).toBe('next_session');
        expect(events[0].priority).toBe('high');
    });

    it("gate event title contains phase numbers N→N+1", () => {
        const { repos, service } = makeService(true);
        const taskId = createPhaseTask(repos, 'Initiation done', 'phase:initiation');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-1', limit: 10 });
        expect(events[0].title).toContain('1→2');
        expect(events[0].tags).toContain('pm-framework');
    });

    it("is idempotent — does not create duplicate gate events", () => {
        const { repos, service } = makeService(true);
        const taskId = createPhaseTask(repos, 'Single task', 'phase:execution');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        // Call twice
        service.triggerTaskCompleteEvents(taskId);
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-3', limit: 10 });
        expect(events).toHaveLength(1);
    });

    it("schedules correct gate for quality phase (phase:quality = 4)", () => {
        const { repos, service } = makeService(true);
        const taskId = createPhaseTask(repos, 'QA done', 'phase:quality');
        repos.tasks.update(taskId, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: 'phase-gate-4', limit: 10 });
        expect(events).toHaveLength(1);
        expect(events[0].title).toContain('4→5');
    });

    it("schedules gate for execution phase when all execution tasks done", () => {
        const { repos, service } = makeService(true);
        const t1 = createPhaseTask(repos, 'Exec A', 'phase:execution');
        const t2 = createPhaseTask(repos, 'Exec B', 'phase:execution');
        // Complete both
        repos.tasks.update(t1, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(t1); // t2 still open — no gate
        expect(repos.events.getFiltered({ tag: 'phase-gate-3', limit: 10 })).toHaveLength(0);

        repos.tasks.update(t2, NOW, { status: 'done' });
        service.triggerTaskCompleteEvents(t2); // now all done — schedule gate
        expect(repos.events.getFiltered({ tag: 'phase-gate-3', limit: 10 })).toHaveLength(1);
    });
});
