import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError, badRequest } from "./api-helpers.js";

export const searchRouter = Router();

// GET /api/v1/search?q=...&scope=decisions,tasks,file_notes,conventions
searchRouter.get("/", (req, res) => {
  try {
    const q = (req.query.q as string ?? "").trim();
    if (!q) return badRequest(res, "q is required");

    const scopeParam = (req.query.scope as string) ?? "decisions,tasks,file_notes,conventions";
    const scopes = new Set(scopeParam.split(",").map(s => s.trim()));

    const repos = getRepos();
    const results: Record<string, unknown[]> = {};

    if (scopes.has("decisions")) {
      const all = repos.decisions.getActive(1000);
      results.decisions = all.filter(d =>
        String((d as any).decision ?? "").toLowerCase().includes(q.toLowerCase()) ||
        String((d as any).rationale ?? "").toLowerCase().includes(q.toLowerCase())
      );
    }

    if (scopes.has("tasks")) {
      const all = repos.tasks.getOpen(1000);
      results.tasks = all.filter(t =>
        String((t as any).title ?? "").toLowerCase().includes(q.toLowerCase()) ||
        String((t as any).description ?? "").toLowerCase().includes(q.toLowerCase())
      );
    }

    if (scopes.has("file_notes")) {
      const all = repos.fileNotes.getAll();
      results.file_notes = all.filter(n =>
        String((n as any).file_path ?? "").toLowerCase().includes(q.toLowerCase()) ||
        String((n as any).executive_summary ?? "").toLowerCase().includes(q.toLowerCase())
      );
    }

    if (scopes.has("conventions")) {
      const all = repos.conventions.getActive(1000);
      results.conventions = all.filter(c =>
        String((c as any).rule ?? "").toLowerCase().includes(q.toLowerCase())
      );
    }

    const total = Object.values(results).reduce((a, b) => a + b.length, 0);
    return ok(res, results, { query: q, total });
  } catch (err) {
    return serverError(res, err);
  }
});
