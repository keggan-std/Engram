// ============================================================================
// Test Helper — In-Memory Database Setup
// ============================================================================

import Database from "better-sqlite3";
import { vi } from "vitest";

/**
 * Create a fresh in-memory SQLite database with Engram's schema applied.
 * Returns the DB instance for direct use in tests.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Apply baseline schema (mirrors migrations v1-v4)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', '4');

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      agent_name TEXT DEFAULT 'unknown',
      project_root TEXT,
      tags TEXT
    );

    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      timestamp TEXT NOT NULL,
      file_path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      description TEXT NOT NULL,
      diff_summary TEXT,
      impact_scope TEXT DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      timestamp TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      affected_files TEXT,
      tags TEXT,
      status TEXT DEFAULT 'active',
      superseded_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS file_notes (
      file_path TEXT PRIMARY KEY,
      purpose TEXT,
      dependencies TEXT,
      dependents TEXT,
      layer TEXT,
      last_reviewed TEXT,
      last_modified_session INTEGER,
      notes TEXT,
      complexity TEXT
    );

    CREATE TABLE IF NOT EXISTS conventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      timestamp TEXT NOT NULL,
      category TEXT NOT NULL,
      rule TEXT NOT NULL,
      examples TEXT,
      enforced INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'backlog',
      assigned_files TEXT,
      tags TEXT,
      blocked_by TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      timestamp TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      version TEXT,
      tags TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshot_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      created_at TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      last_triggered_at TEXT,
      acknowledged_at TEXT,
      recurrence TEXT,
      max_triggers INTEGER DEFAULT 1,
      trigger_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

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
