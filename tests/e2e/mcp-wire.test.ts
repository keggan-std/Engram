// ============================================================================
// The wire contract — FR-D6 §5, the binding for targets T1 and T3
//
// WHY THIS FILE EXISTS. Before it, all 660 tests called dispatcher handlers
// directly against a mocked `src/database` module. Nothing anywhere exercised
// Engram over actual MCP stdio JSON-RPC, so four things had zero coverage by
// construction:
//
//   1. stdout purity      — stdout IS the protocol. One console.log on a
//                           startup path breaks every MCP client, and no
//                           handler-level test can see it.
//   2. tool registration   — a tool that fails to register is simply absent.
//   3. Zod parsing of real MCP arguments, as opposed to hand-built objects.
//   4. the compiled dist/ artifact — tests run TypeScript; users run dist/.
//
// This was not hypothetical. The measure of it: the FR-D6 session changed
// `compact` from a lying no-op into real behaviour, rewrote `/health`, changed
// the export payload shape, and turned POST /import into a 501 — and all 660
// existing tests still passed. Not one of them noticed. A suite that cannot
// tell those four changes from no change is not covering this surface.
//
// PRIOR ART, and it is the strongest of the six areas researched for this
// domain: chrome-devtools-mcp#570 — a Google-maintained MCP server shipped a
// stdout banner that corrupted the protocol. It was found by echoing raw
// JSON-RPC at the binary, never by its test suite, and closed as not planned.
// gopls (golang/go#43738) is the same lesson from the LSP world, which has had
// the stdout-is-the-protocol constraint for a decade longer than MCP has.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not assert the response
// envelope is *good*. It PINS the envelope as it is, including the asymmetry
// recorded in DEFERRED-CHANGES D7 — success returns JSON and omits `isError`,
// while error() returns bare prose with isError:true. Unifying that is a
// master-plan decision affecting the dashboard and both thin clients, not a
// drive-by fix. The pin means that when someone does change it, they change
// this file in the same commit and a human sees the diff.
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

/** A minimal MCP stdio client. Deliberately hand-rolled: using the SDK's client
 *  here would test the SDK's framing rather than ours, and framing is the point. */
