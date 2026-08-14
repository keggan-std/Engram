// ============================================================================
// Engram Dashboard — Express HTTP Server Factory
// ============================================================================
// Starts alongside the MCP stdio server when --mode=http is passed.
// Binds ONLY to 127.0.0.1 — never 0.0.0.0.
// ============================================================================

import express from "express";
import cors from "cors";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import type { WebSocketServer } from "ws";
import { bearerAuth, isLocalHostHeader } from "./http-auth.js";
import { broadcaster } from "./ws-broadcaster.js";
import { getDb } from "./database.js";
import { SERVER_VERSION } from "./constants.js";
import { log } from "./logger.js";

// ─── Route imports ────────────────────────────────────────────────────────────
import { sessionsRouter } from "./http-routes/sessions.routes.js";
import { decisionsRouter } from "./http-routes/decisions.routes.js";
import { fileNotesRouter } from "./http-routes/file-notes.routes.js";
import { tasksRouter } from "./http-routes/tasks.routes.js";
import { conventionsRouter } from "./http-routes/conventions.routes.js";
import { changesRouter } from "./http-routes/changes.routes.js";
import { milestonesRouter } from "./http-routes/milestones.routes.js";
import { eventsRouter } from "./http-routes/events.routes.js";
import { instancesRouter } from "./http-routes/instances.routes.js";
import { analyticsRouter } from "./http-routes/analytics.routes.js";
import { settingsRouter } from "./http-routes/settings.routes.js";
import { sensitiveRouter } from "./http-routes/sensitive.routes.js";
import { searchRouter } from "./http-routes/search.routes.js";
import { exportImportRouter } from "./http-routes/export-import.routes.js";
import { auditRouter } from "./http-routes/audit.routes.js";
import { annotationsRouter } from "./http-routes/annotations.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HttpServerOptions {
  port: number;
  token: string;
  wss?: WebSocketServer;
  /** Injectable broadcaster — used in tests to avoid ESM singleton isolation issues. */
  broadcaster?: { broadcast: (event: import("./ws-broadcaster.js").WsEvent) => void };
}

