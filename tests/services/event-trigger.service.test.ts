// ============================================================================
// Service Tests — EventTriggerService
// Verifies that triggerSessionEvents() fires the correct event subsets,
// triggerTaskCompleteEvents() targets the right taskId, and checkEvents()
// only processes datetime events. Graceful fallback is not tested here
// because createTestDb() always includes the scheduled_events table.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "../helpers/test-db.js";
import { createRepositories } from "../../src/repositories/index.js";
import { EventTriggerService } from "../../src/services/event-trigger.service.js";
import type { Repositories } from "../../src/repositories/index.js";

let db: Database.Database;
let repos: Repositories;
let service: EventTriggerService;

beforeEach(() => {
    db = createTestDb();
    repos = createRepositories(db);
    service = new EventTriggerService(repos);
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function seedEvent(
    opts: {
        title: string;
        trigger_type: string;
        trigger_value?: string;
        recurrence?: string;
        priority?: string;
    }
): number {
    return repos.events.create(null, "2025-01-01T00:00:00Z", opts);
}

// ─── triggerSessionEvents ─────────────────────────────────────────────────────

describe("EventTriggerService.triggerSessionEvents", () => {
    it("should trigger next_session events", () => {
        seedEvent({ title: "Check PRs", trigger_type: "next_session" });

        const triggered = service.triggerSessionEvents();
        expect(triggered.length).toBeGreaterThanOrEqual(1);
        expect(triggered.some(e => e.title === "Check PRs")).toBe(true);
    });

    it("should trigger expired datetime events", () => {
        seedEvent({
            title: "Past deadline",
            trigger_type: "datetime",
            trigger_value: "2020-01-01T00:00:00Z", // always in the past
        });

        const triggered = service.triggerSessionEvents();
        expect(triggered.some(e => e.title === "Past deadline")).toBe(true);
    });

    it("should NOT trigger future datetime events", () => {
        seedEvent({
            title: "Future event",
            trigger_type: "datetime",
            trigger_value: "2099-01-01T00:00:00Z",
        });

        const triggered = service.triggerSessionEvents();
        expect(triggered.every(e => e.title !== "Future event")).toBe(true);
    });

    it("should trigger every_session recurring events", () => {
        seedEvent({
            title: "Recurring check",
            trigger_type: "next_session",
            recurrence: "every_session",
        });

        const triggered = service.triggerSessionEvents();
        expect(triggered.some(e => e.title === "Recurring check")).toBe(true);
    });

    it("should trigger events of all three types in one call", () => {
        seedEvent({ title: "NS event", trigger_type: "next_session" });
        seedEvent({ title: "Expired DT", trigger_type: "datetime", trigger_value: "2020-01-01T00:00:00Z" });
        seedEvent({ title: "Recurring", trigger_type: "next_session", recurrence: "every_session" });

        const triggered = service.triggerSessionEvents();
        // All three should be present (next_session, expired datetime, recurring)
        const titles = triggered.map(e => e.title);
        expect(titles).toContain("NS event");
        expect(titles).toContain("Expired DT");
        expect(titles).toContain("Recurring");
    });

    it("should return empty array when no events are pending", () => {
        const triggered = service.triggerSessionEvents();
        expect(triggered).toHaveLength(0);
    });
});

// ─── triggerTaskCompleteEvents ────────────────────────────────────────────────

describe("EventTriggerService.triggerTaskCompleteEvents", () => {
    it("should trigger task_complete event for matching taskId", () => {
        seedEvent({ title: "On task 7", trigger_type: "task_complete", trigger_value: "7" });
        seedEvent({ title: "On task 8", trigger_type: "task_complete", trigger_value: "8" });

        const triggered = service.triggerTaskCompleteEvents(7);
        expect(triggered).toHaveLength(1);
        expect(triggered[0].title).toBe("On task 7");
    });

    it("should return empty array when no task_complete events exist for that id", () => {
        seedEvent({ title: "On task 5", trigger_type: "task_complete", trigger_value: "5" });

        const triggered = service.triggerTaskCompleteEvents(99);
        expect(triggered).toHaveLength(0);
    });
});

// ─── checkEvents ─────────────────────────────────────────────────────────────

describe("EventTriggerService.checkEvents", () => {
    it("should trigger expired datetime events only", () => {
        seedEvent({ title: "Past DT", trigger_type: "datetime", trigger_value: "2020-01-01T00:00:00Z" });
        seedEvent({ title: "NS event", trigger_type: "next_session" }); // should NOT be triggered

        const triggered = service.checkEvents();
        expect(triggered.some(e => e.title === "Past DT")).toBe(true);
        expect(triggered.every(e => e.title !== "NS event")).toBe(true);
    });

    it("should return empty array when no datetime events are expired", () => {
        seedEvent({ title: "NS event", trigger_type: "next_session" });

        const triggered = service.checkEvents();
        expect(triggered).toHaveLength(0);
    });
});
