// ============================================================================
// Test Helper — In-Memory Database Setup
// ============================================================================

import Database from "better-sqlite3";
import { vi } from "vitest";
import { runMigrations } from "../../src/migrations.js";

/**
 * Create a fresh in-memory SQLite database with Engram's full schema applied.
 * Uses runMigrations() so tests always run against the current schema (v15+).
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run the real migration chain — always current schema, no manual copies.
  runMigrations(db);

  return db;
}

/**
 * Mock the database module to use an in-memory test database.
 * Returns the test DB instance.
 */
export function mockDatabase(): Database.Database {
  const db = createTestDb();

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


