// ============================================================================
// Session start has a CEILING, and the documented figure is an assertion
//
// TASK #68. `engram_session(action:"start", verbosity:"full")` was measured at
// 59,721 tokens against a tool description promising ~730 — 81.8x, at the exact
// moment the agent is reading that description to pick the parameter. Measured
// twice three days apart (48,496 then 59,705), so THE GROWTH WAS THE FINDING,
// not the absolute number: the payload scaled with how much the store
// remembered, which means a memory tool got more expensive to orient in the
// more it had remembered.
//
// project_snapshot alone was 153,194 of 246,118 characters, because it embeds
// fileNotes.getAll() — every note, in full — and it duplicated decisions and
// conventions that the same response already returned as top-level siblings.
//
// WHY THIS IS A TEST AND NOT A NUMBER IN A DOC. The task's own words: "makes
// the documented figure a tested assertion rather than prose." A figure in a
// description drifts silently, and this one drifted by 81.8x with nothing
// reporting it. The ceilings below are a RATCHET, in the same spirit as
// tests/codebase/maintainability.test.ts: a fall is always allowed and must be
// tightened here in the same commit; a rise never is.
//
// FIXED FIXTURE ON PURPOSE. Measured against tests/fixtures/golden-memory.db —
// 16 sessions, 28 tasks, 19 decisions, 94 file notes — NOT the live store. A
// ceiling measured against a database that grows is a ceiling that fails for
// reasons unrelated to the code, which is how a gate gets switched off inside
// a week.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const DIST = path.join(REPO, "dist", "index.js");
const GOLDEN = path.join(REPO, "tests", "fixtures", "golden-memory.db");

/**
 * Response-size ceilings in CHARACTERS, against the golden fixture.
 *
 * MEASURED 2026-08-13 after task #68 — nano 2,870 · minimal 16,088 ·
 * summary 17,662 · full 39,768 — each set ~15% above its measurement. Enough
 * that an incidental one-line addition does not fail the suite; nowhere near
 * enough to absorb a regression of the kind #68 found, which was 8,000%.
 *
 * The first draft of this file used round numbers with up to 52% headroom.
 * That is a ceiling that cannot discriminate, which is the inert-surface
 * defect this repo keeps finding, reproduced inside its own new gate.
 */
const CEILING_CHARS: Record<string, number> = {
    nano: 3_400,
    minimal: 18_500,
    summary: 20_300,
    full: 46_000,
};

class Client {
    readonly proc: ChildProcessWithoutNullStreams;
    private buf = "";
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(projectRoot: string) {
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
        this.proc.stderr.on("data", () => { /* ignored */ });
    }

    private rpc(method: string, params?: unknown): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.pending.delete(id); resolve({ result: null }); }, 20_000);
            this.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
            this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
    }

    async handshake(): Promise<void> {
        await this.rpc("initialize", {
            protocolVersion: "2024-11-05", capabilities: {},
            clientInfo: { name: "cost-probe", version: "1.0.0" },
        });
        this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }

    /** Raw response text — the thing that actually lands in an agent's context. */
    async startText(verbosity: string, agent: string): Promise<string> {
        const res = await this.rpc("tools/call", {
            name: "engram_session",
            arguments: { action: "start", agent_name: agent, verbosity },
        });
        return res?.result?.content?.[0]?.text ?? "";
    }

    stop(): void { try { this.proc.kill(); } catch { /* already dead */ } }
}

describe("FR-D7 / task #68 — session start is bounded, and the bound is asserted", () => {
    let root: string;
    let client: Client;

    beforeAll(async () => {
        expect(
            existsSync(DIST),
            "dist/index.js is missing — run `npm run build`. This suite measures the COMPILED artifact, because that is what an agent talks to.",
        ).toBe(true);

        root = mkdtempSync(path.join(tmpdir(), "engram-cost-"));
        mkdirSync(path.join(root, ".engram"), { recursive: true });
        copyFileSync(GOLDEN, path.join(root, ".engram", "memory.db"));

        client = new Client(root);
        await client.handshake();
    }, 60_000);

    afterAll(() => {
        client?.stop();
        try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    for (const [verbosity, ceiling] of Object.entries(CEILING_CHARS)) {
        it(`verbosity:"${verbosity}" stays under ${ceiling.toLocaleString()} characters`, async () => {
            // A distinct agent name per verbosity: the catalog tier depends on
            // whether this agent has started before, so sharing a name would
            // make each case depend on the order the others ran in.
            const text = await client.startText(verbosity, `probe-${verbosity}`);
            expect(text.length, "the server answered at all").toBeGreaterThan(0);
            expect(
                text.length,
                `Session start at verbosity:"${verbosity}" returned ${text.length.toLocaleString()} chars ` +
                `against a ceiling of ${ceiling.toLocaleString()}. This is a RATCHET: if the growth is ` +
                `deliberate, lower some other cost or raise this number here in the same commit so a human ` +
                `sees it. Task #68 exists because this figure drifted 81.8x from its documented value with ` +
                `nothing reporting it — and it is delivered automatically, so no agent chose to pay it.`,
            ).toBeLessThan(ceiling);
        }, 60_000);
    }

    it("full is the largest tier and nano the smallest — the tiers are ordered", () => {
        // Guards the degenerate fix. Clamping every tier to the same small
        // payload would pass all four ceilings above while destroying the
        // reason verbosity exists.
        expect(CEILING_CHARS.nano).toBeLessThan(CEILING_CHARS.summary);
        expect(CEILING_CHARS.summary).toBeLessThan(CEILING_CHARS.full);
    });

    it("the project snapshot is summarised, not embedded whole", async () => {
        // The specific regression. project_snapshot embedded fileNotes.getAll()
        // and was 153,194 of 246,118 characters. A digest reports the COUNT;
        // the presence of note bodies means getOrRefresh() came back.
        const text = await client.startText("full", "probe-snapshot");
        const parsed = JSON.parse(text);
        const snap = parsed.project_snapshot;

        expect(snap, "full verbosity still returns a project snapshot").toBeTruthy();
        expect(snap.file_notes_count, "the digest reports how many notes exist").toBeGreaterThan(0);
        expect(snap.file_notes, "note BODIES must not be embedded").toBeUndefined();
        expect(snap.file_tree, "the full file tree must not be embedded").toBeUndefined();
        // The duplication half: these are top-level siblings in the same
        // response, and the snapshot shipped its own copy of both.
        expect(snap.recent_decisions, "decisions are already a top-level sibling").toBeUndefined();
        expect(snap.active_conventions, "conventions are already a top-level sibling").toBeUndefined();
        // A digest that does not name its own omission reads as the whole thing.
        expect(snap.hint, "the digest says what it left out and how to get it").toBeTruthy();
    }, 60_000);
});
