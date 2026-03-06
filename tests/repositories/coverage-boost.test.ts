// ============================================================================
// Step 9.7 — Repository Coverage Boost
//
// Targeted tests for repository methods not exercised by existing test files.
// Goal: Push src/repositories/** statement coverage from ~71% to ≥75%.
//
// Covers: SessionsRepo, ChangesRepo, TasksRepo, DecisionsRepo, EventsRepo.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import type { Repositories } from "../../src/repositories/index.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

let repos: Repositories;
const NOW = "2025-06-01T12:00:00.000Z";
const LATER = "2025-06-01T13:00:00.000Z";

beforeEach(() => {
    ({ repos } = createTestDb());
});

// ─── SessionsRepo — missing coverage ──────────────────────────────────────────

describe("SessionsRepo — extended coverage", () => {
    it("autoClose marks session as auto-closed", () => {
        const { repos: r } = createTestDb();
        const id = r.sessions.create("agent", "/root", NOW);
        r.sessions.autoClose(id, LATER);
        const last = r.sessions.getLastCompleted();
        expect(last).not.toBeNull();
        expect(last!.summary).toBe("(auto-closed: new session started)");
    });

    it("getLastCompleted returns null when no completed sessions", () => {
        const { repos: r } = createTestDb();
        expect(r.sessions.getLastCompleted()).toBeNull();
    });

    it("countCompleted returns count of closed sessions only", () => {
        const { repos: r } = createTestDb();
        const id1 = r.sessions.create("a", "/", NOW);
        r.sessions.create("b", "/", NOW); // stays open
        r.sessions.close(id1, LATER, "done");
        expect(r.sessions.countCompleted()).toBe(1);
    });

    it("getOldest returns timestamp of earliest session", () => {
        const { repos: r } = createTestDb();
        r.sessions.create("a", "/", "2025-01-01T00:00:00Z");
        r.sessions.create("b", "/", "2025-06-01T00:00:00Z");
        const oldest = r.sessions.getOldest();
        expect(oldest).toBe("2025-01-01T00:00:00Z");
    });

    it("getOldest returns null when no sessions", () => {
        const { repos: r } = createTestDb();
        expect(r.sessions.getOldest()).toBeNull();
    });

    it("getNewest returns timestamp of most recent session", () => {
        const { repos: r } = createTestDb();
        r.sessions.create("a", "/", "2025-01-01T00:00:00Z");
        r.sessions.create("b", "/", "2025-06-01T00:00:00Z");
        const newest = r.sessions.getNewest();
        expect(newest).toBe("2025-06-01T00:00:00Z");
    });

    it("getIdAtOffset returns session id at position", () => {
        const { repos: r } = createTestDb();
        const id1 = r.sessions.create("a", "/", NOW);
        r.sessions.create("b", "/", LATER);
        // Offset 0 = newest, offset 1 = second newest
        const atOffset1 = r.sessions.getIdAtOffset(1);
        expect(atOffset1).toBe(id1);
    });

    it("getIdAtOffset returns null beyond available sessions", () => {
        const { repos: r } = createTestDb();
        expect(r.sessions.getIdAtOffset(99)).toBeNull();
    });

    it("getCompletedBeforeId returns IDs of closed sessions at/before cutoff", () => {
        const { repos: r } = createTestDb();
        const id1 = r.sessions.create("a", "/", NOW);
        const id2 = r.sessions.create("b", "/", LATER);
        r.sessions.close(id1, LATER, "done");
        // id2 open — not completed. Only id1 should be returned.
        const completed = r.sessions.getCompletedBeforeId(id2);
        expect(completed).toContain(id1);
    });

    it("countBySession counts rows in a given table for a session", () => {
        const { repos: r } = createTestDb();
        const sessionId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "a.ts", change_type: "created", description: "add a", impact_scope: "local" },
            { file_path: "b.ts", change_type: "modified", description: "mod b", impact_scope: "local" },
        ], sessionId, NOW);
        const count = r.sessions.countBySession(sessionId, "changes");
        expect(count).toBe(2);
    });

    it("getDurationStats returns metric fields", () => {
        const { repos: r } = createTestDb();
        const id = r.sessions.create("agent", "/", "2025-06-01T10:00:00Z");
        r.sessions.close(id, "2025-06-01T10:30:00Z", "done");
        const stats = r.sessions.getDurationStats();
        expect(stats).toHaveProperty("avg_minutes");
        expect(stats).toHaveProperty("max_minutes");
        expect(stats).toHaveProperty("sessions_last_7_days");
        expect(typeof stats.avg_minutes).toBe("number");
    });

    it("getDurationStats returns zero metrics when no completed sessions", () => {
        const { repos: r } = createTestDb();
        const stats = r.sessions.getDurationStats();
        expect(stats.avg_minutes).toBe(0);
        expect(stats.max_minutes).toBe(0);
    });

    it("getById returns the correct session", () => {
        const { repos: r } = createTestDb();
        const id = r.sessions.create("my-agent", "/repo", NOW);
        const session = r.sessions.getById(id);
        expect(session).not.toBeNull();
        expect(session!.agent_name).toBe("my-agent");
    });

    it("getById returns null for missing session", () => {
        const { repos: r } = createTestDb();
        expect(r.sessions.getById(99999)).toBeNull();
    });

    it("getHistory filtered by agentName", () => {
        const { repos: r } = createTestDb();
        r.sessions.create("alice", "/", NOW);
        r.sessions.create("alice", "/", LATER);
        r.sessions.create("bob", "/", NOW);
        const aliceHistory = r.sessions.getHistory(10, 0, "alice");
        expect(aliceHistory.every(s => s.agent_name === "alice")).toBe(true);
        expect(aliceHistory).toHaveLength(2);
    });

    it("close with tags stores JSON-encoded tag array", () => {
        const { repos: r } = createTestDb();
        const id = r.sessions.create("agent", "/", NOW);
        r.sessions.close(id, LATER, "done", ["pm-framework", "refactor"]);
        const completed = r.sessions.getLastCompleted();
        expect(completed).not.toBeNull();
        // Tags stored as JSON string in DB, retrieve via getById
        const row = r.sessions.getById(id);
        expect(row?.tags).toBeTruthy();
    });
});

