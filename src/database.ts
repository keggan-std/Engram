// ============================================================================
// Engram MCP Server — Database Layer (better-sqlite3 — native, WAL mode)
// ============================================================================

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { DB_DIR_NAME, DB_FILE_NAME, BACKUP_DIR_NAME, TOOL_CALL_LOG_MAX_ROWS, TOOL_CALL_LOG_PRUNE_INTERVAL } from "./constants.js";
import { runMigrations } from "./migrations.js";
import { createRepositories, type Repositories } from "./repositories/index.js";
import { CompactionService, ProjectScanService, GitService, EventTriggerService, UpdateService, AgentRulesService, InstanceRegistryService, CrossInstanceService, SensitiveDataService, WorkflowAdvisorService, PMDiagnosticsTracker } from "./services/index.js";
import { SERVER_VERSION, CFG_INSTANCE_ID, CFG_INSTANCE_LABEL, CFG_INSTANCE_CREATED_AT, CFG_MACHINE_ID, CFG_SHARING_MODE, CFG_SHARING_TYPES, DEFAULT_SHARING_MODE, DEFAULT_SHARING_TYPES } from "./constants.js";
import { getMachineId, generateInstanceLabel } from "./utils.js";
import { randomUUID } from "crypto";

export interface Services {
  compaction: CompactionService;
  scan: ProjectScanService;
  git: GitService;
  events: EventTriggerService;
  update: UpdateService;
  agentRules: AgentRulesService;
  registry: InstanceRegistryService;
  crossInstance: CrossInstanceService;
  sensitiveData: SensitiveDataService;
  advisor: WorkflowAdvisorService;
  diagnostics: PMDiagnosticsTracker;
}

let _db: DatabaseType | null = null;
let _repos: Repositories | null = null;
let _services: Services | null = null;
let _projectRoot: string = process.cwd();
let _dbPath: string = "";
let _ideKey: string | undefined;

// ─── Initialization ──────────────────────────────────────────────────

/**
 * Open the SQLite database, auto-recovering from WAL/SHM corruption.
 *
 * FLAW-2 FIX: busy_timeout is set immediately after open — BEFORE any other
 * pragma — so concurrent access from multiple IDE windows waits up to 5 s
 * instead of crashing with SQLITE_BUSY.
 *
 * FLAW-3 FIX: SQLITE_BUSY is no longer swallowed by the corruption-recovery
 * path. A busy DB is not corrupt; the two conditions must not be conflated.
 *
 * If WAL/SHM files cause SQLITE_CORRUPT they are removed and the main DB is
 * reopened (almost always intact in WAL mode). If the main DB itself is
 * corrupt it is renamed to a timestamped .corrupt file and a fresh database
 * is created.
 */
/**
 * Put the database into WAL mode, tolerating a concurrent cold start.
 *
 * PROVEN 2026-08-12 against the real `initDatabase()`: spawn four or five
 * processes at one fresh project root and 5–15% of them die with
 * `SQLITE_BUSY: database is locked`, thrown from `db.pragma("journal_mode =
 * WAL")` — NOT from the migration chain, which task #59 covers separately. The
 * process dies; the data is fine. IDE MCP hosts discard stderr (FR-D6 T6), so
 * what the user sees is an Engram that is simply absent, on first run, in
 * exactly the two-IDE topology this product supports.
 *
 * WHY `busy_timeout` DOES NOT COVER IT. Converting a database to WAL needs an
 * exclusive lock, and SQLite returns SQLITE_BUSY for a lock upgrade it judges
 * could deadlock rather than invoking the busy handler. Measured directly: with
 * `busy_timeout = 15000` and another connection holding BEGIN EXCLUSIVE, the
 * conversion still threw SQLITE_BUSY. The timeout is not the mechanism that
 * saves this.
 *
 * WHY READING THE MODE FIRST IS THE ACTUAL FIX, not merely a fast path.
 * `journal_mode` is a property of the FILE, and reading it needs only a shared
 * lock — measured: a second connection reports "wal" as soon as the first has
 * converted. So the loser of the race does not need to win the lock at all. It
 * needs to notice it no longer has to.
 *
 * REJECTED — raise `busy_timeout`: it is already 15 s and the measurement above
 * shows the conversion failing anyway, so this treats a symptom that is not the
 * cause. REJECTED — a lock file around open: a second coordination primitive
 * with its own staleness and cleanup problems, to serialise something SQLite
 * already serialises correctly. REJECTED — abandon WAL: it is what makes
 * concurrent readers work here, and multi-IDE is the supported topology.
 *
 * A persistent failure WARNS AND CONTINUES rather than throwing. The fallback
 * is the rollback journal — slower under concurrency, entirely correct — and a
 * degraded server beats an absent one whose reason went to a discarded stderr.
 */
