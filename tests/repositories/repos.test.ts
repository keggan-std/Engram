// ============================================================================
// Repository Tests — All 7 Core Repos
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "../helpers/test-db.js";
import { SessionsRepo } from "../../src/repositories/sessions.repo.js";
import { ChangesRepo } from "../../src/repositories/changes.repo.js";
import { DecisionsRepo } from "../../src/repositories/decisions.repo.js";
import { TasksRepo } from "../../src/repositories/tasks.repo.js";
import { ConventionsRepo } from "../../src/repositories/conventions.repo.js";
import { MilestonesRepo } from "../../src/repositories/milestones.repo.js";
import { FileNotesRepo } from "../../src/repositories/file-notes.repo.js";

let db: Database.Database;

beforeEach(() => {
    db = createTestDb();
});

// ─── Sessions ────────────────────────────────────────────────────────

describe("SessionsRepo", () => {
    it("should create and retrieve a session by ID", () => {
        const repo = new SessionsRepo(db);
        const id = repo.create("test-agent", "/test/project", "2025-01-01T00:00:00Z");

        expect(id).toBeGreaterThan(0);
    });

    it("should close a session with summary", () => {
        const repo = new SessionsRepo(db);
        const id = repo.create("test", "/test", "2025-01-01T00:00:00Z");

        repo.close(id, "2025-01-01T01:00:00Z", "Did some work", ["refactoring"]);

        const last = repo.getLastCompleted();
        expect(last).not.toBeNull();
        expect(last!.summary).toBe("Did some work");
    });

    it("should detect open sessions", () => {
        const repo = new SessionsRepo(db);
        const id = repo.create("test", "/", "2025-01-01T00:00:00Z");

        expect(repo.getOpenSessionId()).toBe(id);

        repo.close(id, "2025-01-01T01:00:00Z", "done");
        expect(repo.getOpenSessionId()).toBeNull();
    });

    it("should return session history with limit and offset", () => {
        const repo = new SessionsRepo(db);
        for (let i = 0; i < 5; i++) {
            repo.create(`agent-${i}`, "/", `2025-01-0${i + 1}T00:00:00Z`);
        }

        const history = repo.getHistory(3, 0);
        expect(history).toHaveLength(3);
    });

    it("should count sessions", () => {
        const repo = new SessionsRepo(db);
        repo.create("a", "/", "2025-01-01T00:00:00Z");
        repo.create("b", "/", "2025-01-02T00:00:00Z");

        expect(repo.countAll()).toBe(2);
    });
});

// ─── Changes ─────────────────────────────────────────────────────────

describe("ChangesRepo", () => {
    it("should record and retrieve changes by file", () => {
        const repo = new ChangesRepo(db);
        repo.recordBulk([
            { file_path: "src/foo.ts", change_type: "created", description: "Added foo", impact_scope: "local" },
            { file_path: "src/bar.ts", change_type: "modified", description: "Updated bar", impact_scope: "module" },
        ], 1, "2025-01-01T00:00:00Z");

        const changes = repo.getByFile("src/foo.ts", 10);
        expect(changes).toHaveLength(1);
        expect(changes[0].description).toBe("Added foo");
    });

    it("should get changes since a timestamp", () => {
        const repo = new ChangesRepo(db);
        repo.recordBulk([
            { file_path: "a.ts", change_type: "created", description: "old", impact_scope: "local" },
        ], 1, "2025-01-01T00:00:00Z");
        repo.recordBulk([
            { file_path: "b.ts", change_type: "created", description: "new", impact_scope: "local" },
        ], 1, "2025-06-01T00:00:00Z");

        const recent = repo.getSince("2025-03-01T00:00:00Z");
        expect(recent).toHaveLength(1);
        expect(recent[0].file_path).toBe("b.ts");
    });

    it("should return most changed files", () => {
        const repo = new ChangesRepo(db);
        repo.recordBulk([
            { file_path: "hot.ts", change_type: "modified", description: "1", impact_scope: "local" },
        ], 1, "2025-01-01T00:00:00Z");
        repo.recordBulk([
            { file_path: "hot.ts", change_type: "modified", description: "2", impact_scope: "local" },
        ], 1, "2025-01-02T00:00:00Z");
        repo.recordBulk([
            { file_path: "cold.ts", change_type: "created", description: "3", impact_scope: "local" },
        ], 1, "2025-01-03T00:00:00Z");

        const most = repo.getMostChanged(5);
        expect(most[0].file_path).toBe("hot.ts");
        expect(most[0].change_count).toBe(2);
    });
});

// ─── Decisions ───────────────────────────────────────────────────────

