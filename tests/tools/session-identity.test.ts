// ============================================================================
// Session Identity Tests — audit finding N3a/N3b regression suite
//
// These tests encode the failure reproduced in docs/engram-deep-audit-2026-08-02.md
// §N3 and observed FOUR times unprompted during real multi-agent work
// (docs/research/engram-session-notes-n3-evidence.md).
//
// The bug: "the current session" was derived from a GLOBAL query
// (SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1),
// so any agent's start auto-closed any other agent's live session — in both
// directions — and `end` attached one agent's summary to another's record.
//
// The invariant these tests defend:
//   A session belongs to exactly one agent. No other agent may close it,
//   and no other agent's summary may land on it.
// ============================================================================

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ─── Database mock (real migrations + real repositories, in-memory) ───────────
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
        agentRules: { getRules: vi.fn().mockReturnValue({ rules: [], source: "defaults" }) },
        scan: { getOrRefresh: vi.fn().mockReturnValue(null) },
    };

    return {
        _db: db,
        _repos: repos,
        getDb: () => db,
        now: () => new Date().toISOString(),
        // Deliberately mirrors the real (global, unscoped) implementation so the
        // dispatcher cannot pass these tests by leaning on a friendlier mock.
        getCurrentSessionId: (agentName?: string) => {
            const row = agentName
                ? db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL AND agent_name = ? ORDER BY id DESC LIMIT 1").get(agentName)
                : db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1").get();
            return row ? (row as { id: number }).id : null;
        },
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

interface SessionSnapshot {
    id: number;
    agent_name: string;
    ended_at: string | null;
    summary: string | null;
    parent_session_id: number | null;
}

function sessionRow(id: number): SessionSnapshot {
    return db.prepare("SELECT id, agent_name, ended_at, summary, parent_session_id FROM sessions WHERE id = ?").get(id) as SessionSnapshot;
}

beforeAll(async () => {
    const { registerSessionDispatcher } = await import("../../src/tools/sessions.js");
    const dbModule = await import("../../src/database.js") as unknown as Record<string, unknown>;
    db = dbModule._db as typeof db;

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
    // Every test starts from an empty sessions table so "newest open session"
    // means what the test says it means.
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM handoffs").run();
});

// ─── N3a — no agent may close another agent's session ─────────────────────────

describe("N3a — session clobbering (bidirectional)", () => {
    it("a sub-agent start does NOT close the orchestrator's session", async () => {
        const orch = await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });
        const orchId = orch.session_id as number;

        db.prepare("INSERT INTO tasks (created_at, updated_at, title, status, priority) VALUES (?, ?, ?, 'backlog', 'high')")
            .run(new Date().toISOString(), new Date().toISOString(), "delegated work");
        const taskId = (db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

        await callSession("start", { agent_name: "sub-agent-1", agent_role: "sub", task_id: taskId });

        const orchAfter = sessionRow(orchId);
        expect(orchAfter.ended_at).toBeNull();
        expect(orchAfter.summary).toBeNull();
    });

    it("a second primary agent's start does NOT close the first agent's session", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const aId = a.session_id as number;

        await callSession("start", { agent_name: "agent-b", verbosity: "nano" });

        const aAfter = sessionRow(aId);
        expect(aAfter.ended_at).toBeNull();
        expect(aAfter.summary).toBeNull();
    });

    it("an orchestrator restarting does NOT close its live sub-agent's session", async () => {
        await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });

        db.prepare("INSERT INTO tasks (created_at, updated_at, title, status, priority) VALUES (?, ?, ?, 'backlog', 'high')")
            .run(new Date().toISOString(), new Date().toISOString(), "delegated work");
        const taskId = (db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

        const sub = await callSession("start", { agent_name: "sub-agent-1", agent_role: "sub", task_id: taskId });
        const subId = sub.session_id as number;

        // The orchestrator starts again mid-flight — the exact sequence in the PoC.
        await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });

        const subAfter = sessionRow(subId);
        expect(subAfter.ended_at).toBeNull();
        expect(subAfter.summary).toBeNull();
    });

    it("an agent restarting DOES retire its own previous session", async () => {
        const first = await callSession("start", { agent_name: "solo", verbosity: "nano" });
        const firstId = first.session_id as number;

        await callSession("start", { agent_name: "solo", verbosity: "nano" });

        const firstAfter = sessionRow(firstId);
        expect(firstAfter.ended_at).not.toBeNull();
        expect(firstAfter.summary).toContain("auto-closed");
    });
});

// ─── N3a — end must not misattribute a summary ────────────────────────────────

