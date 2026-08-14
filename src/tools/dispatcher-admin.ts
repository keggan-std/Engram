// ============================================================================
// Engram MCP Server — Admin Dispatcher (engram_admin)
// Lean surface: single tool routing all admin/maintenance operations.
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, getDbSizeKb, getRepos, getServices, getProjectRoot, backupDatabase, restoreDatabase, getDbPath, listUserTables, now } from "../database.js";
import { success, error } from "../response.js";
import { detectMalformedWrite } from "../write-integrity.js";
import { SERVER_VERSION, DB_DIR_NAME, BACKUP_DIR_NAME, MAX_BACKUP_COUNT, CFG_AUTO_UPDATE_AVAILABLE, CFG_AUTO_UPDATE_LAST_CHECK, CFG_AUTO_UPDATE_CHECK, GITHUB_RELEASES_URL, configWriteRejection, SECRET_CONFIG_KEYS, REDACTED_VALUE } from "../constants.js";
import { queryGlobalDecisions, queryGlobalConventions } from "../global-db.js";
import { getCurrentSchemaVersion } from "../migrations.js";
import { log } from "../logger.js";
import { ENGRAM_HOOK_MARKER, isEngramHook, stripEngramHookBlock } from "../git-hook.js";
import { pmSafe } from "../services/index.js";
import { detectCurrentPhase } from "../services/event-trigger.service.js";
import { KNOWLEDGE_BASE_VERSION } from "../constants.js";
import path from "path";
import fs from "fs";

import { coerceStringArray, coerceNumberArray } from "../utils.js";

/** Never return a secret's value through a tool response (audit N2). */
function redactConfigValue(key: string, value: string | null): string | null {
  if (value === null || value === "") return value;
  return SECRET_CONFIG_KEYS.has(key) ? REDACTED_VALUE : value;
}

/**
 * Write an audit_log row for a config mutation. The table has existed since
 * migration V20 and this path never used it, so security-relevant config
 * changes left no trace at all. Best-effort: an audit failure must not block
 * the operation, but it is logged rather than swallowed silently.
 */
function recordConfigAudit(key: string, before: string | null, after: string): void {
  try {
    getDb().prepare(
      "INSERT INTO audit_log (created_at, action, actor, table_name, record_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      Date.now(), "config.set", "agent", "config", null,
      JSON.stringify({ key, value: redactConfigValue(key, before) }),
      JSON.stringify({ key, value: redactConfigValue(key, after) })
    );
  } catch (e) { log.warn(`[Engram] audit_log write failed for config."${key}": ${e}`); }
}

// Exported for the same reason as MEMORY_ACTIONS — see dispatcher-memory.ts.
export const ADMIN_ACTIONS = [
  "backup", "restore", "list_backups",
  "export", "import",
  "compact", "clear",
  "stats", "health",
  "config",
  "scan_project",
  "install_hooks", "remove_hooks",
  "generate_report", "get_global_knowledge",
  // Cross-instance actions
  "discover_instances", "get_instance_info", "set_sharing",
  "query_instance", "search_all_instances",
  "import_from_instance", "set_instance_label", "set_visibility",
  // Sensitive data actions
  "mark_sensitive", "unmark_sensitive", "list_sensitive",
  "request_access", "approve_access", "deny_access", "list_access_requests",
  // PM Framework actions
  "enable_pm", "disable_pm", "enable_pm_lite", "disable_pm_lite",
  "decline_pm", "reset_pm_offer", "pm_status",
] as const;

