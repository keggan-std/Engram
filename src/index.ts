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
import { runInstaller } from "./installer.js";

// Tool registrations
import { registerSessionTools } from "./tools/sessions.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerMaintenanceTools } from "./tools/maintenance.js";
import { registerSchedulerTools } from "./tools/scheduler.js";

// ─── Initialize ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── Auto-Installer ───────────────────────────────────────────────────
  if (args.includes("install") || args.includes("--install") || args.includes("--list")) {
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

  registerSessionTools(server);      // start_session, end_session, get_session_history
  registerMemoryTools(server);       // record_change, record_decision, file_notes, conventions
  registerTaskTools(server);         // create_task, update_task, get_tasks
  registerIntelligenceTools(server); // scan_project, search, what_changed, dependency_map
  registerMaintenanceTools(server);  // stats, compact, milestones, export, import, clear
  registerSchedulerTools(server);    // schedule_event, get/update/acknowledge events, check_events

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
}

// ─── Run ──────────────────────────────────────────────────────────────

main().catch((error: Error) => {
  log.error("Fatal error", { message: error.message });
  process.exit(1);
});
