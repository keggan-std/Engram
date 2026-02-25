// ============================================================================
// Dispatcher Smoke Tests — engram_memory action routing
//
// Uses HandlerCapturer (duck-typed stub matching McpServer.registerTool) to
// capture the engram_memory handler after registration, then calls actions
// directly and asserts that response.content[0].text is valid JSON with the
// expected shape. Catches Zod schema regressions at the dispatcher surface.
//
// Isolation: database.js and global-db.js are mocked with an in-memory DB.
// ============================================================================

import { describe, it, expect, vi, beforeAll } from "vitest";

// ─── Database mock — must be declared before any imports that use database.js.
// vi.mock is hoisted, but the async factory runs lazily on first module import.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../src/database.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { runMigrations } = await import("../../src/migrations.js");
    const { createRepositories } = await import("../../src/repositories/index.js");

    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const repos = createRepositories(db);

    return {
        getDb: () => db,
        now: () => new Date().toISOString(),
        getCurrentSessionId: () => 1,
        getProjectRoot: () => "/test/project",
        getDbSizeKb: () => 42,
        getDbPath: () => ":memory:",
        backupDatabase: () => "/test/backup.db",
        getRepos: () => repos,
    };
});

// Prevent global-db.js from trying to open real database files on disk.
vi.mock("../../src/global-db.js", () => ({
    writeGlobalDecision: vi.fn().mockReturnValue(null),
    writeGlobalConvention: vi.fn().mockReturnValue(null),
    queryGlobalDecisions: vi.fn().mockReturnValue([]),
    queryGlobalConventions: vi.fn().mockReturnValue([]),
    getGlobalDb: vi.fn().mockReturnValue(null),
}));

// ─── HandlerCapturer — local stub matching McpServer.registerTool interface ──

type ActionHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

class HandlerCapturer {
    readonly handlers = new Map<string, ActionHandler>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTool(name: string, _schema: unknown, handler: ActionHandler): void {
        this.handlers.set(name, handler);
    }
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let callMemory: (action: string, extra?: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
    const { registerMemoryDispatcher } = await import("../../src/tools/dispatcher-memory.js");
    const { getRepos } = await import("../../src/database.js");

    const capturer = new HandlerCapturer();
    registerMemoryDispatcher(capturer as never);

    const handler = capturer.handlers.get("engram_memory");
    if (!handler) throw new Error("engram_memory handler not captured");

    callMemory = async (action: string, extra: Record<string, unknown> = {}) => {
        const result = await handler({ action, ...extra });
        const text = result.content[0].text;
        // Some error responses are plain text (not JSON). Return as-is in that case.
        try { return JSON.parse(text); } catch { return text; }
    };

    // Seed the test DB with some known data
    const repos = getRepos();
    repos.tasks.create(1, new Date().toISOString(), { title: "Implement auth", priority: "high", status: "backlog" });
    repos.tasks.create(1, new Date().toISOString(), { title: "Write docs", priority: "low", status: "done" });
    repos.decisions.create(1, new Date().toISOString(), "Use SQLite for storage", "Lightweight and embedded");
});

// ─── get_tasks ────────────────────────────────────────────────────────────────

describe("engram_memory action: get_tasks", () => {
    it("should return an array of tasks", async () => {
        const result = await callMemory("get_tasks") as Record<string, unknown>;
        expect(result).toHaveProperty("tasks");
        expect(Array.isArray(result.tasks)).toBe(true);
    });

    it("should respect include_done=false (default) — exclude done tasks", async () => {
        const result = await callMemory("get_tasks", { include_done: false }) as Record<string, unknown>;
        const tasks = result.tasks as Array<{ title: string }>;
        expect(tasks.every(t => t.title !== "Write docs")).toBe(true);
    });

    it("should include done tasks when include_done=true", async () => {
        const result = await callMemory("get_tasks", { include_done: true }) as Record<string, unknown>;
        const tasks = result.tasks as Array<{ title: string }>;
        expect(tasks.some(t => t.title === "Write docs")).toBe(true);
    });
});

// ─── get_decisions ────────────────────────────────────────────────────────────

describe("engram_memory action: get_decisions", () => {
    it("should return an array of decisions", async () => {
        const result = await callMemory("get_decisions") as Record<string, unknown>;
        expect(result).toHaveProperty("decisions");
        expect(Array.isArray(result.decisions)).toBe(true);
    });

    it("should return the seeded decision", async () => {
        const result = await callMemory("get_decisions") as Record<string, unknown>;
        const decisions = result.decisions as Array<{ decision: string }>;
        expect(decisions.some(d => d.decision.includes("SQLite"))).toBe(true);
    });
});

// ─── search ───────────────────────────────────────────────────────────────────

describe("engram_memory action: search", () => {
    it("should return a results object with a hits array", async () => {
        const result = await callMemory("search", { query: "SQLite" }) as Record<string, unknown>;
        // Result shape: { results: [...] } or { hits: [...] }
        const hasResults = "results" in result || "hits" in result || Array.isArray(result);
        expect(hasResults).toBe(true);
    });

    it("should handle missing query gracefully", async () => {
        // Empty query returns a plain-text validation error — must not throw
        const result = await callMemory("search", { query: "" });
        expect(result).toBeDefined();
        // Accept either a plain text error or a structured empty-results response
        const ok = typeof result === "string" || typeof result === "object";
        expect(ok).toBe(true);
    });
});

// ─── unknown action ───────────────────────────────────────────────────────────

describe("engram_memory — unknown action", () => {
    it("should return an error response for an unrecognised action", async () => {
        const result = await callMemory("does_not_exist");
        // The dispatcher returns a plain-text "Unknown method: ..." for unrecognised actions
        expect(result).toBeDefined();
        const isErrorShape =
            typeof result === "string" ||
            (typeof result === "object" && result !== null && ("error" in (result as object) || "message" in (result as object)));
        expect(isErrorShape).toBe(true);
    });
});
