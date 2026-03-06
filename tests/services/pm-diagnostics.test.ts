// ============================================================================
// Tests — PM Diagnostics Tracker + pmSafe Utility
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PMDiagnosticsTracker, pmSafe, PMStatusReport } from "../../src/services/pm-diagnostics.js";
import { PMFrameworkError, PMKnowledgeError, PMAdvisorError, PMPhaseError, ValidationError, DatabaseError } from "../../src/errors.js";

// ─── PMDiagnosticsTracker ────────────────────────────────────────────────────

describe("PMDiagnosticsTracker", () => {
    let tracker: PMDiagnosticsTracker;

    beforeEach(() => {
        tracker = new PMDiagnosticsTracker();
    });

    it("starts with no failures and healthy status", () => {
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(0);
        expect(status.pm_lite_healthy).toBe(true);
        expect(status.pm_full_healthy).toBe(true);
        expect(status.recent_failures).toHaveLength(0);
        expect(status.uptime_ms).toBeGreaterThanOrEqual(0);
    });

    it("records a single failure correctly", () => {
        tracker.recordFailure("test-context", "something went wrong");
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(1);
        expect(status.pm_full_healthy).toBe(false);
        expect(status.pm_lite_healthy).toBe(true); // still healthy with 1 failure < 3
        expect(status.recent_failures[0].context).toBe("test-context");
        expect(status.recent_failures[0].message).toBe("something went wrong");
        expect(status.recent_failures[0].count).toBe(1);
    });

    it("increments count for repeated context failures", () => {
        tracker.recordFailure("ctx", "error 1");
        tracker.recordFailure("ctx", "error 2");
        tracker.recordFailure("ctx", "error 3");
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(3);
        expect(status.recent_failures).toHaveLength(1);
        expect(status.recent_failures[0].count).toBe(3);
        expect(status.recent_failures[0].message).toBe("error 3"); // most recent
    });

    it("marks pm_lite_healthy=false once a context reaches 3 failures", () => {
        tracker.recordFailure("sensitive-ctx", "fail");
        tracker.recordFailure("sensitive-ctx", "fail");
        expect(tracker.getStatus().pm_lite_healthy).toBe(true);
        tracker.recordFailure("sensitive-ctx", "fail");
        expect(tracker.getStatus().pm_lite_healthy).toBe(false);
    });

    it("tracks multiple distinct contexts independently", () => {
        tracker.recordFailure("ctx-a", "error a");
        tracker.recordFailure("ctx-b", "error b");
        tracker.recordFailure("ctx-a", "error a again");
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(3);
        expect(status.recent_failures).toHaveLength(2);
    });

    it("caps recent_failures at 5 entries", () => {
        for (let i = 0; i < 10; i++) {
            tracker.recordFailure(`ctx-${i}`, `error ${i}`);
        }
        const status = tracker.getStatus();
        expect(status.recent_failures).toHaveLength(5);
    });

    it("reset() clears all failures", () => {
        tracker.recordFailure("ctx", "bad");
        tracker.recordFailure("ctx", "bad again");
        tracker.reset();
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(0);
        expect(status.pm_lite_healthy).toBe(true);
        expect(status.pm_full_healthy).toBe(true);
    });

    it("returns recent_failures sorted by most recent timestamp first", async () => {
        tracker.recordFailure("ctx-first", "a");
        await new Promise(r => setTimeout(r, 2));
        tracker.recordFailure("ctx-second", "b");
        const status = tracker.getStatus();
        expect(status.recent_failures[0].context).toBe("ctx-second");
        expect(status.recent_failures[1].context).toBe("ctx-first");
    });
});

// ─── pmSafe ──────────────────────────────────────────────────────────────────

