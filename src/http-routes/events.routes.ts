import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const eventsRouter = Router();

// GET /api/v1/events
eventsRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const status = req.query.status as string | undefined;
    const repos = getRepos();
    const rows = repos.events.getFiltered({ status, limit });
    const page = buildPage(rows, limit, rows.length, "id");
    return ok(res, page.data, { total: rows.length });
  } catch (err) {
    return serverError(res, err);
  }
});
