// ============================================================================
// HTTP API Routes — Integration Smoke Tests
//
// Mounts the full Express app (createHttpServer) with an in-memory SQLite DB.
// Uses supertest to exercise every major endpoint: auth guard, GET lists,
// GET by id, POST create, and key analytics endpoints.
//
// Pattern:
//  - vi.mock is hoisted before any imports — creates isolated in-memory DB
//  - createHttpServer is called once in beforeAll (no actual port binding)
//  - supertest receives the express app directly (no listen required)
// ============================================================================

import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

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

// Prevent global-db.js from touching real disk files.
vi.mock("../../src/global-db.js", () => ({
  writeGlobalDecision: vi.fn().mockReturnValue(null),
  writeGlobalConvention: vi.fn().mockReturnValue(null),
  queryGlobalDecisions: vi.fn().mockReturnValue([]),
  queryGlobalConventions: vi.fn().mockReturnValue([]),
  getGlobalDb: vi.fn().mockReturnValue(null),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_TOKEN = "testtoken1234567890abcdef1234567890ab";
const AUTH = { Authorization: `Bearer ${TEST_TOKEN}` };

// ─── App setup ────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  const { createHttpServer } = await import("../../src/http-server.js");
  const result = createHttpServer({ port: 7432, token: TEST_TOKEN });
  app = result.app;
});

// ─────────────────────────────────────────────────────────────────────────────
// Health endpoint (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with ok and version", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.version).toBe("string");
  });

  it("does not require auth header", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard", () => {
  const protectedRoutes = [
    "/api/v1/sessions",
    "/api/v1/decisions",
    "/api/v1/tasks",
    "/api/v1/file-notes",
    "/api/v1/conventions",
    "/api/v1/changes",
    "/api/v1/milestones",
    "/api/v1/analytics/summary",
  ];

  for (const route of protectedRoutes) {
    it(`returns 401 on ${route} without token`, async () => {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  }

  it("returns 401 with wrong token", async () => {
    const res = await request(app)
      .get("/api/v1/sessions")
      .set("Authorization", "Bearer wrongtoken");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET list endpoints — empty DB returns ok:true, data:[]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/sessions", () => {
  it("returns paginated list", async () => {
    const res = await request(app).get("/api/v1/sessions").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/decisions", () => {
  it("returns paginated list", async () => {
    const res = await request(app).get("/api/v1/decisions").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("includes total in response body", async () => {
    const res = await request(app).get("/api/v1/decisions").set(AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.body.meta?.total).toBe("number");
  });
});

describe("GET /api/v1/tasks", () => {
  it("returns paginated list", async () => {
    const res = await request(app).get("/api/v1/tasks").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/file-notes", () => {
  it("returns list", async () => {
    const res = await request(app).get("/api/v1/file-notes").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/conventions", () => {
  it("returns list", async () => {
    const res = await request(app).get("/api/v1/conventions").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/changes", () => {
  it("returns paginated list", async () => {
    const res = await request(app).get("/api/v1/changes").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/milestones", () => {
  it("returns list", async () => {
    const res = await request(app).get("/api/v1/milestones").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/events", () => {
  it("returns list", async () => {
    const res = await request(app).get("/api/v1/events").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/v1/audit", () => {
  it("returns empty list from in-memory DB", async () => {
    const res = await request(app).get("/api/v1/audit").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Analytics endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/analytics/summary", () => {
  it("returns summary shape with zero counts", async () => {
    const res = await request(app).get("/api/v1/analytics/summary").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const d = res.body.data;
    expect(d).toHaveProperty("decisions");
    expect(d).toHaveProperty("tasks");
    expect(d).toHaveProperty("sessions");
    expect(d.decisions.total).toBe(0);
    expect(d.tasks.total).toBe(0);
  });
});

describe("GET /api/v1/analytics/activity", () => {
  it("returns array (empty for in-memory DB)", async () => {
    const res = await request(app).get("/api/v1/analytics/activity").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/v1/search").set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns results shape for a query with no matches", async () => {
    const res = await request(app)
      .get("/api/v1/search?q=nonexistent_xyz123")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const d = res.body.data;
    expect(d).toHaveProperty("decisions");
    expect(d).toHaveProperty("tasks");
    expect(d.decisions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST create endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/decisions", () => {
  it("returns 400 when body is missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "only-decision" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("creates a decision and returns 201 with the row", async () => {
    const res = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "Use ESM modules", rationale: "Modern standard" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect((res.body.data as Record<string, unknown>).decision).toBe("Use ESM modules");
  });
});

describe("POST /api/v1/tasks", () => {
  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("creates a task and returns 201", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set(AUTH)
      .send({ title: "Test task", priority: "medium" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect((res.body.data as Record<string, unknown>).title).toBe("Test task");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET by id
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/decisions/:id", () => {
  it("returns 404 for non-existent id", async () => {
    const res = await request(app).get("/api/v1/decisions/9999").set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 for non-numeric id", async () => {
    const res = await request(app).get("/api/v1/decisions/abc").set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns a created decision by id", async () => {
    // Create first
    const post = await request(app)
      .post("/api/v1/decisions")
      .set(AUTH)
      .send({ decision: "Use TypeScript", rationale: "Type safety" });
    expect(post.status).toBe(201);
    const id = (post.body.data as Record<string, unknown>).id as number;

    // Retrieve
    const get = await request(app).get(`/api/v1/decisions/${id}`).set(AUTH);
    expect(get.status).toBe(200);
    expect(get.body.ok).toBe(true);
    expect((get.body.data as Record<string, unknown>).decision).toBe("Use TypeScript");
  });
});
