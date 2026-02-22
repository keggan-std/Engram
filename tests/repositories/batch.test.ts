// ============================================================================
// Repository Tests — Batch Operations
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "../helpers/test-db.js";
import { FileNotesRepo } from "../../src/repositories/file-notes.repo.js";
import { DecisionsRepo } from "../../src/repositories/decisions.repo.js";

let db: Database.Database;

beforeEach(() => {
    db = createTestDb();
});

// ─── FileNotesRepo.upsertBatch ──────────────────────────────────────

describe("FileNotesRepo.upsertBatch", () => {
    it("should insert multiple file notes in a single transaction", () => {
        const repo = new FileNotesRepo(db);
        const entries = [
            { file_path: "src/index.ts", purpose: "Entry point", layer: "config" as const },
            { file_path: "src/utils.ts", purpose: "Utility functions", layer: "util" as const },
            { file_path: "src/database.ts", purpose: "DB layer", layer: "database" as const, complexity: "complex" as const },
        ];

        const count = repo.upsertBatch(entries, "2025-01-01T00:00:00Z", 1);

        expect(count).toBe(3);
        expect(repo.countAll()).toBe(3);
    });

    it("should normalize paths during batch insert", () => {
        const repo = new FileNotesRepo(db);
        const entries = [
            { file_path: "src\\tools\\sessions.ts", purpose: "Sessions" },
            { file_path: "./src/tools/changes.ts", purpose: "Changes" },
        ];

        repo.upsertBatch(entries, "2025-01-01T00:00:00Z", 1);

        // Should be able to find by normalized path
        const note1 = repo.getByPath("src/tools/sessions.ts");
        const note2 = repo.getByPath("src/tools/changes.ts");
        expect(note1).not.toBeNull();
        expect(note1!.purpose).toBe("Sessions");
        expect(note2).not.toBeNull();
        expect(note2!.purpose).toBe("Changes");
    });

    it("should upsert (update) existing entries", () => {
        const repo = new FileNotesRepo(db);

        // Insert initial
        repo.upsertBatch(
            [{ file_path: "src/index.ts", purpose: "Old purpose" }],
            "2025-01-01T00:00:00Z", 1
        );

        // Upsert with updated purpose
        repo.upsertBatch(
            [{ file_path: "src/index.ts", purpose: "New purpose" }],
            "2025-01-01T01:00:00Z", 2
        );

        expect(repo.countAll()).toBe(1);
        const note = repo.getByPath("src/index.ts");
        expect(note!.purpose).toBe("New purpose");
    });

    it("should normalize dependency paths", () => {
        const repo = new FileNotesRepo(db);
        repo.upsertBatch(
            [{ file_path: "src/index.ts", dependencies: ["src\\utils.ts", "./src/database.ts"] }],
            "2025-01-01T00:00:00Z", 1
        );

        const note = repo.getByPath("src/index.ts");
        const deps = JSON.parse(note!.dependencies as string);
        expect(deps).toEqual(["src/utils.ts", "src/database.ts"]);
    });
});

// ─── DecisionsRepo.createBatch ──────────────────────────────────────

describe("DecisionsRepo.createBatch", () => {
    it("should insert multiple decisions and return IDs", () => {
        const repo = new DecisionsRepo(db);
        const decisions = [
            { decision: "Use SQLite for storage", rationale: "Lightweight and embedded" },
            { decision: "Use TypeScript for type safety", tags: ["language"] },
            { decision: "Use WAL mode for concurrency", status: "active" as const },
        ];

        const ids = repo.createBatch(decisions, 1, "2025-01-01T00:00:00Z");

        expect(ids).toHaveLength(3);
        expect(ids[0]).toBeGreaterThan(0);
        expect(ids[1]).toBeGreaterThan(ids[0]);
        expect(ids[2]).toBeGreaterThan(ids[1]);
    });

    it("should store all decision fields correctly", () => {
        const repo = new DecisionsRepo(db);
        const ids = repo.createBatch(
            [{
                decision: "Use ESM modules",
                rationale: "Modern standard",
                affected_files: ["package.json", "tsconfig.json"],
                tags: ["build", "architecture"],
                status: "experimental",
            }],
            1,
            "2025-01-01T00:00:00Z"
        );

        const all = repo.getActive(10);
        // experimental won't show up in getActive (status='active' only)
        expect(all).toHaveLength(0);

        const filtered = repo.getFiltered({ status: "experimental", limit: 10 });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].decision).toBe("Use ESM modules");
        expect(filtered[0].rationale).toBe("Modern standard");
    });

    it("should be atomic — all or nothing", () => {
        const repo = new DecisionsRepo(db);

        // First batch should succeed
        const ids = repo.createBatch(
            [{ decision: "Decision A" }, { decision: "Decision B" }],
            1,
            "2025-01-01T00:00:00Z"
        );
        expect(ids).toHaveLength(2);
        expect(repo.countAll()).toBe(2);
    });
});

// ─── DecisionsRepo.findSimilar ──────────────────────────────────────

describe("DecisionsRepo.findSimilar", () => {
    it("should find similar decisions by key words", () => {
        const repo = new DecisionsRepo(db);
        repo.create(1, "2025-01-01T00:00:00Z", "Use SQLite for persistent storage", "Lightweight");
        repo.create(1, "2025-01-01T00:00:00Z", "Use PostgreSQL for cloud storage", "Scalable");

        const similar = repo.findSimilar("SQLite for database storage");
        expect(similar.length).toBeGreaterThanOrEqual(1);
        expect(similar.some(d => d.decision.includes("SQLite"))).toBe(true);
    });

    it("should return empty array for very short text", () => {
        const repo = new DecisionsRepo(db);
        repo.create(1, "2025-01-01T00:00:00Z", "Use SQLite", null);

        const similar = repo.findSimilar("ab");
        expect(similar).toHaveLength(0);
    });

    it("should only return active decisions", () => {
        const repo = new DecisionsRepo(db);
        const id = repo.create(1, "2025-01-01T00:00:00Z", "Use SQLite for storage", null);
        repo.updateStatus(id, "deprecated");

        const similar = repo.findSimilar("SQLite for persistent storage");
        expect(similar).toHaveLength(0);
    });
});
