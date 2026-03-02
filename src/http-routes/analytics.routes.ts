import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError } from "./api-helpers.js";

export const analyticsRouter = Router();

// GET /api/v1/analytics/summary
analyticsRouter.get("/summary", (_req, res) => {
  try {
    const repos = getRepos();

    const totalDecisions   = repos.decisions.countAll();
    const totalTasks       = repos.tasks.countAll();
    const byStatus         = repos.tasks.getByStatus();
    const doneTasks        = byStatus.find((s: { status: string; count: number }) => s.status === "done")?.count ?? 0;
    const totalConventions = repos.conventions.countAll();
    const totalFileNotes   = repos.fileNotes.countAll();
    const totalSessions    = repos.sessions.countAll();
    const recentChanges    = repos.changes.countAll();

    return ok(res, {
      decisions:   { total: totalDecisions },
      tasks:       { total: totalTasks, done: doneTasks, open: totalTasks - doneTasks, by_status: byStatus },
      conventions: { total: totalConventions },
      file_notes:  { total: totalFileNotes },
      sessions:    { total: totalSessions },
      changes:     { total: recentChanges },
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/analytics/activity — changes bucketed by day (last 30 days)
analyticsRouter.get("/activity", (_req, res) => {
  try {
    const repos = getRepos();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const changes = repos.changes.getSince(since);

    const buckets: Record<string, number> = {};
    for (const change of changes) {
      const ts = (change as any).timestamp as string | null;
      if (!ts) continue;
      const day = ts.slice(0, 10);
      buckets[day] = (buckets[day] ?? 0) + 1;
    }

    const series = Object.entries(buckets)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return ok(res, series);
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/analytics/session-stats
analyticsRouter.get("/session-stats", (_req, res) => {
  try {
    const repos = getRepos();
    const stats = repos.sessions.getDurationStats();
    return ok(res, stats);
  } catch (err) {
    return serverError(res, err);
  }
});
