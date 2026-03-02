import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, noContent, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const decisionsRouter = Router();

// GET /api/v1/decisions
decisionsRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const repos = getRepos();
    const rows = repos.decisions.getActive(limit);
    const total = repos.decisions.countAll();
    const page = buildPage(rows, limit, total, "id");
    return ok(res, page.data, { total, hasMore: page.hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/decisions/:id
decisionsRouter.get("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    const all = repos.decisions.getActive(1000);
    const decision = all.find(d => d.id === id);
    if (!decision) return notFound(res, `Decision ${id} not found`);
    return ok(res, decision);
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/decisions
decisionsRouter.post("/", (req, res) => {
  try {
    const { decision, rationale, tags, supersedes } = req.body as Record<string, unknown>;
    if (!decision || !rationale) return badRequest(res, "decision and rationale are required");
    const repos = getRepos();
    const ts = new Date().toISOString();
    const id = repos.decisions.create(null, ts, String(decision), String(rationale), null, Array.isArray(tags) ? tags as string[] : null, "active", supersedes ? Number(supersedes) : null, null);
    const all = repos.decisions.getActive(1000);
    const row = all.find(d => d.id === id);
    return created(res, row);
  } catch (err) {
    return serverError(res, err);
  }
});

// PUT /api/v1/decisions/:id
decisionsRouter.put("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const { status } = req.body as Record<string, string>;
    const repos = getRepos();
    if (status) repos.decisions.updateStatus(id, status);
    const all = repos.decisions.getActive(1000);
    const updated = all.find(d => d.id === id);
    return ok(res, updated ?? null);
  } catch (err) {
    return serverError(res, err);
  }
});

// DELETE /api/v1/decisions/:id
decisionsRouter.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    repos.decisions.updateStatus(id, "superseded");
    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});