export function registerAdminDispatcher(server: McpServer): void {
  // Named so the write-integrity check can DERIVE this tool's valid parameter
  // names instead of restating them. A parameter added below is covered by the
  // malformed-write detector on the same commit.
  const ADMIN_INPUT_SCHEMA = {
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
        // Cross-instance params
        instance_id: z.string().optional().describe("Target instance UUID for cross-instance queries."),
        type: z.string().optional().describe("Memory type: decisions, conventions, file_notes, tasks, sessions, changes. Used by mark_sensitive, unmark_sensitive, list_sensitive, import_from_instance."),
        query_type: z.string().optional().describe("Memory type to query for query_instance: decisions, conventions, file_notes, tasks, sessions, changes. Alias for type when using query_instance."),
        query: z.string().optional().describe("Search query for cross-instance search."),
        limit: z.number().int().optional().describe("Max results to return."),
        mode: z.string().optional().describe("Sharing mode: none, read, or full."),
        types: coerceStringArray().optional().describe("Sharing types array: decisions, conventions, file_notes, tasks, etc."),
        label: z.string().optional().describe("Human-readable instance label."),
        include_stale: z.boolean().optional().describe("Include stale/stopped instances in discovery."),
        include_offline: z.boolean().optional().describe("Include permanently enrolled instances that are currently offline (default true)."),
        visible: z.union([z.boolean(), z.string()]).optional().describe("Visibility toggle for set_visibility: true = permanently enrolled in dashboard, false = heartbeat-only (default)."),
        ids: coerceNumberArray().optional().describe("Record IDs for selective import."),
        status: z.string().optional().describe("Filter by status."),
        reason: z.string().optional().describe("Reason for access request."),
        request_id: z.number().int().optional().describe("Access request ID for approve/deny."),
        resolved_by: z.string().optional().describe("Who approved/denied (default: human)."),
        requester_instance_id: z.string().optional().describe("Instance ID of the requester."),
        requester_label: z.string().optional().describe("Human-readable label of the requester."),
  };

  server.registerTool(
    "engram_admin",
    {
      title: "Admin Operations",
      description: `Engram admin and maintenance operations. Use only when needed.

Actions: backup, restore, list_backups, export, import, compact, clear, stats, health, config, scan_project, discover_instances, set_sharing, set_visibility, query_instance, search_all_instances, mark_sensitive, unmark_sensitive, list_sensitive, request_access, approve_access, deny_access, list_access_requests, enable_pm, disable_pm, enable_pm_lite, disable_pm_lite, decline_pm, reset_pm_offer, pm_status.`,
      inputSchema: ADMIN_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      // ── Write integrity: refuse a decoder-corrupted call ─────────────────
      // Task #91's stated remainder: the check shipped wired into
      // engram_memory's dispatch only. This surface stores `value` (config),
      // `label`, `reason` and `query` — shorter than a session summary, so a
      // lower-probability trigger, but `set_instance_label` and
      // `request_access` reasons are persisted and unrepairable like every
      // other row type except observations.
      //
      // Deliberately placed BEFORE the switch, so it cannot fire between a
      // backup's file write and its response — a rejection here means nothing
      // was attempted, which is the property the message promises.
      {
        const bad = detectMalformedWrite(
          params as Record<string, unknown>,
          Object.keys(ADMIN_INPUT_SCHEMA),
        );
        if (bad) {
          log.warn("Rejected malformed write", { tool: "engram_admin", field: bad.field, swallowed: bad.swallowed });
          return error(bad.message);
        }
      }

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
          // FR-D1 T1. The restore mechanics live in database.ts:restoreDatabase —
          // validate, safety-backup (blocking), close, delete main+wal+shm
          // TOGETHER, copy, reopen. The previous inline version copied over a
          // live database and left the hot WAL in place, so the restore was
          // silently undone on the next close. See docs/foundations/01-durability.md P1.
          try {
            const r = restoreDatabase(params.input_path);
            return success({ ...r, message: `Database restored from ${r.restored_from} (schema v${r.schema_version}) and reopened. Safety backup: ${r.safety_backup}` });
          } catch (e) {
            return error(e instanceof Error ? e.message : String(e));
          }
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
          // ── FR-D1 T5 / task #32 — complete, or it names what it skipped ────
          //
          // The table list was EIGHT names, hand-typed. MEASURED on a real store
          // at schema V26: 24 real tables exist, so 16 were silently absent —
          // including observations (146 rows, and observations ARE the product),
          // handoffs (22), tool_call_log (488), config (43) and checkpoints. The
          // call still reported "Memory exported" and a KB figure, so the only
          // signal that two thirds of the store was missing was a smaller file.
          //
          // Worse, the old `catch { exported[table] = [] }` rendered a table it
          // could not read as an EMPTY ARRAY — indistinguishable from a table
          // that is genuinely empty. A read failure became a factual-looking
          // claim that there was nothing there.
          //
          // Derived from sqlite_master now, so a table added by a future
          // migration is exported the day it exists and there is no second list
          // to forget. This is charter §2's rule applied to a register that
          // happened to be a string array.
          //
          // TWO EXCLUSIONS, both named in the payload rather than assumed:
          //   sqlite_*  — SQLite's own bookkeeping, not ours to carry.
          //   fts_*     — 40 FTS5 shadow tables. They are a DERIVED index over
          //               rows this file already contains, they are rebuilt by
          //               migration V26 on import, and carrying them would
          //               roughly double the file to restate what is already in
          //               it. Excluded because they are redundant, not because
          //               they are inconvenient — and the payload says so.
          const outputPath = params.output_path ?? path.join(projectRoot, DB_DIR_NAME, "export.json");
          // listUserTables() lives in database.ts, not here: schema
          // introspection belongs to the database rather than to any domain
          // repository, and putting the query in this file raised the raw-SQL
          // ratchet (tests/codebase/maintainability.test.ts) — task #80's
          // number moving the wrong way. The ratchet caught it.
          const { tables, ftsArtifacts, sqliteInternal } = listUserTables(db);

          const rowCounts: Record<string, number> = {};
          const failed: Record<string, string> = {};
          const exported: Record<string, unknown> = {};

          let redactedSecrets = 0;
          for (const table of tables) {
            try {
              // Quoted identifier. The name comes from sqlite_master and never
              // from a caller, but an unquoted interpolation here would be the
              // pattern rather than the exception, and the next table with a
              // reserved-word name would break it silently.
              const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all();

              // `config` was NOT in the old eight-table list, so completing the
              // export is what puts it in reach — and it can hold http_token,
              // which SECRET_CONFIG_KEYS already redacts on every other read
              // path. Completeness must not become the one route that serves a
              // credential in plaintext, on a file the user is being encouraged
              // to treat as a backup. Redacted with the same constant the config
              // surface uses, so there is one definition of what is secret.
              if (table === "config") {
                for (const row of rows as Array<{ key?: string; value?: unknown }>) {
                  if (typeof row.key === "string" && SECRET_CONFIG_KEYS.has(row.key)) {
                    row.value = REDACTED_VALUE;
                    redactedSecrets++;
                  }
                }
              }

              exported[table] = rows;
              rowCounts[table] = rows.length;
            } catch (e) {
              // Reported, never rendered as an empty table. A read failure and
              // an empty table are different facts and were the same one.
              failed[table] = (e as Error).message;
            }
          }

          const payload = {
            exported_at: new Date().toISOString(),
            version: SERVER_VERSION,
            schema_version: getCurrentSchemaVersion(db),
            complete: Object.keys(failed).length === 0,
            table_count: Object.keys(rowCounts).length,
            total_rows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
            row_counts: rowCounts,
            excluded: {
              fts_artifacts: ftsArtifacts.length,
              sqlite_internal: sqliteInternal.length,
              why: "FTS5 shadow tables are a derived index over rows already in this file and are rebuilt on import; sqlite_* is SQLite's own bookkeeping.",
            },
            failed_to_read: failed,
            redacted_secrets: redactedSecrets,
            note: "Secret config keys are redacted (see redacted_secrets). `config` still carries instance_id, which identifies this instance rather than authenticating it — importing it elsewhere would clone this instance's identity in the cross-instance registry.",
            ...exported,
          };

          fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
          const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
          const failNote = Object.keys(failed).length
            ? ` ${Object.keys(failed).length} table(s) COULD NOT BE READ and are absent: ${Object.keys(failed).join(", ")}.`
            : "";
          return success({
            path: outputPath,
            size_kb: sizeKb,
            complete: payload.complete,
            table_count: payload.table_count,
            total_rows: payload.total_rows,
            row_counts: rowCounts,
            failed_to_read: failed,
            message:
              `Exported ${payload.table_count} table(s), ${payload.total_rows} row(s) to ${outputPath} (${sizeKb} KB).` +
              failNote,
          });
        }

        // ─── IMPORT ─────────────────────────────────────────────────────
        case "import": {
          if (!params.input_path) return error("input_path required for import.");
          if (!fs.existsSync(params.input_path)) return error(`Import file not found: ${params.input_path}`);
          const data = JSON.parse(fs.readFileSync(params.input_path, "utf-8")) as Record<string, unknown>;
          const dryRun = params.dry_run ?? true;

          // ── SENIOR REVIEW S6 / task #33 — one registry, both halves ───────
          //
          // The dry run used to count FOUR tables — decisions, conventions,
          // file_notes, milestones — from a local `importable` array, and the
          // executor below then wrote exactly ONE of them. A user ran the
          // preview, was told four categories would import, set dry_run:false,
          // and three vanished with no warning. "Import complete. N decisions
          // merged." is technically true and reads as total success.
          //
          // FR-D6 made this worse by pointing at it: export-import.routes.ts:70
          // tells users to "use engram_admin(action:'import', input_path) over
          // MCP, WHICH DOES APPLY THE DATA". It applied one quarter of it.
          //
          // The two lists are now ONE list. A table is importable if and only
          // if it has an `apply` here, so the preview cannot describe work the
          // executor will not do — adding a table fixes both halves at once,
          // and there is no second place to forget.
          //
          // Task #33's definition of done is "honest dry run first, THEN
          // implement". The honest dry run landed first, on its own, so the lie
          // stopped immediately rather than waiting for the feature. The
          // implementation is the block below, added 2026-08-12 — all four
          // tables now have importers, so `not_imported` is empty in practice
          // and stays as the mechanism that keeps preview and executor from
          // ever diverging again.
          // ── SECOND HALF, task #33 — the three defects the honest dry run
          //    deliberately left standing ────────────────────────────────────
          //
          // 1. ID REMAPPING, not INSERT OR IGNORE on the source id. The old
          //    importer carried `row.id` across and relied on OR IGNORE, so
          //    merging a second store into a populated one silently DROPPED
          //    every decision whose id already existed — for two Engram stores
          //    of similar age, most of them. Ids are now omitted so SQLite
          //    assigns fresh ones, which is what makes a merge a merge.
          //
          //    `session_id` is deliberately set to NULL rather than carried.
          //    It references a `sessions` row that this import does not bring
          //    with it, so preserving the number would attribute an imported
          //    decision to whatever local session happens to hold that id —
          //    inventing provenance, which is the exact failure FR-D2 T1 is
          //    about. NULL says "imported, origin session unknown", which is
          //    true. `superseded_by` and `depends_on` are dropped for the same
          //    reason: they are id references that no longer point anywhere.
          //
          // 2. COUNT ROWS THAT LANDED, not calls that did not throw. The old
          //    loop incremented on every call that didn't raise, and
          //    INSERT OR IGNORE does not raise when it ignores — so the
          //    reported count was the number of rows OFFERED. `.changes` is
          //    what actually landed.
          //
          // 3. SHAPE VALIDATION. `JSON.parse` went straight into prepared
          //    statements. A row that is not an object, or is missing the
          //    NOT NULL columns, is now rejected and counted rather than
          //    throwing mid-file or inserting a half-row.
          //
          // file_notes is keyed by `file_path`, a natural key, so it needs no
          // remapping — but it DOES need a policy, and the policy is: never
          // overwrite a local note with an imported one. A local note describes
          // this checkout; an imported one describes someone else's. Conflicts
          // are skipped and counted, not silently applied.
          interface ImportOutcome { inserted: number; skipped: number; rejected: number }

          // EVERY importer goes through `repositories/`, not through raw SQL in
          // this file. The first version wrote four prepared statements here and
          // the raw-SQL ratchet (tests/codebase/maintainability.test.ts) caught
          // it at 25 against a frozen ceiling of 22 — Law 1, and task #80's
          // number moving the wrong way. The repositories already expose exactly
          // what an import needs, including a nullable session id, so the bypass
          // was never justified.
          const isRow = (r: unknown): r is Record<string, unknown> =>
            typeof r === "object" && r !== null && !Array.isArray(r);

          const str = (v: unknown): string | null =>
            typeof v === "string" ? v : v == null ? null : String(v);

          /** Export columns hold JSON text; the repositories take arrays. */
          const arr = (v: unknown): string[] | null => {
            if (Array.isArray(v)) return v.map(String);
            if (typeof v === "string" && v.trim()) {
              try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : null; } catch { return null; }
            }
            return null;
          };

          const IMPORTERS: Record<string, (rows: unknown[]) => ImportOutcome> = {
            decisions: (rows) => {
              const out: ImportOutcome = { inserted: 0, skipped: 0, rejected: 0 };
              for (const r of rows) {
                if (!isRow(r) || !str(r.timestamp) || !str(r.decision)) { out.rejected++; continue; }
                repos.decisions.create(
                  null, str(r.timestamp)!, str(r.decision)!, str(r.rationale),
                  arr(r.affected_files), arr(r.tags), str(r.status) ?? "active",
                );
                out.inserted++;
              }
              return out;
            },
            conventions: (rows) => {
              const out: ImportOutcome = { inserted: 0, skipped: 0, rejected: 0 };
              for (const r of rows) {
                if (!isRow(r) || !str(r.timestamp) || !str(r.category) || !str(r.rule)) { out.rejected++; continue; }
                repos.conventions.create(
                  null, str(r.timestamp)!, str(r.category)!, str(r.rule)!,
                  arr(r.examples), str(r.summary), arr(r.tags),
                );
                out.inserted++;
              }
              return out;
            },
            milestones: (rows) => {
              const out: ImportOutcome = { inserted: 0, skipped: 0, rejected: 0 };
              for (const r of rows) {
                if (!isRow(r) || !str(r.timestamp) || !str(r.title)) { out.rejected++; continue; }
                repos.milestones.create(
                  null, str(r.timestamp)!, str(r.title)!,
                  str(r.description), str(r.version), arr(r.tags),
                );
                out.inserted++;
              }
              return out;
            },
            file_notes: (rows) => {
              // Natural key (`file_path`), so no remapping — but it needs a
              // POLICY, and the policy is: never overwrite a local note with an
              // imported one. A local note describes THIS checkout; an imported
              // one describes someone else's. Expressed as check-then-write
              // rather than INSERT OR IGNORE precisely so it goes through the
              // repository — and it is sound because the whole import runs
              // inside one BEGIN IMMEDIATE, so nothing can insert between the
              // read and the write.
              const out: ImportOutcome = { inserted: 0, skipped: 0, rejected: 0 };
              for (const r of rows) {
                if (!isRow(r) || !str(r.file_path)) { out.rejected++; continue; }
                const fp = str(r.file_path)!;
                if (repos.fileNotes.getByPath(fp)) { out.skipped++; continue; }
                repos.fileNotes.upsert(fp, str(r.last_reviewed) ?? now(), null, {
                  purpose: str(r.purpose),
                  dependencies: arr(r.dependencies),
                  dependents: arr(r.dependents),
                  layer: str(r.layer) as Parameters<typeof repos.fileNotes.upsert>[3]["layer"],
                  complexity: str(r.complexity) as Parameters<typeof repos.fileNotes.upsert>[3]["complexity"],
                  notes: str(r.notes),
                  file_mtime: typeof r.file_mtime === "number" ? r.file_mtime : null,
                  git_branch: str(r.git_branch),
                  content_hash: str(r.content_hash),
                  executive_summary: str(r.executive_summary),
                });
                out.inserted++;
              }
              return out;
            },
          };

          // Every table the export format can carry. Anything here without an
          // IMPORTERS entry is reported as not-imported rather than counted as
          // if it were.
          const KNOWN_TABLES = ["decisions", "conventions", "file_notes", "milestones"];

          const wouldImport: Record<string, number> = {};
          const notImported: Record<string, number> = {};
          for (const table of KNOWN_TABLES) {
            const count = (data[table] as unknown[] | undefined)?.length ?? 0;
            if (IMPORTERS[table]) wouldImport[table] = count;
            else if (count > 0) notImported[table] = count;
          }

          const skipped = Object.keys(notImported);
          const skipNote = skipped.length > 0
            ? ` NOT imported (no importer implemented — task #33): ${skipped.map(t => `${t} (${notImported[t]} row(s))`).join(", ")}.`
            : "";

          if (dryRun) {
            return success({
              dry_run: true,
              would_import: wouldImport,
              not_imported: notImported,
              message:
                `Dry run complete. Set dry_run: false to execute.` + skipNote +
                (skipped.length > 0 ? " These rows will be LEFT IN THE FILE, not merged." : ""),
            });
          }

          // ONE transaction across every table. Without it, a failure at row 400
          // of 500 left 399 rows committed with no rollback — on the path a user
          // reaches for during recovery, which is the worst possible moment to
          // half-apply. All-or-nothing: either the merge happened or the store
          // is exactly as it was.
          const imported: Record<string, number> = {};
          const keptLocal: Record<string, number> = {};
          const rejected: Record<string, number> = {};
          let total = 0;

          const runImport = db.transaction(() => {
            for (const [table, apply] of Object.entries(IMPORTERS)) {
              const rows = data[table];
              if (!Array.isArray(rows)) { imported[table] = 0; continue; }
              const out = apply(rows);
              imported[table] = out.inserted;
              if (out.skipped) keptLocal[table] = out.skipped;
              if (out.rejected) rejected[table] = out.rejected;
              total += out.inserted;
            }
          });

          try {
            runImport.immediate();
          } catch (e) {
            return error(
              `Import failed and NOTHING was written — the whole merge was rolled back. ` +
              `Reason: ${(e as Error).message}`,
            );
          }

          const detail = Object.entries(imported).filter(([, n]) => n > 0)
            .map(([t, n]) => `${n} ${t}`).join(", ") || "nothing";
          const skipNote2 = Object.keys(keptLocal).length
            ? ` Kept the local copy for ${Object.entries(keptLocal).map(([t, n]) => `${n} ${t}`).join(", ")}.`
            : "";
          const rejectNote = Object.keys(rejected).length
            ? ` REJECTED as malformed: ${Object.entries(rejected).map(([t, n]) => `${n} ${t}`).join(", ")}.`
            : "";

          return success({
            imported: total,
            imported_by_table: imported,
            skipped_existing: keptLocal,
            rejected_malformed: rejected,
            not_imported: notImported,
            message:
              `Import complete. ${total} row(s) merged (${detail}).` +
              skipNote + skipNote2 + rejectNote,
          });
        }

        // ─── COMPACT ────────────────────────────────────────────────────
        case "compact": {
          // FR-D6 T1. This case previously told three separate lies:
          //
          //  1. It called manualCompact(keepSessions, maxAgeDays) with TWO
          //     arguments. The signature is (keepSessions, maxAgeDays?, dryRun
          //     = true), so dry_run:false took the dry-run early return, then
          //     `success(result)` reported non-zero sessionsCompacted /
          //     changesSummarized in the past tense for work that never ran.
          //     Proven end-to-end over MCP stdio: 12 sessions in, "compacted 9",
          //     12 sessions out, zero backups on disk.
          //  2. The preview counted a DIFFERENT number from the execution —
          //     raw SQL `total_sessions - keep_sessions` here versus
          //     countCompactableSessions() (ended sessions only, age-filtered)
          //     in the service. Two answers to one question.
          //  3. Both said sessions "would be removed". Compaction never removes
          //     a session. compactBeforeCutoff() collapses each ended session's
          //     change rows into one summary row and deletes the originals.
          //
          // Preview and execution now run the SAME call with dryRun as data, so
          // a future divergence is impossible rather than merely unlikely.
          const dryRun = params.dry_run ?? true;
          const keepSessions = params.keep_sessions ?? 50;
          const maxAgeDays = params.max_age_days;
          const result = services.compaction.manualCompact(keepSessions, maxAgeDays, dryRun);
          return success({
            dry_run: dryRun,
            ...result,
            message: dryRun
              ? `Dry run — nothing was changed. ${result.changesSummarized} change record(s) across ${result.sessionsCompacted} session(s) would be summarised. Sessions are never deleted. Set dry_run: false to execute.`
              : `Summarised ${result.changesSummarized} change record(s) across ${result.sessionsCompacted} session(s). Sessions were not deleted. Safety backup: ${result.backupPath}`,
          });
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
            total_milestones: count("milestones"), total_observations: count("observations"),
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
          // FTS check.
          // FR-D6: this ran `SELECT * FROM decisions LIMIT 1` — the BASE table —
          // and reported fts:"available" on success. It never touched an FTS
          // index, so it answered "available" whenever decisions was readable,
          // which is always. FR-D1 established why the query below is the only
          // one that works: fts_* are EXTERNAL-CONTENT tables, so COUNT(*) and
          // SELECT * delegate to the content table and succeed over a destroyed
          // index. Only MATCH touches the index itself.
          try { db.prepare("SELECT rowid FROM fts_decisions WHERE fts_decisions MATCH ? LIMIT 1").all("engram_health_probe"); checks.fts = "available"; } catch (e) { checks.fts = `unavailable: ${e instanceof Error ? e.message : String(e)}`; }
          // Schema version
          try { const vRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined; checks.schema_version = vRow ? parseInt(vRow.value, 10) : 0; } catch { checks.schema_version = 0; }
          // DB size
          checks.database_size_kb = getDbSizeKb();
          // FR-D6: `healthy` was `checks.integrity === "ok"` alone, so four of the
          // five checks were computed, displayed, and then ignored — "Database is
          // healthy." could be returned with the FTS index destroyed and the
          // schema version reading 0. A check that cannot affect the verdict is
          // decoration. Migrations run on every open, so by the time this
          // executes fts_decisions exists on any database Engram will serve.
          const failures = [
            checks.integrity === "ok" ? null : `integrity: ${checks.integrity}`,
            checks.fts === "available" ? null : `fts: ${checks.fts}`,
            (checks.schema_version as number) > 0 ? null : "schema_version: unreadable",
          ].filter(Boolean) as string[];
          const healthy = failures.length === 0;
          return success({
            healthy,
            checks,
            message: healthy ? "Database is healthy." : `Issues detected — ${failures.join("; ")}`,
          });
        }

        // ─── CONFIG ─────────────────────────────────────────────────────
        case "config": {
          // AUDIT N2: this used to write ANY key with no whitelist, no
          // confirmation and no audit entry — so one tool call could set
          // sharing_mode:"full" or overwrite http_token. See the policy and its
          // rationale in constants.ts.
          if (params.key && params.value !== undefined) {
            const rejection = configWriteRejection(params.key);
            if (rejection) return error(rejection);
            const before = repos.config.get(params.key);
            repos.config.set(params.key, params.value, now());
            recordConfigAudit(params.key, before, params.value);
            return success({ message: `Config "${params.key}" set to "${params.value}".`, key: params.key, value: params.value });
          }
          // ISS-015: When key is provided without value, return just that key's value.
          if (params.key) {
            const val = repos.config.get(params.key);
            return success({ key: params.key, value: redactConfigValue(params.key, val) });
          }
          const config = repos.config.getAll().map(e => ({ ...e, value: redactConfigValue(e.key, e.value) ?? e.value }));
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
          const hookContent = `#!/bin/bash\n# ${ENGRAM_HOOK_MARKER}\nENGRAM_DIR=".engram"\nCHANGE_LOG="$ENGRAM_DIR/git-changes.log"\nmkdir -p "$ENGRAM_DIR"\nHASH=$(git rev-parse --short HEAD)\nMSG=$(git log -1 --pretty=format:"%s")\nDATE=$(git log -1 --pretty=format:"%aI")\nFILES=$(git diff-tree --no-commit-id --name-status -r HEAD)\n{ echo "--- COMMIT $HASH ---"; echo "date: $DATE"; echo "message: $MSG"; echo "files:"; echo "$FILES"; echo "---"; echo ""; } >> "$CHANGE_LOG"\n`;
          if (fs.existsSync(hookPath)) {
            const existing = fs.readFileSync(hookPath, "utf-8");
            // Shared recognition with the CLI installer — see src/git-hook.ts.
            // These two paths previously used different markers and each refused
            // to remove the other's hook.
            if (isEngramHook(existing)) return success({ message: "Engram post-commit hook already installed.", hook_path: hookPath });
            fs.appendFileSync(hookPath, "\n\n" + hookContent.replace(/^#!\/bin\/bash\n/, ""));
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
          if (!isEngramHook(existing2)) return success({ message: "Engram hook not found in existing post-commit hook." });
          // Remove only the engram section. The previous regex anchored on a
          // "\n---\n\n" terminator that this hook's own content never emits, so
          // it matched nothing and the block survived every removal.
          const cleaned = stripEngramHookBlock(existing2);
          if (cleaned.replace(/^#!.*$/m, "").trim()) { fs.writeFileSync(hookPath2, cleaned); } else { fs.unlinkSync(hookPath2); }
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

        // ─── DISCOVER INSTANCES ──────────────────────────────────────────
        case "discover_instances": {
          // include_offline=true (default): enrolled instances that are currently offline
          // are included — they show as status="offline" with label/path/last_seen only.
          // include_offline=false: only online/stale heartbeat instances returned.
          const includeOffline = params.include_offline !== false; // default true
          const instances = services.crossInstance.discoverInstances(params.include_stale ?? true);
          const selfId = services.registry.getInstanceId();

          // Online instances from heartbeat list
          const heartbeatIds = new Set(instances.map(i => i.instance_id));
          const result: Array<Record<string, unknown>> = instances.map(i => ({
            instance_id: i.instance_id,
            label: i.label,
            project_root: i.project_root,
            sharing_mode: i.sharing_mode,
            sharing_types: i.sharing_types,
            status: i.status,
            stats: i.stats,
            last_heartbeat: i.last_heartbeat,
            is_self: i.instance_id === selfId,
            online: i.status === "active",
            enrolled: i.visible ?? false,
          }));

          // Enrolled offline instances (visible=true, not currently heartbeating)
          if (includeOffline) {
            const offlineEnrolled = services.registry.getEnrolledOffline();
            for (const e of offlineEnrolled) {
              if (!heartbeatIds.has(e.instance_id)) {
                result.push({
                  instance_id: e.instance_id,
                  label: e.label,
                  project_root: e.project_root,
                  db_path: e.db_path,
                  last_seen: e.last_seen,
                  enrolled_at: e.enrolled_at,
                  status: "offline",
                  online: false,
                  enrolled: true,
                  is_self: e.instance_id === selfId,
                  // Stats not surfaced for offline instances — privacy-safe
                  stats: null,
                  sharing_mode: null,
                  sharing_types: null,
                  last_heartbeat: e.last_seen,
                });
              }
            }
          }

          const onlineCount = result.filter(i => i.online).length;
          const offlineEnrolledCount = result.filter(i => !i.online && i.enrolled).length;
          return success({
            self_instance_id: selfId,
            instances: result,
            total: result.length,
            online_count: onlineCount,
            offline_enrolled_count: offlineEnrolledCount,
            message: `Found ${result.length} Engram instance(s) on this machine (${onlineCount} online, ${offlineEnrolledCount} enrolled-offline).`,
          });
        }

        // ─── GET INSTANCE INFO ───────────────────────────────────────────
        case "get_instance_info": {
          const selfId = services.registry.getInstanceId();
          const targetId = params.instance_id;

          // Self or no instance_id specified — return live local info
          if (!targetId || targetId === selfId) {
            const self = services.registry.getSelf();
            return success({
              ...self,
              message: `Instance '${self.label}' (${self.instance_id}). Sharing: ${self.sharing_mode}. Types: ${self.sharing_types.join(", ")}.`,
            });
          }

          // Foreign instance — look up from registry
          const instances = services.registry.listInstances(true);
          const target = instances.find(i => i.instance_id === targetId);
          if (!target) {
            return error(`Instance '${targetId}' not found in registry. Is it running?`);
          }
          return success({
            ...target,
            message: `Instance '${target.label}' (${target.instance_id}). Sharing: ${target.sharing_mode}. Types: ${target.sharing_types.join(", ")}.`,
          });
        }

        // ─── SET SHARING ─────────────────────────────────────────────────
        case "set_sharing": {
          const sharingMode = params.mode as "none" | "read" | "full" | undefined;
          if (!sharingMode || !["none", "read", "full"].includes(sharingMode)) {
            return error("mode is required: 'none', 'read', or 'full'.");
          }
          const sharingTypes = params.types as string[] | undefined;
          services.registry.setSharing(sharingMode, sharingTypes);
          const updated = services.registry.getSelf();
          return success({
            sharing_mode: updated.sharing_mode,
            sharing_types: updated.sharing_types,
            message: `Sharing updated to '${updated.sharing_mode}'. Types: ${updated.sharing_types.join(", ")}.`,
          });
        }

        // ─── QUERY INSTANCE ─────────────────────────────────────────────
        case "query_instance": {
          if (!params.instance_id) return error("instance_id is required.");
          const queryType = params.query_type ?? params.type ?? "decisions";
          try {
            let result: { source: { label: string; instance_id: string; project_root: string }; results: Record<string, unknown>[] };
            switch (queryType) {
              case "decisions":
                result = services.crossInstance.queryDecisions(params.instance_id, { query: params.query, limit: params.limit, status: params.status });
                break;
              case "conventions":
                result = services.crossInstance.queryConventions(params.instance_id, { category: params.query });
                break;
              case "file_notes":
                result = services.crossInstance.queryFileNotes(params.instance_id, { filePath: params.query, limit: params.limit });
                break;
              case "tasks":
                result = services.crossInstance.queryTasks(params.instance_id, { status: params.status, limit: params.limit });
                break;
              case "sessions":
                result = services.crossInstance.querySessions(params.instance_id, { limit: params.limit });
                break;
              case "changes":
                result = services.crossInstance.queryChanges(params.instance_id, { limit: params.limit, filePath: params.query });
                break;
              default:
                return error(`Unknown query type '${queryType}'. Valid: decisions, conventions, file_notes, tasks, sessions, changes.`);
            }
            return success({
              source: { label: result.source.label, instance_id: result.source.instance_id, project: result.source.project_root },
              type: queryType,
              results: result.results,
              count: result.results.length,
              message: `${result.results.length} ${queryType} from '${result.source.label}'.`,
            });
          } catch (e) {
            return error((e as Error).message);
          }
        }

        // ─── SEARCH ALL INSTANCES ────────────────────────────────────────
        case "search_all_instances": {
          if (!params.query) return error("query is required for search_all_instances.");
          const results = services.crossInstance.searchAll(params.query, { scope: params.scope, limit: params.limit });
          const totalResults = results.reduce((sum, r) => sum + r.total, 0);
          return success({
            query: params.query,
            scope: params.scope ?? "decisions",
            results: results.map(r => ({
              source_label: r.source_label,
              source_project: r.source_project,
              source_instance_id: r.source_instance_id,
              count: r.total,
              items: r.results,
            })),
            instances_searched: results.length,
            total_results: totalResults,
            message: `Found ${totalResults} result(s) across ${results.length} instance(s) for "${params.query}".`,
          });
        }

        // ─── IMPORT FROM INSTANCE ────────────────────────────────────────
        case "import_from_instance": {
          if (!params.instance_id) return error("instance_id is required.");
          const importType = params.type ?? "decisions";
          try {
            const { source, records } = services.crossInstance.extractForImport(
              params.instance_id,
              importType,
              params.ids
            );
            // The actual import writes happen here; extractForImport only reads
            let imported = 0;
            const ts = now();
            if (importType === "decisions" && records.length > 0) {
              const stmt = db.prepare(
                "INSERT INTO decisions (session_id, timestamp, decision, rationale, affected_files, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
              );
              const insertAll = db.transaction(() => {
                for (const r of records) {
                  stmt.run(null, ts, `[imported from ${source.label}] ${r.decision}`, r.rationale ?? null, r.affected_files ?? null, r.tags ?? null, "active");
                  imported++;
                }
              });
              insertAll();
            } else if (importType === "conventions" && records.length > 0) {
              const stmt = db.prepare(
                "INSERT INTO conventions (session_id, timestamp, category, rule, enforced) VALUES (?, ?, ?, ?, ?)"
              );
              const insertAll = db.transaction(() => {
                for (const r of records) {
                  stmt.run(null, ts, r.category ?? "imported", `[from ${source.label}] ${r.rule}`, r.enforced ?? 1);
                  imported++;
                }
              });
              insertAll();
            } else {
              return error(`Import of '${importType}' is not yet supported. Supported: decisions, conventions.`);
            }
            return success({
              source_label: source.label,
              source_instance_id: source.instance_id,
              type: importType,
              imported,
              message: `Imported ${imported} ${importType} from '${source.label}'.`,
            });
          } catch (e) {
            return error((e as Error).message);
          }
        }

        // ─── SET INSTANCE LABEL ──────────────────────────────────────────
        case "set_instance_label": {
          if (!params.label) return error("label is required.");
          services.registry.setLabel(params.label);
          return success({
            label: params.label,
            instance_id: services.registry.getInstanceId(),
            message: `Instance label updated to '${params.label}'.`,
          });
        }
        // ─── SET VISIBILITY ───────────────────────────────────────────────
        case "set_visibility": {
          const rawVisible = params.visible;
          if (rawVisible === undefined || rawVisible === null) {
            return error("visible is required (true to enroll permanently, false to hide).");
          }
          const visible = rawVisible === true || rawVisible === "true";
          services.registry.setVisibility(visible);
          const self = services.registry.getSelf();
          const statusMsg = visible
            ? `Instance '${self.label}' is now visible. It will appear in dashboard discovery and persist as offline when not running. Enrollment entry will be written on the next heartbeat (~60s).`
            : `Instance '${self.label}' is now hidden. It will only appear while this process is running, then disappear after ~5 minutes.`;
          return success({
            instance_id: self.instance_id,
            label: self.label,
            visible,
            message: statusMsg,
          });
        }
        // ─── MARK SENSITIVE ──────────────────────────────────────────────
        case "mark_sensitive": {
          if (!params.type) return error("type is required (e.g. decisions, conventions, file_notes).");
          if (!params.ids || params.ids.length === 0) return error("ids array is required.");
          const lockResult = services.sensitiveData.lockRecords(params.type, params.ids);
          // FR-D2 T4, task #39. The caveat is on the RESPONSE and not only in
          // the catalog description, because this is the moment the caller
          // decides whether the record is now safe to leave in a shared
          // instance. The old message said "Marked ... as sensitive" and
          // stopped there, which reads as an enforcement that does not exist.
          return success({
            type: params.type,
            ids: params.ids,
            newly_locked: lockResult.locked,
            enforced: false,
            message:
              `Marked ${lockResult.locked} ${params.type} record(s) as sensitive. ` +
              `NOT ENFORCED: this marker is local bookkeeping only. It does NOT hide these ` +
              `records from cross-instance queries — no read path consults it. If this data ` +
              `must not leave the machine, set sharing_mode to 'none' instead.`,
          });
        }

        // ─── UNMARK SENSITIVE ────────────────────────────────────────────
        case "unmark_sensitive": {
          if (!params.type) return error("type is required.");
          if (!params.ids || params.ids.length === 0) return error("ids array is required.");
          const unlockResult = services.sensitiveData.unlockRecords(params.type, params.ids);
          return success({
            type: params.type,
            ids: params.ids,
            unlocked: unlockResult.unlocked,
            message: `Unmarked ${unlockResult.unlocked} ${params.type} record(s) from sensitive.`,
          });
        }

        // ─── LIST SENSITIVE ──────────────────────────────────────────────
        case "list_sensitive": {
          const summary = services.sensitiveData.getSummary();
          const total = summary.reduce((s, e) => s + e.count, 0);
          return success({
            locked_items: summary,
            total_locked: total,
            message: total > 0 ? `${total} record(s) locked across ${summary.length} type(s).` : "No sensitive records locked.",
          });
        }

        // ─── REQUEST ACCESS ──────────────────────────────────────────────
        case "request_access": {
          if (!params.requester_instance_id) return error("requester_instance_id is required.");
          if (!params.type) return error("type is required.");
          if (!params.ids || params.ids.length === 0) return error("ids array is required.");
          const request = services.sensitiveData.createAccessRequest(
            params.requester_instance_id,
            params.requester_label ?? null,
            params.type,
            params.ids,
            params.reason ?? null,
          );
          return success({
            request_id: request.id,
            status: request.status,
            message: `Access request #${request.id} created (pending human approval).`,
          });
        }

        // ─── APPROVE ACCESS ──────────────────────────────────────────────
        case "approve_access": {
          if (!params.request_id) return error("request_id is required.");
          const approved = services.sensitiveData.approveRequest(params.request_id, params.resolved_by ?? "human");
          if (!approved) return error(`Access request #${params.request_id} not found.`);
          return success({
            request_id: approved.id,
            status: approved.status,
            resolved_at: approved.resolved_at,
            resolved_by: approved.resolved_by,
            message: `Access request #${approved.id} approved.`,
          });
        }

        // ─── DENY ACCESS ─────────────────────────────────────────────────
        case "deny_access": {
          if (!params.request_id) return error("request_id is required.");
          const denied = services.sensitiveData.denyRequest(params.request_id, params.resolved_by ?? "human");
          if (!denied) return error(`Access request #${params.request_id} not found.`);
          return success({
            request_id: denied.id,
            status: denied.status,
            resolved_at: denied.resolved_at,
            resolved_by: denied.resolved_by,
            message: `Access request #${denied.id} denied.`,
          });
        }

        // ─── LIST ACCESS REQUESTS ────────────────────────────────────────
        case "list_access_requests": {
          const statusFilter = params.status as "pending" | "approved" | "denied" | undefined;
          const requests = services.sensitiveData.listRequests(statusFilter);
          return success({
            requests: requests.map(r => ({
              id: r.id,
              requester: r.requester_label ?? r.requester_instance_id,
              type: r.target_type,
              ids: JSON.parse(r.target_ids),
              reason: r.reason,
              status: r.status,
              requested_at: r.requested_at,
              resolved_at: r.resolved_at,
              resolved_by: r.resolved_by,
            })),
            count: requests.length,
            message: `${requests.length} access request(s)${statusFilter ? ` (${statusFilter})` : ''}.`,
          });
        }

        default:
          return error(`Unknown admin action: ${(params as Record<string, unknown>).action}`);

        // ── PM FRAMEWORK ACTIONS ───────────────────────────────────────────────────────

        case "enable_pm": {
          const ts = now();
          repos.config.set('pm_full_enabled', 'true', ts);
          repos.config.set('pm_full_declined', 'false', ts);
          return success({ pm_full: true, message: 'PM-Full activated. Phase gates, checklists, and workflow guidance are now available.' });
        }

        case "disable_pm": {
          repos.config.set('pm_full_enabled', 'false', now());
          return success({ pm_full: false, message: 'PM-Full deactivated.' });
        }

        case "enable_pm_lite": {
          repos.config.set('pm_lite_enabled', 'true', now());
          return success({ pm_lite: true, message: 'PM-Lite workflow nudges enabled.' });
        }

        case "disable_pm_lite": {
          repos.config.set('pm_lite_enabled', 'false', now());
          return success({ pm_lite: false, message: 'PM-Lite workflow nudges disabled.' });
        }

        case "decline_pm": {
          const ts = now();
          repos.config.set('pm_full_declined', 'true', ts);
          repos.config.set('pm_full_offered', 'true', ts);
          return success({ pm_full_declined: true, message: 'PM-Full offer declined. No further offers will be made. Use enable_pm to activate manually.' });
        }

        case "reset_pm_offer": {
          const ts = now();
          repos.config.set('pm_full_offered', 'false', ts);
          repos.config.set('pm_full_declined', 'false', ts);
          return success({ reset: true, message: 'PM-Full offer and decline flags cleared. The offer may appear again when criteria are met.' });
        }

        case "pm_status": {
          const pmLiteEnabled = repos.config.get('pm_lite_enabled') !== 'false';
          const pmFullEnabled = repos.config.get('pm_full_enabled') === 'true';
          const pmOffered = repos.config.get('pm_full_offered') === 'true';
          const pmDeclined = repos.config.get('pm_full_declined') === 'true';
          const advisorStats = pmSafe(() => services.advisor.stats, { delivered: 0, available: [] as string[] }, 'pm_status.advisor');
          const diagStatus = pmSafe(() => services.diagnostics.getStatus(), { pm_lite_healthy: true, pm_full_healthy: true, failure_count: 0, recent_failures: [], uptime_ms: 0 }, 'pm_status.diagnostics');
          const currentPhase = pmFullEnabled ? pmSafe(() => detectCurrentPhase(repos), null as number | null, 'pm_status.phase') : null;
          const kbVersion = pmSafe(() => KNOWLEDGE_BASE_VERSION, '1.0', 'pm_status.kbVersion');
          return success({
            pm_lite: { enabled: pmLiteEnabled, healthy: true },
            pm_full: { enabled: pmFullEnabled, offered: pmOffered, declined: pmDeclined },
            current_phase: currentPhase,
            advisor: {
              nudges_delivered: advisorStats.delivered,
              nudges_available: advisorStats.available,
            },
            diagnostics: diagStatus,
            knowledge_base_version: kbVersion,
          });
        }

      }
    }
  );
}