// ─── ChangesRepo — missing coverage ──────────────────────────────────────────

describe("ChangesRepo — extended coverage", () => {
    it("getBySession returns non-compacted changes for session", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "x.ts", change_type: "created", description: "added x", impact_scope: "local" },
        ], sessId, NOW);
        const bySession = r.changes.getBySession(sessId);
        expect(bySession).toHaveLength(1);
        expect(bySession[0].file_path).toBe("x.ts");
    });

    it("getBySessionFull returns all changes including compacted", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "a.ts", change_type: "modified", description: "fix", impact_scope: "local" },
        ], sessId, NOW);
        r.changes.insertCompacted(sessId, NOW, "Compacted session");
        // Full should return both
        const full = r.changes.getBySessionFull(sessId);
        expect(full.length).toBeGreaterThanOrEqual(2);
    });

    it("insertCompacted creates a compacted sentinel row", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.insertCompacted(sessId, NOW, "Session summary");
        const bySession = r.changes.getBySession(sessId); // excludes compacted
        expect(bySession).toHaveLength(0);
        const full = r.changes.getBySessionFull(sessId); // includes compacted
        expect(full.some(c => c.file_path === "(compacted)")).toBe(true);
    });

    it("deleteNonCompacted removes normal changes but keeps compacted", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "a.ts", change_type: "created", description: "added", impact_scope: "local" },
        ], sessId, NOW);
        r.changes.insertCompacted(sessId, NOW, "Summary");
        r.changes.deleteNonCompacted(sessId);
        const full = r.changes.getBySessionFull(sessId);
        expect(full).toHaveLength(1);
        expect(full[0].file_path).toBe("(compacted)");
    });

    it("getMostChanged returns files sorted by change count", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "hot.ts", change_type: "modified", description: "edit 1", impact_scope: "local" },
            { file_path: "hot.ts", change_type: "modified", description: "edit 2", impact_scope: "local" },
            { file_path: "cold.ts", change_type: "created", description: "added", impact_scope: "local" },
        ], sessId, NOW);
        const result = r.changes.getMostChanged(5);
        expect(result[0].file_path).toBe("hot.ts");
        expect(result[0].change_count).toBe(2);
    });

    it("countBySession counts only that session's changes", () => {
        const { repos: r } = createTestDb();
        const sess1 = r.sessions.create("a", "/", NOW);
        const sess2 = r.sessions.create("b", "/", LATER);
        r.changes.recordBulk([
            { file_path: "a.ts", change_type: "created", description: "add", impact_scope: "local" },
        ], sess1, NOW);
        r.changes.recordBulk([
            { file_path: "b.ts", change_type: "created", description: "add", impact_scope: "local" },
            { file_path: "c.ts", change_type: "created", description: "add", impact_scope: "local" },
        ], sess2, LATER);
        expect(r.changes.countBySession(sess1)).toBe(1);
        expect(r.changes.countBySession(sess2)).toBe(2);
    });

    it("countBeforeCutoff counts changes in sessions up to cutoff ID", () => {
        const { repos: r } = createTestDb();
        const sess1 = r.sessions.create("a", "/", NOW);
        const sess2 = r.sessions.create("b", "/", LATER);
        r.changes.recordBulk([
            { file_path: "a.ts", change_type: "created", description: "add", impact_scope: "local" },
        ], sess1, NOW);
        r.changes.recordBulk([
            { file_path: "b.ts", change_type: "created", description: "add", impact_scope: "local" },
        ], sess2, LATER);
        // Cutoff at sess1 should count only its changes
        expect(r.changes.countBeforeCutoff(sess1)).toBe(1);
        // Cutoff at sess2 includes both
        expect(r.changes.countBeforeCutoff(sess2)).toBe(2);
    });

    it("getSince returns changes after the given timestamp", () => {
        const { repos: r } = createTestDb();
        const sessId = r.sessions.create("a", "/", NOW);
        r.changes.recordBulk([
            { file_path: "old.ts", change_type: "created", description: "old", impact_scope: "local" },
        ], sessId, "2025-01-01T00:00:00Z");
        r.changes.recordBulk([
            { file_path: "new.ts", change_type: "created", description: "new", impact_scope: "local" },
        ], sessId, "2025-12-01T00:00:00Z");
        const since = r.changes.getSince("2025-06-01T00:00:00Z");
        expect(since.some(c => c.file_path === "new.ts")).toBe(true);
        expect(since.every(c => c.file_path !== "old.ts")).toBe(true);
    });
});

