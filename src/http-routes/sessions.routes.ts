import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, notFound, serverError, noContent, badRequest } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const sessionsRouter = Router();

// GET /api/v1/sessions
sessionsRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const agentName = req.query.agent as string | undefined;
    const repos = getRepos();
    const rows = repos.sessions.getHistory(limit + 1, offset, agentName);
    const page = buildPage(rows, limit, undefined, "id");
    return ok(res, page.data, { hasMore: page.hasMore, cursor: page.cursor, offset });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/sessions/:id
sessionsRouter.get("/:id", (req, res) => {
  try {
    const repos = getRepos();
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const session = repos.sessions.getById(id);
    if (!session) return notFound(res, `Session ${id} not found`);
    return ok(res, session);
  } catch (err) {
    return serverError(res, err);
  }
});

// DELETE /api/v1/sessions/:id — mark session auto-closed
sessionsRouter.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const repos = getRepos();
    repos.sessions.autoClose(id, new Date().toISOString());
    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});
