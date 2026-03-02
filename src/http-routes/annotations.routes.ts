import { Router } from "express";
import { getDb } from "../database.js";
import { ok, notFound, serverError, noContent, badRequest, created } from "./api-helpers.js";
import { buildPage, parseLimit } from "../http-pagination.js";

export const annotationsRouter = Router();

const TABLE_EXISTS_QUERY =
  "SELECT name FROM sqlite_master WHERE type='table' AND name='annotations'";

// GET /api/v1/annotations?target_table=...&target_id=...
annotationsRouter.get("/", (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const db = getDb();
    if (!db.prepare(TABLE_EXISTS_QUERY).get()) return ok(res, [], { total: 0 });

    const { target_table, target_id } = req.query;
    let rows: unknown[];

    if (target_table && target_id) {
      rows = db
        .prepare("SELECT * FROM annotations WHERE target_table=? AND target_id=? ORDER BY id DESC LIMIT ?")
        .all(String(target_table), Number(target_id), limit + 1);
    } else {
      rows = db
        .prepare("SELECT * FROM annotations ORDER BY id DESC LIMIT ?")
        .all(limit + 1);
    }

    const page = buildPage(rows as unknown[], limit, undefined, "id");
    return ok(res, page.data, { hasMore: page.hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /api/v1/annotations
annotationsRouter.post("/", (req, res) => {
  try {
    const { target_table, target_id, note, author } = req.body;
    if (!target_table || !target_id || !note) {
      return badRequest(res, "target_table, target_id, and note are required");
    }
    const db = getDb();
    if (!db.prepare(TABLE_EXISTS_QUERY).get()) {
      return serverError(res, new Error("Annotations table not yet created — run migrations"));
    }
    const now = Math.floor(Date.now() / 1000);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO annotations (target_table, target_id, note, author, created_at) VALUES (?,?,?,?,?)")
      .run(String(target_table), Number(target_id), String(note), author ?? "dashboard", now);
    const inserted = db.prepare("SELECT * FROM annotations WHERE id=?").get(lastInsertRowid);
    return created(res, inserted);
  } catch (err) {
    return serverError(res, err);
  }
});

// DELETE /api/v1/annotations/:id
annotationsRouter.delete("/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return badRequest(res, "id must be numeric");
    const db = getDb();
    if (!db.prepare(TABLE_EXISTS_QUERY).get()) return noContent(res);
    const existing = db.prepare("SELECT id FROM annotations WHERE id=?").get(id);
    if (!existing) return notFound(res, `Annotation ${id} not found`);
    db.prepare("DELETE FROM annotations WHERE id=?").run(id);
    return noContent(res);
  } catch (err) {
    return serverError(res, err);
  }
});
