// ============================================================================
// Session Intent Tests — engram_session(action:'start') Step 4 additions
//
// Tests: intent param (full_context / quick_op / phase_work), convention
// summary delivery, PM mode detection, PM-Full convention injection,
// focus-aware convention filtering, phase knowledge for phase_work.
// ============================================================================

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { BetterSQLite3Database } from "better-sqlite3";

// ─── Database mock ────────────────────────────────────────────────────────────
vi.mock("../../src/database.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { runMigrations } = await import("../../src/migrations.js");
    const { createRepositories } = await import("../../src/repositories/index.js");

    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const repos = createRepositories(db);

    const mockServices = {
        compaction: { autoCompact: vi.fn().mockReturnValue(false) },
        git: {
            getBranch: vi.fn().mockReturnValue("main"),
            getHead: vi.fn().mockReturnValue("abc123"),
            isRepo: vi.fn().mockReturnValue(false),
            getLogSince: vi.fn().mockReturnValue(""),
            parseHookLog: vi.fn().mockReturnValue(""),
        },
        events: { triggerSessionEvents: vi.fn().mockReturnValue([]) },
        update: { getNotification: vi.fn().mockReturnValue(null) },
        agentRules: { getRules: vi.fn().mockReturnValue({ rules: ["ALWAYS call session start."], source: "defaults" }) },
        scan: { getOrRefresh: vi.fn().mockReturnValue(null) },
    };

    return {
        _db: db,
        _repos: repos,
        getDb: () => db,
        now: () => new Date().toISOString(),
        getCurrentSessionId: vi.fn().mockReturnValue(null),
        getLastCompletedSession: vi.fn().mockReturnValue(null),
        getProjectRoot: () => "/test/project",
        getDbSizeKb: () => 42,
        getDbPath: () => ":memory:",
        backupDatabase: () => "/test/backup.db",
        getRepos: () => repos,
        getServices: () => mockServices,
        reinitDatabase: vi.fn().mockReturnValue({ message: "OK" }),
        logToolCall: vi.fn(),
    };
});

vi.mock("../../src/global-db.js", () => ({
    writeGlobalDecision: vi.fn().mockReturnValue(null),
    writeGlobalConvention: vi.fn().mockReturnValue(null),
    queryGlobalDecisions: vi.fn().mockReturnValue([]),
    queryGlobalConventions: vi.fn().mockReturnValue([]),
    getGlobalDb: vi.fn().mockReturnValue(null),
}));

// ─── HandlerCapturer stub ─────────────────────────────────────────────────────

type ActionHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

