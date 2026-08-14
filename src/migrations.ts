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

  // ─── V11: Tool Call Log (Session Replay / Diagnostics) ────────────
  {
    version: 11,
    description: "Tool call log — records every MCP tool invocation for session replay and audit",
    up: (db) => {
      db.exec(`
        -- Log of every MCP tool invocation for diagnostic replay.
        -- Populated by tools that call logToolCall(); passive tools may skip logging.
        CREATE TABLE IF NOT EXISTS tool_call_log (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  INTEGER,
          agent_id    TEXT,
          tool_name   TEXT NOT NULL,
          called_at   INTEGER NOT NULL,
          input_hash  TEXT,
          outcome     TEXT NOT NULL DEFAULT 'success',
          notes       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_call_log(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_time    ON tool_call_log(called_at);
      `);
    },
  },

  // ─── V12: Checkpoints ─────────────────────────────────────────────
  {
    version: 12,
    description: "Checkpoints — working memory offload table for agent context preservation across sessions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id           INTEGER NOT NULL,
          agent_name           TEXT,
          created_at           INTEGER NOT NULL,
          current_understanding TEXT NOT NULL,
          progress             TEXT NOT NULL,
          relevant_files       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_time    ON checkpoints(created_at DESC);
      `);
    },
  },

  // ─── V13: Staleness-Enhanced ───────────────────────────────────────
  {
    version: 13,
    description: "Staleness-enhanced — content_hash SHA-256 on file_notes for hash-based confidence scoring",
    up: (db) => {
      db.exec(`ALTER TABLE file_notes ADD COLUMN content_hash TEXT;`);
    },
  },

  // ─── V14: Tiered Verbosity ───────────────────────────────────────
  {
    version: 14,
    description: "Tiered verbosity — executive_summary column on file_notes for Tier 1 micro-level reads",
    up: (db) => {
      db.exec(`ALTER TABLE file_notes ADD COLUMN executive_summary TEXT;`);
    },
  },

  // ─── V15: Multi-Agent Specializations ───────────────────────────
  {
    version: 15,
    description: "Multi-agent specializations — specializations TEXT (JSON array) on agents for task routing",
    up: (db) => {
      db.exec(`ALTER TABLE agents ADD COLUMN specializations TEXT;`);
    },
  },

  // ─── V16: Targeted Broadcasts ────────────────────────────────────
  {
    version: 16,
    description: "Targeted broadcasts — target_agent TEXT on broadcasts for directed delivery",
    up: (db) => {
      db.exec(`ALTER TABLE broadcasts ADD COLUMN target_agent TEXT;`);
    },
  },

  // ─── V17: Instance Identity & Cross-Instance Infrastructure ─────
  {
    version: 17,
    description: "Instance identity + cross-instance sharing infrastructure — config keys populated by initDatabase()",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sensitive_access_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requester_instance_id TEXT NOT NULL,
          requester_label TEXT,
          target_type TEXT NOT NULL,
          target_ids TEXT NOT NULL,
          reason TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sar_status ON sensitive_access_requests(status);
        CREATE INDEX IF NOT EXISTS idx_sar_requester ON sensitive_access_requests(requester_instance_id);
      `);
    },
  },

  // ─── V18: HTTP API Token (config table entry only) ───────────────
  {
    version: 18,
    description: "HTTP API token placeholder — actual token generated by http-auth on first start",
    up: (_db) => {
      // Token is stored in the config table under CFG_HTTP_TOKEN key.
      // No ALTER TABLE needed; config table is already flexible.
      // Token value is written by HttpAuth.ensureToken() at server start.
    },
  },

  // ─── V19: Soft Delete Columns ────────────────────────────────────
  {
    version: 19,
    description: "Add deleted_at column to decisions, file_notes, tasks, sessions for soft-delete support",
    up: (db) => {
      // Use separate exec calls — SQLite does not support multiple ADD COLUMN
      // statements in a single ALTER TABLE.
      try { db.exec(`ALTER TABLE decisions ADD COLUMN deleted_at INTEGER`); } catch { /* already exists */ }
      try { db.exec(`ALTER TABLE file_notes ADD COLUMN deleted_at INTEGER`); } catch { /* already exists */ }
      try { db.exec(`ALTER TABLE tasks ADD COLUMN deleted_at INTEGER`); } catch { /* already exists */ }
      try { db.exec(`ALTER TABLE sessions ADD COLUMN deleted_at INTEGER`); } catch { /* already exists */ }
    },
  },

  // ─── V20: Audit Log ──────────────────────────────────────────────
  {
    version: 20,
    description: "Create audit_log table — records all human-initiated mutations via the dashboard API",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          action    TEXT NOT NULL,
          actor     TEXT NOT NULL DEFAULT 'human',
          table_name TEXT NOT NULL,
          record_id  INTEGER,
          before_json TEXT,
          after_json  TEXT,
          session_id  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
      `);
    },
  },

  // ─── V21: Import Jobs ────────────────────────────────────────────
  {
    version: 21,
    description: "Create import_jobs table — tracks staged cross-instance import batches awaiting human review",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_jobs (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          source_path    TEXT NOT NULL,
          source_agent   TEXT,
          status         TEXT NOT NULL DEFAULT 'pending',
          total_records  INTEGER DEFAULT 0,
          approved_count INTEGER DEFAULT 0,
          rejected_count INTEGER DEFAULT 0,
          trust_level    TEXT DEFAULT 'review-required',
          raw_json       TEXT NOT NULL,
          completed_at   INTEGER
        );
      `);
    },
  },

  // ─── V22: Human Annotations ──────────────────────────────────────
  {
    version: 22,
    description: "Create annotations table — human notes attached to any record via the dashboard",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS annotations (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          target_table TEXT NOT NULL,
          target_id    INTEGER NOT NULL,
          note         TEXT NOT NULL,
          author       TEXT NOT NULL DEFAULT 'human'
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_table, target_id);
      `);
    },
  },

  // ─── V23: PM Convention Upgrade ──────────────────────────────────
  {
    version: 23,
    description: "PM convention upgrade: add summary+tags columns, rebuild FTS, add PM config keys",
    up: (db) => {
      // 1. Add new columns to conventions table
      db.exec(`
        ALTER TABLE conventions ADD COLUMN summary TEXT;
        ALTER TABLE conventions ADD COLUMN tags    TEXT;
      `);

      // 2. Backfill summary from first 80 chars of rule
      db.exec(`
        UPDATE conventions SET summary = SUBSTR(rule, 1, 80) WHERE summary IS NULL;
      `);

      // 3. Drop old conventions FTS triggers (they reference old column list)
      db.exec(`
        DROP TRIGGER IF EXISTS trg_conventions_ai;
        DROP TRIGGER IF EXISTS trg_conventions_au;
        DROP TRIGGER IF EXISTS trg_conventions_ad;
      `);

      // 4. Drop and recreate fts_conventions with expanded columns
      db.exec(`
        DROP TABLE IF EXISTS fts_conventions;
        CREATE VIRTUAL TABLE fts_conventions USING fts5(
          rule,
          examples,
          summary,
          tags,
          content='conventions',
          content_rowid='id'
        );
      `);

      // 5. Rebuild FTS index from conventions table
      db.exec(`INSERT INTO fts_conventions(fts_conventions) VALUES ('rebuild')`);

      // 6. Recreate triggers with new column list
      db.exec(`
        CREATE TRIGGER trg_conventions_ai AFTER INSERT ON conventions BEGIN
          INSERT INTO fts_conventions(rowid, rule, examples, summary, tags)
            VALUES (new.id, new.rule, new.examples, new.summary, new.tags);
        END;
        CREATE TRIGGER trg_conventions_au AFTER UPDATE ON conventions BEGIN
          INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples, summary, tags)
            VALUES('delete', old.id, old.rule, old.examples, old.summary, old.tags);
          INSERT INTO fts_conventions(rowid, rule, examples, summary, tags)
            VALUES (new.id, new.rule, new.examples, new.summary, new.tags);
        END;
        CREATE TRIGGER trg_conventions_ad AFTER DELETE ON conventions BEGIN
          INSERT INTO fts_conventions(fts_conventions, rowid, rule, examples, summary, tags)
            VALUES('delete', old.id, old.rule, old.examples, old.summary, old.tags);
        END;
      `);

      // 7. Insert PM framework config keys (defaults — PM-Lite auto-ON, PM-Full opt-in)
      db.exec(`
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_lite_enabled',   'true',  datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_full_enabled',   'false', datetime('now'));
        INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('pm_offer_declined', 'false', datetime('now'));
      `);
    },
  },

  // ─── V24: Observations Table ─────────────────────────────────────
  {
    version: 24,
    description: "Create observations table + FTS5 — lightweight non-decision notes for agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS observations (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  INTEGER REFERENCES sessions(id),
          timestamp   TEXT NOT NULL,
          content     TEXT NOT NULL,
          category    TEXT NOT NULL DEFAULT 'other',
          file_path   TEXT,
          tags        TEXT,
          agent_name  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_observations_session   ON observations(session_id);
        CREATE INDEX IF NOT EXISTS idx_observations_category  ON observations(category);
        CREATE INDEX IF NOT EXISTS idx_observations_file_path ON observations(file_path);

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_observations USING fts5(
          content,
          tags,
          content='observations',
          content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS trg_observations_ai AFTER INSERT ON observations BEGIN
          INSERT INTO fts_observations(rowid, content, tags)
            VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_observations_au AFTER UPDATE ON observations BEGIN
          INSERT INTO fts_observations(fts_observations, rowid, content, tags)
            VALUES('delete', old.id, old.content, old.tags);
          INSERT INTO fts_observations(rowid, content, tags)
            VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_observations_ad AFTER DELETE ON observations BEGIN
          INSERT INTO fts_observations(fts_observations, rowid, content, tags)
            VALUES('delete', old.id, old.content, old.tags);
        END;
      `);
    },
  },
  {
    version: 25,
    description: "Repair decisions.superseded_by — clear it on rows that were never superseded",
    up: (db) => {
      // DecisionsRepo.create() bound the `supersedes` argument to the NEW row's
      // `superseded_by` column. That column means "the decision that replaced
      // this one", so the new, authoritative decision was left pointing
      // backwards at the one it replaced — `status:'active'` and
      // `superseded_by:<older id>` simultaneously, which is self-contradictory.
      //
      // The write path is fixed in decisions.repo.ts. This repairs databases
      // that already recorded a superseding decision.
      //
      // Only a row whose status is actually 'superseded' may carry the pointer.
      // Idempotent, and a no-op on any database that never used `supersedes`.
      db.exec(`
        UPDATE decisions
           SET superseded_by = NULL
         WHERE superseded_by IS NOT NULL
           AND status <> 'superseded';
      `);
    },
  },
  {
    version: 26,
    description: "Populate fts_file_notes — it has never had triggers, so file-note search always returned nothing",
    up: (db) => {
      // V2 created fts_file_notes and then omitted file_notes from BOTH the
      // trigger block and the backfill that every other content table got.
      // Nothing in src/ has ever written to it either, so the inverted index
      // has been empty since the table was created and both read paths
      // (intelligence.ts, dispatcher-memory.ts `search`) returned no file-note
      // hits and reported no error.
      //
      // PROVEN on a real store before this migration was written: fts5 keeps
      // its baseline 2 rows in fts_file_notes_data where the six working
      // shadows hold 13 to 64, and `MATCH 'the'` returned 0 against 96 base
      // rows of which 70 contain the word.
      //
      // DO NOT verify this by comparing row counts or column values between
      // file_notes and fts_file_notes. For an external-content table those
      // reads are served THROUGH the base table by rowid, so they agree
      // perfectly whether or not an index exists — 96 vs 96 and zero drift
      // across 288 field comparisons, all of it tautological. Only a MATCH
      // query or the _data row count touches the actual index.
      //
      // Three things differ from a straight copy of the other six:
      //
      // 1. No content_rowid. file_notes is keyed `file_path TEXT PRIMARY KEY`
      //    and has no `id` column, so the implicit rowid is correct here.
      //    Adding content_rowid='id' to match the others would not compile.
      //
      // 2. executive_summary joins the indexed columns. Agent rule AR-06
      //    requires every agent to write it, and it was the one required field
      //    that restoring the triggers alone would have left unsearchable.
      //    fts5 columns cannot be ALTERed, hence the drop and recreate — which
      //    costs nothing, the table being empty.
      //
      // 3. Soft-deleted rows are kept OUT of the index rather than filtered at
      //    read time. file_notes.deleted_at exists (V19) and is currently
      //    written by nothing in src/, so this is precautionary: if soft delete
      //    is ever wired up, search must not resurrect deleted notes. REJECTED
      //    the alternative of indexing everything and adding
      //    `AND deleted_at IS NULL` to each reader — that is the rule copied to
      //    N call sites with nothing to catch site N+1, the exact shape FR-D5
      //    found in the installer and #127 found again in addToConfig. One
      //    trigger enforces it for every reader, present and future.
      //
      // The UPDATE trigger uses `INSERT ... SELECT ... WHERE` rather than two
      // WHEN-guarded triggers. SQLite does not define the firing order of two
      // triggers of the same kind on the same table, so a WHEN pair could run
      // insert-before-delete on an ordinary edit and silently unindex the row —
      // reintroducing this very bug, intermittently. One trigger, ordered
      // statements, each self-guarding.
      //
      // Idempotent by construction: the drop precedes every create.
      db.exec(`
        DROP TRIGGER IF EXISTS trg_file_notes_ai;
        DROP TRIGGER IF EXISTS trg_file_notes_au;
        DROP TRIGGER IF EXISTS trg_file_notes_ad;
        DROP TABLE IF EXISTS fts_file_notes;

        CREATE VIRTUAL TABLE fts_file_notes USING fts5(
          file_path,
          purpose,
          notes,
          executive_summary,
          content='file_notes'
        );

        CREATE TRIGGER trg_file_notes_ai AFTER INSERT ON file_notes BEGIN
          INSERT INTO fts_file_notes(rowid, file_path, purpose, notes, executive_summary)
            SELECT new.rowid, new.file_path, new.purpose, new.notes, new.executive_summary
             WHERE new.deleted_at IS NULL;
        END;

        CREATE TRIGGER trg_file_notes_au AFTER UPDATE ON file_notes BEGIN
          INSERT INTO fts_file_notes(fts_file_notes, rowid, file_path, purpose, notes, executive_summary)
            SELECT 'delete', old.rowid, old.file_path, old.purpose, old.notes, old.executive_summary
             WHERE old.deleted_at IS NULL;
          INSERT INTO fts_file_notes(rowid, file_path, purpose, notes, executive_summary)
            SELECT new.rowid, new.file_path, new.purpose, new.notes, new.executive_summary
             WHERE new.deleted_at IS NULL;
        END;

        CREATE TRIGGER trg_file_notes_ad AFTER DELETE ON file_notes BEGIN
          INSERT INTO fts_file_notes(fts_file_notes, rowid, file_path, purpose, notes, executive_summary)
            SELECT 'delete', old.rowid, old.file_path, old.purpose, old.notes, old.executive_summary
             WHERE old.deleted_at IS NULL;
        END;

        INSERT INTO fts_file_notes(rowid, file_path, purpose, notes, executive_summary)
          SELECT rowid, file_path, purpose, notes, executive_summary
            FROM file_notes
           WHERE deleted_at IS NULL;
      `);

      // ── The same defect, one table over ────────────────────────────────
      //
      // Found by the derived assertion in tests/storage/fts-file-notes.test.ts,
      // not by looking: fts_events (V4, content='scheduled_events') has exactly
      // one trigger, fts_events_insert. It indexes on INSERT and then never
      // hears about an UPDATE or a DELETE.
      //
      // That is worse than an index that is merely stale. For an external-
      // content table the index holds rowids and the COLUMNS are read back
      // through the base table, so after an edit the terms point at a row whose
      // text no longer contains them, and after a delete they point at a row
      // that is gone. `update_scheduled_event` and `acknowledge_event` are both
      // live actions, so both happen in normal use.
      //
      // Fixed here rather than filed, because it is the same finding: the
      // trigger set is the thing nobody checks, and the test that now checks it
      // is in this commit.
      db.exec(`
        DROP TRIGGER IF EXISTS fts_events_update;
        DROP TRIGGER IF EXISTS fts_events_delete;

        CREATE TRIGGER fts_events_update AFTER UPDATE ON scheduled_events BEGIN
          INSERT INTO fts_events(fts_events, rowid, title, description, action_summary)
            VALUES('delete', old.id, old.title, old.description, old.action_summary);
          INSERT INTO fts_events(rowid, title, description, action_summary)
            VALUES (new.id, new.title, new.description, new.action_summary);
        END;

        CREATE TRIGGER fts_events_delete AFTER DELETE ON scheduled_events BEGIN
          INSERT INTO fts_events(fts_events, rowid, title, description, action_summary)
            VALUES('delete', old.id, old.title, old.description, old.action_summary);
        END;
      `);

      // Rebuild rather than backfill: unlike file_notes this index is not
      // empty, it is WRONG — every row edited or deleted since V4 left terms
      // behind. 'rebuild' discards and regenerates from the content table,
      // which is the only way to drop entries whose original values are no
      // longer recoverable.
      db.exec(`INSERT INTO fts_events(fts_events) VALUES('rebuild');`);
    },
  },
];

