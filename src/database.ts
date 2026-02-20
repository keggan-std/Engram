// ============================================================================
// Engram MCP Server — Database Layer (sql.js — pure JS, no native deps)
// ============================================================================

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import { DB_DIR_NAME, DB_FILE_NAME } from "./constants.js";

let _db: SqlJsDatabase | null = null;
let _projectRoot: string = process.cwd();
let _dbPath: string = "";
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Initialization ──────────────────────────────────────────────────

export async function initDatabase(projectRoot: string): Promise<SqlJsDatabase> {
  _projectRoot = projectRoot;
  const dbDir = path.join(projectRoot, DB_DIR_NAME);
  fs.mkdirSync(dbDir, { recursive: true });
  ensureGitignore(projectRoot);

  _dbPath = path.join(dbDir, DB_FILE_NAME);
  const SQL = await initSqlJs();

  if (fs.existsSync(_dbPath)) {
    const buffer = fs.readFileSync(_dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run("PRAGMA foreign_keys = ON");
  createSchema(_db);
  persistDb();
  return _db;
}

export function getDb(): SqlJsDatabase {
  if (!_db) throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

export function getProjectRoot(): string {
  return _projectRoot;
}

// ─── Persistence ─────────────────────────────────────────────────────

function persistDb(): void {
  if (!_db || !_dbPath) return;
  try {
    const data = _db.export();
    fs.writeFileSync(_dbPath, Buffer.from(data));
  } catch { /* retry on next save */ }
}

function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => persistDb(), 300);
}

function ensureGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      if (!content.includes(DB_DIR_NAME)) {
        fs.appendFileSync(gitignorePath, `\n# Engram AI agent memory\n${DB_DIR_NAME}/\n`);
      }
    }
  } catch { /* skip */ }
}

// ─── Schema ──────────────────────────────────────────────────────────

function createSchema(db: SqlJsDatabase): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1')`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT,
      summary TEXT, agent_name TEXT DEFAULT 'unknown', project_root TEXT NOT NULL,
      tags TEXT, parent_session_id INTEGER)`,

    `CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, timestamp TEXT NOT NULL,
      file_path TEXT NOT NULL, change_type TEXT NOT NULL, description TEXT NOT NULL,
      diff_summary TEXT, impact_scope TEXT DEFAULT 'local')`,
    `CREATE INDEX IF NOT EXISTS idx_changes_session ON changes(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_changes_file ON changes(file_path)`,
    `CREATE INDEX IF NOT EXISTS idx_changes_time ON changes(timestamp)`,

    `CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, timestamp TEXT NOT NULL,
      decision TEXT NOT NULL, rationale TEXT, affected_files TEXT, tags TEXT,
      status TEXT DEFAULT 'active', superseded_by INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`,

    `CREATE TABLE IF NOT EXISTS file_notes (
      file_path TEXT PRIMARY KEY, purpose TEXT, dependencies TEXT, dependents TEXT,
      layer TEXT, last_reviewed TEXT, last_modified_session INTEGER,
      notes TEXT, complexity TEXT)`,

    `CREATE TABLE IF NOT EXISTS conventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, timestamp TEXT NOT NULL,
      category TEXT NOT NULL, rule TEXT NOT NULL, examples TEXT, enforced INTEGER DEFAULT 1)`,

    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, status TEXT DEFAULT 'backlog', priority TEXT DEFAULT 'medium',
      assigned_files TEXT, tags TEXT, completed_at TEXT, blocked_by TEXT)`,

    `CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER,
      timestamp TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
      version TEXT, tags TEXT)`,

    `CREATE TABLE IF NOT EXISTS snapshot_cache (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL, ttl_minutes INTEGER)`,
  ];

  for (const sql of statements) {
    db.run(sql);
  }
}

// ─── Query Helpers ───────────────────────────────────────────────────

export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params as (string | number | null | Uint8Array)[]);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}

export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function execute(sql: string, params: unknown[] = []): { lastId: number } {
  const db = getDb();
  db.run(sql, params as (string | number | null | Uint8Array)[]);
  const row = queryOne("SELECT last_insert_rowid() as id");
  scheduleSave();
  return { lastId: (row?.id as number) || 0 };
}

export function executeMany(statements: Array<{ sql: string; params: unknown[] }>): void {
  const db = getDb();
  for (const { sql, params } of statements) {
    db.run(sql, params as (string | number | null | Uint8Array)[]);
  }
  scheduleSave();
}

// ─── Convenience ─────────────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString();
}

export function getCurrentSessionId(): number | null {
  const row = queryOne("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1");
  return row ? (row.id as number) : null;
}

export function getLastCompletedSession(): {
  id: number; ended_at: string; summary: string | null; agent_name: string;
} | null {
  const row = queryOne(
    "SELECT id, ended_at, summary, agent_name FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1"
  );
  if (!row) return null;
  return {
    id: row.id as number,
    ended_at: row.ended_at as string,
    summary: row.summary as string | null,
    agent_name: row.agent_name as string,
  };
}

export function getDbSizeKb(): number {
  try {
    const stats = fs.statSync(_dbPath);
    return Math.round(stats.size / 1024);
  } catch { return 0; }
}

export function forceFlush(): void {
  persistDb();
}

// ─── Compatibility Layer ─────────────────────────────────────────────
// Provides a better-sqlite3-like API so tool files can use familiar patterns.

interface PreparedLike {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
}

/**
 * Returns a DB wrapper with a .prepare() method matching better-sqlite3 patterns.
 * Usage: dbCompat().prepare("SELECT ...").all(params)
 */
export function dbCompat(): { prepare: (sql: string) => PreparedLike; exec: (sql: string) => void; transaction: <T>(fn: () => T) => () => T } {
  return {
    prepare(sql: string): PreparedLike {
      return {
        all(...params: unknown[]): Record<string, unknown>[] {
          return queryAll(sql, params);
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          return queryOne(sql, params) ?? undefined;
        },
        run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
          const db = getDb();
          db.run(sql, params as (string | number | null | Uint8Array)[]);
          const idRow = queryOne("SELECT last_insert_rowid() as id");
          const chgRow = queryOne("SELECT changes() as c");
          scheduleSave();
          return {
            lastInsertRowid: (idRow?.id as number) || 0,
            changes: (chgRow?.c as number) || 0,
          };
        },
      };
    },
    exec(sql: string): void {
      getDb().run(sql);
      scheduleSave();
    },
    transaction<T>(fn: () => T): () => T {
      return () => {
        const db = getDb();
        db.run("BEGIN TRANSACTION");
        try {
          const result = fn();
          db.run("COMMIT");
          scheduleSave();
          return result;
        } catch (e) {
          db.run("ROLLBACK");
          throw e;
        }
      };
    },
  };
}
