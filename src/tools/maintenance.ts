// ============================================================================
// Engram MCP Server — Maintenance & Milestone Tools
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { dbCompat, now, getCurrentSessionId, getLastCompletedSession, getProjectRoot, getDbSizeKb, forceFlush } from "../database.js";
import { TOOL_PREFIX, DB_DIR_NAME, COMPACTION_THRESHOLD_SESSIONS } from "../constants.js";
import type { MemoryStats, CompactionResult } from "../types.js";

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
      const db = dbCompat();

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

      const stats: MemoryStats & { layer_distribution: typeof layerDist; tasks_by_status: typeof tasksByStatus } = {
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
      description: `Compact old session data to reduce database size. Merges change records from old sessions into summaries and removes granular entries. Sessions newer than the threshold are preserved in full.

Args:
  - keep_sessions (number, optional): Number of recent sessions to keep in full detail (default: ${COMPACTION_THRESHOLD_SESSIONS})
  - dry_run (boolean, optional): Show what would be compacted without actually doing it (default: true)

Returns:
  CompactionResult with counts and freed storage.`,
      inputSchema: {
        keep_sessions: z.number().int().min(5).default(COMPACTION_THRESHOLD_SESSIONS).describe("Recent sessions to preserve"),
        dry_run: z.boolean().default(true).describe("Preview mode — no changes made"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ keep_sessions, dry_run }) => {
      const db = dbCompat();

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
      const sessionsToCompact = (db.prepare(
        "SELECT COUNT(*) as c FROM sessions WHERE id <= ? AND ended_at IS NOT NULL"
      ).get(cutoff.id) as { c: number }).c;

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

      // Execute compaction
      db.transaction(() => {
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
      })();

      // Vacuum to reclaim space
      db.exec("VACUUM");

      const sizeAfter = getDbSizeKb();

      const result: CompactionResult = {
        sessions_compacted: sessionsToCompact,
        changes_summarized: changesToSummarize,
        storage_freed_kb: Math.max(0, sizeBefore - sizeAfter),
      };

      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, message: "Compaction complete." }, null, 2) }],
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
      const db = dbCompat();
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
      const db = dbCompat();
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
      const db = dbCompat();
      const projectRoot = getProjectRoot();

      const exportData = {
        engram_version: "1.0.0",
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
      const db = dbCompat();

      db.transaction(() => {
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
      })();

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
      description: `Clear specific tables or the entire memory database. USE WITH EXTREME CAUTION. This is irreversible.

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

      const db = dbCompat();
      const tables = scope === "all"
        ? ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "snapshot_cache"]
        : scope === "cache" ? ["snapshot_cache"] : [scope];

      for (const table of tables) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      return {
        content: [{ type: "text", text: `Cleared: ${tables.join(", ")}. Memory has been reset.` }],
      };
    }
  );
}