// ─── Migration Runner ────────────────────────────────────────────────

export function runMigrations(db: DatabaseType): void {
  runMigrationsTo(db, Number.POSITIVE_INFINITY);
}

/**
 * Run the chain up to and including `targetVersion`, then stop.
 *
 * `runMigrations` is this function with no ceiling, so there is exactly one
 * implementation of the chain and a partial run cannot drift from a full one.
 *
 * This exists for ONE reason: building a database that is genuinely at an
 * historical schema version, so a test can migrate REAL data forward through
 * the real chain. Every other suite starts from an empty database at head,
 * which is why V2, V23, V24 and V25 — the four migrations that mutate
 * pre-existing rows — had never executed against a row they were written to
 * touch. See tests/migrations/upgrade-path.test.ts.
 *
 * Not for production use: the server always migrates to head.
 */
export function runMigrationsTo(db: DatabaseType, targetVersion: number): void {
  // Ensure schema_meta table exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const readVersion = (): number => {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  };
  const pendingFrom = (from: number) =>
    migrations.filter(m => m.version > from && m.version <= targetVersion);

  // ─── FR-D1 T4 / task #31 — refuse a database from the future ────────
  //
  // A store written by a NEWER Engram than this one is not something this
  // binary can understand, and the failure is silent in the worst possible
  // direction: every migration is already applied, so the chain has nothing to
  // do, the fast path below returns cleanly, and the server proceeds to read
  // and WRITE a schema whose columns and constraints it does not know. Columns
  // added by the newer version are never populated; NOT NULL columns it does
  // not know about make writes fail in ways that read as corruption; and the
  // downgrade is silent, so the user's first evidence is damaged data.
  //
  // This is a realistic path, not a hypothetical: `npx` pins per exact spec
  // string, IDE configs pin an exact version (task #107), and a machine can
  // easily run two Engram versions against one project — a globally installed
  // 1.12.0 in one IDE and 1.14.0 in another. Whichever starts first migrates;
  // the older one then opens a future database.
  //
  // Refusing is the whole fix. There is no safe automatic action: down-migration
  // is not implemented and never will be for a store whose newer schema this
  // binary has no definition of. So it throws with both versions and the one
  // instruction that resolves it.
  //
  // REJECTED — warn and continue: that is exactly today's behaviour with a log
  // line attached, and FR-D6 T6 established that IDE MCP hosts discard stderr,
  // so the warning reaches nobody while the writes still land. REJECTED —
  // open read-only: a memory server that silently stops recording is the
  // inert-surface defect this review exists to stop, and the agent would go on
  // believing its writes succeeded.
  {
    const current = readVersion();
    const head = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
    if (current > head) {
      throw new Error(
        `Engram database is at schema v${current}, but this build only knows up to v${head}. ` +
        `It was written by a newer version of Engram, and running this one against it would ` +
        `write rows this build cannot describe. Nothing has been changed. ` +
        `Upgrade Engram (npx -y engram-mcp-server@latest install --check --update), ` +
        `or point this build at a different project.`,
      );
    }
  }

  // ─── FAST PATH, deliberately unlocked ──────────────────────────────
  // The overwhelmingly common case is a server starting against a database
  // already at head, and that case must not take a write lock: BEGIN IMMEDIATE
  // blocks every other writer, and paying that on every process start to guard
  // a first-run-only race would be a worse trade than the race. A stale read
  // here is safe because the slow path re-reads under the lock.
  if (pendingFrom(readVersion()).length === 0) {
    return; // Already up to date
  }

  // ─── SLOW PATH: one BEGIN IMMEDIATE around read-version → run-chain ──
  //
  // Task #59, PROVEN: two servers cold-starting on the same fresh project both
  // read version 0, both run the whole chain, and the loser dies on V22's
  // unconditional `ALTER TABLE file_notes ADD COLUMN git_branch` with
  // "duplicate column name: git_branch". The DATA survives — the PROCESS does
  // not, and IDE MCP hosts discard stderr, so from the user's side Engram is
  // simply absent. First run only; a restart succeeds because the chain is
  // complete by then. Reachable by opening a fresh project in two IDEs, or by
  // an orchestrator and a sub-agent both spawning servers.
  //
  // The version read MUST be inside the lock. That is the whole fix: the loser
  // blocks at BEGIN IMMEDIATE, and when it finally reads, it reads the winner's
  // committed version and finds nothing to do.
  //
  // REJECTED — make all migrations idempotent: 26 retrofits, each a chance to
  // introduce the bug being fixed, and it must be remembered by every future
  // author forever. REJECTED — shard the database per process: `--ide=<key>`
  // already does this and it is why the collision is rare, but it solves cold
  // start by abandoning the domain, since two agents in one IDE is the
  // SUPPORTED topology. PRIOR ART: rails/rails#22092, same defect with
  // different DDL; an advisory lock around the whole chain is Rails' accepted
  // fix, so this is the converged answer rather than an invention.
  //
  // NOTE the chain is now atomic as a whole, where it used to be atomic per
  // migration. A mid-chain failure rolls the database back to the version it
  // started at instead of leaving it stranded part-way, which also removes the
  // cross-migration idempotency requirement the old shape depended on. The
  // per-migration transactions are KEPT — inside the outer one better-sqlite3
  // makes them SAVEPOINTs — so a single migration still cannot half-apply.
  const runChain = db.transaction(() => {
    const currentVersion = readVersion();
    const pendingMigrations = pendingFrom(currentVersion);

    if (pendingMigrations.length === 0) {
      // Another process ran the chain while we waited on the lock. This is the
      // designed outcome for the loser, not an error.
      return;
    }

    log.info(`Running ${pendingMigrations.length} migration(s) from v${currentVersion} → v${pendingMigrations[pendingMigrations.length - 1].version}`);

    for (const migration of pendingMigrations) {
      log.info(`  v${migration.version}: ${migration.description}`);

      const runMigration = db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)"
        ).run(String(migration.version));
      });

      runMigration();
    }

    log.info(`Migrations complete. Schema at v${pendingMigrations[pendingMigrations.length - 1].version}`);
  });

  try {
    runChain.immediate();
  } catch (e) {
    // A busy timeout means the winner is STILL running the chain — but it may
    // also have committed in the gap between our timeout and this line. Only
    // re-reading can tell the two apart, and reporting a fatal for a chain that
    // has in fact completed is the same "absent server" outcome this fix
    // exists to remove.
    const busy = (e as { code?: string }).code === "SQLITE_BUSY"
      || (e as { code?: string }).code === "SQLITE_BUSY_TIMEOUT";
    if (busy && pendingFrom(readVersion()).length === 0) {
      log.info("Migrations were applied by another process while this one waited; nothing to do.");
      return;
    }
    throw e;
  }
}

export function getCurrentSchemaVersion(db: DatabaseType): number {
  try {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}