function ensureWalMode(db: DatabaseType, attempts = 100, delayMs = 25): void {
  for (let i = 0; i <= attempts; i++) {
    // Cheap, shared-lock read. In the race this is what ends it.
    try {
      const mode = db.pragma("journal_mode", { simple: true }) as string | undefined;
      if (typeof mode === "string" && mode.toLowerCase() === "wal") return;
    } catch { /* fall through and try the conversion */ }

    try {
      db.pragma("journal_mode = WAL");
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code !== "SQLITE_BUSY" && code !== "SQLITE_BUSY_TIMEOUT") throw err;
      if (i === attempts) {
        console.error(
          "[Engram] [WARN] Could not switch the database to WAL mode — another " +
          "process is holding it. Continuing on the rollback journal, which is " +
          "correct but slower under concurrent access.",
        );
        return;
      }
      // Synchronous by necessity: better-sqlite3 is synchronous throughout, so
      // there is no event loop turn to yield to here.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function openDatabaseWithRecovery(dbPath: string): DatabaseType {
  const CORRUPTION_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);

  // ── First attempt ──────────────────────────────────────────────────
  try {
    const db = new Database(dbPath);
    db.pragma("busy_timeout = 15000"); // 15 s — multi-IDE shards may still share a file
    ensureWalMode(db);                 // survives a concurrent cold start; see above
    return db;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    // FLAW-3: never enter corruption recovery for a locked-but-healthy DB
    if (!CORRUPTION_CODES.has(code)) throw err;
  }

  // ── Try removing WAL/SHM ── main file is usually fine in WAL mode ──
  const walPath = dbPath + "-wal";
  const shmPath = dbPath + "-shm";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  for (const p of [walPath, shmPath]) {
    if (fs.existsSync(p)) {
      try { fs.renameSync(p, p + `.corrupt.${ts}.bak`); } catch { /* best-effort */ }
    }
  }

  try {
    const db = new Database(dbPath);
    db.pragma("busy_timeout = 15000"); // 15 s
    ensureWalMode(db);
    console.error("[Engram] [WARN] Recovered from corrupt WAL/SHM — some recent changes may be lost.");
    return db;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (!CORRUPTION_CODES.has(code)) throw err;
  }

  // ── Main DB is also corrupt — rename and start fresh ───────────────
  try { fs.renameSync(dbPath, dbPath + `.corrupt.${ts}.bak`); } catch { /* best-effort */ }
  console.error("[Engram] [WARN] Main database was corrupt — renamed to backup, starting fresh.");
  const freshDb = new Database(dbPath);
  freshDb.pragma("busy_timeout = 15000"); // 15 s
  // This path used to be the ONE that never set WAL, leaving the caller's
  // line 119 as its only source — which is why that line is not simply
  // redundant. Setting it here makes the function's contract uniform: every
  // database it returns is in WAL mode, or has warned that it is not.
  ensureWalMode(freshDb);
  return freshDb;
}

