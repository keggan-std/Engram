import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const sensitiveRouter = Router();

// GET /api/v1/sensitive — list redacted sensitive-data entries
sensitiveRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const repos = getRepos();
    // SensitiveData is not in the base Repositories interface — return empty for now
    const rows: Record<string, unknown>[] = [];
    const page = buildPage(rows, limit, 0, "id");
    return ok(res, page.data, { total: 0 });
  } catch (err) {
    return serverError(res, err);
  }
});