describe("N3a — end attributes the summary to the calling agent", () => {
    it("agent B's summary lands on agent B's session, not agent A's", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const aId = a.session_id as number;
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "nano" });
        const bId = b.session_id as number;

        await callSession("end", { agent_name: "agent-b", summary: "B RESULT: refactored auth module" });

        expect(sessionRow(bId).summary).toBe("B RESULT: refactored auth module");
        expect(sessionRow(aId).summary).toBeNull();
        expect(sessionRow(aId).ended_at).toBeNull();
    });

    it("an explicit session_id handle closes exactly that session", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const aId = a.session_id as number;
        await callSession("start", { agent_name: "agent-b", verbosity: "nano" });

        const res = await callSession("end", { session_id: aId, summary: "A RESULT" });

        expect(res.session_id).toBe(aId);
        expect(sessionRow(aId).summary).toBe("A RESULT");
    });

    it("ending an already-closed session is refused rather than overwriting it", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const aId = a.session_id as number;
        await callSession("end", { session_id: aId, summary: "FIRST" });

        const res = await callSession("end", { session_id: aId, summary: "SECOND — must not land" });

        expect(String(JSON.stringify(res))).toMatch(/already closed|not found/i);
        expect(sessionRow(aId).summary).toBe("FIRST");
    });
});

// ─── N3b — parent_session_id is written ───────────────────────────────────────

describe("N3b — sub-agent lineage", () => {
    it("a sub-agent session records its orchestrator as parent_session_id", async () => {
        const orch = await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });
        const orchId = orch.session_id as number;

        db.prepare("INSERT INTO tasks (created_at, updated_at, title, status, priority) VALUES (?, ?, ?, 'backlog', 'high')")
            .run(new Date().toISOString(), new Date().toISOString(), "delegated work");
        const taskId = (db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

        const sub = await callSession("start", { agent_name: "sub-agent-1", agent_role: "sub", task_id: taskId });

        expect(sub.parent_session_id).toBe(orchId);
        expect(sessionRow(sub.session_id as number).parent_session_id).toBe(orchId);
    });

    it("an explicit parent_session_id wins over inference", async () => {
        const orchA = await callSession("start", { agent_name: "orchestrator-a", verbosity: "nano" });
        const orchAId = orchA.session_id as number;
        await callSession("start", { agent_name: "orchestrator-b", verbosity: "nano" });

        db.prepare("INSERT INTO tasks (created_at, updated_at, title, status, priority) VALUES (?, ?, ?, 'backlog', 'high')")
            .run(new Date().toISOString(), new Date().toISOString(), "delegated work");
        const taskId = (db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

        const sub = await callSession("start", {
            agent_name: "sub-agent-1", agent_role: "sub", task_id: taskId, parent_session_id: orchAId,
        });

        expect(sub.parent_session_id).toBe(orchAId);
    });

    it("a primary session has no parent", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        expect(sessionRow(a.session_id as number).parent_session_id).toBeNull();
    });
});

// ─── N3b — agent_name must be a real identity ─────────────────────────────────

describe("N3b — agent_name is required", () => {
    it("start without agent_name is refused", async () => {
        const res = await callSession("start", { verbosity: "nano" });
        expect(String(JSON.stringify(res))).toMatch(/agent_name/i);
        expect(res.session_id).toBeUndefined();
    });

    it("start with a blank agent_name is refused", async () => {
        const res = await callSession("start", { agent_name: "   ", verbosity: "nano" });
        expect(String(JSON.stringify(res))).toMatch(/agent_name/i);
        expect(res.session_id).toBeUndefined();
    });
});

// ─── The audit's own reproduction, end to end ─────────────────────────────────

describe("N3 — the PoC sequence from the audit, replayed", () => {
    it("orchestrator / sub / orchestrator / sub-end produces three correctly-owned rows", async () => {
        const o1 = await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });

        db.prepare("INSERT INTO tasks (created_at, updated_at, title, status, priority) VALUES (?, ?, ?, 'backlog', 'high')")
            .run(new Date().toISOString(), new Date().toISOString(), "delegated work");
        const taskId = (db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as { id: number }).id;

        const s1 = await callSession("start", { agent_name: "sub-agent-1", agent_role: "sub", task_id: taskId });
        const o2 = await callSession("start", { agent_name: "orchestrator", verbosity: "nano" });

        await callSession("end", {
            agent_name: "sub-agent-1",
            summary: "SUB-AGENT RESULT: refactored auth module, 3 files changed",
        });

        // The orchestrator's first session was retired by its own restart — legitimate.
        expect(sessionRow(o1.session_id as number).ended_at).not.toBeNull();
        // The sub-agent's summary is on the sub-agent's row.
        expect(sessionRow(s1.session_id as number).summary).toContain("SUB-AGENT RESULT");
        // The orchestrator's live session is untouched.
        expect(sessionRow(o2.session_id as number).ended_at).toBeNull();
        expect(sessionRow(o2.session_id as number).summary).toBeNull();
    });
});
