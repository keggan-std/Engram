import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const fileNotesRouter = Router();

// GET /api/v1/file-notes
fileNotesRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const filePath = req.query.file_path as string | undefined;
    const repos = getRepos();
    if (filePath) {
      const note = repos.fileNotes.getByPath(filePath);
      return ok(res, note ? [note] : [], { total: note ? 1 : 0 });
    }
    const rows = repos.fileNotes.getAll();
    const page = buildPage(rows, limit, rows.length, "file_path");
    return ok(res, page.data, { total: rows.length });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/file-notes/:path — lookup by URL-encoded file path
// Usage: GET /api/v1/file-notes/src%2Findex.ts
fileNotesRouter.get("/:path", (req, res) => {
  try {
    const filePath = decodeURIComponent(req.params.path);
    const repos = getRepos();
    const note = repos.fileNotes.getByPath(filePath);
    if (!note) return notFound(res, `FileNote for '${filePath}' not found`);
    return ok(res, note);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/file-notes — upsert file note
fileNotesRouter.post("/", (req, res) => {
  try {
    const { file_path, purpose, executive_summary, dependencies, notes, layer, complexity } = req.body as Record<string, unknown>;
    if (!file_path) return badRequest(res, "file_path is required");
    const repos = getRepos();
    const ts = new Date().toISOString();
    repos.fileNotes.upsert(String(file_path), ts, null, {
      purpose: purpose != null ? String(purpose) : null,
      executive_summary: executive_summary != null ? String(executive_summary) : null,
      dependencies: Array.isArray(dependencies) ? dependencies as string[] : null,
      notes: notes != null ? String(notes) : null,
      layer: layer != null ? String(layer) : null,
      complexity: complexity != null ? String(complexity) : null,
    });
    const note = repos.fileNotes.getByPath(String(file_path));
    return created(res, note);
  } catch (err) {
    return serverError(res, err);
  }
});