describe("DecisionsRepo", () => {
    it("should create and retrieve decisions", () => {
        const repo = new DecisionsRepo(db);
        const id = repo.create(
            1, "2025-01-01T00:00:00Z",
            "Use TypeScript es2022",
            "Modern target",
            ["tsconfig.json"],
            ["architecture"],
            "active"
        );

        expect(id).toBeGreaterThan(0);

        const decisions = repo.getFiltered({ status: "active", limit: 10 });
        expect(decisions).toHaveLength(1);
        expect(decisions[0].decision).toBe("Use TypeScript es2022");
    });

    it("should update decision status", () => {
        const repo = new DecisionsRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", "Old pattern");

        const changed = repo.updateStatus(id, "deprecated");
        expect(changed).toBe(1);

        const decisions = repo.getFiltered({ status: "deprecated", limit: 10 });
        expect(decisions).toHaveLength(1);
    });

    it("should supersede decisions", () => {
        const repo = new DecisionsRepo(db);
        const oldId = repo.create(1, "2025-01-01T00:00:00Z", "Old way");
        const newId = repo.create(1, "2025-01-02T00:00:00Z", "New way");

        repo.supersede(oldId, newId);

        const active = repo.getActive();
        expect(active.some(d => d.id === oldId)).toBe(false);
    });
});

// ─── Tasks ───────────────────────────────────────────────────────────

describe("TasksRepo", () => {
    it("should create and retrieve tasks", () => {
        const repo = new TasksRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", {
            title: "Fix Bug #42",
            description: "Critical bug in auth",
            priority: "high",
            status: "backlog",
        });

        expect(id).toBeGreaterThan(0);

        const tasks = repo.getFiltered({ limit: 10 });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe("Fix Bug #42");
    });

    it("should update task status", () => {
        const repo = new TasksRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", {
            title: "Do thing",
            priority: "medium",
            status: "backlog",
        });

        repo.update(id, "2025-01-01T01:00:00Z", { status: "in_progress" });

        const tasks = repo.getFiltered({ status: "in_progress", limit: 10 });
        expect(tasks).toHaveLength(1);
    });

    it("should get open tasks", () => {
        const repo = new TasksRepo(db);
        repo.create(1, "2025-01-01T00:00:00Z", { title: "Open task" });
        repo.create(1, "2025-01-01T00:00:00Z", { title: "Done task", status: "done" });

        const open = repo.getOpen(10);
        expect(open).toHaveLength(1);
        expect(open[0].title).toBe("Open task");
    });
});

// ─── Conventions ─────────────────────────────────────────────────────

describe("ConventionsRepo", () => {
    it("should create and toggle conventions", () => {
        const repo = new ConventionsRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", "naming", "Use camelCase for variables");

        expect(id).toBeGreaterThan(0);

        const active = repo.getFiltered({ includeDisabled: false });
        expect(active).toHaveLength(1);

        repo.toggle(id, false);
        const disabled = repo.getFiltered({ includeDisabled: false });
        expect(disabled).toHaveLength(0);

        // Including disabled should still show it
        const all = repo.getFiltered({ includeDisabled: true });
        expect(all).toHaveLength(1);
    });
});

// ─── Milestones ──────────────────────────────────────────────────────

describe("MilestonesRepo", () => {
    it("should create and list milestones", () => {
        const repo = new MilestonesRepo(db);
        const id = repo.create(
            1, "2025-01-01T00:00:00Z",
            "v1.0 Release",
            "Initial release",
            "1.0.0",
            ["release"]
        );

        expect(id).toBeGreaterThan(0);

        const milestones = repo.getAll(10);
        expect(milestones).toHaveLength(1);
        expect(milestones[0].title).toBe("v1.0 Release");
    });
});

// ─── File Notes ──────────────────────────────────────────────────────

describe("FileNotesRepo", () => {
    it("should upsert and retrieve file notes", () => {
        const repo = new FileNotesRepo(db);
        repo.upsert("src/index.ts", "2025-01-01T00:00:00Z", 1, {
            purpose: "Entry point",
            layer: "config",
            complexity: "simple",
        });

        const note = repo.getByPath("src/index.ts");
        expect(note).not.toBeNull();
        expect(note!.purpose).toBe("Entry point");
        expect(note!.layer).toBe("config");
    });

    it("should preserve existing fields when updating with null", () => {
        const repo = new FileNotesRepo(db);
        repo.upsert("src/test.ts", "2025-01-01T00:00:00Z", 1, {
            purpose: "Test file",
            layer: "test",
        });

        // Update only complexity
        repo.upsert("src/test.ts", "2025-01-02T00:00:00Z", 1, {
            complexity: "moderate",
        });

        const note = repo.getByPath("src/test.ts");
        expect(note!.purpose).toBe("Test file"); // preserved
        expect(note!.complexity).toBe("moderate"); // updated
    });

    it("should filter by layer", () => {
        const repo = new FileNotesRepo(db);
        repo.upsert("a.ts", "2025-01-01T00:00:00Z", 1, { layer: "ui" });
        repo.upsert("b.ts", "2025-01-01T00:00:00Z", 1, { layer: "data" });
        repo.upsert("c.ts", "2025-01-01T00:00:00Z", 1, { layer: "ui" });

        const uiNotes = repo.getFiltered({ layer: "ui" });
        expect(uiNotes).toHaveLength(2);
    });
});