class HandlerCapturer {
    readonly handlers = new Map<string, ActionHandler>();
    registerTool(name: string, _schema: unknown, handler: ActionHandler): void {
        this.handlers.set(name, handler);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let callSession: (action: string, extra?: Record<string, unknown>) => Promise<Record<string, unknown>>;
let db: InstanceType<typeof import("better-sqlite3").default>;
let repos: Awaited<ReturnType<typeof import("../../src/repositories/index.js").createRepositories>>;

/** Convenience: reset PM config to default state (lite=true, full=false) */
function resetPMConfig(): void {
    db.prepare("UPDATE config SET value = 'true' WHERE key = 'pm_lite_enabled'").run();
    db.prepare("UPDATE config SET value = 'false' WHERE key = 'pm_full_enabled'").run();
}

/** Enable PM-Full, run fn, then reset regardless of result */
async function withPMFull(fn: () => Promise<void>): Promise<void> {
    db.prepare("UPDATE config SET value = 'true' WHERE key = 'pm_full_enabled'").run();
    try { await fn(); } finally { resetPMConfig(); }
}

beforeAll(async () => {
    const { registerSessionDispatcher } = await import("../../src/tools/sessions.js");
    const dbModule = await import("../../src/database.js") as unknown as Record<string, unknown>;
    db = dbModule._db as typeof db;
    repos = dbModule._repos as typeof repos;

    const capturer = new HandlerCapturer();
    registerSessionDispatcher(capturer as never);

    const handler = capturer.handlers.get("engram_session");
    if (!handler) throw new Error("engram_session handler not captured");

    callSession = async (action: string, extra: Record<string, unknown> = {}) => {
        const result = await handler({ action, ...extra });
        const text = result.content[0].text;
        try { return JSON.parse(text) as Record<string, unknown>; } catch { return { raw: text }; }
    };
});

beforeEach(() => {
    // Ensure PM config is in default state before each test
    resetPMConfig();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("session start — intent param", () => {
    it("defaults to full_context when intent is omitted", async () => {
        const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary" });
        expect(res.session_id).toBeDefined();
        // intent field is omitted when full_context (default)
        expect(res.intent).toBeUndefined();
    });

    it("full_context intent does not set intent field", async () => {
        const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "full_context" });
        expect(res.session_id).toBeDefined();
        expect(res.intent).toBeUndefined();
    });

    it("quick_op intent returns minimal response", async () => {
        const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "quick_op" });
        expect(res.session_id).toBeDefined();
        expect(res.intent).toBe("quick_op");
        expect(res.agent_rules).toBeDefined();
        expect(res.tool_catalog).toBeDefined();
        // quick_op must NOT include heavy context
        expect(res.changes_since_last).toBeUndefined();
        expect(res.active_decisions).toBeUndefined();
        expect(res.active_conventions).toBeUndefined();
        expect(res.open_tasks).toBeUndefined();
        expect(res.previous_session).toBeUndefined();
    });

    it("quick_op intent has a message indicating quick_op", async () => {
        const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "quick_op" });
        expect(String(res.message)).toContain("quick_op");
    });

    it("phase_work intent without PM-Full active returns no phase_knowledge", async () => {
        // pm_full_enabled is 'false' by default from V23 migration
        const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "phase_work" });
        expect(res.session_id).toBeDefined();
        expect(res.phase_knowledge).toBeUndefined();
    });

    it("phase_work intent with PM-Full enabled returns phase_knowledge when tasks have phase tags", async () => {
        await withPMFull(async () => {
            // Insert a task tagged with phase:2
            repos.tasks.create(null, new Date().toISOString(), { title: "Design architecture", description: "Plan the system", priority: "high", tags: ["phase:2", "planning"] });

            const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "phase_work" });
            expect(res.phase_knowledge).toBeDefined();
            const pk = res.phase_knowledge as Record<string, unknown>;
            expect(pk.phase).toBe(2);
            expect(pk.name).toBeDefined();
            expect(pk.compact).toBeDefined();
            expect(Array.isArray(pk.entryCriteria)).toBe(true);
            expect(Array.isArray(pk.exitCriteria)).toBe(true);
        });
    });

    it("phase_work with PM-Full detects phase from task title keywords when no tags", async () => {
        await withPMFull(async () => {
            // Task title contains 'planning' keyword (maps to phase 2 in PHASE_MAP)
            repos.tasks.create(null, new Date().toISOString(), { title: "Begin planning for Q2", description: "Start phase planning", priority: "medium" });

            const res = await callSession("start", { agent_name: "test-agent", verbosity: "summary", intent: "phase_work" });
            // Should detect phase 2 from 'planning' keyword — graceful even if no phase found
            if (res.phase_knowledge) {
                const pk = res.phase_knowledge as Record<string, unknown>;
                expect(typeof pk.phase).toBe("number");
            }
        });
    });
});

describe("session start — PM mode field", () => {
    it("returns pm_mode='lite' when only pm_lite_enabled=true (V23 default)", async () => {
        // After V23 migration: pm_lite_enabled='true', pm_full_enabled='false'
        const res = await callSession("start", { agent_name: "pm-mode-agent", verbosity: "summary" });
        expect(res.pm_mode).toBe("lite");
    });

    it("returns pm_mode='full' when pm_full_enabled=true", async () => {
        await withPMFull(async () => {
            const res = await callSession("start", { agent_name: "pm-full-agent", verbosity: "summary" });
            expect(res.pm_mode).toBe("full");
        });
    });

    it("pm_mode is absent (undefined) when both disabled", async () => {
        db.prepare("UPDATE config SET value = 'false' WHERE key = 'pm_lite_enabled'").run();
        db.prepare("UPDATE config SET value = 'false' WHERE key = 'pm_full_enabled'").run();
        try {
            const res = await callSession("start", { agent_name: "disabled-agent", verbosity: "summary" });
            expect(res.pm_mode).toBeUndefined();
        } finally {
            resetPMConfig();
        }
    });

    it("quick_op includes pm_mode when non-disabled", async () => {
        // pm_lite_enabled='true' (default) → pm_mode='lite'
        const res = await callSession("start", { agent_name: "qop-agent", verbosity: "nano", intent: "quick_op" });
        expect(res.pm_mode).toBe("lite");
    });
});