// FLAW-5 FIX: initDatabase is synchronous (better-sqlite3 is sync throughout).
// The misleading async/Promise wrapper is removed — callers no longer need
// to remember to await a function that never actually awaits anything.
//
// ideKey: when provided, the DB is opened as memory-{ideKey}.db instead of memory.db.
// Global-only IDEs (no workspaceVar) pass their IDE key so each IDE type gets its own
// shard, eliminating write-lock contention between different IDEs on the same project.
export function initDatabase(projectRoot: string, ideKey?: string): DatabaseType {
  _projectRoot = projectRoot;
  _ideKey = ideKey;
  const dbDir = path.join(projectRoot, DB_DIR_NAME);
  fs.mkdirSync(dbDir, { recursive: true });
  ensureGitignore(projectRoot);

  // Per-IDE shard: global installs without workspaceVar use memory-{ideKey}.db
  const dbFileName = ideKey ? `memory-${ideKey}.db` : DB_FILE_NAME;
  _dbPath = path.join(dbDir, dbFileName);
  _db = openDatabaseWithRecovery(_dbPath);

  // Performance pragmas. busy_timeout and WAL are both already established by
  // openDatabaseWithRecovery on every one of its three return paths, so the
  // bare `journal_mode = WAL` that used to sit here is gone rather than routed
  // through ensureWalMode(): it was a second, unprotected conversion attempt of
  // exactly the kind that produced the SQLITE_BUSY crash.
  _db.pragma("foreign_keys = ON");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -8000");       // 8MB cache
  _db.pragma("wal_autocheckpoint = 100"); // checkpoint every 100 pages for faster readers
  _db.pragma("mmap_size = 67108864");     // 64MB memory-mapped I/O
  _db.pragma("busy_timeout = 15000");     // 15 s — handles same-IDE multi-window contention

  // Run versioned migrations
  runMigrations(_db);

  // Initialize repositories
  _repos = createRepositories(_db);

  // Initialize services
  const registryService = new InstanceRegistryService(_repos.config, projectRoot, _db, dbFileName);
  const diagnosticsTracker = new PMDiagnosticsTracker();
  _services = {
    compaction: new CompactionService(_db, _repos),
    scan: new ProjectScanService(_repos),
    git: new GitService(projectRoot),
    events: new EventTriggerService(_repos),
    update: new UpdateService(_repos, SERVER_VERSION),
    agentRules: new AgentRulesService(projectRoot),
    registry: registryService,
    crossInstance: new CrossInstanceService(registryService),
    sensitiveData: new SensitiveDataService(_repos.config, _db),
    advisor: new WorkflowAdvisorService(_repos, diagnosticsTracker),
    diagnostics: diagnosticsTracker,
  };

  // ─── Instance Identity ─────────────────────────────────────────────
  // Generate stable identity on first run after v17 migration.
  // These values live in the config table and never change once set.
  const existingId = _repos.config.get(CFG_INSTANCE_ID);
  if (!existingId) {
    const ts = now();
    _repos.config.set(CFG_INSTANCE_ID, randomUUID(), ts);
    _repos.config.set(CFG_INSTANCE_LABEL, generateInstanceLabel(projectRoot), ts);
    _repos.config.set(CFG_INSTANCE_CREATED_AT, ts, ts);
    _repos.config.set(CFG_MACHINE_ID, getMachineId(), ts);
    _repos.config.set(CFG_SHARING_MODE, DEFAULT_SHARING_MODE, ts);
    _repos.config.set(CFG_SHARING_TYPES, JSON.stringify(DEFAULT_SHARING_TYPES), ts);
  }

  // ─── Instance Registry ─────────────────────────────────────────────
  // Register in ~/.engram/instances.json and start periodic heartbeat.
  // The heartbeat timer is unref'd so it won't prevent Node from exiting.
  _services.registry.register();
  _services.registry.startHeartbeat();

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

// ─── Runtime Re-Initialization ───────────────────────────────────────

/**
 * Re-initialize the database at a new project root.
 *
 * Used when the agent provides the correct project_root at session start
 * and the server originally resolved to the wrong location (e.g. the
 * global fallback because the IDE spawned from $HOME).
 *
 * If the old DB at the incorrect location contains data, this function
 * copies it to the new location so previous sessions/decisions/etc. survive.
 *
 * @returns {{ migrated: boolean; oldPath: string; newPath: string; message: string }}
 */
export function reinitDatabase(newProjectRoot: string, ideKey?: string): {
  migrated: boolean;
  oldPath: string;
  newPath: string;
  message: string;
} {
  const oldProjectRoot = _projectRoot;
  const oldDbPath = _dbPath;

  // Nothing to do if already at the correct root
  const normalizedOld = oldProjectRoot.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const normalizedNew = newProjectRoot.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  if (normalizedOld === normalizedNew) {
    return { migrated: false, oldPath: oldDbPath, newPath: oldDbPath, message: "Already at correct project root." };
  }

  // Compute new DB path
  const newDbDir = path.join(newProjectRoot, DB_DIR_NAME);
  const dbFileName = ideKey ? `memory-${ideKey}.db` : DB_FILE_NAME;
  const newDbPath = path.join(newDbDir, dbFileName);

  // Close old DB
  if (_db) {
    try {
      // Flush instance registry before closing
      _services?.registry.shutdown();
    } catch { /* best effort */ }
    try { _db.close(); } catch { /* best effort */ }
    _db = null;
    _repos = null;
    _services = null;
  }

  // Ensure new directory exists
  fs.mkdirSync(newDbDir, { recursive: true });

  // If new DB doesn't exist yet AND old DB has data, copy old → new
  let migrated = false;
  if (!fs.existsSync(newDbPath) && fs.existsSync(oldDbPath)) {
    try {
      fs.copyFileSync(oldDbPath, newDbPath);
      // Also copy WAL/SHM if present (ensures consistency)
      for (const suffix of ["-wal", "-shm"]) {
        const src = oldDbPath + suffix;
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, newDbPath + suffix);
        }
      }
      migrated = true;
      console.error(`[Engram] [INFO] Migrated database from ${oldDbPath} → ${newDbPath}`);
    } catch (err) {
      console.error(`[Engram] [WARN] Failed to migrate database: ${err}. Starting fresh.`);
    }
  }

  // Re-initialize at the new location
  initDatabase(newProjectRoot, ideKey);

  const msg = migrated
    ? `Database migrated from ${oldProjectRoot} to ${newProjectRoot}. Previous data preserved.`
    : fs.existsSync(oldDbPath) && oldDbPath !== newDbPath
      ? `Database re-initialized at ${newProjectRoot}. Old data remains at ${oldDbPath}.`
      : `Database initialized at ${newProjectRoot}.`;

  return { migrated, oldPath: oldDbPath, newPath: newDbPath, message: msg };
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

  // Flush WAL to the main DB file so the copy is consistent (ISS-005 fix).
  // better-sqlite3's db.backup() is async in v9+ and statSync immediately after
  // it would throw ENOENT before the file is written. Using WAL checkpoint +
  // synchronous file copy guarantees the backup file is fully written before
  // we return the path to callers.
  try { db.pragma("wal_checkpoint(FULL)"); } catch { /* WAL may not be in use */ }
  fs.copyFileSync(getDbPath(), destPath);

  return destPath;
}

