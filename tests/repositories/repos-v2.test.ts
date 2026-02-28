// ============================================================================
// Repository Tests — Untested Repos (ConfigRepo, EventsRepo, AgentsRepo,
//                                    BroadcastsRepo, SnapshotRepo)
// Added in migrations v1–v6 but never had companion tests. Phase 7 gap fill.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "../helpers/test-db.js";
import { ConfigRepo } from "../../src/repositories/config.repo.js";
import { EventsRepo } from "../../src/repositories/events.repo.js";
import { AgentsRepo } from "../../src/repositories/agents.repo.js";
import { BroadcastsRepo } from "../../src/repositories/broadcasts.repo.js";
import { SnapshotRepo } from "../../src/repositories/snapshot.repo.js";

let db: Database.Database;

beforeEach(() => {
    ({ db } = createTestDb());
});

// ─── ConfigRepo ───────────────────────────────────────────────────────────────

describe("ConfigRepo", () => {
    it("should return null for missing key", () => {
        const repo = new ConfigRepo(db);
        expect(repo.get("nonexistent")).toBeNull();
    });

    it("should store and retrieve a string value", () => {
        const repo = new ConfigRepo(db);
        repo.set("theme", "dark", "2025-01-01T00:00:00Z");
        expect(repo.get("theme")).toBe("dark");
    });

    it("getOrDefault should return default when key is missing", () => {
        const repo = new ConfigRepo(db);
        expect(repo.getOrDefault("missing", "fallback")).toBe("fallback");
    });

    it("getOrDefault should return stored value when key exists", () => {
        const repo = new ConfigRepo(db);
        repo.set("font", "mono", "2025-01-01T00:00:00Z");
        expect(repo.getOrDefault("font", "default-font")).toBe("mono");
    });

    it("getInt should parse stored integer string", () => {
        const repo = new ConfigRepo(db);
        repo.set("retention_days", "30", "2025-01-01T00:00:00Z");
        expect(repo.getInt("retention_days", 90)).toBe(30);
    });

    it("getInt should return default for missing key", () => {
        const repo = new ConfigRepo(db);
        expect(repo.getInt("missing", 99)).toBe(99);
    });

    it("getInt should return default for non-numeric value", () => {
        const repo = new ConfigRepo(db);
        repo.set("bad_int", "not-a-number", "2025-01-01T00:00:00Z");
        expect(repo.getInt("bad_int", 42)).toBe(42);
    });

    it("getBool should parse 'true' as true", () => {
        const repo = new ConfigRepo(db);
        repo.set("feature_flag", "true", "2025-01-01T00:00:00Z");
        expect(repo.getBool("feature_flag", false)).toBe(true);
    });

    it("getBool should return default for missing key", () => {
        const repo = new ConfigRepo(db);
        expect(repo.getBool("missing", true)).toBe(true);
    });

    it("getBool should treat non-'true' values as false", () => {
        const repo = new ConfigRepo(db);
        repo.set("flag", "yes", "2025-01-01T00:00:00Z");
        expect(repo.getBool("flag", true)).toBe(false);
    });

    it("set should overwrite existing key (upsert)", () => {
        const repo = new ConfigRepo(db);
        repo.set("key", "v1", "2025-01-01T00:00:00Z");
        repo.set("key", "v2", "2025-01-02T00:00:00Z");
        expect(repo.get("key")).toBe("v2");
    });

    it("getAll should return all stored config entries", () => {
        const repo = new ConfigRepo(db);
        repo.set("a", "1", "2025-01-01T00:00:00Z");
        repo.set("b", "2", "2025-01-01T00:00:00Z");
        repo.set("c", "3", "2025-01-01T00:00:00Z");

        const all = repo.getAll();
        expect(all.length).toBeGreaterThanOrEqual(3);
        expect(all.some(r => r.key === "a" && r.value === "1")).toBe(true);
    });
});

// ─── EventsRepo ───────────────────────────────────────────────────────────────

