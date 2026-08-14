// ============================================================================
// Config Write Policy Tests — audit finding N2 regression suite
//
// engram_admin(action:"config") used to write ANY key with no whitelist, no
// confirmation and no audit entry. A single ordinary tool call —
//   engram_admin({action:"config", key:"sharing_mode", value:"full"})
// — silently disabled the cross-instance access control that SECURITY.md
// presents as a boundary, and http_token could be overwritten to hijack the
// dashboard API. The whitelist existed pre-v1.6 in src/tools/stats.ts and was
// dropped in the dispatcher consolidation.
//
// The invariant these tests defend:
//   The generic config setter writes user preferences only. Security- and
//   identity-bearing keys are reachable only through the action that owns
//   them, secrets never leave in a response, and every write is audited.
// ============================================================================

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import {
    TUNABLE_CONFIG_KEYS,
    PROTECTED_CONFIG_KEYS,
    SECRET_CONFIG_KEYS,
    configWriteRejection,
    CFG_HTTP_TOKEN,
    CFG_SHARING_MODE,
    CFG_MACHINE_ID,
} from "../../src/constants.js";

// ─── Database mock (real migrations + real repositories, in-memory) ───────────
vi.mock("../../src/database.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { runMigrations } = await import("../../src/migrations.js");
    const { createRepositories } = await import("../../src/repositories/index.js");

    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    runMigrations(db);
    const repos = createRepositories(db);

    const mockServices = {
        scan: { getOrRefresh: vi.fn().mockReturnValue({}) },
        update: { getNotification: vi.fn().mockReturnValue(null) },
        instanceRegistry: {},
        crossInstance: {},
        sensitiveData: {},
        advisor: { checkNudge: vi.fn().mockReturnValue(null), recordAction: vi.fn() },
        compaction: {},
        git: {},
        events: {},
        agentRules: { getRules: vi.fn().mockReturnValue({ rules: [], source: "defaults" }) },
    };

    return {
        _db: db,
        _repos: repos,
        getDb: () => db,
        now: () => new Date().toISOString(),
        getCurrentSessionId: () => null,
        getProjectRoot: () => "/test/project",
        getDbSizeKb: () => 42,
        getDbPath: () => ":memory:",
        backupDatabase: () => "/test/backup.db",
        getRepos: () => repos,
        getServices: () => mockServices,
        logToolCall: vi.fn(),
    };
});

vi.mock("../../src/global-db.js", () => ({
    queryGlobalDecisions: vi.fn().mockReturnValue([]),
    queryGlobalConventions: vi.fn().mockReturnValue([]),
    getGlobalDb: vi.fn().mockReturnValue(null),
}));

type ActionHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

class HandlerCapturer {
    readonly handlers = new Map<string, ActionHandler>();
    registerTool(name: string, _schema: unknown, handler: ActionHandler): void {
        this.handlers.set(name, handler);
    }
}

let callAdmin: (action: string, extra?: Record<string, unknown>) => Promise<{ data: Record<string, unknown>; text: string; isError: boolean }>;
let db: DatabaseType;

function auditRows(): Array<{ action: string; actor: string; before_json: string; after_json: string }> {
    return db.prepare("SELECT action, actor, before_json, after_json FROM audit_log ORDER BY id").all() as never;
}

beforeAll(async () => {
    const { registerAdminDispatcher } = await import("../../src/tools/dispatcher-admin.js");
    const dbModule = await import("../../src/database.js") as unknown as Record<string, unknown>;
    db = dbModule._db as typeof db;

    const capturer = new HandlerCapturer();
    registerAdminDispatcher(capturer as never);
    const handler = capturer.handlers.get("engram_admin");
    if (!handler) throw new Error("engram_admin handler not captured");

    callAdmin = async (action: string, extra: Record<string, unknown> = {}) => {
        const result = await handler({ action, ...extra });
        const text = result.content[0].text;
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* plain-text error */ }
        return { data, text, isError: result.isError === true };
    };
});

beforeEach(() => {
    db.prepare("DELETE FROM audit_log").run();
});

// ─── The policy itself ────────────────────────────────────────────────────────

