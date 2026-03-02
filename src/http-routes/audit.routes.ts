import { Router } from "express";
import { getDb } from "../database.js";
import { ok, serverError } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const auditRouter = Router();

// GET /api/v1/audit
auditRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const table = req.query.table as string | undefined;
    const db = getDb();

    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'")
      .get();

    if (!tableExists) return ok(res, [], { total: 0 });

    let rows: unknown[];
    if (table) {
      rows = db.prepare(
        "SELECT * FROM audit_log WHERE table_name = ? ORDER BY id DESC LIMIT ?"
      ).all(table, limit + 1);
    } else {
      rows = db.prepare(
        "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?"
      ).all(limit + 1);
    }

    const page = buildPage(rows as unknown[], limit, undefined, "id");
    return ok(res, page.data, { hasMore: page.hasMore, cursor: page.cursor });
  } catch (err) {
    return serverError(res, err);
  }
});
