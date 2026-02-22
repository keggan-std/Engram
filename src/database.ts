// ============================================================================
// Engram MCP Server — Database Layer (better-sqlite3 — native, WAL mode)
// ============================================================================

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { DB_DIR_NAME, DB_FILE_NAME, BACKUP_DIR_NAME } from "./constants.js";
import { runMigrations } from "./migrations.js";
import { createRepositories, type Repositories } from "./repositories/index.js";
import { CompactionService, ProjectScanService, GitService, EventTriggerService } from "./services/index.js";

export interface Services {
  compaction: CompactionService;
  scan: ProjectScanService;
  git: GitService;
  events: EventTriggerService;
}

let _db: DatabaseType | null = null;
let _repos: Repositories | null = null;
let _services: Services | null = null;
let _projectRoot: string = process.cwd();
let _dbPath: string = "";

// ─── Initialization ──────────────────────────────────────────────────

export async function initDatabase(projectRoot: string): Promise<DatabaseType> {
  _projectRoot = projectRoot;
  const dbDir = path.join(projectRoot, DB_DIR_NAME);
  fs.mkdirSync(dbDir, { recursive: true });
  ensureGitignore(projectRoot);

  _dbPath = path.join(dbDir, DB_FILE_NAME);
  _db = new Database(_dbPath);

  // Performance pragmas
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -8000"); // 8MB cache
  _db.pragma("busy_timeout = 5000");

  // Run versioned migrations
  runMigrations(_db);

  // Initialize repositories
  _repos = createRepositories(_db);

  // Initialize services
  _services = {
    compaction: new CompactionService(_db, _repos),
    scan: new ProjectScanService(_repos),
    git: new GitService(projectRoot),
    events: new EventTriggerService(_repos),
  };

  return _db;
}

export function getDb(): DatabaseType {
  if (!_db) throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

export function getRepos(): Repositories {
  if (!_repos) throw new Error("Repositories not initialized. Call initDatabase() first.");
  return _repos;
}

export function getServices(): Services {
  if (!_services) throw new Error("Services not initialized. Call initDatabase() first.");
  return _services;
}

export function getProjectRoot(): string {
  return _projectRoot;
}

export function getDbPath(): string {
  return _dbPath;
}

// ─── Backup ──────────────────────────────────────────────────────────

/**
 * Create a backup copy of the database file.
 * Uses SQLite's backup API for a safe, consistent copy.
 */
export function backupDatabase(destPath?: string): string {
  const db = getDb();
  const projectRoot = getProjectRoot();

  if (!destPath) {
    const backupDir = path.join(projectRoot, DB_DIR_NAME, BACKUP_DIR_NAME);
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    destPath = path.join(backupDir, `memory-${timestamp}.db`);
  }

  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true });

  // Use SQLite backup API
  db.backup(destPath);

  return destPath;
}

// ─── Gitignore ───────────────────────────────────────────────────────

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

// ─── Query Helpers ───────────────────────────────────────────────────

export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.all(...params) as Record<string, unknown>[];
}

export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const db = getDb();
  const stmt = db.prepare(sql);
  const row = stmt.get(...params) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function execute(sql: string, params: unknown[] = []): { lastId: number } {
  const db = getDb();
  const result = db.prepare(sql).run(...params);
  return { lastId: Number(result.lastInsertRowid) };
}

export function executeMany(statements: Array<{ sql: string; params: unknown[] }>): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    for (const { sql, params } of statements) {
      db.prepare(sql).run(...params);
    }
  });
  transaction();
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
  // With better-sqlite3 + WAL mode, we can force a WAL checkpoint
  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");
}
