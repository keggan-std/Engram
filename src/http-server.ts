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
import { bearerAuth } from "./http-auth.js";

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
}

export function createHttpServer(options: HttpServerOptions) {
  const { port, token } = options;

  const app = express();

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
    res.json({ ok: true, version: "1.9.0", database: "connected" });
  });

  // ─── Auth guard on all /api routes ────────────────────────────────
  app.use("/api", bearerAuth(token));

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
