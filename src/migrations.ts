// ============================================================================
// Engram MCP Server — Schema Migration System
// ============================================================================

import type { Database as DatabaseType } from "better-sqlite3";
import { log } from "./logger.js";

interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseType) => void;
}

// ─── Migration Definitions ───────────────────────────────────────────

const migrations: Migration[] = [
  // ─── V1: Baseline Schema ───────────────────────────────────────────
  {
    version: 1,
    description: "Baseline schema — sessions, changes, decisions, file_notes, conventions, tasks, milestones, snapshot_cache",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          summary TEXT,
          agent_name TEXT DEFAULT 'unknown',
          project_root TEXT NOT NULL,
          tags TEXT,
          parent_session_id INTEGER
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
        CREATE INDEX IF NOT EXISTS idx_changes_session ON changes(session_id);
        CREATE INDEX IF NOT EXISTS idx_changes_file ON changes(file_path);
        CREATE INDEX IF NOT EXISTS idx_changes_time ON changes(timestamp);

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
        CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);

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
          status TEXT DEFAULT 'backlog',
          priority TEXT DEFAULT 'medium',
          assigned_files TEXT,
          tags TEXT,
          completed_at TEXT,
          blocked_by TEXT
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
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          ttl_minutes INTEGER
        );
      `);
    },
  },

  // ─── V2: FTS5 Full-Text Search ─────────────────────────────────────
  {
    version: 2,
    description: "Add FTS5 virtual tables for high-performance full-text search",
    up: (db) => {
      db.exec(`
        -- FTS5 for session summaries
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_sessions USING fts5(
          summary,
          tags,
          content='sessions',
          content_rowid='id'
        );

        -- FTS5 for change descriptions
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_changes USING fts5(
          file_path,
          description,
          diff_summary,
          content='changes',
          content_rowid='id'
        );

        -- FTS5 for decisions
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_decisions USING fts5(
          decision,
          rationale,
          tags,
          content='decisions',
          content_rowid='id'
        );

        -- FTS5 for file notes
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_file_notes USING fts5(
          file_path,
          purpose,
          notes,
          content='file_notes'
        );

        -- FTS5 for conventions
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_conventions USING fts5(
          rule,
          examples,
          content='conventions',
          content_rowid='id'
        );

        -- FTS5 for tasks
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_tasks USING fts5(
          title,
          description,
          tags,
          content='tasks',
          content_rowid='id'
        );

        -- Triggers to keep FTS indexes in sync with main tables

        -- Sessions triggers
        CREATE TRIGGER IF NOT EXISTS trg_sessions_ai AFTER INSERT ON sessions BEGIN
          INSERT INTO fts_sessions(rowid, summary, tags) VALUES (new.id, new.summary, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_sessions_au AFTER UPDATE ON sessions BEGIN
          INSERT INTO fts_sessions(fts_sessions, rowid, summary, tags) VALUES('delete', old.id, old.summary, old.tags);
          INSERT INTO fts_sessions(rowid, summary, tags) VALUES (new.id, new.summary, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_sessions_ad AFTER DELETE ON sessions BEGIN
          INSERT INTO fts_sessions(fts_sessions, rowid, summary, tags) VALUES('delete', old.id, old.summary, old.tags);
        END;

        -- Changes triggers
        CREATE TRIGGER IF NOT EXISTS trg_changes_ai AFTER INSERT ON changes BEGIN
          INSERT INTO fts_changes(rowid, file_path, description, diff_summary) VALUES (new.id, new.file_path, new.description, new.diff_summary);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_changes_au AFTER UPDATE ON changes BEGIN
          INSERT INTO fts_changes(fts_changes, rowid, file_path, description, diff_summary) VALUES('delete', old.id, old.file_path, old.description, old.diff_summary);
          INSERT INTO fts_changes(rowid, file_path, description, diff_summary) VALUES (new.id, new.file_path, new.description, new.diff_summary);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_changes_ad AFTER DELETE ON changes BEGIN
          INSERT INTO fts_changes(fts_changes, rowid, file_path, description, diff_summary) VALUES('delete', old.id, old.file_path, old.description, old.diff_summary);
        END;

        -- Decisions triggers
        CREATE TRIGGER IF NOT EXISTS trg_decisions_ai AFTER INSERT ON decisions BEGIN
          INSERT INTO fts_decisions(rowid, decision, rationale, tags) VALUES (new.id, new.decision, new.rationale, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_decisions_au AFTER UPDATE ON decisions BEGIN
          INSERT INTO fts_decisions(fts_decisions, rowid, decision, rationale, tags) VALUES('delete', old.id, old.decision, old.rationale, old.tags);
          INSERT INTO fts_decisions(rowid, decision, rationale, tags) VALUES (new.id, new.decision, new.rationale, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_decisions_ad AFTER DELETE ON decisions BEGIN
          INSERT INTO fts_decisions(fts_decisions, rowid, decision, rationale, tags) VALUES('delete', old.id, old.decision, old.rationale, old.tags);
        END;

        -- Conventions triggers
        CREATE TRIGGER IF NOT EXISTS trg_conventions_ai AFTER INSERT ON conventions BEGIN
          INSERT INTO fts_conventions(rowid, rule, examples) VALUES (new.id, new.rule, new.examples);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_conventions_au AFTER UPDATE ON conventions BEGIN
          INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples) VALUES('delete', old.id, old.rule, old.examples);
          INSERT INTO fts_conventions(rowid, rule, examples) VALUES (new.id, new.rule, new.examples);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_conventions_ad AFTER DELETE ON conventions BEGIN
          INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples) VALUES('delete', old.id, old.rule, old.examples);
        END;

        -- Tasks triggers
        CREATE TRIGGER IF NOT EXISTS trg_tasks_ai AFTER INSERT ON tasks BEGIN
          INSERT INTO fts_tasks(rowid, title, description, tags) VALUES (new.id, new.title, new.description, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_tasks_au AFTER UPDATE ON tasks BEGIN
          INSERT INTO fts_tasks(fts_tasks, rowid, title, description, tags) VALUES('delete', old.id, old.title, old.description, old.tags);
          INSERT INTO fts_tasks(rowid, title, description, tags) VALUES (new.id, new.title, new.description, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_tasks_ad AFTER DELETE ON tasks BEGIN
          INSERT INTO fts_tasks(fts_tasks, rowid, title, description, tags) VALUES('delete', old.id, old.title, old.description, old.tags);
        END;
      `);

      // Populate FTS tables from existing data
      db.exec(`
        INSERT OR IGNORE INTO fts_sessions(rowid, summary, tags)
          SELECT id, summary, tags FROM sessions;
        INSERT OR IGNORE INTO fts_changes(rowid, file_path, description, diff_summary)
          SELECT id, file_path, description, diff_summary FROM changes;
        INSERT OR IGNORE INTO fts_decisions(rowid, decision, rationale, tags)
          SELECT id, decision, rationale, tags FROM decisions;
        INSERT OR IGNORE INTO fts_conventions(rowid, rule, examples)
          SELECT id, rule, examples FROM conventions;
        INSERT OR IGNORE INTO fts_tasks(rowid, title, description, tags)
          SELECT id, title, description, tags FROM tasks;
      `);
    },
  },

  // ─── V3: Config Table ──────────────────────────────────────────────
  {
    version: 3,
    description: "Add config table for user settings (retention, auto-compact, etc.)",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Default settings
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('auto_compact', 'true', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('compact_threshold', '50', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('retention_days', '90', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('max_backups', '10', datetime('now'));

        -- Additional composite indexes for better query performance
        CREATE INDEX IF NOT EXISTS idx_changes_file_time ON changes(file_path, timestamp);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_conventions_enforced ON conventions(enforced);
        CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at);
      `);
    },
  },

  // ─── V4: Scheduled Events ─────────────────────────────────────────
  {
    version: 4,
    description: "Add scheduled_events table for deferred work and reminders",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER,
          created_at TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          trigger_type TEXT NOT NULL DEFAULT 'next_session',
          trigger_value TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          triggered_at TEXT,
          acknowledged_at TEXT,
          requires_approval INTEGER DEFAULT 1,
          action_summary TEXT,
          action_data TEXT,
          priority TEXT DEFAULT 'medium',
          tags TEXT,
          recurrence TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_status ON scheduled_events(status);
        CREATE INDEX IF NOT EXISTS idx_events_trigger ON scheduled_events(trigger_type, status);

        -- FTS5 for searching events
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_events USING fts5(
          title, description, action_summary,
          content='scheduled_events', content_rowid='id'
        );

        -- Sync trigger
        CREATE TRIGGER IF NOT EXISTS fts_events_insert AFTER INSERT ON scheduled_events BEGIN
          INSERT INTO fts_events(rowid, title, description, action_summary)
          VALUES (new.id, new.title, new.description, new.action_summary);
        END;
      `);
    },
  },

  // ─── V5: Trustworthy Context ───────────────────────────────────────
  {
    version: 5,
    description: "Trustworthy context — file_mtime for stale detection; focus-ready indexes",
    up: (db) => {
      db.exec(`
        -- Store the actual file modification time (Unix ms) when notes are saved.
        -- Used to detect stale notes: if the file changed after notes were written,
        -- the agent is warned so it can decide whether to re-read or trust the cache.
        ALTER TABLE file_notes ADD COLUMN file_mtime INTEGER;

        -- Composite index to speed up focused start_session queries on tasks
        CREATE INDEX IF NOT EXISTS idx_tasks_priority_status
          ON tasks(priority, status)
          WHERE status NOT IN ('done', 'cancelled');
      `);
    },
  },

  // ─── V6: Multi-Agent Coordination ─────────────────────────────────
  {
    version: 6,
    description: "Multi-agent coordination — agents registry, broadcasts, task claiming",
    up: (db) => {
      db.exec(`
        -- Agent registry: tracks active agents, their status, and current task
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_seen INTEGER NOT NULL,
          current_task_id INTEGER,
          status TEXT DEFAULT 'idle'
        );
        CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

        -- Broadcast messages: agents can post messages readable by all other agents
        CREATE TABLE IF NOT EXISTS broadcasts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_agent TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          read_by TEXT DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at DESC);

        -- Task claiming: add claimed_by and claimed_at to tasks for atomic ownership
        ALTER TABLE tasks ADD COLUMN claimed_by TEXT;
        ALTER TABLE tasks ADD COLUMN claimed_at INTEGER;
        CREATE INDEX IF NOT EXISTS idx_tasks_claimed ON tasks(claimed_by) WHERE claimed_by IS NOT NULL;
      `);
    },
  },

  // ─── V7: File Locks + Pending Work ────────────────────────────────
  {
    version: 7,
    description: "Agent safety — file_locks for concurrent write prevention, pending_work for intent recording",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_locks (
          file_path TEXT PRIMARY KEY,
          agent_id  TEXT NOT NULL,
          reason    TEXT,
          locked_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);

        CREATE TABLE IF NOT EXISTS pending_work (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id    TEXT NOT NULL,
          session_id  INTEGER,
          description TEXT NOT NULL,
          files       TEXT NOT NULL DEFAULT '[]',
          started_at  INTEGER NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_pending_work_status ON pending_work(status);
        CREATE INDEX IF NOT EXISTS idx_pending_work_agent  ON pending_work(agent_id, status);
        CREATE INDEX IF NOT EXISTS idx_pending_work_session ON pending_work(session_id);
      `);
    },
  },

  // ─── V8: Context Pressure Tracking ────────────────────────────────
  {
    version: 8,
    description: "Context pressure — session_bytes table for byte-estimate token tracking",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_bytes (
          session_id INTEGER PRIMARY KEY,
          input_bytes  INTEGER NOT NULL DEFAULT 0,
          output_bytes INTEGER NOT NULL DEFAULT 0,
          tool_calls   INTEGER NOT NULL DEFAULT 0,
          updated_at   INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('context_pressure_notice_pct',  '50', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('context_pressure_warning_pct', '70', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('context_pressure_urgent_pct',  '85', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('context_window_size',    '200000', datetime('now'));
      `);
    },
  },

  // ─── V9: Knowledge Graph Enhancements ─────────────────────────────
  {
    version: 9,
    description: "Knowledge graph — git_branch in file_notes for branch-aware staleness; depends_on in decisions for dependency chains",
    up: (db) => {
      db.exec(`
        ALTER TABLE file_notes ADD COLUMN git_branch TEXT;

        ALTER TABLE decisions ADD COLUMN depends_on TEXT;
        CREATE INDEX IF NOT EXISTS idx_decisions_depends ON decisions(depends_on)
          WHERE depends_on IS NOT NULL;
      `);
    },
  },

    // ─── V10: Structured Agent Handoffs ───────────────────────────────
  {
    version: 10,
    description: "Session handoffs — handoffs table for graceful context-exhaustion transfers between agents",
    up: (db) => {
      db.exec(`
        -- Stores structured handoff packets for context-exhaustion transfers.
        -- start_session surfaces any unacknowledged handoff as handoff_pending.
        CREATE TABLE IF NOT EXISTS handoffs (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          from_session_id        INTEGER NOT NULL,
          from_agent             TEXT,
          created_at             INTEGER NOT NULL,
          reason                 TEXT NOT NULL,
          next_agent_instructions TEXT,
          resume_at              TEXT,
          git_branch             TEXT,
          open_task_ids          TEXT,
          last_file_touched      TEXT,
          acknowledged_at        INTEGER,
          acknowledged_by        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_handoffs_session ON handoffs(from_session_id);
        CREATE INDEX IF NOT EXISTS idx_handoffs_acked   ON handoffs(acknowledged_at) WHERE acknowledged_at IS NULL;
      `);
    },
  },
];

// ─── Migration Runner ────────────────────────────────────────────────

export function runMigrations(db: DatabaseType): void {
  // Ensure schema_meta table exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // Get current version
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  // Filter migrations that need to run
  const pendingMigrations = migrations.filter(m => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    return; // Already up to date
  }

  log.info(`Running ${pendingMigrations.length} migration(s) from v${currentVersion} → v${pendingMigrations[pendingMigrations.length - 1].version}`);

  for (const migration of pendingMigrations) {
    log.info(`  v${migration.version}: ${migration.description}`);

    // Run migration in a transaction for safety
    const runMigration = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
      ).run(String(migration.version));
    });

    runMigration();
  }

  log.info(`Migrations complete. Schema at v${pendingMigrations[pendingMigrations.length - 1].version}`);
}

export function getCurrentSchemaVersion(db: DatabaseType): number {
  try {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}
