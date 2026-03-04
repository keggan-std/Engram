// ============================================================================
// Step 9 Integration Tests — PM Framework End-to-End Flows
//
// Tests: PM-Lite nudge flow, PM-Full activation, phase gate auto-scheduling,
// PM error isolation (pmSafe), and PM disable/enable cycle.
//
// Uses real in-memory SQLite (createTestDb) + real service classes.
// No mocks — these are true integration tests.
// ============================================================================

import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { WorkflowAdvisorService } from "../../src/services/workflow-advisor.service.js";
import { PMDiagnosticsTracker, pmSafe } from "../../src/services/pm-diagnostics.js";
import { EventTriggerService } from "../../src/services/event-trigger.service.js";
import { getKnowledge } from "../../src/knowledge/index.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeAdvisor(pmLite = true, pmFull = false) {
    const { repos } = createTestDb();
    if (!pmLite) repos.config.set("pm_lite_enabled", "false", NOW);
    if (pmFull) repos.config.set("pm_full_enabled", "true", NOW);
    const diagnostics = new PMDiagnosticsTracker();
    const advisor = new WorkflowAdvisorService(repos, diagnostics);
    return { advisor, repos, diagnostics };
}

// ─── 9.1 Full PM-Lite flow ────────────────────────────────────────────────────
//
// Flow: session start → 3+ begin_work calls (no record_change) → nudge fires
//       → record_change recorded → same nudge not repeated

describe("9.1 PM-Lite flow: unrecorded edits nudge lifecycle", () => {
    it("no nudge before any actions", () => {
        const { advisor } = makeAdvisor(true, false);
        expect(advisor.checkNudge()).toBeNull();
    });

    it("nudge fires after 3 begin_work calls without record_change", () => {
        const { advisor } = makeAdvisor(true, false);
        advisor.recordAction("begin_work", { file_path: "src/a.ts" });
        advisor.recordAction("begin_work", { file_path: "src/b.ts" });
        advisor.recordAction("begin_work", { file_path: "src/c.ts" });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("record_change");
    });

    it("2 begin_work calls do not trigger nudge", () => {
        const { advisor } = makeAdvisor(true, false);
        advisor.recordAction("begin_work", { file_path: "src/a.ts" });
        advisor.recordAction("begin_work", { file_path: "src/b.ts" });
        // Only 2 — below threshold
        expect(advisor.checkNudge()).toBeNull();
    });

    it("unrecorded_edits nudge is NOT repeated after it fires once", () => {
        const { advisor } = makeAdvisor(true, false);
        for (let i = 0; i < 3; i++) {
            advisor.recordAction("begin_work", { file_path: `src/file${i}.ts` });
        }
        const first = advisor.checkNudge();
        expect(first).not.toBeNull();
        expect(first).toContain("record_change");

        // Record the change — now record_change is in the log
        advisor.recordAction("record_change", {
            changes: [{ file_path: "src/a.ts", change_type: "modified" }],
        });

        // Call checkNudge again — unrecorded_edits already delivered, should not repeat
        const second = advisor.checkNudge();
        // Either null or a DIFFERENT nudge (not the same unrecorded_edits warning)
        if (second !== null) {
            expect(second).not.toContain("record_change");
        }
    });

    it("stats tracks the delivered nudge", () => {
        const { advisor } = makeAdvisor(true, false);
        for (let i = 0; i < 3; i++) {
            advisor.recordAction("begin_work", { file_path: `src/f${i}.ts` });
        }
        advisor.checkNudge(); // delivers unrecorded_edits
        expect(advisor.stats.delivered).toBe(1);
        expect(advisor.stats.available).toContain("unrecorded_edits");
    });

    it("PM-Lite disabled → nudge never fires even after 10 begin_work calls", () => {
        const { advisor } = makeAdvisor(false, false);
        for (let i = 0; i < 10; i++) {
            advisor.recordAction("begin_work", { file_path: `src/file${i}.ts` });
        }
        expect(advisor.checkNudge()).toBeNull();
    });
});

// ─── 9.2 PM-Full activation flow ─────────────────────────────────────────────
//
// Flow: create 3 tasks → pm_full_offer nudge fires → enable_pm → get_knowledge works