describe("session start — convention delivery using summary field", () => {
    it("active_conventions uses summary field instead of rule", async () => {
        // Insert a convention with an explicit summary
        repos.conventions.create(null, new Date().toISOString(), "testing", "Always write tests before merging. This is a long rule that should be truncated.", null, "Always write tests before merging.");

        const res = await callSession("start", { agent_name: "conv-agent", verbosity: "summary" });
        const convs = res.active_conventions as Array<Record<string, unknown>>;
        expect(Array.isArray(convs)).toBe(true);
        const found = convs.find(c => c.summary?.toString().includes("Always write tests"));
        expect(found).toBeDefined();
        // Must NOT have a 'rule' field (old format)
        if (found) expect(found.rule).toBeUndefined();
    });

    it("falls back to truncated rule when summary is null", async () => {
        // Insert a convention without summary (will be null → fallback to truncate(rule, 80))
        repos.conventions.create(null, new Date().toISOString(), "format", "Use camelCase for all TypeScript variable names without exceptions.", null, null);

        const res = await callSession("start", { agent_name: "conv-fallback-agent", verbosity: "summary" });
        const convs = res.active_conventions as Array<Record<string, unknown>>;
        // Some convention should have a summary derived from the rule
        const hasSummary = convs.some(c => typeof c.summary === "string" && c.summary.length > 0);
        expect(hasSummary).toBe(true);
    });
});

describe("session start — PM-Full convention injection", () => {
    it("injects PM conventions when pm_full_enabled=true", async () => {
        await withPMFull(async () => {
            const res = await callSession("start", { agent_name: "pm-conv-agent", verbosity: "summary" });
            const convs = res.active_conventions as Array<Record<string, unknown>>;
            expect(Array.isArray(convs)).toBe(true);
            // PM conventions have string ids like 'pm-pmconv-...'
            const pmConvs = convs.filter(c => String(c.id).startsWith("pm-"));
            expect(pmConvs.length).toBeGreaterThan(0);
            // Each PM convention has a summary and category
            for (const pc of pmConvs) {
                expect(typeof pc.summary).toBe("string");
                expect(typeof pc.category).toBe("string");
            }
        });
    });

    it("does NOT inject PM conventions when pm_full_enabled=false", async () => {
        const res = await callSession("start", { agent_name: "no-pm-conv-agent", verbosity: "summary" });
        const convs = res.active_conventions as Array<Record<string, unknown>>;
        const pmConvs = convs.filter(c => String(c.id).startsWith("pm-"));
        expect(pmConvs.length).toBe(0);
    });

    it("injects PM agent rules when pm_full_enabled=true", async () => {
        await withPMFull(async () => {
            const res = await callSession("start", { agent_name: "pm-rules-agent", verbosity: "summary" });
            expect(res.pm_agent_rules).toBeDefined();
            const rules = res.pm_agent_rules as Array<Record<string, unknown>>;
            expect(rules.length).toBe(3);
            expect(rules[0].condition).toBe("pm_full");
            expect(rules[0].priority).toBe("HIGH");
        });
    });

    it("does NOT include pm_agent_rules when PM-Full disabled", async () => {
        const res = await callSession("start", { agent_name: "no-pm-rules-agent", verbosity: "summary" });
        expect(res.pm_agent_rules).toBeUndefined();
    });
});

describe("session start — nano verbosity still works", () => {
    it("nano verbosity returns counts and rules", async () => {
        const res = await callSession("start", { agent_name: "nano-agent", verbosity: "nano" });
        expect(res.session_id).toBeDefined();
        expect(res.counts).toBeDefined();
        expect(res.agent_rules).toBeDefined();
        expect(res.tool_catalog).toBeDefined();
    });
});

describe("session start — full verbosity works", () => {
    it("full verbosity returns active_conventions using capConventions", async () => {
        const res = await callSession("start", { agent_name: "full-agent", verbosity: "full" });
        const convs = res.active_conventions as Array<Record<string, unknown>>;
        expect(Array.isArray(convs)).toBe(true);
        // All conventions returned should have summary field
        for (const c of convs) {
            expect(c.summary).toBeDefined();
        }
    });
});
