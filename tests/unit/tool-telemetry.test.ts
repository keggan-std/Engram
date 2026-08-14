// ============================================================================
// Tool Telemetry Tests
//
// Until 2026-08-02, logToolCall was called from five sites, all in sessions.ts.
// 72 of Engram's 83 actions had no telemetry at all, which meant the "which
// actions are never called" signal — the only evidence that could license
// deleting an action — could not be computed, and `replay` reconstructed
// sessions from an empty log.
//
// withToolTelemetry intercepts registerTool rather than editing 83 switch
// cases, so a newly added action is instrumented because it came through the
// same door. These tests defend three properties:
//   1. every registered tool logs, with outcome
//   2. behaviour is unchanged — responses and thrown errors pass through
//   3. only allowlisted enum-ish params reach `notes`; free text never does
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const logToolCall = vi.fn();
vi.mock("../../src/database.js", () => ({
    logToolCall: (...args: unknown[]) => logToolCall(...args),
}));

const { withToolTelemetry } = await import("../../src/tool-telemetry.js");

/** Minimal stand-in for McpServer that records what was registered. */
class FakeServer {
    registered: Array<{ name: string; handler: (p: unknown) => Promise<unknown> }> = [];
    registerTool(name: string, _config: unknown, handler: (p: unknown) => Promise<unknown>) {
        this.registered.push({ name, handler });
        return { name };
    }
    someOtherMethod() { return "untouched"; }
}

function setup() {
    const fake = new FakeServer();
    const server = withToolTelemetry(fake as never);
    return { fake, server: server as unknown as FakeServer };
}

beforeEach(() => logToolCall.mockClear());

describe("withToolTelemetry — logging", () => {
    it("logs tool.action on a successful call", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => ({ ok: true }));
        await fake.registered[0].handler({ action: "create_task" });

        expect(logToolCall).toHaveBeenCalledOnce();
        const [name, outcome] = logToolCall.mock.calls[0];
        expect(name).toBe("engram_memory.create_task");
        expect(outcome).toBe("success");
    });

    it("records outcome 'error' when the response carries isError", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_admin", {}, async () => ({ isError: true, content: [] }));
        await fake.registered[0].handler({ action: "config" });

        expect(logToolCall.mock.calls[0][0]).toBe("engram_admin.config");
        expect(logToolCall.mock.calls[0][1]).toBe("error");
    });

    it("records outcome 'error' when the handler throws, and rethrows", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => { throw new Error("boom"); });

        await expect(fake.registered[0].handler({ action: "search" })).rejects.toThrow("boom");
        expect(logToolCall.mock.calls[0][1]).toBe("error");
    });

    it("uses '(none)' when no action is supplied", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_find", {}, async () => ({}));
        await fake.registered[0].handler({});
        expect(logToolCall.mock.calls[0][0]).toBe("engram_find.(none)");
    });

    it("passes agent_name through so attribution survives a closed session", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_session", {}, async () => ({}));
        await fake.registered[0].handler({ action: "end", agent_name: "lead" });
        expect(logToolCall.mock.calls[0][3]).toBe("lead");
    });
});

describe("withToolTelemetry — behaviour is unchanged", () => {
    it("returns the handler's response untouched", async () => {
        const { fake, server } = setup();
        const payload = { content: [{ type: "text", text: "hello" }] };
        server.registerTool("engram_memory", {}, async () => payload);
        expect(await fake.registered[0].handler({ action: "get_tasks" })).toBe(payload);
    });

    it("does not swallow a telemetry failure into the caller's result", async () => {
        logToolCall.mockImplementationOnce(() => { throw new Error("telemetry down"); });
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => ({ ok: true }));
        // logToolCall is documented as never throwing; if it ever does, the
        // failure must not be silently converted into a successful response.
        await expect(fake.registered[0].handler({ action: "get_tasks" })).rejects.toThrow("telemetry down");
    });

    it("leaves other server members reachable", () => {
        const { server } = setup();
        expect(server.someOtherMethod()).toBe("untouched");
    });
});

describe("withToolTelemetry — notes allowlist", () => {
    it("captures allowlisted enum-ish params", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_session", {}, async () => ({}));
        await fake.registered[0].handler({ action: "start", verbosity: "nano", intent: "quick_op", agent_role: "sub" });

        const notes = logToolCall.mock.calls[0][2] as string;
        expect(notes).toContain("verbosity=nano");
        expect(notes).toContain("intent=quick_op");
        expect(notes).toContain("agent_role=sub");
    });

    it("NEVER records free-text params", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => ({}));
        await fake.registered[0].handler({
            action: "record_decision",
            decision: "we chose Postgres over MySQL",
            rationale: "JSONB support",
            content: "secret user content",
            summary: "a summary",
            notes: "some notes",
            query: "a query",
        });

        const notes = (logToolCall.mock.calls[0][2] as string) ?? "";
        for (const leak of ["Postgres", "JSONB", "secret user content", "a summary", "some notes", "a query"]) {
            expect(notes).not.toContain(leak);
        }
    });

    it("NEVER records config values — the dashboard token lives there", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_admin", {}, async () => ({}));
        await fake.registered[0].handler({ action: "config", key: "http_token", value: "super-secret-bearer-token" });

        const notes = (logToolCall.mock.calls[0][2] as string) ?? "";
        expect(notes).not.toContain("super-secret-bearer-token");
        expect(notes).not.toContain("http_token");
    });

    it("drops oversized values even on allowlisted keys", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => ({}));
        await fake.registered[0].handler({ action: "record_change", impact_scope: "x".repeat(200) });
        expect(logToolCall.mock.calls[0][2]).toBeUndefined();
    });

    it("truncates an absurd action name rather than storing it", async () => {
        const { fake, server } = setup();
        server.registerTool("engram_memory", {}, async () => ({}));
        await fake.registered[0].handler({ action: "a".repeat(500) });
        expect(logToolCall.mock.calls[0][0]).toBe("engram_memory.(none)");
    });
});
