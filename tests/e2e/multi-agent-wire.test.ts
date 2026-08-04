// ============================================================================
// The multi-agent contract — FR-D4 §5
//
// WHY THIS FILE EXISTS. Engram's headline promise is coordination: "Run
// multiple AI agents on the same codebase simultaneously. Engram provides the
// coordination layer so they never step on each other" (README:746). Before
// this file, every coordination path — claiming, locking, attribution, stale
// recovery — was tested only through single-process handler calls against a
// mocked database. "Two agents at once" had no test that involved two of
// anything.
//
// So this suite spawns TWO real `dist/index.js` processes against ONE project
// root, which is the actual shape of the claim. It reuses the hand-rolled
// JSON-RPC client rationale from mcp-wire.test.ts: the SDK client would test
// the SDK, and the transport is part of what makes these agents separate.
//
// WHAT IT PINS, AND WHY SOME PINS ARE DEFECTS. Following the D6 precedent
// (DEFERRED-CHANGES D7), the assertions below encode reality as measured,
// INCLUDING three defects. That is deliberate. Each defect is a target in
// docs/foundations/04-concurrency.md §4; when one is fixed, this file must be
// edited in the same commit, where a human sees the diff. A test that quietly
// tolerates both the bug and the fix pins nothing.
//
// PRIOR ART that shaped these tests, per charter §3b:
//   - MAST (arXiv:2503.13657): "inter-agent misalignment" is 36.9% of observed
//     multi-agent failures, characterised as agents acting on inconsistent
//     views of shared state. Tests 3 and 4 are that failure, mechanised.
//   - rails/rails#22092: concurrent startup migrations race because the
//     migrator takes no exclusive lock. Test 6 is the same shape.
//   - Kleppmann on distributed locking: an advisory lock that cannot refuse is
//     not mutual exclusion. Test 3.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const DIST = path.join(REPO, "dist", "index.js");

class Agent {
    readonly proc: ChildProcessWithoutNullStreams;
    rawStderr = "";
    private buf = "";
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(projectRoot: string, readonly label: string) {
        this.proc = spawn(process.execPath, [DIST, "--project-root", projectRoot], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ENGRAM_LOG_LEVEL: "error" },
        }) as ChildProcessWithoutNullStreams;
        this.proc.stdout.on("data", (chunk: Buffer) => {
            this.buf += chunk.toString();
            let idx: number;
            while ((idx = this.buf.indexOf("\n")) >= 0) {
                const line = this.buf.slice(0, idx).trim();
                this.buf = this.buf.slice(idx + 1);
                if (!line) continue;
                let msg: any;
                try { msg = JSON.parse(line); } catch { continue; }
                if (msg.id !== undefined && this.pending.has(msg.id)) {
                    this.pending.get(msg.id)!(msg);
                    this.pending.delete(msg.id);
                }
            }
        });
        this.proc.stderr.on("data", (d: Buffer) => { this.rawStderr += d.toString(); });
    }

    private rpc(method: string, params?: unknown): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve({ result: { content: [{ text: `{"_timeout":true}` }] } });
            }, 20_000);
            this.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
            this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
    }

    async handshake(): Promise<void> {
        await this.rpc("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: `d4-${this.label}`, version: "1.0.0" },
        });
        this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }

    async callRaw(name: string, args: Record<string, unknown>): Promise<any> {
        const res = await this.rpc("tools/call", { name, arguments: args });
        return res?.result;
    }

    async call(name: string, args: Record<string, unknown>): Promise<any> {
        const r = await this.callRaw(name, args);
        try { return JSON.parse(r?.content?.[0]?.text); } catch { return { _text: r?.content?.[0]?.text }; }
    }

    async stop(): Promise<void> {
        try { this.proc.kill(); } catch { /* already dead */ }
        await new Promise((r) => setTimeout(r, 200));
    }
}

