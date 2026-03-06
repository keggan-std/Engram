// ============================================================================
// Tests — Convention Repository V23 (summary, tags, getActiveFocused)
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { ConventionsRepo } from "../../src/repositories/conventions.repo.js";
import type { Database } from "better-sqlite3";

let db: Database;
let conventions: ConventionsRepo;

beforeEach(() => {
    const { db: testDb } = createTestDb();
    db = testDb;
    conventions = new ConventionsRepo(db);
});

// ─── create() with V23 fields ────────────────────────────────────────────────

describe("ConventionsRepo.create() V23 fields", () => {
    it("creates with summary and tags populated", () => {
        const id = conventions.create(
            1,
            "2025-01-01T00:00:00Z",
            "naming",
            "Use camelCase for all variable and function names in TypeScript source files",
            ["useCamelCase()", "myVariable"],
            "Use camelCase for variables and functions",
            ["naming", "typescript"]
        );
        expect(id).toBeGreaterThan(0);
        const rows = conventions.getActive();
        const row = rows.find(r => r.id === id);
        expect(row).toBeDefined();
        expect(row!.summary).toBe("Use camelCase for variables and functions");
        expect(row!.tags).toBe(JSON.stringify(["naming", "typescript"]));
    });

    it("creates with null summary and tags (backward compat)", () => {
        const id = conventions.create(1, "2025-01-01T00:00:00Z", "general", "Always write tests first");
        const rows = conventions.getActive();
        const row = rows.find(r => r.id === id);
        expect(row).toBeDefined();
        expect(row!.summary).toBeNull();
        expect(row!.tags).toBeNull();
    });

    it("creates with summary only (no tags)", () => {
        const id = conventions.create(
            null,
            "2025-01-01T00:00:00Z",
            "testing",
            "Write unit tests for every public method",
            null,
            "Write unit tests for public methods"
        );
        const row = conventions.getActive().find(r => r.id === id);
        expect(row!.summary).toBe("Write unit tests for public methods");
        expect(row!.tags).toBeNull();
    });

    it("creates with tags only (no summary)", () => {
        const id = conventions.create(
            null,
            "2025-01-01T00:00:00Z",
            "logging",
            "Use console.error for diagnostics",
            null,
            null,
            ["logging", "errors"]
        );
        const row = conventions.getActive().find(r => r.id === id);
        expect(row!.summary).toBeNull();
        expect(row!.tags).toBe(JSON.stringify(["logging", "errors"]));
    });
});

// ─── getActiveFocused() ───────────────────────────────────────────────────────

describe("ConventionsRepo.getActiveFocused()", () => {
    beforeEach(() => {
        // Seed conventions
        conventions.create(1, "2025-01-01T00:00:00Z", "naming", "Use camelCase for TypeScript variables", null, "camelCase for TS variables", ["naming", "typescript"]);
        conventions.create(1, "2025-01-01T00:00:00Z", "testing", "Write vitest unit tests for every service", null, "Write vitest tests", ["testing", "vitest"]);
        conventions.create(1, "2025-01-01T00:00:00Z", "logging", "Use console.error only — never console.log", null, "Use console.error only", ["logging"]);
        conventions.create(1, "2025-01-01T00:00:00Z", "architecture", "Barrel export all modules through index.ts", null, "Barrel export from index.ts", ["architecture", "exports"]);
    });

    it("returns active conventions ranked by FTS relevance", () => {
        const results = conventions.getActiveFocused("typescript naming", 10);
        expect(results.length).toBeGreaterThan(0);
        // The typescipt/naming convention should appear
        expect(results.some(r => r.category === "naming")).toBe(true);
    });

    it("returns all active when ftsQuery is empty string", () => {
        const results = conventions.getActiveFocused("", 10);
        expect(results.length).toBe(4);
    });

    it("returns all active when ftsQuery is whitespace-only", () => {
        const results = conventions.getActiveFocused("   ", 10);
        expect(results.length).toBe(4);
    });

    it("respects the limit parameter", () => {
        const results = conventions.getActiveFocused("", 2);
        expect(results.length).toBe(2);
    });

    it("applies default limit of 10 when not specified", () => {
        // Seed more conventions to go over 10
        for (let i = 0; i < 8; i++) {
            conventions.create(null, "2025-01-01T00:00:00Z", "general", `Rule number ${i} about coding standards`, null, `Rule ${i}`, ["general"]);
        }
        const results = conventions.getActiveFocused("");
        expect(results.length).toBeLessThanOrEqual(10);
    });

    it("does not return disabled conventions", () => {
        const rows = conventions.getActive();
        conventions.toggle(rows[0].id, false); // disable first
        const results = conventions.getActiveFocused("", 10);
        expect(results.length).toBe(3); // 4 inserted - 1 disabled
    });

    it("falls back gracefully to getActive when FTS table missing", () => {
        // Simulate FTS unavailability by dropping the index
        db.exec("DROP TABLE IF EXISTS fts_conventions");
        const results = conventions.getActiveFocused("typescript", 10);
        // Should fall back without throwing
        expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("falls back to getActive when FTS query matches nothing", () => {
        const results = conventions.getActiveFocused("xyzabcnonexistentterm", 10);
        // Should return all active rather than empty (fallback behavior)
        expect(results.length).toBeGreaterThan(0);
    });
});

// ─── ConventionRow V23 type shape ─────────────────────────────────────────────

describe("ConventionRow V23 type shape", () => {
    it("rows returned by getActive() include summary and tags fields", () => {
        conventions.create(1, "2025-01-01T00:00:00Z", "general", "Write clean code", null, "Write clean code", ["general"]);
        const rows = conventions.getActive();
        expect(rows[0]).toHaveProperty("summary");
        expect(rows[0]).toHaveProperty("tags");
    });

    it("rows from getFiltered() include summary and tags fields", () => {
        conventions.create(1, "2025-01-01T00:00:00Z", "general", "Write clean code", null, "Summary here", null);
        const rows = conventions.getFiltered({ includeDisabled: false });
        expect(rows[0]).toHaveProperty("summary");
        expect(rows[0].summary).toBe("Summary here");
    });
});
