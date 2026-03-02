import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const changesRouter = Router();

// GET /api/v1/changes?since=ISO-timestamp&file=path
changesRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const since = (req.query.since as string) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const filePath = req.query.file as string | undefined;
    const repos = getRepos();
    let rows;
    if (filePath) {
      rows = repos.changes.getByFile(filePath, limit);
    } else {
      rows = repos.changes.getSince(since);
    }
    const page = buildPage(rows, limit, undefined, "id");
    return ok(res, page.data, { hasMore: page.hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});