// ─── Restore ─────────────────────────────────────────────────────────

/**
 * Replace the live database with the contents of a backup file.
 *
 * FR-D1 T1. The previous implementation (dispatcher-admin `case "restore"`)
 * copied the backup over memory.db while this process still held the
 * connection open, and never removed the old -wal/-shm. SQLite then
 * checkpointed the STALE WAL back over the freshly restored file — so the
 * restore silently did not happen, `integrity_check` still returned "ok", and
 * the user was told to restart, which is the very act that undid their
 * rollback. Proof and quoted output: docs/foundations/01-durability.md P1.
 *
 * sqlite.org/howtocorrupt.html §1.4 lists "overwriting a database file with
 * another without also deleting any hot journal associated with the original
 * database" among the actions likely to lead to corruption. This function is
 * the fix for that specific bullet.
 *
 * Order matters and every step is load-bearing:
 *   1. validate the candidate before touching anything (it may not be a
 *      database at all — the old code checked existence only)
 *   2. safety-backup, and ABORT if it fails. The live path used to swallow
 *      that failure; only the dead code in tools/backup.ts got it right
 *   3. close the connection, so nothing can write behind us
 *   4. delete main + -wal + -shm TOGETHER — this is the actual bug fix
 *   5. copy, then reopen through initDatabase so migrations run against a
 *      possibly-older backup and repos/services are rebuilt
 *
 * @throws if the candidate is unreadable, fails integrity_check, carries no
 *         schema_meta version, or if the safety backup cannot be written.
 */
