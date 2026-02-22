// ============================================================================
// Engram MCP Server — Maintenance, Backup & Milestone Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getDb, now, getCurrentSessionId, getProjectRoot, getDbSizeKb, getDbPath, backupDatabase } from "../database.js";
import { TOOL_PREFIX, DB_DIR_NAME, DB_FILE_NAME, BACKUP_DIR_NAME, COMPACTION_THRESHOLD_SESSIONS, MAX_BACKUP_COUNT, SERVER_VERSION } from "../constants.js";
import { log } from "../logger.js";
import type { MemoryStats, CompactionResult, BackupInfo } from "../types.js";

export function registerMaintenanceTools(server: McpServer): void {
  // ─── MEMORY STATS ───────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_stats`,
    {
      title: "Memory Statistics",
      description: `Get a comprehensive overview of everything stored in Engram's memory: session count, changes, decisions, file notes, conventions, tasks, milestones, most-changed files, and database size.

Returns:
  MemoryStats object with counts and insights.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const db = getDb();

      const count = (table: string): number =>
        (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

      const oldest = db.prepare("SELECT started_at FROM sessions ORDER BY id ASC LIMIT 1").get() as { started_at: string } | undefined;
      const newest = db.prepare("SELECT started_at FROM sessions ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;

      const mostChanged = db.prepare(`
        SELECT file_path, COUNT(*) as change_count
        FROM changes GROUP BY file_path ORDER BY change_count DESC LIMIT 10
      `).all() as Array<{ file_path: string; change_count: number }>;

      // Layer distribution from file notes
      const layerDist = db.prepare(`
        SELECT layer, COUNT(*) as count FROM file_notes WHERE layer IS NOT NULL GROUP BY layer ORDER BY count DESC
      `).all() as Array<{ layer: string; count: number }>;

      // Task stats
      const tasksByStatus = db.prepare(`
        SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC
      `).all() as Array<{ status: string; count: number }>;

      // Schema version
      let schemaVersion = 0;
      try {
        const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
        schemaVersion = vRow ? parseInt(vRow.value, 10) : 0;
      } catch { /* no schema_meta */ }

      const stats: MemoryStats & {
        layer_distribution: typeof layerDist;
        tasks_by_status: typeof tasksByStatus;
        schema_version: number;
        engine: string;
      } = {
        total_sessions: count("sessions"),
        total_changes: count("changes"),
        total_decisions: count("decisions"),
        total_file_notes: count("file_notes"),
        total_conventions: count("conventions"),
        total_tasks: count("tasks"),
        total_milestones: count("milestones"),
        oldest_session: oldest?.started_at || null,
        newest_session: newest?.started_at || null,
        most_changed_files: mostChanged,
        database_size_kb: getDbSizeKb(),
        layer_distribution: layerDist,
        tasks_by_status: tasksByStatus,
        schema_version: schemaVersion,
        engine: "better-sqlite3 (WAL mode)",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    }
  );

  // ─── COMPACT MEMORY ─────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_compact`,
    {
      title: "Compact Memory",
      description: `Compact old session data to reduce database size. Merges change records from old sessions into summaries and removes granular entries. Sessions newer than the threshold are preserved in full. Automatically creates a backup before compacting.

Args:
  - keep_sessions (number, optional): Number of recent sessions to keep in full detail (default: ${COMPACTION_THRESHOLD_SESSIONS})
  - max_age_days (number, optional): Also remove sessions older than N days (default: no age limit)
  - dry_run (boolean, optional): Show what would be compacted without actually doing it (default: true)

Returns:
  CompactionResult with counts and freed storage.`,
      inputSchema: {
        keep_sessions: z.number().int().min(5).default(COMPACTION_THRESHOLD_SESSIONS).describe("Recent sessions to preserve"),
        max_age_days: z.number().int().min(7).optional().describe("Remove sessions older than N days"),
        dry_run: z.boolean().default(true).describe("Preview mode — no changes made"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ keep_sessions, max_age_days, dry_run }) => {
      const db = getDb();

      // Find the cutoff session ID
      const cutoff = db.prepare(
        "SELECT id FROM sessions ORDER BY id DESC LIMIT 1 OFFSET ?"
      ).get(keep_sessions) as { id: number } | undefined;

      if (!cutoff) {
        return {
          content: [{ type: "text", text: "Not enough sessions to compact. Nothing to do." }],
        };
      }

      // Count what would be compacted
      let sessionsQuery = "SELECT COUNT(*) as c FROM sessions WHERE id <= ? AND ended_at IS NOT NULL";
      const sessionsParams: unknown[] = [cutoff.id];

      if (max_age_days) {
        const cutoffDate = new Date(Date.now() - max_age_days * 86400000).toISOString();
        sessionsQuery += " AND started_at < ?";
        sessionsParams.push(cutoffDate);
      }

      const sessionsToCompact = (db.prepare(sessionsQuery).get(...sessionsParams) as { c: number }).c;

      const changesToSummarize = (db.prepare(
        "SELECT COUNT(*) as c FROM changes WHERE session_id <= ?"
      ).get(cutoff.id) as { c: number }).c;

      const sizeBefore = getDbSizeKb();

      if (dry_run) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dry_run: true,
              would_compact: {
                sessions: sessionsToCompact,
                changes: changesToSummarize,
              },
              message: `Would compact ${sessionsToCompact} sessions and summarize ${changesToSummarize} change records. Run with dry_run=false to execute.`,
            }, null, 2),
          }],
        };
      }

      // ─── Auto-backup before compacting ──────────────────────────
      let backupPath = "";
      try {
        backupPath = backupDatabase();
        log.info(`Auto-backup created before compaction: ${backupPath}`);
      } catch (e) {
        log.warn(`Failed to create backup before compaction: ${e}`);
      }

      // Execute compaction in a transaction
      const compact = db.transaction(() => {
        // For each old session, create a summarized change record
        const oldSessions = db.prepare(
          "SELECT id, summary FROM sessions WHERE id <= ? AND ended_at IS NOT NULL"
        ).all(cutoff.id) as Array<{ id: number; summary: string | null }>;

        for (const session of oldSessions) {
          const changes = db.prepare(
            "SELECT change_type, file_path, description FROM changes WHERE session_id = ?"
          ).all(session.id) as Array<{ change_type: string; file_path: string; description: string }>;

          if (changes.length > 0) {
            // Create one summary change per old session
            const summaryDesc = changes.map(c => `[${c.change_type}] ${c.file_path}: ${c.description}`).join("; ");
            db.prepare(
              "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, impact_scope) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(session.id, now(), "(compacted)", "modified", `Compacted ${changes.length} changes: ${summaryDesc.slice(0, 2000)}`, "global");
          }

          // Delete granular changes
          db.prepare("DELETE FROM changes WHERE session_id = ? AND file_path != '(compacted)'").run(session.id);
        }
      });

      compact();

      // Vacuum to reclaim space (must be outside transaction)
      db.exec("VACUUM");

      const sizeAfter = getDbSizeKb();

      const result: CompactionResult = {
        sessions_compacted: sessionsToCompact,
        changes_summarized: changesToSummarize,
        storage_freed_kb: Math.max(0, sizeBefore - sizeAfter),
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            backup_path: backupPath || null,
            message: `Compaction complete. ${backupPath ? `Backup saved at ${backupPath}.` : ""}`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── BACKUP DATABASE ───────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_backup`,
    {
      title: "Backup Database",
      description: `Create a backup of the Engram memory database. Uses SQLite's native backup API for safe, consistent copies. Save to any path — including cloud-synced folders (Dropbox, OneDrive, Google Drive) for cross-machine portability.

Args:
  - output_path (string, optional): Where to save the backup (default: .engram/backups/memory-{timestamp}.db)
  - prune_old (boolean, optional): Remove old backups beyond the max count (default: true)

Returns:
  BackupInfo with path, size, and timestamp.`,
      inputSchema: {
        output_path: z.string().optional().describe("Custom backup destination path"),
        prune_old: z.boolean().default(true).describe("Prune old backups beyond the max count"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ output_path, prune_old }) => {
      const backupPath = backupDatabase(output_path);

      const stats = fs.statSync(backupPath);
      const sizeKb = Math.round(stats.size / 1024);

      // Get schema version
      let dbVersion = 0;
      try {
        const db = getDb();
        const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
        dbVersion = vRow ? parseInt(vRow.value, 10) : 0;
      } catch { /* skip */ }

      const info: BackupInfo = {
        path: backupPath,
        size_kb: sizeKb,
        created_at: now(),
        database_version: dbVersion,
      };

      // Prune old backups if saving to default directory
      if (prune_old && !output_path) {
        const backupDir = path.join(getProjectRoot(), DB_DIR_NAME, BACKUP_DIR_NAME);
        try {
          const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith("memory-") && f.endsWith(".db"))
            .map(f => ({
              name: f,
              path: path.join(backupDir, f),
              mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

          if (files.length > MAX_BACKUP_COUNT) {
            const toDelete = files.slice(MAX_BACKUP_COUNT);
            for (const f of toDelete) {
              fs.unlinkSync(f.path);
            }
            (info as BackupInfo & { pruned: number }).pruned = toDelete.length;
          }
        } catch { /* skip pruning */ }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...info,
            message: `Backup created successfully at ${backupPath} (${sizeKb} KB).`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── RESTORE DATABASE ──────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_restore`,
    {
      title: "Restore Database",
      description: `Restore the Engram memory database from a backup file. Creates a safety backup of the current database before overwriting. The MCP server will need to be restarted after restore.

Args:
  - input_path (string): Path to the backup .db file
  - confirm (string): Must be "yes-restore" to execute

Returns:
  Confirmation and instructions to restart.`,
      inputSchema: {
        input_path: z.string().describe("Path to the backup .db file"),
        confirm: z.string().describe('Type "yes-restore" to confirm'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ input_path, confirm }) => {
      if (confirm !== "yes-restore") {
        return {
          isError: true,
          content: [{ type: "text", text: 'Safety check: set confirm to "yes-restore" to proceed.' }],
        };
      }

      const projectRoot = getProjectRoot();
      const inputPath = path.isAbsolute(input_path) ? input_path : path.join(projectRoot, input_path);

      if (!fs.existsSync(inputPath)) {
        return { isError: true, content: [{ type: "text", text: `Backup file not found: ${inputPath}` }] };
      }

      // Create safety backup of current database
      let safetyBackupPath = "";
      try {
        safetyBackupPath = backupDatabase();
        log.info(`Safety backup created before restore: ${safetyBackupPath}`);
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create safety backup before restore: ${e}. Aborting.` }],
        };
      }

      // Copy the backup file over the current database
      const dbPath = getDbPath();
      try {
        fs.copyFileSync(inputPath, dbPath);
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to restore: ${e}. Your previous database is backed up at ${safetyBackupPath}.` }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            restored_from: inputPath,
            safety_backup: safetyBackupPath,
            message: "Database restored successfully. Please RESTART the MCP server to load the restored database. A safety backup of the previous database was created.",
          }, null, 2),
        }],
      };
    }
  );

  // ─── LIST BACKUPS ──────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_list_backups`,
    {
      title: "List Backups",
      description: `List all available backup files in the default backup directory.

Returns:
  Array of backup files with sizes and timestamps.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const backupDir = path.join(getProjectRoot(), DB_DIR_NAME, BACKUP_DIR_NAME);

      if (!fs.existsSync(backupDir)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ backups: [], message: "No backups found." }, null, 2) }],
        };
      }

      const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith(".db"))
        .map(f => {
          const fullPath = path.join(backupDir, f);
          const stats = fs.statSync(fullPath);
          return {
            filename: f,
            path: fullPath,
            size_kb: Math.round(stats.size / 1024),
            created_at: stats.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            backup_directory: backupDir,
            count: files.length,
            backups: files,
          }, null, 2),
        }],
      };
    }
  );

  // ─── RECORD MILESTONE ───────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_record_milestone`,
    {
      title: "Record Milestone",
      description: `Record a major project milestone or achievement. Milestones mark significant points in the project timeline — feature completions, releases, major refactors, etc.

Args:
  - title (string): Milestone title
  - description (string, optional): What was achieved
  - version (string, optional): Version number if applicable
  - tags (array, optional): Tags

Returns:
  Milestone ID and confirmation.`,
      inputSchema: {
        title: z.string().min(3).describe("Milestone title"),
        description: z.string().optional().describe("What was achieved"),
        version: z.string().optional().describe("Version number"),
        tags: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, description, version, tags }) => {
      const db = getDb();
      const timestamp = now();
      const sessionId = getCurrentSessionId();

      const result = db.prepare(
        "INSERT INTO milestones (session_id, timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(sessionId, timestamp, title, description || null, version || null, tags ? JSON.stringify(tags) : null);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            milestone_id: result.lastInsertRowid,
            message: `Milestone #${result.lastInsertRowid} recorded: "${title}"${version ? ` (v${version})` : ""}`,
          }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    `${TOOL_PREFIX}_get_milestones`,
    {
      title: "Get Milestones",
      description: `Retrieve project milestones. Shows the project's achievement timeline.

Args:
  - limit (number, optional): Max results (default 20)

Returns:
  Array of milestones in reverse chronological order.`,
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      const db = getDb();
      const milestones = db.prepare("SELECT * FROM milestones ORDER BY timestamp DESC LIMIT ?").all(limit);
      return { content: [{ type: "text", text: JSON.stringify({ milestones }, null, 2) }] };
    }
  );

  // ─── EXPORT MEMORY ──────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_export`,
    {
      title: "Export Memory",
      description: `Export the entire memory database as a portable JSON file. Useful for backup, migration, or sharing project knowledge with teammates.

Args:
  - output_path (string, optional): Where to save the export (default: .engram/export.json)

Returns:
  Export file path and summary.`,
      inputSchema: {
        output_path: z.string().optional().describe("Export file path"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ output_path }) => {
      const db = getDb();
      const projectRoot = getProjectRoot();

      const exportData = {
        engram_version: SERVER_VERSION,
        exported_at: now(),
        project_root: projectRoot,
        sessions: db.prepare("SELECT * FROM sessions ORDER BY id").all(),
        changes: db.prepare("SELECT * FROM changes ORDER BY id").all(),
        decisions: db.prepare("SELECT * FROM decisions ORDER BY id").all(),
        file_notes: db.prepare("SELECT * FROM file_notes ORDER BY file_path").all(),
        conventions: db.prepare("SELECT * FROM conventions ORDER BY id").all(),
        tasks: db.prepare("SELECT * FROM tasks ORDER BY id").all(),
        milestones: db.prepare("SELECT * FROM milestones ORDER BY id").all(),
      };

      const filePath = output_path || path.join(projectRoot, DB_DIR_NAME, "export.json");
      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            exported_to: filePath,
            counts: {
              sessions: (exportData.sessions as unknown[]).length,
              changes: (exportData.changes as unknown[]).length,
              decisions: (exportData.decisions as unknown[]).length,
              file_notes: (exportData.file_notes as unknown[]).length,
              conventions: (exportData.conventions as unknown[]).length,
              tasks: (exportData.tasks as unknown[]).length,
              milestones: (exportData.milestones as unknown[]).length,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── IMPORT MEMORY ──────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_import`,
    {
      title: "Import Memory",
      description: `Import memory from a previously exported JSON file. Merges data into the existing database without duplicating existing records.

Args:
  - input_path (string): Path to the export JSON file
  - dry_run (boolean, optional): Preview import without writing (default: true)

Returns:
  Import summary with counts.`,
      inputSchema: {
        input_path: z.string().describe("Path to export JSON file"),
        dry_run: z.boolean().default(true).describe("Preview mode"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ input_path, dry_run }) => {
      const projectRoot = getProjectRoot();
      const filePath = path.isAbsolute(input_path) ? input_path : path.join(projectRoot, input_path);

      if (!fs.existsSync(filePath)) {
        return { isError: true, content: [{ type: "text", text: `File not found: ${filePath}` }] };
      }

      let importData: Record<string, unknown[]>;
      try {
        importData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Invalid JSON: ${e}` }] };
      }

      const counts: Record<string, number> = {};
      for (const key of ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones"]) {
        counts[key] = Array.isArray(importData[key]) ? importData[key].length : 0;
      }

      if (dry_run) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dry_run: true,
              would_import: counts,
              message: "Run with dry_run=false to execute the import.",
            }, null, 2),
          }],
        };
      }

      // Actual import — decisions, conventions, file_notes, tasks, milestones
      const db = getDb();

      const importTransaction = db.transaction(() => {
        // ─── Import sessions (skip duplicates by started_at + agent_name) ───
        const sessionIdMap = new Map<number, number>(); // old → new
        if (Array.isArray(importData.sessions)) {
          for (const s of importData.sessions as Array<Record<string, unknown>>) {
            const exists = db.prepare(
              "SELECT id FROM sessions WHERE started_at = ? AND agent_name = ?"
            ).get(s.started_at, s.agent_name || "unknown") as { id: number } | undefined;
            if (!exists) {
              const result = db.prepare(
                "INSERT INTO sessions (started_at, ended_at, summary, agent_name, project_root, tags) VALUES (?, ?, ?, ?, ?, ?)"
              ).run(s.started_at, s.ended_at || null, s.summary || null, s.agent_name || "unknown", s.project_root || "", s.tags || null);
              sessionIdMap.set(s.id as number, result.lastInsertRowid as number);
            } else {
              sessionIdMap.set(s.id as number, exists.id);
            }
          }
        }

        // ─── Import changes (skip duplicates by file_path + timestamp + description) ───
        if (Array.isArray(importData.changes)) {
          for (const c of importData.changes as Array<Record<string, unknown>>) {
            const exists = db.prepare(
              "SELECT id FROM changes WHERE file_path = ? AND timestamp = ? AND description = ?"
            ).get(c.file_path, c.timestamp, c.description);
            if (!exists) {
              // Map old session_id to new session_id
              const mappedSessionId = c.session_id ? (sessionIdMap.get(c.session_id as number) ?? c.session_id) : null;
              db.prepare(
                "INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope) VALUES (?, ?, ?, ?, ?, ?, ?)"
              ).run(mappedSessionId, c.timestamp, c.file_path, c.change_type, c.description, c.diff_summary || null, c.impact_scope || "local");
            }
          }
        }

        // Import conventions (skip duplicates by rule text)
        if (Array.isArray(importData.conventions)) {
          for (const c of importData.conventions as Array<Record<string, unknown>>) {
            const exists = db.prepare("SELECT id FROM conventions WHERE rule = ?").get(c.rule);
            if (!exists) {
              db.prepare(
                "INSERT INTO conventions (timestamp, category, rule, examples, enforced) VALUES (?, ?, ?, ?, ?)"
              ).run(c.timestamp || now(), c.category, c.rule, c.examples || null, c.enforced ?? 1);
            }
          }
        }

        // Import decisions (skip duplicates by decision text)
        if (Array.isArray(importData.decisions)) {
          for (const d of importData.decisions as Array<Record<string, unknown>>) {
            const exists = db.prepare("SELECT id FROM decisions WHERE decision = ?").get(d.decision);
            if (!exists) {
              db.prepare(
                "INSERT INTO decisions (timestamp, decision, rationale, affected_files, tags, status) VALUES (?, ?, ?, ?, ?, ?)"
              ).run(d.timestamp || now(), d.decision, d.rationale || null, d.affected_files || null, d.tags || null, d.status || "active");
            }
          }
        }

        // Import file notes (upsert)
        if (Array.isArray(importData.file_notes)) {
          for (const f of importData.file_notes as Array<Record<string, unknown>>) {
            db.prepare(`
              INSERT OR REPLACE INTO file_notes (file_path, purpose, dependencies, dependents, layer, last_reviewed, notes, complexity)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(f.file_path, f.purpose || null, f.dependencies || null, f.dependents || null, f.layer || null, f.last_reviewed || now(), f.notes || null, f.complexity || null);
          }
        }

        // Import milestones (skip duplicates by title + timestamp)
        if (Array.isArray(importData.milestones)) {
          for (const m of importData.milestones as Array<Record<string, unknown>>) {
            const exists = db.prepare("SELECT id FROM milestones WHERE title = ? AND timestamp = ?").get(m.title, m.timestamp);
            if (!exists) {
              db.prepare(
                "INSERT INTO milestones (timestamp, title, description, version, tags) VALUES (?, ?, ?, ?, ?)"
              ).run(m.timestamp || now(), m.title, m.description || null, m.version || null, m.tags || null);
            }
          }
        }
      });

      importTransaction();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ imported: counts, message: "Import complete. Duplicates were skipped." }, null, 2),
        }],
      };
    }
  );

  // ─── CLEAR MEMORY ───────────────────────────────────────────────────
  server.registerTool(
    `${TOOL_PREFIX}_clear`,
    {
      title: "Clear Memory",
      description: `Clear specific tables or the entire memory database. USE WITH EXTREME CAUTION. This is irreversible. A backup is automatically created before clearing.

Args:
  - scope: "all" | "sessions" | "changes" | "decisions" | "file_notes" | "conventions" | "tasks" | "milestones" | "cache"
  - confirm (string): Must be "yes-delete-permanently" to execute

Returns:
  Confirmation of what was cleared.`,
      inputSchema: {
        scope: z.enum(["all", "sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "cache"]),
        confirm: z.string().describe('Type "yes-delete-permanently" to confirm'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scope, confirm }) => {
      if (confirm !== "yes-delete-permanently") {
        return {
          isError: true,
          content: [{ type: "text", text: 'Safety check: set confirm to "yes-delete-permanently" to proceed.' }],
        };
      }

      // ─── Auto-backup before clearing ──────────────────────────
      let backupPath = "";
      try {
        backupPath = backupDatabase();
        log.info(`Auto-backup created before clear: ${backupPath}`);
      } catch (e) {
        log.warn(`Failed to create backup before clear: ${e}`);
      }

      const db = getDb();
      const tables = scope === "all"
        ? ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "snapshot_cache"]
        : scope === "cache" ? ["snapshot_cache"] : [scope];

      for (const table of tables) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      return {
        content: [{
          type: "text",
          text: `Cleared: ${tables.join(", ")}. Memory has been reset.${backupPath ? ` Backup saved at ${backupPath}.` : ""}`,
        }],
      };
    }
  );
}