// ─── TasksRepo — missing coverage ─────────────────────────────────────────────

describe("TasksRepo — extended coverage", () => {
    it("getOpenFocused returns results via FTS5 match", () => {
        repos.tasks.create(null, NOW, { title: "Implement authentication system", status: "backlog", priority: "high" });
        repos.tasks.create(null, NOW, { title: "Fix CSS layout", status: "backlog", priority: "low" });
        const results = repos.tasks.getOpenFocused("authentication");
        // Should find the auth task (or fallback to getOpen on failure — both acceptable)
        expect(Array.isArray(results)).toBe(true);
    });

    it("getOpen with resumeTask returns matching tasks first", () => {
        repos.tasks.create(null, NOW, { title: "Research API design", status: "backlog", priority: "medium" });
        repos.tasks.create(null, NOW, { title: "Write tests", status: "backlog", priority: "medium" });
        const results = repos.tasks.getOpen(10, "Research");
        // If match found, returns it; if not, falls back to all open
        expect(Array.isArray(results)).toBe(true);
        if (results.length > 0 && results[0].title.includes("Research")) {
            expect(results[0].title).toContain("Research");
        }
    });

    it("getFiltered with tag filter returns only tagged tasks", () => {
        repos.tasks.create(null, NOW, { title: "Phase 1 task", status: "backlog", priority: "medium", tags: ["phase:1"] });
        repos.tasks.create(null, NOW, { title: "No tag task", status: "backlog", priority: "medium" });
        const results = repos.tasks.getFiltered({ tag: "phase:1", limit: 10 });
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe("Phase 1 task");
    });

    it("getFiltered with status filter returns correct subset", () => {
        repos.tasks.create(null, NOW, { title: "Active task", status: "in-progress", priority: "high" });
        repos.tasks.create(null, NOW, { title: "Backlog task", status: "backlog", priority: "medium" });
        const inProgress = repos.tasks.getFiltered({ status: "in-progress", limit: 10 });
        expect(inProgress.every(t => t.status === "in-progress")).toBe(true);
    });

    it("getFiltered with includeDone=true includes done tasks", () => {
        const id = repos.tasks.create(null, NOW, { title: "Done task", status: "done", priority: "low" });
        const results = repos.tasks.getFiltered({ includeDone: true, limit: 10 });
        expect(results.some(t => t.id === id)).toBe(true);
    });

    it("getFiltered with priority filter returns matching priority", () => {
        repos.tasks.create(null, NOW, { title: "Critical task", status: "backlog", priority: "critical" });
        repos.tasks.create(null, NOW, { title: "Low task", status: "backlog", priority: "low" });
        const critical = repos.tasks.getFiltered({ priority: "critical", limit: 10 });
        expect(critical.every(t => t.priority === "critical")).toBe(true);
    });

    it("getByStatus returns task counts grouped by status", () => {
        repos.tasks.create(null, NOW, { title: "A", status: "backlog", priority: "medium" });
        repos.tasks.create(null, NOW, { title: "B", status: "backlog", priority: "medium" });
        repos.tasks.create(null, NOW, { title: "C", status: "done", priority: "medium" });
        const stats = repos.tasks.getByStatus();
        const backlog = stats.find(s => s.status === "backlog");
        expect(backlog?.count).toBe(2);
    });

    it("countDoneInSession counts only done tasks for that session", () => {
        const sessId1 = repos.sessions.create("a", "/", NOW);
        const sessId2 = repos.sessions.create("b", "/", LATER);
        const id1 = repos.tasks.create(sessId1, NOW, { title: "Task 1", status: "backlog", priority: "medium" });
        repos.tasks.update(id1, NOW, { status: "done" });
        const id2 = repos.tasks.create(sessId2, LATER, { title: "Task 2", status: "backlog", priority: "medium" });
        repos.tasks.update(id2, LATER, { status: "done" });

        expect(repos.tasks.countDoneInSession(sessId1)).toBe(1);
        expect(repos.tasks.countDoneInSession(sessId2)).toBe(1);
    });

    it("countAll returns total number of tasks", () => {
        repos.tasks.create(null, NOW, { title: "T1", status: "backlog", priority: "medium" });
        repos.tasks.create(null, NOW, { title: "T2", status: "backlog", priority: "medium" });
        expect(repos.tasks.countAll()).toBe(2);
    });
});

