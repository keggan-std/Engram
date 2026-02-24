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
import { registerKnowledgeTools } from "./tools/knowledge.js";

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
    args.includes("-v")
  ) {
    runInstaller(args);
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
  registerKnowledgeTools(server);     // get_global_knowledge

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
