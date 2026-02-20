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
import { findProjectRoot } from "./utils.js";

// Tool registrations
import { registerSessionTools } from "./tools/sessions.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerMaintenanceTools } from "./tools/maintenance.js";

// ─── Initialize ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Detect project root
  const projectRoot = findProjectRoot();
  console.error(`[Engram] Project root: ${projectRoot}`);

  // Initialize database
  initDatabase(projectRoot);
  console.error(`[Engram] Database initialized at ${projectRoot}/.engram/memory.db`);

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

  console.error(`[Engram] ${SERVER_NAME} v${SERVER_VERSION} — all tools registered`);

  // ─── Connect Transport ───────────────────────────────────────────

  const transportType = process.env.ENGRAM_TRANSPORT || "stdio";

  if (transportType === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[Engram] Running on stdio transport. Ready.");
  } else {
    // Future: HTTP transport support
    console.error(`[Engram] Unknown transport: ${transportType}. Falling back to stdio.`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────

main().catch((error: Error) => {
  console.error("[Engram] Fatal error:", error.message);
  process.exit(1);
});
