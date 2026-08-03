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
    db.prepare("DELETE FROM pending_work").run();
});

function addPendingWork(agentId: string, sessionId: number | null, description: string): number {
    const r = db.prepare(
        "INSERT INTO pending_work (agent_id, session_id, description, files, started_at, status) VALUES (?, ?, ?, '[]', ?, 'pending')"
    ).run(agentId, sessionId, description, Date.now());
    return r.lastInsertRowid as number;
}

function workStatus(id: number): string {
    return (db.prepare("SELECT status FROM pending_work WHERE id = ?").get(id) as { status: string }).status;
}

function makeHandoff(fromSessionId: number, fromAgent: string, reason: string, createdAt = Date.now()): number {
    const r = db.prepare(
        "INSERT INTO handoffs (from_session_id, from_agent, created_at, reason) VALUES (?, ?, ?, ?)"
    ).run(fromSessionId, fromAgent, createdAt, reason);
    return r.lastInsertRowid as number;
}

/** Mark a handoff acknowledged at an explicit time, so supersession order is deterministic. */
function ackHandoffAt(id: number, at: number, by = "someone"): void {
    db.prepare("UPDATE handoffs SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?").run(at, by, id);
}

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

// ─── N3c — pending_work abandonment must not sweep other agents ───────────────

describe("N3c — pending_work abandonment is scoped to the calling agent", () => {
    it("agent C starting a session does NOT abandon agent A's in-flight work", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const aWork = addPendingWork("agent-a", a.session_id as number, "agent A is mid-refactor");

        await callSession("start", { agent_name: "agent-c", verbosity: "nano" });

        expect(workStatus(aWork)).toBe("pending");
    });

    it("a session start does NOT abandon unrelated orphaned (session_id IS NULL) rows", async () => {
        const orphan = addPendingWork("agent-b", null, "declared with no active session");

        await callSession("start", { agent_name: "agent-c", verbosity: "nano" });

        expect(workStatus(orphan)).toBe("pending");
    });

    it("an agent DOES abandon its own work left over from a closed earlier session", async () => {
        const first = await callSession("start", { agent_name: "solo", verbosity: "nano" });
        const stale = addPendingWork("solo", first.session_id as number, "never finished this");
        await callSession("end", { session_id: first.session_id, summary: "stopped early" });

        await callSession("start", { agent_name: "solo", verbosity: "nano" });

        expect(workStatus(stale)).toBe("abandoned");
    });

    it("an agent does NOT abandon work belonging to its own still-open session", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const live = addPendingWork("agent-a", a.session_id as number, "still working on it");

        // A sub-agent of the same name is not how this happens, but another
        // agent starting must not trip the sweep either.
        await callSession("start", { agent_name: "agent-b", verbosity: "nano" });

        expect(workStatus(live)).toBe("pending");
    });

    it("abandoned_work in the response only contains the calling agent's rows", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        addPendingWork("agent-a", a.session_id as number, "agent A leftover");
        await callSession("end", { session_id: a.session_id, summary: "done" });
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "summary" });
        addPendingWork("agent-b", b.session_id as number, "agent B leftover");
        await callSession("end", { session_id: b.session_id, summary: "done" });

        const again = await callSession("start", { agent_name: "agent-b", verbosity: "summary" });
        const abandoned = (again.abandoned_work ?? []) as Array<{ agent_id: string }>;
        expect(abandoned.every(w => w.agent_id === "agent-b")).toBe(true);
    });
});

// ─── N3d — handoffs must not be silently dropped or stolen ────────────────────