describe("EventsRepo", () => {
    it("should create an event and return an ID", () => {
        const repo = new EventsRepo(db);
        const id = repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Review PRs",
            trigger_type: "next_session",
        });
        expect(id).toBeGreaterThan(0);
    });

    it("should retrieve an event by ID", () => {
        const repo = new EventsRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", {
            title: "Deploy v2",
            trigger_type: "datetime",
            trigger_value: "2025-06-01T00:00:00Z",
            priority: "high",
            tags: ["release"],
        });

        const event = repo.getById(id);
        expect(event).not.toBeNull();
        expect(event!.title).toBe("Deploy v2");
        expect(event!.priority).toBe("high");
    });

    it("triggerNextSession should only trigger next_session events", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", { title: "Next", trigger_type: "next_session" });
        repo.create(null, "2025-01-01T00:00:00Z", { title: "Datetime", trigger_type: "datetime", trigger_value: "2025-01-01T00:00:00Z" });

        repo.triggerNextSession("2025-01-02T00:00:00Z");

        const triggered = repo.getTriggered();
        expect(triggered).toHaveLength(1);
        expect(triggered[0].title).toBe("Next");
    });

    it("triggerExpiredDatetime should trigger only past datetime events", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Past",
            trigger_type: "datetime",
            trigger_value: "2025-01-01T00:00:00Z",
        });
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Future",
            trigger_type: "datetime",
            trigger_value: "2099-01-01T00:00:00Z",
        });

        repo.triggerExpiredDatetime("2025-06-01T00:00:00Z");

        const triggered = repo.getTriggered();
        expect(triggered).toHaveLength(1);
        expect(triggered[0].title).toBe("Past");
    });

    it("triggerEverySession should trigger recurrence=every_session events", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Recurring",
            trigger_type: "next_session",
            recurrence: "every_session",
        });
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Once only",
            trigger_type: "next_session",
            recurrence: "once",
        });

        repo.triggerEverySession("2025-01-02T00:00:00Z");

        const triggered = repo.getTriggered();
        expect(triggered).toHaveLength(1);
        expect(triggered[0].title).toBe("Recurring");
    });

    it("triggerTaskComplete should trigger only events matching taskId", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "On task 5",
            trigger_type: "task_complete",
            trigger_value: "5",
        });
        repo.create(null, "2025-01-01T00:00:00Z", {
            title: "On task 9",
            trigger_type: "task_complete",
            trigger_value: "9",
        });

        repo.triggerTaskComplete(5, "2025-01-02T00:00:00Z");

        const triggered = repo.getTriggered();
        expect(triggered).toHaveLength(1);
        expect(triggered[0].title).toBe("On task 5");
    });

    it("getTriggered should order by priority (critical first)", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", { title: "Low", trigger_type: "next_session", priority: "low" });
        repo.create(null, "2025-01-01T00:00:00Z", { title: "Critical", trigger_type: "next_session", priority: "critical" });
        repo.create(null, "2025-01-01T00:00:00Z", { title: "High", trigger_type: "next_session", priority: "high" });

        repo.triggerNextSession("2025-01-02T00:00:00Z");

        const triggered = repo.getTriggered();
        expect(triggered[0].title).toBe("Critical");
        expect(triggered[triggered.length - 1].title).toBe("Low");
    });

    it("acknowledge should mark event as acknowledged", () => {
        const repo = new EventsRepo(db);
        const id = repo.create(null, "2025-01-01T00:00:00Z", {
            title: "Ack me",
            trigger_type: "next_session",
        });
        repo.triggerNextSession("2025-01-02T00:00:00Z");
        const changes = repo.acknowledge(id, "2025-01-02T01:00:00Z");
        expect(changes).toBe(1);

        const event = repo.getById(id);
        expect(event!.status).toBe("acknowledged");
    });

    it("getFiltered should filter by trigger_type", () => {
        const repo = new EventsRepo(db);
        repo.create(null, "2025-01-01T00:00:00Z", { title: "A", trigger_type: "next_session" });
        repo.create(null, "2025-01-01T00:00:00Z", { title: "B", trigger_type: "datetime", trigger_value: "2099-01-01T00:00:00Z" });

        const filtered = repo.getFiltered({ trigger_type: "next_session", limit: 10 });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].title).toBe("A");
    });
});

// ─── AgentsRepo ───────────────────────────────────────────────────────────────