describe("multi-agent contract (two real processes, one project root)", () => {
    let root: string;
    let A: Agent, B: Agent;
    let sessionA: number, sessionB: number;
    const db = () => new Database(path.join(root, ".engram", "memory.db"), { readonly: true });

    beforeAll(async () => {
        expect(
            existsSync(DIST),
            "dist/index.js is missing — run `npm run build`. This suite exercises the COMPILED artifact on purpose.",
        ).toBe(true);

        root = mkdtempSync(path.join(tmpdir(), "engram-d4-"));

        // A initialises the store ALONE. Starting both at once against a fresh
        // root makes them race the migration chain — see test 6, which is why
        // this ordering is explicit rather than incidental.
        A = new Agent(root, "A");
        await A.handshake();
        const sa = await A.call("engram_session", { action: "start", agent_name: "agent-A", verbosity: "nano" });
        sessionA = sa.session_id;

        B = new Agent(root, "B");
        await B.handshake();
        const sb = await B.call("engram_session", { action: "start", agent_name: "agent-B", verbosity: "nano" });
        sessionB = sb.session_id;

        expect(sessionA).toBeTypeOf("number");
        expect(sessionB).toBeTypeOf("number");
        // The ordering that every other test in this file depends on, and the
        // root cause of test 4: a parent's session id is always LOWER than the
        // children it spawns.
        expect(sessionB).toBeGreaterThan(sessionA);
    }, 120_000);

    afterAll(async () => {
        await A?.stop();
        await B?.stop();
        try { rmSync(root, { recursive: true, force: true }); } catch { /* windows file locks */ }
    });

    // ── 1. The one coordination primitive that is genuinely correct ─────────
    // README:740 — "`claim_task` is atomic: two parallel agents can never start
    // the same work." Measured across two OS processes, not two function calls.
    // This test protects a property that currently HOLDS; it exists so that a
    // refactor of the compare-and-swap at dispatcher-memory.ts:1051 cannot
    // quietly turn it into a read-then-write.
    it("claim_task is atomic across two processes — exactly one winner, every time", async () => {
        let bothWon = 0, exactlyOne = 0;

        for (let i = 0; i < 10; i++) {
            const created = await A.call("engram_memory", {
                action: "create_task", title: `race task ${i}`, priority: "low",
            });
            const id = created.task_id ?? created.id ?? created.task?.id;
            expect(id, "create_task must return an id").toBeTypeOf("number");

            const [ra, rb] = await Promise.all([
                A.call("engram_memory", { action: "claim_task", task_id: id, agent_id: "agent-A" }),
                B.call("engram_memory", { action: "claim_task", task_id: id, agent_id: "agent-B" }),
            ]);
            const aWon = !!ra.task, bWon = !!rb.task;
            if (aWon && bWon) bothWon++;
            else if (aWon !== bWon) exactlyOne++;
        }

        expect(bothWon, "two agents both claimed the same task — README:740 is false").toBe(0);
        expect(exactlyOne, "every race must produce exactly one winner").toBe(10);
    }, 120_000);

    // ── 2. The advertised file locks do not exist ───────────────────────────
    // README:750 lists `lock_file` / `unlock_file` as the mechanism preventing
    // "Two agents editing the same file at once". They are not on the live
    // surface; the implementation survives only in dead src/tools/file-notes.ts.
    // PINNED AS A DEFECT. Restoring them must edit this test.
    it("lock_file / unlock_file are advertised in README:750 and absent from the surface", async () => {
        const res = await A.callRaw("engram_memory", { action: "lock_file", file_path: "src/shared.ts" });
        const text = JSON.stringify(res);
        expect(text).toMatch(/validation|Invalid|received/i);

        const catalog = JSON.stringify(await A.call("engram_find", { action: "search", query: "lock file" }));
        expect(catalog).not.toMatch(/\block_file\b/);
        expect(catalog).not.toMatch(/\bunlock_file\b/);
    }, 60_000);

    // ── 3. The surviving soft lock cannot refuse ────────────────────────────
    // Kleppmann's point, in our codebase: acquireSoftLock (dispatcher-memory.ts:48)
    // is INSERT .. ON CONFLICT DO UPDATE with no ownership guard, and it runs at
    // line 382 — AFTER the upsert at 369. It cannot prevent the write it is
    // supposed to guard, and it cannot report a conflict.
    //
    // The result is worse than last-writer-wins. Because FileNotesRepo.upsert
    // uses COALESCE(?, col), B's thin write keeps A's executive_summary while
    // replacing A's purpose: the row ends up a CHIMERA belonging to neither
    // agent. That is MAST's "inconsistent views of shared state" made concrete.
    // PINNED AS A DEFECT.
    it("two agents writing one file produce a chimera row, and the lock never refuses", async () => {
        await A.call("engram_memory", {
            action: "set_file_notes", file_path: "src/shared.ts",
            purpose: "A's careful analysis", executive_summary: "A read the whole file.",
        });
        const bWrite = await B.call("engram_memory", {
            action: "set_file_notes", file_path: "src/shared.ts", purpose: "B drive-by",
        });

        // B is never refused, never warned, never told a lock exists.
        expect(JSON.stringify(bWrite)).not.toMatch(/conflict|locked|refus/i);

        const note = await B.call("engram_memory", { action: "get_file_notes", file_path: "src/shared.ts" });
        expect(note.purpose, "last writer wins the fields it sets").toBe("B drive-by");
        expect(note.executive_summary, "COALESCE preserves A's field — the chimera").toBe("A read the whole file.");

        // The lock is held by whoever wrote LAST, and is labelled with a session
        // rather than an agent — see test 4 for why that label is unreliable.
        expect(note.lock_status?.locked).toBe(true);
    }, 60_000);

    // ── 4. Attribution: the orchestrator cannot win against its own children ─
    // getCurrentSessionId() (database.ts:486) is
    //   SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1
    // called unscoped at 16 sites in dispatcher-memory.ts. Because a parent
    // session always predates its sub-agents (asserted in beforeAll), the parent
    // always loses. Not a race — deterministic.
    //
    // Observed live before it was reproduced here: decision #21 of this project
    // was recorded by session #24 (fr-lead) and stamped to session #27, a
    // sub-agent. See observation #79. PINNED AS A DEFECT.
    it("a record written by agent A is stamped with agent B's session", async () => {
        await A.call("engram_memory", {
            action: "record_decision",
            decision: "A DECIDED THIS", rationale: "recorded solely by agent-A",
        });

        const d = db();
        try {
            const row = d.prepare(
                "SELECT id, session_id, decision FROM decisions ORDER BY id DESC LIMIT 1",
            ).get() as { id: number; session_id: number; decision: string };
            const owner = d.prepare(
                "SELECT agent_name FROM sessions WHERE id = ?",
            ).get(row.session_id) as { agent_name: string } | undefined;

            expect(row.decision).toBe("A DECIDED THIS");
            // The defect, pinned. When attribution is fixed, these two lines
            // become `toBe(sessionA)` / `toBe("agent-A")` in the same commit.
            expect(row.session_id, "DEFECT: stamped with the newest open session").toBe(sessionB);
            expect(owner?.agent_name, "DEFECT: credited to the agent that did not act").toBe("agent-B");
        } finally { d.close(); }
    }, 60_000);

    // ── 5. A dead agent's claim is unreclaimable ────────────────────────────
    // agent_sync reclaims tasks held by stale agents (dispatcher-memory.ts:1106)
    // but the subquery requires an `agents` row with status='working'.
    // claim_task never creates one, and agent_sync defaults status to 'idle'
    // (line 1101). Both conditions fail by default, so the only recovery path
    // for a crashed claimer is release_task with force:true.
    // PINNED AS A DEFECT.
    it("a task claimed by an agent that never registered can never be auto-reclaimed", async () => {
        const created = await A.call("engram_memory", {
            action: "create_task", title: "orphan task", priority: "low",
        });
        const id = created.task_id ?? created.id ?? created.task?.id;
        await A.call("engram_memory", { action: "claim_task", task_id: id, agent_id: "ghost-agent" });

        const d1 = db();
        const registered = d1.prepare("SELECT id FROM agents WHERE id = 'ghost-agent'").all();
        d1.close();
        expect(registered.length, "DEFECT: claim_task does not register the claimer").toBe(0);

        // Another agent syncing is what triggers the reclaim sweep.
        await B.call("engram_memory", { action: "agent_sync", agent_id: "agent-B" });

        const d2 = db();
        try {
            const bRow = d2.prepare("SELECT status FROM agents WHERE id = 'agent-B'").get() as { status: string };
            expect(bRow.status, "DEFECT: agent_sync defaults to 'idle', so the sweep can never match").toBe("idle");

            const task = d2.prepare("SELECT claimed_by FROM tasks WHERE id = ?").get(id) as { claimed_by: string | null };
            expect(task.claimed_by, "DEFECT: the orphaned claim survives the sweep").toBe("ghost-agent");
        } finally { d2.close(); }
    }, 60_000);

    // ── 6. Concurrent cold start ────────────────────────────────────────────
    // rails/rails#22092, in our codebase. runMigrations (migrations.ts:810)
    // reads the version and then runs each step in a DEFERRED transaction, with
    // nothing serialising read-version→run-chain across processes. Two servers
    // cold-starting on one fresh root both run the chain; the loser hits an
    // unconditional `ALTER TABLE file_notes ADD COLUMN git_branch` (V22,
    // migrations.ts:437) and dies with "duplicate column name: git_branch".
    //
    // DELIBERATELY ASSERTS ONLY THE SAFE INVARIANT. Whether a given process
    // dies is a genuine race, and per FR-D6 kill switch 1 a flaky gate is worse
    // than none. So this asserts what must ALWAYS hold — the store survives and
    // at least one server is usable — and reports the race outcome to stderr as
    // evidence rather than as a pass/fail. The process-death finding lives in
    // docs/foundations/04-concurrency.md §3 and Engram, where it cannot flake.
    it("two servers cold-starting on one fresh root never corrupt the store", async () => {
        const coldRoot = mkdtempSync(path.join(tmpdir(), "engram-cold-"));
        const X = new Agent(coldRoot, "X"), Y = new Agent(coldRoot, "Y");
        try {
            const results = await Promise.all([
                X.call("engram_session", { action: "start", agent_name: "cold-X", verbosity: "nano" }),
                Y.call("engram_session", { action: "start", agent_name: "cold-Y", verbosity: "nano" }),
            ]);

            const survived = results.filter((r) => typeof r?.session_id === "number").length;
            const died = [X, Y].filter((a) => /duplicate column name/i.test(a.rawStderr)).length;
            // Evidence, not an assertion — see the header note above.
            console.error(`[FR-D4 cold start] servers answering: ${survived}/2, killed by migration race: ${died}/2`);

            expect(survived, "at least one server must come up on a fresh project").toBeGreaterThanOrEqual(1);

            const p = path.join(coldRoot, ".engram", "memory.db");
            expect(existsSync(p)).toBe(true);
            const d = new Database(p, { readonly: true });
            try {
                const integrity = d.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
                expect(integrity.integrity_check, "the store must never be corrupted by a start race").toBe("ok");
                const v = d.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as { value: string };
                expect(Number(v.value), "the chain must complete, not stop half-migrated").toBeGreaterThan(0);
            } finally { d.close(); }
        } finally {
            await X.stop(); await Y.stop();
            try { rmSync(coldRoot, { recursive: true, force: true }); } catch { /* windows */ }
        }
    }, 180_000);
});
