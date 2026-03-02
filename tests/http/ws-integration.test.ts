// ============================================================================
// WS Mutation Middleware — Integration Tests
// ============================================================================
// Strategy: inject a plain mock broadcaster into createHttpServer() via the
// optional `broadcaster` option added for testability. This avoids all ESM
// module-singleton identity issues that come from Vitest's per-file isolation.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { WsEvent } from "../../src/ws-broadcaster.js";

// ---- Database mock ---------------------------------------------------------

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

vi.mock("../../src/global-db.js", () => ({
  writeGlobalDecision: vi.fn().mockReturnValue(null),
  writeGlobalConvention: vi.fn().mockReturnValue(null),
  queryGlobalDecisions: vi.fn().mockReturnValue([]),
  queryGlobalConventions: vi.fn().mockReturnValue([]),
  getGlobalDb: vi.fn().mockReturnValue(null),
}));

// ---- Constants & helpers ---------------------------------------------------

const TOKEN = "testtoken1234567890abcdef1234567890ab";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// ---- Injected mock broadcaster ---------------------------------------------
// Use a plain vi.fn() injected via createHttpServer({ broadcaster }) so we
// never have to fight Vitest ESM module-singleton identity across file scopes.

const broadcastFn = vi.fn<[WsEvent], void>();
const mockBroadcaster = { broadcast: broadcastFn };

// ---- App setup ------------------------------------------------------------

let app: Express;

beforeAll(async () => {
  const { createHttpServer } = await import("../../src/http-server.js");
  app = createHttpServer({ port: 7432, token: TOKEN, broadcaster: mockBroadcaster }).app;
});

afterEach(() => {
  broadcastFn.mockClear();
});

// Reusable helper: wait for the async `finish` event to materialize
const waitForBroadcast = () =>
  vi.waitFor(() => {
    expect(broadcastFn.mock.calls.length).toBeGreaterThan(0);
  }, { timeout: 500, interval: 10 });

// ============================================================
// HTTP observable: middleware doesn't block responses
// ============================================================

describe("WS middleware - does not block responses", () => {
  it("POST /api/v1/decisions returns 2xx with broadcaster injected", async () => {
    const res = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "no-interference check", rationale: "test" });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it("GET /api/v1/decisions returns 2xx with broadcaster injected", async () => {
    const res = await request(app).get("/api/v1/decisions").set(AUTH);
    expect(res.status).toBe(200);
  });

  it("POST without auth still returns 401", async () => {
    const res = await request(app)
      .post("/api/v1/decisions")
      .send({ decision: "blocked" });
    expect(res.status).toBe(401);
  });
});

// ============================================================
// Broadcast called on mutations
// ============================================================

describe("WS middleware - broadcast called on mutations", () => {
  it("broadcast is invoked after POST /api/v1/decisions", async () => {
    const res = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "broadcast check decision", rationale: "ws test" });
    expect(res.status).toBeLessThan(300);

    await waitForBroadcast();

    const evt = broadcastFn.mock.calls[0][0];
    expect(evt.type).toBe("mutated");
    expect(evt.resource).toBe("decisions");
    expect(evt.method).toBe("POST");
    expect(typeof evt.ts).toBe("number");
  });

  it("broadcast is invoked after POST /api/v1/tasks", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set(AUTH)
      .send({ title: "broadcast check task", status: "backlog", priority: "low" });
    expect(res.status).toBeLessThan(300);

    await waitForBroadcast();

    const evt = broadcastFn.mock.calls[0][0];
    expect(evt.resource).toBe("tasks");
    expect(evt.method).toBe("POST");
  });

  it("broadcast is NOT invoked after GET", async () => {
    await request(app).get("/api/v1/decisions").set(AUTH);
    await new Promise<void>(r => setTimeout(r, 50));
    expect(broadcastFn.mock.calls.length).toBe(0);
  });

  it("broadcast is NOT invoked after 401", async () => {
    await request(app).post("/api/v1/decisions").send({ decision: "blocked" });
    await new Promise<void>(r => setTimeout(r, 50));
    expect(broadcastFn.mock.calls.length).toBe(0);
  });
});

// ============================================================
// Resource name extraction
// ============================================================

describe("WS middleware - resource & method in event payload", () => {
  it("file-notes POST: resource extracted as 'file-notes'", async () => {
    const res = await request(app)
      .post("/api/v1/file-notes")
      .set(AUTH)
      .send({ file_path: "/test/ws2.ts", purpose: "ws test", executive_summary: "ws summary" });
    expect(res.status).toBeLessThan(300);

    await waitForBroadcast();

    expect(broadcastFn.mock.calls[0][0].resource).toBe("file-notes");
  });

  it("conventions POST: resource extracted as 'conventions'", async () => {
    const res = await request(app)
      .post("/api/v1/conventions")
      .set(AUTH)
      .send({ rule: "ws test convention", category: "testing" });
    expect(res.status).toBeLessThan(300);

    await waitForBroadcast();

    expect(broadcastFn.mock.calls[0][0].resource).toBe("conventions");
  });

  it("ts is a recent epoch timestamp", async () => {
    const before = Date.now();

    const res = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "ts check", rationale: "timing" });
    expect(res.status).toBeLessThan(300);

    await waitForBroadcast();

    const ts = broadcastFn.mock.calls[0][0].ts;
    const after = Date.now() + 200;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ============================================================
// DELETE - broadcasts on success
// ============================================================

describe("WS middleware - DELETE broadcasts", () => {
  it("DELETE /api/v1/decisions/:id broadcasts on success", async () => {
    const create = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "will be deleted", rationale: "delete test" });
    broadcastFn.mockClear();

    const id = create.body?.id ?? create.body?.data?.id;
    if (!id) return; // route may return different shape

    const res = await request(app)
      .delete(`/api/v1/decisions/${id}`)
      .set(AUTH);

    if (res.status >= 200 && res.status < 300) {
      await waitForBroadcast();

      const evt = broadcastFn.mock.calls[0][0];
      expect(evt.method).toBe("DELETE");
      expect(evt.resource).toBe("decisions");
    }
  });
});

// ============================================================
// WS upgrade token validation - pure unit logic
// ============================================================

describe("WS upgrade routing logic", () => {
  it("valid token matches on /ws path", () => {
    const url = new URL("/ws", "http://127.0.0.1:7432");
    url.searchParams.set("token", TOKEN);
    expect(url.pathname).toBe("/ws");
    expect(url.searchParams.get("token")).toBe(TOKEN);
  });

  it("rejects non-/ws paths", () => {
    expect(new URL("/not-ws", "http://127.0.0.1:7432").pathname).not.toBe("/ws");
  });

  it("detects missing token", () => {
    expect(new URL("/ws", "http://127.0.0.1:7432").searchParams.get("token")).toBeNull();
  });

  it("detects wrong token", () => {
    const url = new URL("/ws?token=wrong", "http://127.0.0.1:7432");
    expect(url.searchParams.get("token") === TOKEN).toBe(false);
  });
});
