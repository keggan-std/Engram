import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const milestonesRouter = Router();

// GET /api/v1/milestones
milestonesRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const repos = getRepos();
    const rows = repos.milestones.getAll(limit);
    const total = repos.milestones.countAll();
    const page = buildPage(rows, limit, total, "id");
    return ok(res, page.data, { total });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/milestones/:id
milestonesRouter.get("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    const rows = repos.milestones.getAll(1000);
    const item = rows.find(m => m.id === id);
    if (!item) return notFound(res, `Milestone ${id} not found`);
    return ok(res, item);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/milestones
milestonesRouter.post("/", (req, res) => {
  try {
    const { title, description, version, tags } = req.body as Record<string, unknown>;
    if (!title) return badRequest(res, "title is required");
    const repos = getRepos();
    const ts = new Date().toISOString();
    const id = repos.milestones.create(null, ts, String(title), description != null ? String(description) : null, version != null ? String(version) : null, Array.isArray(tags) ? tags as string[] : null);
    const rows = repos.milestones.getAll(1000);
    const item = rows.find(m => m.id === id);
    return created(res, item);
  } catch (err) {
    return serverError(res, err);
  }
});