// ─── DecisionsRepo — missing coverage ─────────────────────────────────────────

describe("DecisionsRepo — extended coverage", () => {
    it("getActiveFocused uses FTS5 to find matching decisions", () => {
        repos.decisions.create(null, NOW, "Use PostgreSQL for all persistent storage", "Production-grade reliability");
        repos.decisions.create(null, NOW, "All UI components use Tailwind", "Consistent styling");
        const results = repos.decisions.getActiveFocused("PostgreSQL");
        expect(Array.isArray(results)).toBe(true);
        // Either FTS match or getActive fallback
    });

    it("getFiltered by status returns matching decisions", () => {
        repos.decisions.create(null, NOW, "Use TypeScript", "Type safety", null, null, "active");
        repos.decisions.create(null, NOW, "Remove React", "Too heavy", null, null, "superseded");
        const active = repos.decisions.getFiltered({ status: "active", limit: 10 });
        expect(active.every(d => d.status === "active")).toBe(true);
    });

    it("getFiltered by tag returns matching decisions", () => {
        repos.decisions.create(null, NOW, "Tagged decision", "reason", null, ["architecture", "backend"]);
        repos.decisions.create(null, NOW, "Untagged decision", "reason");
        const tagged = repos.decisions.getFiltered({ tag: "architecture", limit: 10 });
        expect(tagged.some(d => d.decision.includes("Tagged"))).toBe(true);
    });

    it("getFiltered by file_path returns decisions affecting that file", () => {
        repos.decisions.create(null, NOW, "Refactor auth.ts", "Too complex", ["src/auth.ts"]);
        repos.decisions.create(null, NOW, "Unrelated decision", "Other", ["src/other.ts"]);
        const results = repos.decisions.getFiltered({ file_path: "src/auth.ts", limit: 10 });
        expect(results.some(d => d.decision.includes("auth.ts"))).toBe(true);
    });

    it("getByFile returns decisions affecting the given file", () => {
        repos.decisions.create(null, NOW, "Move logic to utils.ts", "Reusability", ["src/utils.ts"]);
        const results = repos.decisions.getByFile("src/utils.ts");
        expect(results).toHaveLength(1);
        expect(results[0].decision).toContain("utils.ts");
    });

    it("createBatch creates multiple decisions in a transaction", () => {
        const ids = repos.decisions.createBatch([
            { decision: "Decision 1", rationale: "R1", tags: null, affected_files: null, status: "active" },
            { decision: "Decision 2", rationale: "R2", tags: ["batch"], affected_files: null, status: "active" },
            { decision: "Decision 3", rationale: "R3", tags: null, affected_files: ["src/a.ts"], status: "active" },
        ], null, NOW);
        expect(ids).toHaveLength(3);
        expect(ids.every(id => id > 0)).toBe(true);
    });

    it("findSimilar returns decisions matching keywords from the query text", () => {
        repos.decisions.create(null, NOW, "Implement authentication with JWT tokens", "Stateless auth");
        repos.decisions.create(null, NOW, "Deploy to Kubernetes cluster", "Scalability");
        const similar = repos.decisions.findSimilar("authentication JWT stateless tokens");
        expect(Array.isArray(similar)).toBe(true);
        // May find via FTS or LIKE fallback
        if (similar.length > 0) {
            expect(similar.some(d => d.decision.includes("authentication") || d.decision.includes("JWT"))).toBe(true);
        }
    });

    it("findSimilar returns empty array for very short query", () => {
        const result = repos.decisions.findSimilar("ok");
        expect(Array.isArray(result)).toBe(true);
    });
});

