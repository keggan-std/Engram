import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, noContent, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const tasksRouter = Router();

// GET /api/v1/tasks
tasksRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const status = req.query.status as string | undefined;
    const repos = getRepos();
    const rows = status
      ? repos.tasks.getFiltered({ status, limit })
      : repos.tasks.getOpen(limit);
    const total = repos.tasks.countAll();
    const page = buildPage(rows, limit, total, "id");
    return ok(res, page.data, { total });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/tasks/:id
tasksRouter.get("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    const task = repos.tasks.getById(id);
    if (!task) return notFound(res, `Task ${id} not found`);
    return ok(res, task);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/tasks
tasksRouter.post("/", (req, res) => {
  try {
    const { title, description, priority, blocked_by } = req.body as Record<string, unknown>;
    if (!title) return badRequest(res, "title is required");
    const repos = getRepos();
    const ts = new Date().toISOString();
    const id = repos.tasks.create(null, ts, {
      title: String(title),
      description: description != null ? String(description) : null,
      priority: priority != null ? String(priority) : "medium",
      blocked_by: Array.isArray(blocked_by) ? blocked_by as number[] : null,
    });
    const task = repos.tasks.getById(id);
    return created(res, task);
  } catch (err) {
    return serverError(res, err);
  }
});

// PUT /api/v1/tasks/:id
tasksRouter.put("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const { status, description, priority } = req.body as Record<string, string>;
    const repos = getRepos();
    repos.tasks.update(id, new Date().toISOString(), { status, description, priority });
    const task = repos.tasks.getById(id);
    return ok(res, task ?? null);
  } catch (err) {
    return serverError(res, err);
  }
});

// DELETE /api/v1/tasks/:id
tasksRouter.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    repos.tasks.update(id, new Date().toISOString(), { status: "cancelled" });
    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});