export function createHttpServer(options: HttpServerOptions) {
  const { port, token } = options;
  // Allow tests to inject a mock broadcaster; fall back to the module singleton.
  const bc = options.broadcaster ?? broadcaster;

  const app = express();

  // ─── Host allow-list: DNS rebinding (FR-D2 T6) ────────────────────
  //
  // MUST come before CORS, the JSON body parser and every route, including
  // /health and the static bundle — those are exactly what a rebinding attack
  // reaches, since everything under /api is already behind the bearer token.
  //
  // CORS DOES NOT COVER THIS, which is why the block below is not redundant
  // with the cors() call underneath it. In a DNS rebinding attack the browser
  // believes it is talking to the attacker's origin and is therefore making a
  // SAME-ORIGIN request: it sends no Origin header, and the CORS middleware has
  // nothing to reject. What identifies the attack is the Host header, which
  // still carries the attacker's hostname because that is what was resolved.
  // Checking Host is the only thing that sees it.
  //
  // "It only binds to loopback" has now failed three times inside MCP itself:
  // CVE-2025-49596 (MCP Inspector, CVSS 9.4, RCE via DNS rebinding) and
  // CVE-2025-66416/66414, where Anthropic's own Python and TypeScript SDKs
  // shipped DNS-rebinding protection OFF BY DEFAULT (CVSS 7.6, fixed in 1.23.0).
  //
  // CALIBRATED, and the calibration is load-bearing: both MCP CVEs required an
  // UNAUTHENTICATED localhost server. Ours authenticates /api by bearer header
  // and /ws by token, so what rebinding actually reached here was /health and a
  // static asset bundle. Real, small, and stated at its true size — this is a
  // few lines of defence in depth, not a patch for an RCE we had.
  // Only the HOSTNAME is checked; the port is stripped and ignored. The port
  // defends against nothing here — rebinding turns on which NAME resolved to
  // this socket — and pinning it breaks every legitimate caller that reaches
  // the server on a port this factory was not told about, which includes
  // supertest's ephemeral binding and any future dynamic-port path.
  app.use((req, res, next) => {
    if (isLocalHostHeader(req.headers.host)) return next();
    log.warn(`[Dashboard] Refused request with foreign Host header: ${JSON.stringify(req.headers.host)}`);
    res.status(403).json({
      ok: false,
      error: "FORBIDDEN_HOST",
      message: "This server accepts requests addressed to localhost only.",
    });
  });

  // ─── CORS: allow localhost only ───────────────────────────────────
  app.use(cors({
    origin: [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      "http://localhost:5173",   // Vite dev server
      "http://127.0.0.1:5173",
    ],
    credentials: true,
  }));

  app.use(express.json({ limit: "10mb" }));

  // ─── Attach request metadata ───────────────────────────────────────
  app.use((req, _res, next) => {
    (req as any)._startMs = Date.now();
    (req as any)._reqId = Math.random().toString(36).slice(2, 10);
    next();
  });

  // ─── Health (no auth) ─────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    // FR-D6: this returned `{ok:true, version:"1.9.0", database:"connected"}` —
    // three literals and zero checks. It reported "connected" with the database
    // closed, and stamped 1.9.0 on a 1.12.0 server for three minor versions.
    // A health endpoint that cannot fail proves only that Express is listening,
    // which is the one thing anyone calling it already knows.
    try {
      const db = getDb();
      db.prepare("SELECT 1").get();
      res.json({ ok: true, version: SERVER_VERSION, database: "connected" });
    } catch (e) {
      res.status(503).json({
        ok: false,
        version: SERVER_VERSION,
        database: "unavailable",
        error: "DATABASE_UNAVAILABLE",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // ─── Auth guard on all /api routes ────────────────────────────────
  app.use("/api", bearerAuth(token));

  // ─── WS mutation broadcaster ───────────────────────────────────────
  // After any successful mutating request, broadcast a "mutated" event
  // so connected dashboard clients can invalidate their query cache.
  app.use((req, res, next) => {
    res.on("finish", () => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const match = req.originalUrl.match(/^\/api\/v1\/([^/?#]+)/);
      if (!match) return;
      bc.broadcast({
        type: "mutated",
        resource: match[1],
        method: req.method,
        ts: Date.now(),
      });
    });
    next();
  });

  // ─── API v1 routes ────────────────────────────────────────────────
  const v1 = express.Router();
  v1.use("/sessions",    sessionsRouter);
  v1.use("/decisions",   decisionsRouter);
  v1.use("/file-notes",  fileNotesRouter);
  v1.use("/tasks",       tasksRouter);
  v1.use("/conventions", conventionsRouter);
  v1.use("/changes",     changesRouter);
  v1.use("/milestones",  milestonesRouter);
  v1.use("/events",      eventsRouter);
  v1.use("/instances",   instancesRouter);
  v1.use("/analytics",   analyticsRouter);
  v1.use("/settings",    settingsRouter);
  v1.use("/sensitive",   sensitiveRouter);
  v1.use("/search",      searchRouter);
  v1.use("/export",      exportImportRouter);
  v1.use("/import",      exportImportRouter);
  v1.use("/audit",       auditRouter);
  v1.use("/annotations", annotationsRouter);

  app.use("/api/v1", v1);

  // ─── Serve built dashboard SPA ───────────────────────────────────
  const dashboardDist = path.resolve(__dirname, "../packages/engram-dashboard/dist");
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    // SPA fallback — all unknown GET routes serve index.html
    app.get("/{*path}", (_req, res) => {
      const indexPath = path.join(dashboardDist, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Dashboard not built. Run: npm run build:dashboard");
      }
    });
  } else {
    app.get("/", (_req, res) => {
      res.send(`
        <h2>Engram Dashboard</h2>
        <p>Backend API is running at <code>/api/v1/</code></p>
        <p>To build the dashboard UI: <code>npm run build:dashboard</code></p>
        <p>Then restart with <code>engram --mode=http</code></p>
      `);
    });
  }

  return { app };
}