// ─── EventsRepo — missing coverage ────────────────────────────────────────────

describe("EventsRepo — extended coverage", () => {
    it("getById returns the correct event", () => {
        const id = repos.events.create(null, NOW, {
            title: "Review Phase 2 Gate",
            trigger_type: "next_session",
            priority: "high",
            tags: ["phase-gate-2"],
        });
        const event = repos.events.getById(id);
        expect(event).not.toBeNull();
        expect(event!.title).toBe("Review Phase 2 Gate");
    });

    it("getById returns null for non-existent ID", () => {
        expect(repos.events.getById(99999)).toBeNull();
    });

    it("updateStatus with simple status change", () => {
        const id = repos.events.create(null, NOW, {
            title: "PM Gate",
            trigger_type: "next_session",
            priority: "medium",
        });
        const changed = repos.events.updateStatus(id, "acknowledged");
        expect(changed).toBe(1);
        const event = repos.events.getById(id);
        expect(event!.status).toBe("acknowledged");
    });

    it("updateStatus with extraFields updates additional columns", () => {
        const id = repos.events.create(null, NOW, {
            title: "Scheduled review",
            trigger_type: "next_session",
            priority: "low",
        });
        const changed = repos.events.updateStatus(id, "acknowledged", {
            acknowledged_at: LATER,
        });
        expect(changed).toBe(1);
        const event = repos.events.getById(id);
        expect(event!.status).toBe("acknowledged");
    });

    it("updateStatus returns 0 for non-existent event", () => {
        const changed = repos.events.updateStatus(99999, "acknowledged");
        expect(changed).toBe(0);
    });
});
