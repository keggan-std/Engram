#!/usr/bin/env node
// ============================================================================
//
//   ███████╗███╗   ██╗ ██████╗ ██████╗  █████╗ ███╗   ███╗
//   ██╔════╝████╗  ██║██╔════╝ ██╔══██╗██╔══██╗████╗ ████║
//   █████╗  ██╔██╗ ██║██║  ███╗██████╔╝███████║██╔████╔██║
//   ██╔══╝  ██║╚██╗██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║
//   ███████╗██║ ╚████║╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
//   ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
//
//   Persistent Memory Cortex for AI Coding Agents
//   Model Context Protocol (MCP) Server
//
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { initDatabase, getProjectRoot } from "./database.js";
import { log } from "./logger.js";
import { findProjectRoot } from "./utils.js";
import { runInstaller } from "./installer/index.js";

// Tool registrations
import { registerSessionTools } from "./tools/sessions.js";
import { registerChangeTools } from "./tools/changes.js";
import { registerDecisionTools } from "./tools/decisions.js";
import { registerFileNoteTools } from "./tools/file-notes.js";
import { registerConventionTools } from "./tools/conventions.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerBackupTools } from "./tools/backup.js";
import { registerMilestoneTools } from "./tools/milestones.js";
import { registerExportImportTools } from "./tools/export-import.js";
import { registerCompactionTools } from "./tools/compaction.js";
import { registerSchedulerTools } from "./tools/scheduler.js";
import { registerCoordinationTools } from "./tools/coordination.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerReportTools } from "./tools/report.js";

// ─── F7: record-commit — git hook handler ────────────────────────────
// Called by the Engram post-commit git hook after each git commit.
// Reads the last commit's changed files and records them in Engram's DB
// so the history stays complete even when an agent doesn't call record_change.

async function runRecordCommit(): Promise<void> {
  const { execSync } = await import("child_process");
  const projectRoot = findProjectRoot();

  try {
    await initDatabase(projectRoot);
    const { getDb } = await import("./database.js");
    const db = getDb();

    // Get changed files from the last commit
    const changedFilesRaw = execSync(
      "git show --name-only --format= HEAD",
      { cwd: projectRoot, encoding: "utf-8" }
    ).trim();
    const changedFiles = changedFilesRaw.split("\n").map(f => f.trim()).filter(Boolean);

    if (changedFiles.length === 0) {
      log.info("record-commit: no files changed in last commit");
      return;
    }

    // Get commit message
    const commitMsg = execSync("git log -1 --format=%B HEAD", {
      cwd: projectRoot, encoding: "utf-8",
    }).trim().split("\n")[0] ?? "git commit";

    // Get commit hash (short)
    const commitHash = execSync("git rev-parse --short HEAD", {
      cwd: projectRoot, encoding: "utf-8",
    }).trim();

    const timestamp = new Date().toISOString();

    // Find the most recent open session, if any
    let sessionId: number | null = null;
    try {
      const sessionRow = db.prepare(
        "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
      ).get() as { id: number } | undefined;
      sessionId = sessionRow?.id ?? null;
    } catch { /* sessions table may not exist */ }

    const stmt = db.prepare(`
      INSERT INTO changes (session_id, timestamp, file_path, change_type, description, diff_summary, impact_scope)
      VALUES (?, ?, ?, 'modified', ?, ?, 'local')
    `);

    const insertAll = db.transaction(() => {
      for (const file of changedFiles) {
        stmt.run(
          sessionId,
          timestamp,
          file,
          `git commit ${commitHash}: ${commitMsg}`,
          `Auto-recorded via Engram git post-commit hook`
        );
      }
    });

    insertAll();
    log.info(`record-commit: recorded ${changedFiles.length} file(s) from commit ${commitHash}`);
  } catch (e) {
    // Always exit 0 from a git hook — never block commits
    log.warn(`record-commit: ${e}`);
  }
}

// ─── Initialize ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── Auto-Installer ───────────────────────────────────────────────────
  if (
    args.includes("install") ||
    args.includes("--install") ||
    args.includes("--list") ||
    args.includes("--check") ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-v") ||
    args.includes("--install-hooks") ||
    args.includes("--remove-hooks")
  ) {
    runInstaller(args);
    return;
  }

  // ─── record-commit (git hook handler) ──────────────────────────────
  if (args.includes("record-commit")) {
    await runRecordCommit();
    return;
  }

  // Detect project root
  const projectRoot = findProjectRoot();
  log.info(`Project root: ${projectRoot}`);

  // Initialize database
  initDatabase(projectRoot);
  log.info(`Database initialized at ${projectRoot}/.engram/memory.db`);

  // Create MCP server
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ─── Register All Tools ──────────────────────────────────────────

  registerSessionTools(server);       // start_session, end_session, get_session_history
  registerChangeTools(server);        // record_change, get_file_history
  registerDecisionTools(server);      // record_decision, get_decisions, update_decision
  registerFileNoteTools(server);      // set_file_notes, get_file_notes
  registerConventionTools(server);    // add_convention, get_conventions, toggle_convention
  registerTaskTools(server);          // create_task, update_task, get_tasks
  registerIntelligenceTools(server);  // scan_project, search, what_changed, dependency_map
  registerStatsTools(server);         // stats
  registerBackupTools(server);        // backup, restore, list_backups
  registerMilestoneTools(server);     // record_milestone, get_milestones
  registerExportImportTools(server);  // export, import
  registerCompactionTools(server);    // compact, clear
  registerSchedulerTools(server);     // schedule_event, get/update/acknowledge events, check_events
  registerCoordinationTools(server);  // dump, claim_task, release_task, agent_sync, get_agents, broadcast
  registerKnowledgeTools(server);     // get_global_knowledge
  registerReportTools(server);        // generate_report

  log.info(`${SERVER_NAME} v${SERVER_VERSION} — all tools registered`);

  // ─── Connect Transport ───────────────────────────────────────────

  const transportType = process.env.ENGRAM_TRANSPORT || "stdio";

  if (transportType === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("Running on stdio transport. Ready.");
  } else {
    // Future: HTTP transport support
    log.warn(`Unknown transport: ${transportType}. Falling back to stdio.`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  // ─── Schedule background update check ───────────────────────────
  // Fire-and-forget — never blocks startup or any tool call.
  // Results are stored in the config repo and surfaced on the next engram_start_session.
  try {
    const { getServices } = await import("./database.js");
    getServices().update.scheduleCheck();
  } catch { /* update check is best-effort */ }
}

// ─── Run ──────────────────────────────────────────────────────────────

main().catch((error: Error) => {
  log.error("Fatal error", { message: error.message });
  process.exit(1);
});