export function restoreDatabase(inputPath: string): {
  restored_from: string;
  safety_backup: string;
  schema_version: string;
} {
  const resolved = path.isAbsolute(inputPath) ? inputPath : path.join(_projectRoot, inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`Backup file not found: ${resolved}`);

  // ── 1. Validate the candidate ──────────────────────────────────────
  // Read-only so a malformed file cannot be modified by the act of checking it.
  let schemaVersion: string;
  {
    let probe: DatabaseType | null = null;
    try {
      probe = new Database(resolved, { readonly: true, fileMustExist: true });
      const integrity = probe.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        throw new Error(`refusing to restore: integrity_check returned "${integrity}"`);
      }
      // Ask sqlite_master first: a plain SELECT throws "no such table", which
      // is SQLite's message, not an answer to the user's question.
      const hasMeta = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
      const row = hasMeta
        ? probe.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined
        : undefined;
      if (!row?.value) {
        throw new Error("refusing to restore: no schema_meta version — this is not an Engram database");
      }
      schemaVersion = row.value;
    } catch (e) {
      throw new Error(`Backup file rejected: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      try { probe?.close(); } catch { /* best effort */ }
    }
  }

  // ── 2. Safety backup — blocking, unlike the path this replaces ──────
  let safetyBackup: string;
  try {
    safetyBackup = backupDatabase();
  } catch (e) {
    throw new Error(`Failed to create a safety backup before restore: ${e}. Aborting — nothing was changed.`);
  }

  // ── 3. Close ────────────────────────────────────────────────────────
  if (_db) {
    try { _services?.registry.shutdown(); } catch { /* best effort */ }
    try { _db.close(); } catch { /* best effort */ }
    _db = null;
    _repos = null;
    _services = null;
  }

  // ── 4. Delete main + journals together ──────────────────────────────
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(_dbPath + suffix, { force: true }); } catch { /* best effort */ }
  }

  // ── 5. Copy and reopen ──────────────────────────────────────────────
  try {
    fs.copyFileSync(resolved, _dbPath);
  } catch (e) {
    // The live database is gone at this point; say exactly where it went.
    throw new Error(`Failed to restore: ${e}. Your previous database is at ${safetyBackup}.`);
  }
  initDatabase(_projectRoot, _ideKey);

  return { restored_from: resolved, safety_backup: safetyBackup, schema_version: schemaVersion };
}

// ─── Gitignore ───────────────────────────────────────────────────────

// FLAW-6 / FLAW-13 FIX: Write a self-contained .engram/.gitignore ("*") that
// protects the DB regardless of whether a root .gitignore exists or is writable.
// Also append to root .gitignore when present, as a belt-and-suspenders measure.
function ensureGitignore(projectRoot: string): void {
  // 1. Self-contained: .engram/.gitignore with wildcard — always works
  try {
    const dbDir = path.join(projectRoot, DB_DIR_NAME);
    const innerIgnore = path.join(dbDir, ".gitignore");
    if (!fs.existsSync(innerIgnore)) {
      fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(innerIgnore,
        "# Engram AI agent memory — do not commit\n*\n!.gitignore\n",
        "utf-8"
      );
    }
  } catch { /* best-effort */ }

  // 2. Belt-and-suspenders: append to root .gitignore if it exists
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

/**
 * Newest open session, optionally scoped to one agent.
 *
 * AUDIT N3a: the unscoped form answers "the newest open session belonging to
 * ANYONE". Since sessions are no longer force-closed on every start, more than
 * one may be open at a time, so any caller that knows its own identity should
 * pass `agentName`. Mirrors SessionsRepo.getOpenSessionId().
 */
export function getCurrentSessionId(agentName?: string): number | null {
  const row = agentName
    ? queryOne("SELECT id FROM sessions WHERE ended_at IS NULL AND agent_name = ? ORDER BY id DESC LIMIT 1", [agentName])
    : queryOne("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1");
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

/** Insert counter driving the periodic prune below. Process-local, not persisted. */
let _toolCallsSincePrune = 0;

/**
 * Log a tool invocation. Feeds two things that did not previously work:
 * the `replay` timeline, and the "which actions are never called" signal that
 * licenses deleting an action.
 *
 * Until 2026-08-02 this was called from five sites, all in sessions.ts, so 72 of
 * the 83 actions had no telemetry at all and the unused-action report could not
 * be computed. See docs/foundations/measurements/README.md §2.
 *
 * `agent_id` is resolved from the owning session rather than passed in — it is
 * derivable, and deriving it means it cannot disagree with the session record.
 * Previously hardcoded `null`.
 *
 * Silent no-op if the table doesn't exist (older schemas). Never throws: losing
 * a diagnostic row must never fail the operation being diagnosed.
 */
export function logToolCall(
  toolName: string,
  outcome: "success" | "error" = "success",
  notes?: string,
  agentName?: string
): void {
  try {
    const db = getDb();

    // Resolve the owning session. Prefer the caller's own OPEN session; fall
    // back to its most recent closed one. The fallback matters for `end`, which
    // logs from a finally block after the session it belongs to is already
    // closed — without it, every session-end event would be unattributed.
    let sessionId: number | null;
    if (agentName) {
      const row = db.prepare(
        `SELECT id FROM sessions WHERE agent_name = ?
          ORDER BY (ended_at IS NULL) DESC, id DESC LIMIT 1`
      ).get(agentName) as { id: number } | undefined;
      sessionId = row?.id ?? getCurrentSessionId();
    } else {
      sessionId = getCurrentSessionId();
    }

    // agent_id prefers the name the caller supplied over the one derived from
    // the session: the caller identifying itself is the stronger signal, and it
    // still resolves when no session is open.
    db.prepare(
      `INSERT INTO tool_call_log (session_id, agent_id, tool_name, called_at, outcome, notes)
       VALUES (?, COALESCE(?, (SELECT agent_name FROM sessions WHERE id = ?)), ?, ?, ?, ?)`
    ).run(sessionId, agentName ?? null, sessionId, toolName, Date.now(), outcome, notes ?? null);

    // Now that every action logs, this table grows without bound — nothing else
    // prunes it (compaction does not touch it). Trim on a counter rather than
    // every insert so the cost is amortised.
    if (++_toolCallsSincePrune >= TOOL_CALL_LOG_PRUNE_INTERVAL) {
      _toolCallsSincePrune = 0;
      db.prepare(
        `DELETE FROM tool_call_log WHERE id < (
           SELECT MIN(id) FROM (
             SELECT id FROM tool_call_log ORDER BY id DESC LIMIT ?
           )
         )`
      ).run(TOOL_CALL_LOG_MAX_ROWS);
    }
  } catch { /* table may not exist on older schemas — always silent */ }
}