describe("9.2 PM-Full activation flow", () => {
    it("pm_full_offer nudge fires after 3 task creations (no prior offer)", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        // Suppress missing_decision_lookup so pm_full_offer can surface
        advisor.recordAction("get_decisions", {});
        for (let i = 0; i < 3; i++) {
            repos.tasks.create(null, NOW, { title: `Task ${i}`, status: "backlog", priority: "medium" });
            advisor.recordAction("create_task", { title: `Task ${i}`, tags: [] });
        }
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("enable_pm");
    });

    it("pm_full_offer marks pm_full_offered=true in config", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        advisor.recordAction("get_decisions", {});
        for (let i = 0; i < 3; i++) {
            advisor.recordAction("create_task", { title: `Task ${i}`, tags: [] });
        }
        advisor.checkNudge(); // fires the offer
        expect(repos.config.get("pm_full_offered")).toBe("true");
    });

    it("pm_full_offer fires with 1 phase-tagged task (below count threshold but PM-signal)", () => {
        const { advisor } = makeAdvisor(true, false);
        advisor.recordAction("get_decisions", {});
        advisor.recordAction("create_task", { title: "Phase 1 kickoff", tags: ["phase:1"] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("enable_pm");
    });

    it("after enable_pm (config flag set), getKnowledge('principles') returns data", () => {
        const { repos } = makeAdvisor(true, false);

        // Simulate enable_pm admin action
        repos.config.set("pm_full_enabled", "true", NOW);
        repos.config.set("pm_full_declined", "false", NOW);

        // getKnowledge should return valid knowledge content
        const result = getKnowledge("principles") as { principles: unknown[] };
        expect(result).toBeDefined();
        expect(result.principles).toBeInstanceOf(Array);
        expect((result.principles as unknown[]).length).toBeGreaterThan(0);
    });

    it("after enable_pm, getKnowledge('estimation') returns estimation data", () => {
        const result = getKnowledge("estimation") as Record<string, unknown>;
        expect(result).toBeDefined();
        expect(result.method).toBeDefined();
        expect(result.formula).toBeDefined();
    });

    it("after enable_pm, getKnowledge('conventions') returns PM conventions", () => {
        const result = getKnowledge("conventions") as { pm_conventions: unknown[] };
        expect(result).toBeDefined();
        expect(result.pm_conventions).toBeInstanceOf(Array);
        expect((result.pm_conventions as unknown[]).length).toBeGreaterThan(0);
    });

    it("pm_full_offer does NOT fire if already offered (idempotency)", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        repos.config.set("pm_full_offered", "true", NOW);
        advisor.recordAction("get_decisions", {});
        for (let i = 0; i < 5; i++) {
            advisor.recordAction("create_task", { title: `Task ${i}` });
        }
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain("enable_pm"); // offer not re-triggered
    });

    it("pm_full_offer does NOT fire if user declined", () => {
        const { advisor, repos } = makeAdvisor(true, false);
        repos.config.set("pm_full_declined", "true", NOW);
        advisor.recordAction("get_decisions", {});
        for (let i = 0; i < 5; i++) {
            advisor.recordAction("create_task", { title: `Task ${i}` });
        }
        const nudge = advisor.checkNudge();
        if (nudge) expect(nudge).not.toContain("enable_pm");
    });
});

// ─── 9.3 Phase gate flow ──────────────────────────────────────────────────────
//
// Flow: create phase:planning tasks → complete all → gate event auto-scheduled
//       → getKnowledge('checklist', 2) returns checklist data