describe("AgentsRepo", () => {
    it("should upsert a new agent and retrieve it", () => {
        const repo = new AgentsRepo(db);
        repo.upsert("agent-1", "Claude", Date.now(), "idle");

        const agent = repo.getById("agent-1");
        expect(agent).not.toBeNull();
        expect(agent!.name).toBe("Claude");
        expect(agent!.status).toBe("idle");
    });

    it("should update existing agent on second upsert (no duplicate)", () => {
        const repo = new AgentsRepo(db);
        const now = Date.now();
        repo.upsert("agent-1", "Claude", now, "idle");
        repo.upsert("agent-1", "Claude v2", now + 1000, "working");

        const all = repo.getAll();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe("Claude v2");
        expect(all[0].status).toBe("working");
    });

    it("getAll should list all agents ordered by last_seen desc", () => {
        const repo = new AgentsRepo(db);
        repo.upsert("agent-a", "Alpha", 1000, "idle");
        repo.upsert("agent-b", "Beta", 2000, "idle");

        const all = repo.getAll();
        expect(all).toHaveLength(2);
        expect(all[0].id).toBe("agent-b"); // most recent first
    });

    it("getById should return null for unknown id", () => {
        const repo = new AgentsRepo(db);
        expect(repo.getById("ghost")).toBeNull();
    });

    it("releaseStale should mark old working agents as stale", () => {
        const repo = new AgentsRepo(db);
        const staleTime = Date.now() - 60_000 * 10; // 10 minutes ago
        repo.upsert("old-agent", "Old", staleTime, "working");
        repo.upsert("new-agent", "New", Date.now(), "working");

        // Timeout: 5 minutes
        const released = repo.releaseStale(Date.now(), 60_000 * 5);
        expect(released).toBe(1);

        expect(repo.getById("old-agent")!.status).toBe("stale");
        expect(repo.getById("new-agent")!.status).toBe("working");
    });

    it("releaseStale should not affect idle agents", () => {
        const repo = new AgentsRepo(db);
        repo.upsert("idle-old", "Old Idle", Date.now() - 60_000 * 60, "idle");

        const released = repo.releaseStale(Date.now(), 60_000);
        expect(released).toBe(0); // idle agents not affected
    });
});

// ─── BroadcastsRepo ──────────────────────────────────────────────────────────

describe("BroadcastsRepo", () => {
    it("should create a broadcast and return an ID", () => {
        const repo = new BroadcastsRepo(db);
        const id = repo.create("agent-a", "Hello everyone", Date.now());
        expect(id).toBeGreaterThan(0);
    });

    it("getUnread should return broadcasts not yet read by agent", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        repo.create("sender", "Message 1", now);
        repo.create("sender", "Message 2", now);

        const unread = repo.getUnread("agent-b", now);
        expect(unread).toHaveLength(2);
    });

    it("markRead should exclude message from subsequent getUnread", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        const id = repo.create("sender", "Marked msg", now);

        repo.markRead(id, "agent-b");

        const unread = repo.getUnread("agent-b", now);
        expect(unread.every(b => b.id !== id)).toBe(true);
    });

    it("markRead should not affect other agents' unread list", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        const id = repo.create("sender", "For all", now);

        repo.markRead(id, "agent-b");

        const unreadForC = repo.getUnread("agent-c", now);
        expect(unreadForC.some(b => b.id === id)).toBe(true);
    });

    it("create with TTL should expire broadcast", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        // Create a broadcast that expired 1s ago
        repo.create("sender", "Expired msg", now - 2000, 1000); // TTL: 1s

        const unread = repo.getUnread("agent-x", now);
        expect(unread).toHaveLength(0); // already expired
    });

    it("create without TTL should always appear in getAll", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        repo.create("sender", "Persistent msg", now);

        const all = repo.getAll(now);
        expect(all).toHaveLength(1);
    });

    it("markRead is idempotent — double-marking does not duplicate", () => {
        const repo = new BroadcastsRepo(db);
        const now = Date.now();
        const id = repo.create("sender", "Once", now);

        repo.markRead(id, "agent-z");
        repo.markRead(id, "agent-z"); // second mark

        const unread = repo.getUnread("agent-z", now);
        expect(unread).toHaveLength(0);
    });
});

// ─── SnapshotRepo ─────────────────────────────────────────────────────────────

describe("SnapshotRepo", () => {
    it("getCached should return null for missing key", () => {
        const repo = new SnapshotRepo(db);
        expect(repo.getCached("nonexistent")).toBeNull();
    });

    it("should upsert and retrieve a cached value", () => {
        const repo = new SnapshotRepo(db);
        repo.upsert("summary", '{"count":42}', "2025-01-01T00:00:00Z", 60);

        const cached = repo.getCached("summary");
        expect(cached).not.toBeNull();
        expect(cached!.value).toBe('{"count":42}');
        expect(cached!.updated_at).toBe("2025-01-01T00:00:00Z");
    });

    it("should overwrite an existing cache entry on re-upsert", () => {
        const repo = new SnapshotRepo(db);
        repo.upsert("report", "v1", "2025-01-01T00:00:00Z", 60);
        repo.upsert("report", "v2", "2025-01-02T00:00:00Z", 60);

        const cached = repo.getCached("report");
        expect(cached!.value).toBe("v2");
        expect(cached!.updated_at).toBe("2025-01-02T00:00:00Z");
    });

    it("different keys should be independent", () => {
        const repo = new SnapshotRepo(db);
        repo.upsert("key-a", "value-a", "2025-01-01T00:00:00Z", 60);
        repo.upsert("key-b", "value-b", "2025-01-01T00:00:00Z", 60);

        expect(repo.getCached("key-a")!.value).toBe("value-a");
        expect(repo.getCached("key-b")!.value).toBe("value-b");
    });
});
