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
import { initDatabase, getProjectRoot, getServices } from "./database.js";
import { log } from "./logger.js";
import { findProjectRoot } from "./utils.js";
import { runInstaller } from "./installer/index.js";
import { ensureToken } from "./http-auth.js";
import { createHttpServer } from "./http-server.js";
import { broadcaster } from "./ws-broadcaster.js";

// ─── v1.6 Lean Surface — 4 dispatcher tools ──────────────────────────────────
import { registerSessionDispatcher } from "./tools/sessions.js";
import { registerMemoryDispatcher } from "./tools/dispatcher-memory.js";
import { registerAdminDispatcher } from "./tools/dispatcher-admin.js";
import { registerFindTool } from "./tools/find.js";

// ─── v1.7 Universal Mode — 1 tool ~80 token schema ──────────────────────────
import { registerUniversalMode } from "./modes/universal.js";

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
    await runInstaller(args);  // FLAW-12 FIX: runInstaller is async; was missing await
    return;
  }

  // ─── record-commit (git hook handler) ──────────────────────────────
  if (args.includes("record-commit")) {
    await runRecordCommit();
    return;
  }

  // ─── HTTP / Dashboard mode ─────────────────────────────────────────
  const isHttpMode =
    args.includes("--mode=http") ||
    args.includes("--mode=dashboard") ||
    process.env.ENGRAM_MODE === "http" ||
    process.env.ENGRAM_MODE === "dashboard";

  if (isHttpMode) {
    const projectRoot = findProjectRoot();
    const ideArg2 = args.find(a => a.startsWith("--ide="));
    const ideKey2 = ideArg2 ? ideArg2.slice("--ide=".length).trim() : undefined;
    initDatabase(projectRoot, ideKey2);

    const portArg = args.find(a => a.startsWith("--port="));
    const port = portArg ? Number(portArg.slice("--port=".length)) : 7432;

    // --open-port=N: open the browser on a different port (e.g. Vite dev server at 5173)
    const openPortArg = args.find(a => a.startsWith("--open-port="));
    const openPort = openPortArg ? Number(openPortArg.slice("--open-port=".length)) : port;

    const token = ensureToken(projectRoot);
    const { app } = createHttpServer({ port, token });

    // ── Phase 3: WebSocket live-update layer ─────────────────────────
    // Node's http.createServer wraps the Express app so we can intercept
    // the HTTP Upgrade handshake and attach a WebSocket server on /ws.
    const { createServer: createHttpNodeServer } = await import("node:http");
    const { WebSocketServer } = await import("ws");

    const httpServer = createHttpNodeServer(app);
    const wss = new WebSocketServer({ noServer: true });
    broadcaster.attach(wss);

    // ── Auto-shutdown on inactivity ───────────────────────────────────
    // Gracefully exits when the dashboard is closed and the server has been
    // idle (no WS clients, no HTTP requests) for IDLE_TIMEOUT_MS.
    const IDLE_TIMEOUT_MS  = 5 * 60 * 1000; // 5 min: hard idle cutoff
    const WS_GRACE_MS      = 2 * 60 * 1000; // 2 min: grace after last WS client leaves
    let lastActivityMs = Date.now();
    let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

    const resetActivity = () => { lastActivityMs = Date.now(); };

    const doShutdown = () => {
      log.info("[Dashboard] No active clients — shutting down.");
      wss.close();
      httpServer.close(() => process.exit(0));
      // Force-exit if graceful close stalls
      setTimeout(() => process.exit(0), 3000).unref();
    };

    const scheduleShutdown = (delay: number) => {
      if (shutdownTimer) clearTimeout(shutdownTimer);
      shutdownTimer = setTimeout(() => {
        shutdownTimer = null;
        // Final check: bail out if clients reconnected
        if (wss.clients.size > 0) return;
        const idle = Date.now() - lastActivityMs;
        if (idle >= IDLE_TIMEOUT_MS) {
          doShutdown();
        } else {
          // Not idle long enough yet — wait out the remainder
          scheduleShutdown(IDLE_TIMEOUT_MS - idle);
        }
      }, delay);
    };

    const cancelShutdown = () => {
      if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null; }
    };

    // Track HTTP activity (fires on every request, before any route handlers)
    httpServer.on("request", resetActivity);

    // Validate token + route upgrade to /ws only
    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      if (url.searchParams.get("token") !== token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    // Track WS activity; manage shutdown timer based on client presence
    wss.on("connection", (ws) => {
      resetActivity();
      cancelShutdown(); // dashboard is open — cancel any pending shutdown
      ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));

      ws.on("message", resetActivity);

      ws.on("close", () => {
        if (wss.clients.size === 0) {
          // Last client disconnected: wait WS_GRACE_MS, then begin idle check
          scheduleShutdown(WS_GRACE_MS);
        }
      });
    });

    httpServer.listen(port, "127.0.0.1", async () => {
      log.info(`Engram Dashboard API listening on http://127.0.0.1:${port}`);
      log.info(`WebSocket live-updates on ws://127.0.0.1:${port}/ws`);
      if (!args.includes("--no-open")) {
        const { default: open } = await import("open");
        open(`http://localhost:${openPort}?token=${token}`).catch(() => {});
      }
    });

    try { getServices().update.scheduleCheck(); } catch { /* best-effort */ }
    return; // keep process alive — app.listen holds the event loop
  }

  // Detect project root
  const projectRoot = findProjectRoot();
  log.info(`Project root: ${projectRoot}`);

  // --ide=<key>: global-only IDEs inject this so they open a per-IDE DB shard
  // (memory-{key}.db) instead of competing on the shared memory.db write lock.
  const ideArg = args.find(a => a.startsWith("--ide="));
  const ideKey = ideArg ? ideArg.slice("--ide=".length).trim() : undefined;

  // Initialize database (synchronous — better-sqlite3 is sync throughout)
  // FLAW-5 FIX: initDatabase is no longer async; no await needed
  initDatabase(projectRoot, ideKey);
  const dbLabel = ideKey ? `memory-${ideKey}.db` : "memory.db";
  log.info(`Database initialized at ${projectRoot}/.engram/${dbLabel}`);

  // Create MCP server
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ─── Register Tools (mode-dependent) ──────────────────────────────────

  const isUniversalMode = args.includes("--mode=universal") || process.env.ENGRAM_MODE === "universal";

  if (isUniversalMode) {
    // Universal mode: 1 "engram" tool, ~80 schema tokens. All agents.
    registerUniversalMode(server);
    log.info(`${SERVER_NAME} v${SERVER_VERSION} — universal mode (1 tool, ~80 schema tokens)`);
  } else {
    // Standard mode: 4 dispatcher tools, ~1,600 schema tokens.
    registerSessionDispatcher(server);  // engram_session: start, end, get_history, handoff
    registerMemoryDispatcher(server);   // engram_memory: all memory operations via action enum
    registerAdminDispatcher(server);    // engram_admin: backup, restore, stats, health, config, scan
    registerFindTool(server);           // engram_find: catalog keyword search
    log.info(`${SERVER_NAME} v${SERVER_VERSION} — standard mode (4 tools, ~1,600 schema tokens)`);
  }

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
    getServices().update.scheduleCheck();
  } catch { /* update check is best-effort */ }

  // ─── Graceful shutdown ─────────────────────────────────────────────
  // Mark this instance as stopped in the registry so other instances
  // don't see a dead PID with "active" status.
  const shutdownHandler = (): void => {
    try {
      getServices().crossInstance.closeAll();
      getServices().registry.shutdown();
    } catch { /* best-effort */ }
  };
  process.on("SIGINT", () => { shutdownHandler(); process.exit(0); });
  process.on("SIGTERM", () => { shutdownHandler(); process.exit(0); });
  process.on("beforeExit", shutdownHandler);
}

// ─── Run ──────────────────────────────────────────────────────────────

main().catch((error: Error) => {
  log.error("Fatal error", { message: error.message });
  process.exit(1);
});