class WireClient {
    readonly proc: ChildProcessWithoutNullStreams;
    /** Every byte ever seen on stdout, verbatim — this is what test 1 inspects. */
    rawStdout = "";
    rawStderr = "";
    private buf = "";
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(projectRoot: string) {
        this.proc = spawn(process.execPath, [DIST, "--project-root", projectRoot], {
            stdio: ["pipe", "pipe", "pipe"],
            // vitest.config.ts sets ENGRAM_LOG_LEVEL=warn for the test process and
            // the child inherits it. Pin debug explicitly: the stderr assertion
            // below would otherwise depend on the server happening to emit a
            // warning, which is not a property we want to accidentally require.
            env: { ...process.env, ENGRAM_LOG_LEVEL: "debug" },
        }) as ChildProcessWithoutNullStreams;

        this.proc.stdout.on("data", (chunk: Buffer) => {
            const s = chunk.toString();
            this.rawStdout += s;
            this.buf += s;
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

    rpc(method: string, params?: unknown): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve) => {
            this.pending.set(id, resolve);
            this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
    }

    async handshake(): Promise<void> {
        await this.rpc("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "engram-wire-test", version: "1.0.0" },
        });
        this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }

    /** The RAW tool result — no parsing of content. The shape is what we measure. */
    async callRaw(name: string, args: Record<string, unknown>): Promise<any> {
        const res = await this.rpc("tools/call", { name, arguments: args });
        return res?.result;
    }

    /** Convenience for tests that care about the payload rather than the envelope. */
    async call(name: string, args: Record<string, unknown>): Promise<any> {
        const r = await this.callRaw(name, args);
        try { return JSON.parse(r?.content?.[0]?.text); } catch { return { _text: r?.content?.[0]?.text }; }
    }

    async stop(): Promise<void> {
        try { this.proc.kill(); } catch { /* already dead */ }
        await new Promise((r) => setTimeout(r, 250));
    }
}

function scratchRoot(): string {
    return mkdtempSync(path.join(tmpdir(), "engram-wire-"));
}
function cleanup(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

// ────────────────────────────────────────────────────────────────────────────

describe("MCP wire contract (real stdio against dist/)", () => {
    let root: string;
    let client: WireClient;

    beforeAll(async () => {
        // A missing dist/ must fail loudly here. If this test silently skipped,
        // the one suite that covers the shipped artifact would be the easiest
        // in the repo to switch off by accident.
        expect(
            existsSync(DIST),
            `dist/index.js is missing — run \`npm run build\` before the tests. This suite exercises the COMPILED artifact on purpose; skipping it would defeat the point.`,
        ).toBe(true);

        root = scratchRoot();
        client = new WireClient(root);
        await client.handshake();
    }, 60_000);

    afterAll(async () => {
        await client?.stop();
        cleanup(root);
    });

    it("writes nothing but JSON-RPC to stdout", async () => {
        // THE test in this file. Everything else here could be covered another
        // way; this cannot. stdout is the transport, so any stray console.log,
        // banner, progress bar, dep warning or stack trace on a startup path
        // corrupts the stream for every MCP client, and every handler-level
        // test in the repo stays green while it happens.
        await client.call("engram_session", { action: "start", agent_name: "wire-test", verbosity: "nano" });

        const lines = client.rawStdout.split("\n").filter((l) => l.trim() !== "");
        const offenders = lines.filter((l) => {
            try { JSON.parse(l); return false; } catch { return true; }
        });

        expect(offenders, offenders.length === 0 ? "" : [
            "",
            "NON-JSON OUTPUT ON STDOUT — this corrupts the MCP protocol for every client.",
            "",
            `First offending line: ${JSON.stringify(offenders[0]?.slice(0, 300))}`,
            "",
            "stdout is the transport. Logging goes to stderr — use `log` from src/logger.ts,",
            "which writes via console.error. See docs/ENGRAM_CONSTITUTION.md line 59 and",
            "docs/foundations/06-observability.md §5.",
            "",
        ].join("\n")).toEqual([]);

        expect(lines.length).toBeGreaterThan(0);   // guard the detector itself
    }, 60_000);

    it("puts diagnostics on stderr, level-tagged", async () => {
        // The counterpart to the test above: proving stdout is clean is only
        // meaningful if the process is actually saying something somewhere.
        // A server that logs nothing would pass the stdout test vacuously.
        expect(client.rawStderr.length).toBeGreaterThan(0);
        expect(client.rawStderr).toMatch(/\[Engram\] \[(DEBUG|INFO|WARN|ERROR)\]/);
    });

    it("pins the success envelope: JSON in content[0].text, and NO isError field", async () => {
        const raw = await client.callRaw("engram_session", {
            action: "start", agent_name: "envelope-probe", verbosity: "nano",
        });

        expect(raw.content[0].type).toBe("text");
        expect(() => JSON.parse(raw.content[0].text)).not.toThrow();

        // Recorded asymmetry, half 1 of 2: success omits isError entirely rather
        // than setting it false, so a consumer branching on `isError === false`
        // gets undefined and takes the error path. src/response.ts:24-28.
        expect(raw.isError).toBeUndefined();
    }, 30_000);

    it("pins the error envelope: bare prose, isError:true — the recorded asymmetry", async () => {
        const raw = await client.callRaw("engram_session", {
            action: "end", session_id: 999_999, summary: "no such session",
        });

        expect(raw.isError).toBe(true);
        expect(raw.content[0].type).toBe("text");

        // Half 2 of 2. error() returns a BARE STRING while success() returns
        // JSON (src/response.ts:42-47 vs :24-28). This assertion is inverted on
        // purpose — it pins a known defect, so unifying the envelope MUST edit
        // this line and a human must see it. DEFERRED-CHANGES D7.
        //
        // Do not "fix" this test to make a uniform envelope pass. Change the
        // envelope, change this line, and say so in the commit.
        expect(() => JSON.parse(raw.content[0].text)).toThrow();
        expect(raw.content[0].text).toContain("999999");
    }, 30_000);

    it("returns every failure class through the same flat channel", async () => {
        // Not an aspiration — a measurement. Five distinct failure kinds are
        // indistinguishable to a consumer except by reading English prose, and
        // the JSON-RPC `error` field is never used for any of them. Recorded so
        // that adding a machine-readable code becomes a visible diff here.
        const cases = [
            ["unknown tool", await client.rpc("tools/call", { name: "engram_nope", arguments: {} })],
            ["unknown action", await client.rpc("tools/call", { name: "engram_memory", arguments: { action: "nope" } })],
            ["missing field", await client.rpc("tools/call", { name: "engram_memory", arguments: { action: "create_task" } })],
            ["not found", await client.rpc("tools/call", { name: "engram_memory", arguments: { action: "update_task", id: 999_999, status: "done" } })],
        ] as const;

        for (const [label, res] of cases) {
            expect(res.error, `${label}: JSON-RPC error field is unused for tool failures`).toBeUndefined();
            expect(res.result.isError, `${label}: should be a tool-level error`).toBe(true);
        }
    }, 30_000);

    it("survives a run of failures without dying", async () => {
        // Degradation is genuinely non-fatal, and that is worth keeping true.
        const after = await client.call("engram_session", {
            action: "start", agent_name: "still-alive", verbosity: "nano",
        });
        expect(after.session_id).toBeGreaterThan(0);
    }, 30_000);
});

// ────────────────────────────────────────────────────────────────────────────

describe("compact reports only work it actually did (FR-D6 T1)", () => {
    let root: string;
    let client: WireClient;

    beforeAll(async () => {
        root = scratchRoot();
        client = new WireClient(root);
        await client.handshake();

        // Twelve closed sessions, FOUR change rows each.
        //
        // Four, not one, and the reason is worth writing down: compaction
        // replaces a session's change rows with ONE summary row. With a single
        // change per session, 1 row collapses to 1 row and the total count never
        // moves — so a test built that way asserts nothing and passes against a
        // no-op. That is the exact failure this whole domain is about, and the
        // first draft of this test had it.
        for (let i = 0; i < 12; i++) {
            const s = await client.call("engram_session", { action: "start", agent_name: `a${i}`, verbosity: "nano" });
            await client.call("engram_memory", {
                action: "record_change",
                changes: [0, 1, 2, 3].map((j) => ({
                    file_path: `f${i}-${j}.ts`, change_type: "modified", description: `change ${i}.${j}`,
                })),
            });
            await client.call("engram_session", { action: "end", session_id: s.session_id, summary: `s${i}` });
        }
    }, 120_000);

    afterAll(async () => {
        await client?.stop();
        cleanup(root);
    });

    function counts(): { sessions: number; changes: number } {
        const db = new Database(path.join(root, ".engram", "memory.db"), { readonly: true });
        const r = {
            sessions: (db.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c,
            changes: (db.prepare("SELECT COUNT(*) c FROM changes").get() as { c: number }).c,
        };
        db.close();
        return r;
    }

    it("dry_run:true changes nothing and says so", async () => {
        const before = counts();
        const res = await client.call("engram_admin", { action: "compact", keep_sessions: 3, dry_run: true });
        const after = counts();

        expect(res.dry_run).toBe(true);
        expect(after).toEqual(before);
        expect(res.backupPath).toBeUndefined();
        // The old preview promised sessions "would be removed". Compaction never
        // removes a session — it collapses change rows. A preview that describes
        // the wrong operation is worse than no preview.
        expect(res.message).not.toMatch(/removed/i);
    }, 60_000);

    it("dry_run:false actually compacts, and the numbers it reports are true", async () => {
        // THE REGRESSION TEST. dispatcher-admin called
        //   manualCompact(keepSessions, maxAgeDays)
        // against a signature of (keepSessions, maxAgeDays?, dryRun = true), so
        // dry_run:false silently took the dry-run early return and then reported
        // sessionsCompacted in the PAST TENSE for work that never ran. Measured
        // over this exact transport before the fix:
        //
        //   BEFORE  : sessions=12 changes=12
        //   claimed : {"sessionsCompacted":9,"changesSummarized":9}
        //   AFTER   : sessions=12 changes=12
        //   backups : 0
        //
        // Nothing in the response distinguished that from success. The only tell
        // was an absent backupPath field.
        const before = counts();
        const res = await client.call("engram_admin", { action: "compact", keep_sessions: 3, dry_run: false });
        const after = counts();

        expect(res.dry_run).toBe(false);
        expect(res.changesSummarized).toBeGreaterThan(0);

        // The claim must be backed by the database. This is the assertion the
        // old code could never have passed.
        expect(after.changes).toBeLessThan(before.changes);

        // And the rows that remain are real summaries, not survivors of a no-op.
        const db = new Database(path.join(root, ".engram", "memory.db"), { readonly: true });
        const summaries = (db.prepare(
            "SELECT COUNT(*) c FROM changes WHERE description LIKE 'Compacted %'",
        ).get() as { c: number }).c;
        db.close();
        expect(summaries).toBeGreaterThan(0);

        // Sessions are NOT deleted by compaction, and the message must not imply it.
        expect(after.sessions).toBe(before.sessions);

        // The safety backup is now blocking, so a successful compaction always
        // has one. FR-D1 and FR-D5 fixed this same swallowed-backup shape.
        expect(res.backupPath).toBeTruthy();
        expect(existsSync(res.backupPath)).toBe(true);
    }, 60_000);
});

// ────────────────────────────────────────────────────────────────────────────

describe("health tells the truth under an injected fault (FR-D6 T4)", () => {
    // Prior art requirement, from the Roblox 2021 outage writeup: a health check
    // is only worth having if there is a test proving it FAILS when the thing it
    // checks is broken. Before this, `engram_admin health` probed FTS with
    // `SELECT * FROM decisions LIMIT 1` — the base table — and reported
    // fts:"available" whenever that table was readable, which is always.
    let root: string;

    afterAll(() => cleanup(root));

    it("reports healthy on a good database, and unhealthy once the FTS index is destroyed", async () => {
        root = scratchRoot();

        // 1. Healthy baseline.
        const c1 = new WireClient(root);
        await c1.handshake();
        await c1.call("engram_session", { action: "start", agent_name: "health-probe", verbosity: "nano" });
        const good = await c1.call("engram_admin", { action: "health" });
        await c1.stop();

        expect(good.healthy).toBe(true);
        expect(good.checks.fts).toBe("available");

        // 2. Destroy the FTS index behind the server's back. Migrations only run
        //    for versions above the stored one, so a V25 database stays dropped.
        const db = new Database(path.join(root, ".engram", "memory.db"));
        db.exec("DROP TABLE fts_decisions");
        db.close();

        // 3. The same check must now fail. If this assertion ever starts failing,
        //    the health check has stopped being able to detect anything.
        const c2 = new WireClient(root);
        await c2.handshake();
        const bad = await c2.call("engram_admin", { action: "health" });
        await c2.stop();

        expect(bad.checks.fts).toMatch(/^unavailable/);
        expect(bad.healthy).toBe(false);
        expect(bad.message).toMatch(/fts/i);
    }, 120_000);
});
