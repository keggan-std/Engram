// ============================================================================
// Engram MCP Server — Admin Dispatcher (engram_admin)
// Lean surface: single tool routing all admin/maintenance operations.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, getDbSizeKb, getRepos, getServices, getProjectRoot, backupDatabase, getDbPath, now } from "../database.js";
import { success, error } from "../response.js";
import { SERVER_VERSION, DB_DIR_NAME, BACKUP_DIR_NAME, MAX_BACKUP_COUNT, CFG_AUTO_UPDATE_AVAILABLE, CFG_AUTO_UPDATE_LAST_CHECK, CFG_AUTO_UPDATE_CHECK, GITHUB_RELEASES_URL } from "../constants.js";
import { queryGlobalDecisions, queryGlobalConventions } from "../global-db.js";
import path from "path";
import fs from "fs";

const ADMIN_ACTIONS = [
  "backup", "restore", "list_backups",
  "export", "import",
  "compact", "clear",
  "stats", "health",
  "config",
  "scan_project",
  "install_hooks", "remove_hooks",
  "generate_report", "get_global_knowledge",
] as const;

export function registerAdminDispatcher(server: McpServer): void {
  server.registerTool(
    "engram_admin",
    {
      title: "Admin Operations",
      description: `Engram admin and maintenance operations. Use only when needed.

Actions: backup, restore, list_backups, export, import, compact, clear, stats, health, config, scan_project.`,
      inputSchema: {
        action: z.enum(ADMIN_ACTIONS).describe("Admin operation to perform."),
        output_path: z.string().optional(),
        input_path: z.string().optional(),
        confirm: z.string().optional().describe("Safety confirmation string for destructive ops."),
        keep_sessions: z.number().int().optional(),
        max_age_days: z.number().int().optional(),
        dry_run: z.boolean().optional(),
        scope: z.string().optional(),
        key: z.string().optional(),
        value: z.string().optional(),
        force_refresh: z.boolean().optional(),
        max_depth: z.number().int().optional(),
        prune_old: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const { action } = params;
      const repos = getRepos();
      const services = getServices();
      const projectRoot = getProjectRoot();
      const db = getDb();

      switch (action) {

        // ─── BACKUP ─────────────────────────────────────────────────────
        case "backup": {
          const backupPath = backupDatabase(params.output_path);
          const stats = fs.statSync(backupPath);
          const sizeKb = Math.round(stats.size / 1024);
          let dbVersion = 0;
          try { const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined; dbVersion = vRow ? parseInt(vRow.value, 10) : 0; } catch { /* skip */ }
          const info: Record<string, unknown> = { path: backupPath, size_kb: sizeKb, created_at: now(), database_version: dbVersion };
          if ((params.prune_old ?? true) && !params.output_path) {
            const backupDir = path.join(projectRoot, DB_DIR_NAME, BACKUP_DIR_NAME);
            try {
              const files = fs.readdirSync(backupDir).filter(f => f.startsWith("memory-") && f.endsWith(".db")).map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
              if (files.length > MAX_BACKUP_COUNT) { const toDelete = files.slice(MAX_BACKUP_COUNT); for (const f of toDelete) fs.unlinkSync(f.path); info.pruned = toDelete.length; }
            } catch { /* skip pruning */ }
          }
          return success({ ...info, message: `Backup created at ${backupPath} (${sizeKb} KB).` });
        }

        // ─── RESTORE ────────────────────────────────────────────────────
        case "restore": {
          if (!params.input_path) return error("input_path required for restore.");
          if (params.confirm !== "yes-restore") return error("Set confirm: 'yes-restore' to execute restore.");
          if (!fs.existsSync(params.input_path)) return error(`Backup file not found: ${params.input_path}`);
          let safetyBackupPath: string | undefined;
          try { safetyBackupPath = backupDatabase(); } catch { /* non-blocking */ }
          const dbPath = getDbPath();
          fs.copyFileSync(params.input_path, dbPath);
          return success({ message: "Database restored. Please RESTART the MCP server to load the restored database.", restored_from: params.input_path, safety_backup: safetyBackupPath });
        }

        // ─── LIST BACKUPS ────────────────────────────────────────────────
        case "list_backups": {
          const backupDir = path.join(projectRoot, DB_DIR_NAME, BACKUP_DIR_NAME);
          if (!fs.existsSync(backupDir)) return success({ backups: [], message: "No backups found." });
          const files = fs.readdirSync(backupDir).filter(f => f.startsWith("memory-") && f.endsWith(".db")).map(f => {
            const fp = path.join(backupDir, f);
            const s = fs.statSync(fp);
            return { filename: f, path: fp, size_kb: Math.round(s.size / 1024), created_at: new Date(s.mtimeMs).toISOString() };
          }).sort((a, b) => b.created_at.localeCompare(a.created_at));
          return success({ backups: files, total: files.length });
        }

        // ─── EXPORT ─────────────────────────────────────────────────────
        case "export": {
          const outputPath = params.output_path ?? path.join(projectRoot, DB_DIR_NAME, "export.json");
          const tables = ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones", "scheduled_events"];
          const exported: Record<string, unknown> = { exported_at: new Date().toISOString(), version: SERVER_VERSION };
          for (const table of tables) {
            try { exported[table] = db.prepare(`SELECT * FROM ${table}`).all(); } catch { exported[table] = []; }
          }
          fs.writeFileSync(outputPath, JSON.stringify(exported, null, 2), "utf-8");
          const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
          return success({ path: outputPath, size_kb: sizeKb, message: `Memory exported to ${outputPath} (${sizeKb} KB).` });
        }

        // ─── IMPORT ─────────────────────────────────────────────────────
        case "import": {
          if (!params.input_path) return error("input_path required for import.");
          if (!fs.existsSync(params.input_path)) return error(`Import file not found: ${params.input_path}`);
          const data = JSON.parse(fs.readFileSync(params.input_path, "utf-8")) as Record<string, unknown>;
          const dryRun = params.dry_run ?? true;
          const counts: Record<string, number> = {};
          const importable = ["decisions", "conventions", "file_notes", "milestones"];
          for (const table of importable) {
            const rows = data[table] as Array<Record<string, unknown>> | undefined;
            counts[table] = rows?.length ?? 0;
          }
          if (dryRun) return success({ dry_run: true, would_import: counts, message: "Dry run complete. Set dry_run: false to execute." });
          // Actual import (decisions only — safe to merge)
          let imported = 0;
          const rows = data["decisions"] as Array<Record<string, unknown>> | undefined;
          if (rows) {
            for (const row of rows) {
              try { db.prepare("INSERT OR IGNORE INTO decisions (id, session_id, timestamp, decision, rationale, affected_files, tags, status) VALUES (?,?,?,?,?,?,?,?)").run(row.id, row.session_id, row.timestamp, row.decision, row.rationale, row.affected_files, row.tags, row.status); imported++; } catch { /* skip duplicates */ }
            }
          }
          return success({ imported, message: `Import complete. ${imported} decisions merged.` });
        }

        // ─── COMPACT ────────────────────────────────────────────────────
        case "compact": {
          const dryRun = params.dry_run ?? true;
          const keepSessions = params.keep_sessions ?? 50;
          const maxAgeDays = params.max_age_days;
          if (dryRun) {
            const totalSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
            const wouldRemove = Math.max(0, totalSessions - keepSessions);
            return success({ dry_run: true, total_sessions: totalSessions, would_remove: wouldRemove, message: `Dry run. ${wouldRemove} session(s) would be removed. Set dry_run: false to execute.` });
          }
          const result = await services.compaction.manualCompact(keepSessions, maxAgeDays);
          return success(result as Record<string, unknown>);
        }

        // ─── CLEAR ──────────────────────────────────────────────────────
        case "clear": {
          if (!params.scope) return error("scope required for clear. Options: all, sessions, changes, decisions, file_notes, conventions, tasks, milestones, cache");
          if (params.confirm !== "yes-delete-permanently") return error("Set confirm: 'yes-delete-permanently' to execute clear. This is irreversible.");
          const scope = params.scope;
          const tableMap: Record<string, string[]> = {
            all: ["sessions", "changes", "decisions", "file_notes", "conventions", "tasks", "milestones"],
            sessions: ["sessions"],
            changes: ["changes"],
            decisions: ["decisions"],
            file_notes: ["file_notes"],
            conventions: ["conventions"],
            tasks: ["tasks"],
            milestones: ["milestones"],
            cache: ["snapshot_cache"],
          };
          const tables = tableMap[scope];
          if (!tables) return error(`Unknown scope: ${scope}`);
          // Create safety backup first
          let safetyBackup: string | undefined;
          try { safetyBackup = backupDatabase(); } catch { /* non-blocking */ }
          for (const table of tables) {
            try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* skip non-existent */ }
          }
          return success({ cleared: tables, safety_backup: safetyBackup, message: `Cleared: ${tables.join(", ")}.` });
        }

        // ─── STATS ──────────────────────────────────────────────────────
        case "stats": {
          const count = (table: string): number => { try { return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c; } catch { return 0; } };
          const oldest = db.prepare("SELECT started_at FROM sessions ORDER BY id ASC LIMIT 1").get() as { started_at: string } | undefined;
          const mostChanged = db.prepare("SELECT file_path, COUNT(*) as change_count FROM changes GROUP BY file_path ORDER BY change_count DESC LIMIT 10").all() as Array<{ file_path: string; change_count: number }>;
          const tasksByStatus = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all() as Array<{ status: string; count: number }>;
          const updateAvailable = repos.config.get(CFG_AUTO_UPDATE_AVAILABLE) || null;
          const lastCheck = repos.config.get(CFG_AUTO_UPDATE_LAST_CHECK) || null;
          const autoUpdateEnabled = repos.config.getBool(CFG_AUTO_UPDATE_CHECK, true);
          let schemaVersion = 0;
          try { const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined; schemaVersion = vRow ? parseInt(vRow.value, 10) : 0; } catch { /* skip */ }
          const agentMetrics = db.prepare(`SELECT s.agent_name, COUNT(DISTINCT s.id) AS sessions, MAX(COALESCE(s.ended_at, s.started_at)) AS last_active FROM sessions s GROUP BY s.agent_name ORDER BY sessions DESC`).all() as Array<{ agent_name: string; sessions: number; last_active: string }>;
          return success({
            server_version: SERVER_VERSION, schema_version: schemaVersion,
            total_sessions: count("sessions"), total_changes: count("changes"), total_decisions: count("decisions"),
            total_file_notes: count("file_notes"), total_conventions: count("conventions"), total_tasks: count("tasks"),
            total_milestones: count("milestones"),
            oldest_session: oldest?.started_at || null, database_size_kb: getDbSizeKb(),
            most_changed_files: mostChanged, tasks_by_status: tasksByStatus,
            update_status: updateAvailable ? { available: true, version: updateAvailable, releases_url: GITHUB_RELEASES_URL } : { available: false },
            auto_update_check: autoUpdateEnabled ? "enabled" : "disabled", last_update_check: lastCheck,
            agents: agentMetrics,
          });
        }

        // ─── HEALTH ─────────────────────────────────────────────────────
        case "health": {
          const checks: Record<string, unknown> = {};
          // Integrity check
          try { const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }; checks.integrity = result.integrity_check === "ok" ? "ok" : `FAILED: ${result.integrity_check}`; } catch (e) { checks.integrity = `ERROR: ${e}`; }
          // WAL mode check
          try { const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }; checks.journal_mode = result.journal_mode; } catch { checks.journal_mode = "unknown"; }
          // FTS check
          try { db.prepare("SELECT * FROM decisions LIMIT 1").all(); checks.fts = "available"; } catch { checks.fts = "unavailable"; }
          // Schema version
          try { const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined; checks.schema_version = vRow ? parseInt(vRow.value, 10) : 0; } catch { checks.schema_version = 0; }
          // DB size
          checks.database_size_kb = getDbSizeKb();
          const healthy = checks.integrity === "ok";
          return success({ healthy, checks, message: healthy ? "Database is healthy." : "Issues detected — see checks." });
        }

        // ─── CONFIG ─────────────────────────────────────────────────────
        case "config": {
          if (params.key && params.value !== undefined) {
            repos.config.set(params.key, params.value, now());
            return success({ message: `Config "${params.key}" set to "${params.value}".`, key: params.key, value: params.value });
          }
          // ISS-015: When key is provided without value, return just that key's value.
          if (params.key) {
            const val = repos.config.get(params.key);
            return success({ key: params.key, value: val ?? null });
          }
          const config = repos.config.getAll();
          return success({ config });
        }

        // ─── SCAN PROJECT ────────────────────────────────────────────────
        case "scan_project": {
          const snapshot = services.scan.getOrRefresh(projectRoot, params.force_refresh ?? false, params.max_depth ?? 5);
          return success(snapshot as unknown as Record<string, unknown>);
        }

        // ─── INSTALL HOOKS ─────────────────────────────────────────────────
        case "install_hooks": {
          const gitDir = path.join(projectRoot, ".git");
          if (!fs.existsSync(gitDir)) return error("No .git directory found at project root. Not a git repository.");
          const hooksDir = path.join(gitDir, "hooks");
          fs.mkdirSync(hooksDir, { recursive: true });
          const hookPath = path.join(hooksDir, "post-commit");
          const hookContent = `#!/bin/bash\n# Engram Post-Commit Hook\nENGRAM_DIR=".engram"\nCHANGE_LOG="$ENGRAM_DIR/git-changes.log"\nmkdir -p "$ENGRAM_DIR"\nHASH=$(git rev-parse --short HEAD)\nMSG=$(git log -1 --pretty=format:"%s")\nDATE=$(git log -1 --pretty=format:"%aI")\nFILES=$(git diff-tree --no-commit-id --name-status -r HEAD)\n{ echo "--- COMMIT $HASH ---"; echo "date: $DATE"; echo "message: $MSG"; echo "files:"; echo "$FILES"; echo "---"; echo ""; } >> "$CHANGE_LOG"\n`;
          if (fs.existsSync(hookPath)) {
            const existing = fs.readFileSync(hookPath, "utf-8");
            if (existing.includes("Engram Post-Commit Hook")) return success({ message: "Engram post-commit hook already installed.", hook_path: hookPath });
            fs.appendFileSync(hookPath, "\n\n" + hookContent);
          } else {
            fs.writeFileSync(hookPath, hookContent);
          }
          fs.chmodSync(hookPath, "755");
          return success({ message: "Engram post-commit hook installed.", hook_path: hookPath });
        }

        case "remove_hooks": {
          const hookPath2 = path.join(projectRoot, ".git", "hooks", "post-commit");
          if (!fs.existsSync(hookPath2)) return success({ message: "No post-commit hook found." });
          const existing2 = fs.readFileSync(hookPath2, "utf-8");
          if (!existing2.includes("Engram Post-Commit Hook")) return success({ message: "Engram hook not found in existing post-commit hook." });
          // Remove only the engram section
          const cleaned = existing2.replace(/\n?\n?# Engram Post-Commit Hook[\s\S]*?\n---\n\n/g, "").trim();
          if (cleaned) { fs.writeFileSync(hookPath2, cleaned + "\n"); } else { fs.unlinkSync(hookPath2); }
          return success({ message: "Engram post-commit hook removed.", hook_path: hookPath2 });
        }

        // ─── GENERATE REPORT ────────────────────────────────────────────
        case "generate_report": {
          const count = (table: string): number => { try { return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c; } catch { return 0; } };
          const openTasks = db.prepare("SELECT * FROM tasks WHERE status NOT IN ('done','cancelled') ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END LIMIT 30").all() as Array<Record<string, unknown>>;
          const activeDecisions = db.prepare("SELECT * FROM decisions WHERE status = 'active' ORDER BY timestamp DESC LIMIT 20").all() as Array<Record<string, unknown>>;
          const recentChanges = db.prepare("SELECT file_path, change_type, description, timestamp FROM changes ORDER BY timestamp DESC LIMIT 15").all() as Array<Record<string, unknown>>;
          const activeConventions = repos.conventions.getActive();
          const milestones = db.prepare("SELECT * FROM milestones ORDER BY timestamp DESC LIMIT 10").all() as Array<Record<string, unknown>>;
          return success({
            generated_at: new Date().toISOString(),
            server_version: SERVER_VERSION,
            summary: {
              total_sessions: count("sessions"),
              total_changes: count("changes"),
              total_decisions: count("decisions"),
              open_tasks: openTasks.length,
              total_tasks: count("tasks"),
              total_conventions: activeConventions.length,
              total_milestones: count("milestones"),
              database_size_kb: getDbSizeKb(),
            },
            open_tasks: openTasks,
            active_decisions: activeDecisions,
            recent_changes: recentChanges,
            active_conventions: activeConventions,
            milestones,
            message: `Report generated: ${openTasks.length} open task(s), ${activeDecisions.length} active decision(s), ${recentChanges.length} recent change(s).`,
          });
        }

        // ─── GET GLOBAL KNOWLEDGE ────────────────────────────────────────
        case "get_global_knowledge": {
          const globalDecisions = queryGlobalDecisions(params.key, 50);
          const globalConventions = queryGlobalConventions(50);
          return success({
            global_decisions: globalDecisions,
            global_conventions: globalConventions,
            total_decisions: globalDecisions.length,
            total_conventions: globalConventions.length,
            message: globalDecisions.length === 0 && globalConventions.length === 0
              ? "Global KB is empty. Use record_decision with export_global:true to populate."
              : `Global KB: ${globalDecisions.length} decision(s), ${globalConventions.length} convention(s).`,
          });
        }

        default:
          return error(`Unknown admin action: ${(params as Record<string, unknown>).action}`);
      }
    }
  );
}
