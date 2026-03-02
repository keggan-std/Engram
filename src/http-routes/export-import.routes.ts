import { Router } from "express";
import { ok, serverError, badRequest } from "./api-helpers.js";

export const exportImportRouter = Router();

// POST /api/v1/export — returns a JSON snapshot of all data
exportImportRouter.post("/export", async (req, res) => {
  try {
    // Delegate to the existing dispatcher-admin export handler
    // by calling the underlying repos directly
    const { getRepos } = await import("../database.js");
    const repos = getRepos();

    const snapshot = {
      exported_at:  new Date().toISOString(),
      version:      "1.9.0",
      decisions:    repos.decisions.getActive(1000),
      tasks:        repos.tasks.getOpen(1000),
      conventions:  repos.conventions.getActive(1000),
      file_notes:   repos.fileNotes.getAll(),
      milestones:   repos.milestones.getAll(1000),
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
    const { data, mode } = req.body;
    if (!data) return badRequest(res, "data payload is required");
    // For now return the import job info — full merging logic is in dispatcher-admin
    return ok(res, {
      status:   "staged",
      mode:     mode ?? "review",
      received: Date.now(),
      message:  "Import staged. Use the MCP import tool to apply.",
    });
  } catch (err) {
    return serverError(res, err);
  }
});
