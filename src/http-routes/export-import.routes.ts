import { Router } from "express";
import { serverError, badRequest, notImplemented } from "./api-helpers.js";
import { SERVER_VERSION } from "../constants.js";

export const exportImportRouter = Router();

// POST /api/v1/export — returns a JSON snapshot of all data
exportImportRouter.post("/export", async (req, res) => {
  try {
    // Delegate to the existing dispatcher-admin export handler
    // by calling the underlying repos directly
    const { getRepos } = await import("../database.js");
    const repos = getRepos();

    // FR-D6 T2. This object was labelled "a JSON snapshot of all data" and
    // stamped version:"1.9.0" on a 1.12.0 server. It is not a snapshot: it
    // carries 5 of the 24 tables at schema V25 — omitting sessions, changes and
    // observations, which are the product — and each call is FILTERED
    // (getActive drops superseded decisions, getOpen drops completed tasks) and
    // CAPPED at 1000 rows with no signal when the cap bites. Served with
    // Content-Disposition: attachment, so a dashboard user experiences it as a
    // backup download. Nothing here is changed except the labelling: the payload
    // now says exactly what it is, and says when it truncated. Making it a real
    // export is task #50 and belongs to FR-D1, which owns "the data survives".
    const CAP = 1000;
    const decisions   = repos.decisions.getActive(CAP);
    const tasks       = repos.tasks.getOpen(CAP);
    const conventions = repos.conventions.getActive(CAP);
    const fileNotes   = repos.fileNotes.getAll();
    const milestones  = repos.milestones.getAll(CAP);
    const truncated = Object.entries({ decisions, tasks, conventions, milestones })
      .filter(([, rows]) => rows.length === CAP)
      .map(([name]) => name);

    const snapshot = {
      exported_at:  new Date().toISOString(),
      version:      SERVER_VERSION,
      partial:      true,
      contains:     ["decisions", "tasks", "conventions", "file_notes", "milestones"],
      omits:        ["sessions", "changes", "observations", "checkpoints", "handoffs", "agents", "audit_log", "and 12 further tables"],
      filters:      { decisions: "active only", tasks: "open only" },
      row_cap:      CAP,
      truncated,
      warning:      "PARTIAL EXPORT — not a backup. Use engram_admin(action:'backup') for a restorable copy.",
      decisions, tasks, conventions, file_notes: fileNotes, milestones,
    };

    res.setHeader("Content-Disposition", `attachment; filename="engram-export-${Date.now()}.json"`);
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(snapshot);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/import — accepts a JSON snapshot and stages it for review
exportImportRouter.post("/import", (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return badRequest(res, "data payload is required");
    // FR-D6 T2. This returned ok:true with status:"staged", mode, and
    // received:Date.now() — for a payload it parsed and threw away. Nothing was
    // written: no repo call, and no row in `import_jobs`, a table that EXISTS in
    // the V25 schema, so "staged" named a real mechanism the handler did not
    // use. The prose said "use the MCP import tool", but the dashboard branches
    // on `ok` (client.ts:59) and rendered a success. A 501 is the honest answer
    // and is cheaper than the feature; implementing staging is task #51.
    return notImplemented(
      res,
      "Import over HTTP is not implemented — nothing was written. Use engram_admin(action:'import', input_path) over MCP, which does apply the data.",
    );
  } catch (err) {
    return serverError(res, err);
  }
});