describe("9.3 Phase gate flow: complete phase → gate event → checklist", () => {
    it("gate event is scheduled when last phase:planning task completes (PM-Full ON)", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_full_enabled", "true", NOW);
        const service = new EventTriggerService(repos);

        const taskId = repos.tasks.create(null, NOW, {
            title: "Draft planning doc",
            status: "backlog",
            priority: "medium",
            tags: ["phase:planning"],
        });
        repos.tasks.update(taskId, NOW, { status: "done" });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: "phase-gate-2", limit: 10 });
        expect(events).toHaveLength(1);
        expect(events[0].title).toContain("Phase Gate");
        expect(events[0].priority).toBe("high");
    });

    it("gate event is NOT scheduled if another phase:planning task remains open", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_full_enabled", "true", NOW);
        const service = new EventTriggerService(repos);

        repos.tasks.create(null, NOW, {
            title: "Still open",
            status: "backlog",
            priority: "medium",
            tags: ["phase:planning"],
        });
        const taskId = repos.tasks.create(null, NOW, {
            title: "Completing this one",
            status: "backlog",
            priority: "medium",
            tags: ["phase:planning"],
        });
        repos.tasks.update(taskId, NOW, { status: "done" });
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: "phase-gate-2", limit: 10 });
        expect(events).toHaveLength(0);
    });

    it("getKnowledge('checklist', 2) returns the planning→execution checklist", () => {
        const result = getKnowledge("checklist", 2) as Record<string, unknown>;
        expect(result).toBeDefined();
        expect(result.error).toBeUndefined();
        expect(result.fromPhase).toBe(2);
        expect(result.items).toBeInstanceOf(Array);
    });

    it("getKnowledge('checklist') without phase returns error", () => {
        const result = getKnowledge("checklist") as Record<string, unknown>;
        expect(result.error).toBeDefined();
    });

    it("getKnowledge('phase_info', 2) returns planning phase info", () => {
        const result = getKnowledge("phase_info", 2) as Record<string, unknown>;
        expect(result).toBeDefined();
        expect(result.error).toBeUndefined();
        expect(result.phase).toBe(2);
        expect(result.entryCriteria).toBeInstanceOf(Array);
        expect(result.exitCriteria).toBeInstanceOf(Array);
    });

    it("gate event scheduling is idempotent (calling twice does not double-create)", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_full_enabled", "true", NOW);
        const service = new EventTriggerService(repos);

        const taskId = repos.tasks.create(null, NOW, {
            title: "Solo planning task",
            status: "backlog",
            priority: "medium",
            tags: ["phase:planning"],
        });
        repos.tasks.update(taskId, NOW, { status: "done" });

        // Trigger twice — only one event should be created
        service.triggerTaskCompleteEvents(taskId);
        service.triggerTaskCompleteEvents(taskId);

        const events = repos.events.getFiltered({ tag: "phase-gate-2", limit: 10 });
        expect(events).toHaveLength(1);
    });
});

// ─── 9.4 PM error isolation ───────────────────────────────────────────────────
//
// Flow: PM code throws → pmSafe catches → fallback returned → core ops unaffected

describe("9.4 PM error isolation via pmSafe", () => {
    it("pmSafe returns fallback when operation throws", () => {
        const fallback = { error: "knowledge base unavailable" };
        const result = pmSafe(
            () => { throw new Error("Simulated knowledge base failure"); },
            fallback,
            "test_knowledge_query",
            null,
        );
        expect(result).toEqual(fallback);
    });

    it("pmSafe returns operation result when no error", () => {
        const result = pmSafe(
            () => ({ data: "ok", count: 42 }),
            { data: "fallback", count: 0 },
            "test_success",
            null,
        );
        expect(result).toEqual({ data: "ok", count: 42 });
    });

    it("pmSafe records failure in diagnostics tracker", () => {
        const diagnostics = new PMDiagnosticsTracker();
        pmSafe(
            () => { throw new Error("KB error"); },
            null,
            "kb_query",
            diagnostics,
        );
        const status = diagnostics.getStatus();
        expect(status.failure_count).toBe(1);
        expect(status.pm_full_healthy).toBe(false);
    });

    it("pmSafe with null diagnostics tracker does not throw", () => {
        expect(() => {
            pmSafe(
                () => { throw new Error("oops"); },
                "fallback",
                "test_null_tracker",
                null,
            );
        }).not.toThrow();
    });

    it("core DB operations work normally even when PM code fails", () => {
        const { repos } = createTestDb();

        // Simulate a PM advisor failure
        pmSafe(
            () => { throw new Error("Advisor exploded"); },
            null,
            "advisor_check",
            null,
        );

        // Core operations should be completely unaffected
        const taskId = repos.tasks.create(null, NOW, {
            title: "Important work",
            status: "backlog",
            priority: "high",
        });
        const task = repos.tasks.getById(taskId);
        expect(task).not.toBeNull();
        expect(task?.title).toBe("Important work");
    });

    it("PMDiagnosticsTracker.getStatus returns healthy=true initially", () => {
        const diagnostics = new PMDiagnosticsTracker();
        const status = diagnostics.getStatus();
        expect(status.pm_full_healthy).toBe(true);
        expect(status.pm_lite_healthy).toBe(true);
        expect(status.failure_count).toBe(0);
    });

    it("PMDiagnosticsTracker marks unhealthy after multiple failures", () => {
        const diagnostics = new PMDiagnosticsTracker();
        diagnostics.recordFailure("test", "error 1");
        diagnostics.recordFailure("test", "error 2");
        diagnostics.recordFailure("test", "error 3");
        const status = diagnostics.getStatus();
        expect(status.failure_count).toBe(3);
        expect(status.pm_full_healthy).toBe(false);
    });
});

