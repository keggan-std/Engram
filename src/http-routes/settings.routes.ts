import { Router } from "express";
import { getRepos } from "../database.js";
import { ok, serverError, badRequest } from "./api-helpers.js";
import { CFG_HTTP_TOKEN } from "../constants.js";

export const settingsRouter = Router();

// GET /api/v1/settings — retrieve all config entries (excluding token)
settingsRouter.get("/", (_req, res) => {
  try {
    const repos = getRepos();
    const allEntries = repos.config.getAll();
    const all = Object.fromEntries(allEntries.map(e => [e.key, e.value]));
    // Never expose the raw token over the API
    const safe = Object.fromEntries(
      Object.entries(all).filter(([k]) => k !== CFG_HTTP_TOKEN)
    ) as Record<string, string>;
    return ok(res, safe);
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /api/v1/settings/:key
settingsRouter.get("/:key", (req, res) => {
  try {
    const { key } = req.params;
    if (key === CFG_HTTP_TOKEN) return badRequest(res, "Access denied");
    const repos = getRepos();
    const value = repos.config.get(key);
    return ok(res, { key, value: value ?? null });
  } catch (err) {
    return serverError(res, err);
  }
});

// PUT /api/v1/settings/:key
settingsRouter.put("/:key", (req, res) => {
  try {
    const { key } = req.params;
    if (key === CFG_HTTP_TOKEN) return badRequest(res, "Access denied");
    const { value } = req.body;
    if (value === undefined) return badRequest(res, "value is required");
    const repos = getRepos();
    repos.config.set(key, String(value), new Date().toISOString());
    return ok(res, { key, value: String(value) });
  } catch (err) {
    return serverError(res, err);
  }
});