describe("config write policy", () => {
    it("every protected key is rejected with a pointer to the owning action", () => {
        for (const key of PROTECTED_CONFIG_KEYS.keys()) {
            const rejection = configWriteRejection(key);
            expect(rejection, `expected "${key}" to be rejected`).toBeTruthy();
        }
    });

    it("every tunable key is accepted", () => {
        for (const key of TUNABLE_CONFIG_KEYS) {
            expect(configWriteRejection(key), `expected "${key}" to be writable`).toBeNull();
        }
    });

    it("tunable and protected sets do not overlap", () => {
        for (const key of PROTECTED_CONFIG_KEYS.keys()) {
            expect(TUNABLE_CONFIG_KEYS.has(key), `"${key}" is in both sets`).toBe(false);
        }
    });

    it("an unknown key is rejected rather than silently written", () => {
        expect(configWriteRejection("totally_made_up_key")).toMatch(/unknown config key/i);
    });

    it("the four escalation keys named in the audit are all protected", () => {
        for (const key of ["sharing_mode", "sharing_types", "http_token", "sensitive_keys"]) {
            expect(PROTECTED_CONFIG_KEYS.has(key), `"${key}" must be protected`).toBe(true);
        }
    });
});

// ─── The MCP door ─────────────────────────────────────────────────────────────

describe("engram_admin(config) — the MCP door", () => {
    it("refuses the audit's exact escalation call", async () => {
        const res = await callAdmin("config", { key: CFG_SHARING_MODE, value: "full" });
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/set_sharing/);
        // and the value must not have changed
        const stored = db.prepare("SELECT value FROM config WHERE key = ?").get(CFG_SHARING_MODE) as { value: string } | undefined;
        expect(stored?.value).not.toBe("full");
    });

    it("refuses to overwrite the dashboard bearer token", async () => {
        db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)").run(CFG_HTTP_TOKEN, "real-token", new Date().toISOString());
        const res = await callAdmin("config", { key: CFG_HTTP_TOKEN, value: "attacker-token" });
        expect(res.isError).toBe(true);
        expect((db.prepare("SELECT value FROM config WHERE key = ?").get(CFG_HTTP_TOKEN) as { value: string }).value).toBe("real-token");
    });

    it("allows a genuinely user-tunable key", async () => {
        const res = await callAdmin("config", { key: "compact_threshold", value: "50" });
        expect(res.isError).toBe(false);
        expect((db.prepare("SELECT value FROM config WHERE key = ?").get("compact_threshold") as { value: string }).value).toBe("50");
    });

    it("writes an audit_log row on a successful mutation", async () => {
        await callAdmin("config", { key: "retention_days", value: "90" });
        const rows = auditRows();
        expect(rows.length).toBe(1);
        expect(rows[0].action).toBe("config.set");
        expect(JSON.parse(rows[0].after_json)).toMatchObject({ key: "retention_days", value: "90" });
    });

    it("writes NO audit row when the write was refused", async () => {
        await callAdmin("config", { key: CFG_SHARING_MODE, value: "full" });
        expect(auditRows().length).toBe(0);
    });

    it("redacts secrets when reading a single key", async () => {
        db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)").run(CFG_HTTP_TOKEN, "super-secret-token", new Date().toISOString());
        const res = await callAdmin("config", { key: CFG_HTTP_TOKEN });
        expect(res.text).not.toContain("super-secret-token");
        expect(res.data.value).toBe("[redacted]");
    });

    it("redacts secrets when dumping the whole table", async () => {
        const ts = new Date().toISOString();
        db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)").run(CFG_HTTP_TOKEN, "super-secret-token", ts);
        db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)").run(CFG_MACHINE_ID, "MACHINE-GUID-0001", ts);

        const res = await callAdmin("config");

        expect(res.text).not.toContain("super-secret-token");
        expect(res.text).not.toContain("MACHINE-GUID-0001");
        for (const key of SECRET_CONFIG_KEYS) {
            const entry = (res.data.config as Array<{ key: string; value: string }>).find(e => e.key === key);
            if (entry) expect(entry.value).toBe("[redacted]");
        }
    });
});
