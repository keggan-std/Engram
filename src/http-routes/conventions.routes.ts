import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, noContent, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const conventionsRouter = Router();

// GET /api/v1/conventions
conventionsRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const repos = getRepos();
    const rows = repos.conventions.getActive(limit);
    const total = repos.conventions.countAll();
    const page = buildPage(rows, limit, total, "id");
    return ok(res, page.data, { total });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/conventions/:id
conventionsRouter.get("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    const rows = repos.conventions.getActive(1000);
    const item = rows.find(c => c.id === id);
    if (!item) return notFound(res, `Convention ${id} not found`);
    return ok(res, item);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/conventions
conventionsRouter.post("/", (req, res) => {
  try {
    const { rule, category } = req.body as Record<string, string>;
    if (!rule) return badRequest(res, "rule is required");
    const repos = getRepos();
    const ts = new Date().toISOString();
    const id = repos.conventions.create(null, ts, category ?? "general", rule, null);
    const rows = repos.conventions.getActive(1000);
    const item = rows.find(c => c.id === id);
    return created(res, item);
  } catch (err) {
    return serverError(res, err);
  }
});

// DELETE /api/v1/conventions/:id — toggle off
conventionsRouter.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    repos.conventions.toggle(id, false);
    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});