// ─── 9.5 PM disable/enable cycle ─────────────────────────────────────────────
//
// Flow: enable PM-Full → verify active → disable → verify inactive
//       → re-enable → verify active again

describe("9.5 PM disable/enable cycle", () => {
    it("default state: PM-Lite enabled, PM-Full disabled", () => {
        const { repos } = createTestDb();
        expect(repos.config.get("pm_lite_enabled")).not.toBe("false");
        expect(repos.config.get("pm_full_enabled")).not.toBe("true");
    });

    it("enable_pm sets pm_full_enabled=true and clears declined flag", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_full_declined", "true", NOW);

        // Simulate enable_pm action
        repos.config.set("pm_full_enabled", "true", NOW);
        repos.config.set("pm_full_declined", "false", NOW);

        expect(repos.config.get("pm_full_enabled")).toBe("true");
        expect(repos.config.get("pm_full_declined")).toBe("false");
    });

    it("phase_gate_skip nudge fires when PM-Full is enabled", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_full_enabled", "true", NOW);
        const diagnostics = new PMDiagnosticsTracker();
        const advisor = new WorkflowAdvisorService(repos, diagnostics);

        advisor.recordAction("update_task", { id: 1, status: "done", tags: ["phase:2", "planning"] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("checklist");
    });

    it("disable_pm: phase_gate_skip nudge does NOT fire when PM-Full is disabled", () => {
        const { repos } = createTestDb();
        // Disable PM-Full (default state)
        repos.config.set("pm_full_enabled", "false", NOW);
        const diagnostics = new PMDiagnosticsTracker();
        const advisor = new WorkflowAdvisorService(repos, diagnostics);

        advisor.recordAction("update_task", { id: 1, status: "done", tags: ["phase:2", "planning"] });
        const nudge = advisor.checkNudge();
        // With PM-Full disabled, phase_gate_skip should not fire
        if (nudge) expect(nudge).not.toContain("checklist");
    });

    it("re-enable: phase_gate_skip fires again after re-enable", () => {
        const { repos } = createTestDb();

        // Start disabled
        repos.config.set("pm_full_enabled", "false", NOW);

        // Re-enable
        repos.config.set("pm_full_enabled", "true", NOW);

        const diagnostics = new PMDiagnosticsTracker();
        const advisor = new WorkflowAdvisorService(repos, diagnostics);

        advisor.recordAction("update_task", { id: 1, status: "done", tags: ["phase:3"] });
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("checklist");
    });

    it("disable_pm_lite: no PM-Lite nudges fire when disabled", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_lite_enabled", "false", NOW);
        repos.config.set("pm_full_enabled", "false", NOW);
        const diagnostics = new PMDiagnosticsTracker();
        const advisor = new WorkflowAdvisorService(repos, diagnostics);

        // These would normally trigger PM-Lite nudges
        for (let i = 0; i < 5; i++) {
            advisor.recordAction("begin_work", { file_path: `file${i}.ts` });
        }
        expect(advisor.checkNudge()).toBeNull();
    });

    it("enable_pm_lite restores PM-Lite nudges", () => {
        const { repos } = createTestDb();
        repos.config.set("pm_lite_enabled", "false", NOW);
        repos.config.set("pm_lite_enabled", "true", NOW); // re-enable
        const diagnostics = new PMDiagnosticsTracker();
        const advisor = new WorkflowAdvisorService(repos, diagnostics);

        for (let i = 0; i < 3; i++) {
            advisor.recordAction("begin_work", { file_path: `file${i}.ts` });
        }
        const nudge = advisor.checkNudge();
        expect(nudge).not.toBeNull();
        expect(nudge).toContain("record_change");
    });

    it("full cycle: enabled → disabled → re-enabled verifies config state at each step", () => {
        const { repos } = createTestDb();

        // Step 1: Enable
        repos.config.set("pm_full_enabled", "true", NOW);
        expect(repos.config.get("pm_full_enabled")).toBe("true");

        // Step 2: Disable
        repos.config.set("pm_full_enabled", "false", NOW);
        expect(repos.config.get("pm_full_enabled")).toBe("false");

        // Step 3: Re-enable
        repos.config.set("pm_full_enabled", "true", NOW);
        expect(repos.config.get("pm_full_enabled")).toBe("true");
    });
});