describe("N3d — handoff surfacing and acknowledgement", () => {
    it("a second outstanding handoff is not silently invisible", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "nano" });
        makeHandoff(a.session_id as number, "agent-a", "handoff one");
        makeHandoff(b.session_id as number, "agent-b", "handoff two");

        const c = await callSession("start", { agent_name: "agent-c", verbosity: "summary" });

        const primary = c.handoff_pending as { id: number } | undefined;
        const others = (c.other_handoffs_pending ?? []) as Array<{ id: number }>;
        expect(primary).toBeDefined();
        expect(others.length).toBe(1);
        expect(others[0].id).not.toBe(primary?.id);
    });

    it("start prefers a handoff authored by a different agent", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "nano" });
        makeHandoff(b.session_id as number, "agent-b", "from someone else");
        // agent-a's own handoff is newer, so a naive ORDER BY would pick it
        makeHandoff(a.session_id as number, "agent-a", "my own handoff");

        const again = await callSession("start", { agent_name: "agent-a", verbosity: "summary" });
        expect((again.handoff_pending as { from_agent: string }).from_agent).toBe("agent-b");
    });

    it("acknowledging without an active session is refused", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const hid = makeHandoff(a.session_id as number, "agent-a", "needs reading");
        await callSession("end", { session_id: a.session_id, summary: "done" });

        const res = await callSession("acknowledge_handoff", { id: hid });
        expect(String(JSON.stringify(res))).toMatch(/no active session/i);
        expect(db.prepare("SELECT acknowledged_at FROM handoffs WHERE id = ?").get(hid)).toMatchObject({ acknowledged_at: null });
    });

    it("a session cannot acknowledge a handoff it just created itself", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const created = await callSession("handoff", { session_id: a.session_id, reason: "passing this on" });

        const res = await callSession("acknowledge_handoff", { id: created.handoff_id, session_id: a.session_id });

        expect(String(JSON.stringify(res))).toMatch(/same session/i);
        expect(db.prepare("SELECT acknowledged_at FROM handoffs WHERE id = ?").get(created.handoff_id)).toMatchObject({ acknowledged_at: null });
    });

    it("acknowledged_by records the real agent, never the literal 'unknown'", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const hid = makeHandoff(a.session_id as number, "agent-a", "for the next agent");
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "nano" });

        const res = await callSession("acknowledge_handoff", { id: hid, session_id: b.session_id });

        expect(res.acknowledged_by).toBe("agent-b");
        expect((db.prepare("SELECT acknowledged_by FROM handoffs WHERE id = ?").get(hid) as { acknowledged_by: string }).acknowledged_by).toBe("agent-b");
    });

    it("double-acknowledging reports who got there first", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const hid = makeHandoff(a.session_id as number, "agent-a", "for the next agent");
        const b = await callSession("start", { agent_name: "agent-b", verbosity: "nano" });
        await callSession("acknowledge_handoff", { id: hid, session_id: b.session_id });

        const res = await callSession("acknowledge_handoff", { id: hid, session_id: b.session_id });
        // error() returns plain text, so the message arrives as `raw`, not JSON.
        expect(String(res.raw)).toMatch(/already acknowledged by "agent-b"/i);
    });
});

// ─── The audit's own reproduction, end to end ─────────────────────────────────

// ─── FR-0g — handoffs are a baton, and an overtaken one is not live ───────────

describe("FR-0g — handoff supersession", () => {
    const T = 1_700_000_000_000;

    it("an unacknowledged handoff older than the newest acknowledgement is NOT promoted", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const stale = makeHandoff(a.session_id as number, "old-agent", "two days ago", T);
        const current = makeHandoff(a.session_id as number, "recent-agent", "the live one", T + 2000);
        ackHandoffAt(current, T + 3000);

        const next = await callSession("start", { agent_name: "agent-next", verbosity: "summary" });
        // Before the fix this promoted `stale`, because it was the newest thing
        // still unacknowledged — acknowledging the CURRENT handoff retired only itself.
        expect(next.handoff_pending).toBeUndefined();
        const others = (next.other_handoffs_pending ?? []) as Array<{ id: number; stale?: boolean }>;
        expect(others.find(h => h.id === stale)?.stale).toBe(true);
    });

    it("a superseded handoff is still reported, never silently dropped (N3d guard)", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        const one = makeHandoff(a.session_id as number, "agent-one", "first", T);
        const two = makeHandoff(a.session_id as number, "agent-two", "second", T + 1000);
        ackHandoffAt(two, T + 2000);

        const next = await callSession("start", { agent_name: "agent-next", verbosity: "summary" });
        const ids = ((next.other_handoffs_pending ?? []) as Array<{ id: number }>).map(h => h.id);
        expect(ids).toContain(one);
    });

    it("with nothing acknowledged yet, every pending handoff is still live", async () => {
        const a = await callSession("start", { agent_name: "agent-a", verbosity: "nano" });
        makeHandoff(a.session_id as number, "agent-one", "first", T);
        const two = makeHandoff(a.session_id as number, "agent-two", "second", T + 1000);

        const next = await callSession("start", { agent_name: "agent-next", verbosity: "summary" });
        expect((next.handoff_pending as { id: number }).id).toBe(two);
    });

    it("replays the real sequence: #1 and #2 abandoned, #4 acknowledged", async () => {
        const a = await callSession("start", { agent_name: "opus5-deep-audit", verbosity: "nano" });
        const h1 = makeHandoff(a.session_id as number, "opus5-deep-audit", "audit phase done", T);
        const h2 = makeHandoff(a.session_id as number, "opus5-pm-infra", "research phase done", T + 1000);
        const h4 = makeHandoff(a.session_id as number, "phase-0-agent", "Phase 0 complete", T + 5000);
        ackHandoffAt(h4, T + 6000, "cherry-pick-verifier");

        const next = await callSession("start", { agent_name: "fresh-agent", verbosity: "summary" });
        expect(next.handoff_pending).toBeUndefined();
        const others = (next.other_handoffs_pending ?? []) as Array<{ id: number; stale?: boolean }>;
        expect(others.filter(h => h.stale).map(h => h.id).sort()).toEqual([h1, h2].sort());
    });
});

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