describe("pmSafe", () => {
    let tracker: PMDiagnosticsTracker;

    beforeEach(() => {
        tracker = new PMDiagnosticsTracker();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("returns operation result on success", () => {
        const result = pmSafe(() => 42, 0, "test", tracker);
        expect(result).toBe(42);
        expect(tracker.getStatus().failure_count).toBe(0);
    });

    it("returns fallback when operation throws", () => {
        const result = pmSafe(() => { throw new Error("boom"); }, "fallback", "test", tracker);
        expect(result).toBe("fallback");
    });

    it("logs to console.error on failure with [Engram/PM] prefix", () => {
        pmSafe(() => { throw new Error("test error"); }, null, "my-context", tracker);
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("[Engram/PM]"),
        );
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("my-context"),
        );
    });

    it("records failure to tracker when provided", () => {
        pmSafe(() => { throw new Error("oops"); }, null, "tracked-ctx", tracker);
        const status = tracker.getStatus();
        expect(status.failure_count).toBe(1);
        expect(status.recent_failures[0].context).toBe("tracked-ctx");
        expect(status.recent_failures[0].message).toBe("oops");
    });

    it("works without tracker (no crash)", () => {
        const result = pmSafe(() => { throw new Error("no tracker"); }, "default", "ctx");
        expect(result).toBe("default");
    });

    it("works without tracker when null is explicitly passed", () => {
        const result = pmSafe(() => { throw new Error("null tracker"); }, 0, "ctx", null);
        expect(result).toBe(0);
    });

    it("handles non-Error throws gracefully", () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        pmSafe(() => { throw "just a string"; }, null, "ctx", tracker);
        expect(tracker.getStatus().recent_failures[0].message).toBe("just a string");
    });

    it("handles complex fallback types", () => {
        const fallback = { items: [], total: 0 };
        const result = pmSafe<{ items: number[]; total: number }>(
            () => { throw new Error("fail"); },
            fallback,
            "complex-ctx",
        );
        expect(result).toBe(fallback);
    });

    it("propagates successful async-like patterns (sync)", () => {
        let called = false;
        pmSafe(() => { called = true; return true; }, false, "ctx");
        expect(called).toBe(true);
    });
});

// ─── PM Error Classes ─────────────────────────────────────────────────────────

describe("PM Error classes", () => {
    it("PMFrameworkError has correct name and code", () => {
        const err = new PMFrameworkError("base error");
        expect(err.name).toBe("PMFrameworkError");
        expect(err.code).toBe("PM_FRAMEWORK_ERROR");
        expect(err.message).toBe("base error");
        expect(err instanceof Error).toBe(true);
    });

    it("PMKnowledgeError extends PMFrameworkError", () => {
        const err = new PMKnowledgeError("knowledge fail");
        expect(err.name).toBe("PMKnowledgeError");
        expect(err.code).toBe("PM_KNOWLEDGE_ERROR");
        expect(err instanceof PMFrameworkError).toBe(true);
    });

    it("PMAdvisorError extends PMFrameworkError", () => {
        const err = new PMAdvisorError("advisor fail");
        expect(err.name).toBe("PMAdvisorError");
        expect(err.code).toBe("PM_ADVISOR_ERROR");
        expect(err instanceof PMFrameworkError).toBe(true);
    });

    it("PMPhaseError extends PMFrameworkError", () => {
        const err = new PMPhaseError("phase fail");
        expect(err.name).toBe("PMPhaseError");
        expect(err.code).toBe("PM_PHASE_ERROR");
        expect(err instanceof PMFrameworkError).toBe(true);
    });

    it("PM errors carry optional context", () => {
        const err = new PMKnowledgeError("kb missing", { phase: 3, type: "checklist" });
        expect(err.context).toEqual({ phase: 3, type: "checklist" });
    });

    it("PM errors are catchable by PMFrameworkError base type", () => {
        const errors = [
            new PMKnowledgeError("k"),
            new PMAdvisorError("a"),
            new PMPhaseError("p"),
        ];
        for (const e of errors) {
            expect(e instanceof PMFrameworkError).toBe(true);
        }
    });

    it("PM errors do NOT inherit from core non-PM EngramError subclasses", () => {
        const err = new PMKnowledgeError("test");
        expect(err instanceof ValidationError).toBe(false);
        expect(err instanceof DatabaseError).toBe(false);
    });
});
