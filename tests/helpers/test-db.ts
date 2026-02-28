// ============================================================================
// Test Helper — In-Memory Database Setup
// ============================================================================

import Database from "better-sqlite3";
import { vi } from "vitest";
import { runMigrations } from "../../src/migrations.js";
import { createRepositories, type Repositories } from "../../src/repositories/index.js";
import { randomUUID } from "crypto";

/**
 * Create a fresh in-memory SQLite database with Engram's full schema applied.
 * Uses runMigrations() so tests always run against the current schema (v17+).
 */
export function createTestDb(): {
  db: Database.Database;
  repos: Repositories;
  cleanup: () => void;
} {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run the real migration chain — always current schema, no manual copies.
  runMigrations(db);

  // Create repositories
  const repos = createRepositories(db);

  // Populate instance identity (mirrors initDatabase behavior)
  const ts = new Date().toISOString();
  if (!repos.config.get("instance_id")) {
    repos.config.set("instance_id", randomUUID(), ts);
    repos.config.set("instance_label", "test-project", ts);
    repos.config.set("instance_created_at", ts, ts);
    repos.config.set("machine_id", "test-machine-id-0000", ts);
    repos.config.set("sharing_mode", "none", ts);
    repos.config.set("sharing_types", JSON.stringify(["decisions", "conventions"]), ts);
  }

  return {
    db,
    repos,
    cleanup: () => { try { db.close(); } catch { /* already closed */ } },
  };
}

/**
 * Legacy signature: returns just the raw Database for backward compat.
 * Existing tests that call `createTestDb()` and expect a Database object
 * should continue to work via this re-export.
 */
export function createTestDatabase(): Database.Database {
  const { db } = createTestDb();
  return db;
}

/**
 * Mock the database module to use an in-memory test database.
 * Returns the test DB instance.
 */
export function mockDatabase(): Database.Database {
  const { db } = createTestDb();

  // This will be used in tests that import from "../database.js"
  vi.mock("../database.js", () => ({
    getDb: () => db,
    now: () => new Date().toISOString(),
    getCurrentSessionId: () => 1,
    getProjectRoot: () => "/test/project",
    getDbSizeKb: () => 42,
    getDbPath: () => ":memory:",
    backupDatabase: () => "/test/backup.db",
  }));

  return db;
}

/*
 * ── REMOVED: hand-rolled v4 schema ──────────────────────────────────────────
 * Previously createTestDb() manually replicated migrations v1–v4 inline.
 * This caused test failures whenever new migrations added columns (v5+).
 * Now we call runMigrations(db) above, which always stays in sync with the
 * real schema. Do not replicate migration SQL here again.
 * ────────────────────────────────────────────────────────────────────────────
 */


