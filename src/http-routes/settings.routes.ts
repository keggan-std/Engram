import { Router } from "express";
import { getDb, getRepos } from "../database.js";
import { ok, serverError, badRequest } from "./api-helpers.js";
import { CFG_HTTP_TOKEN, SECRET_CONFIG_KEYS, REDACTED_VALUE, configWriteRejection } from "../constants.js";
import { log } from "../logger.js";

export const settingsRouter = Router();

// AUDIT N2, second door: PUT /:key blocked only http_token, so sharing_mode,
// sharing_types, sensitive_keys, instance_id and machine_id were all writable
// over the API — the same escalation as the MCP `config` action, through a
// different entrance. Both now share one policy, defined in constants.ts.

/** Never return a secret's value over the API. */
function redact(key: string, value: string | null): string | null {
  if (value === null || value === "") return value;
  return SECRET_CONFIG_KEYS.has(key) ? REDACTED_VALUE : value;
}

function recordAudit(key: string, before: string | null, after: string): void {
  try {
    getDb().prepare(
      "INSERT INTO audit_log (created_at, action, actor, table_name, record_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      Date.now(), "config.set", "human", "config", null,
      JSON.stringify({ key, value: redact(key, before) }),
      JSON.stringify({ key, value: redact(key, after) })
    );
  } catch (e) { log.warn(`[Engram] audit_log write failed for config."${key}": ${e}`); }
}

// GET /api/v1/settings — retrieve all config entries (token omitted, secrets redacted)
settingsRouter.get("/", (_req, res) => {
  try {
    const repos = getRepos();
    const safe = Object.fromEntries(
      repos.config.getAll()
        .filter(e => e.key !== CFG_HTTP_TOKEN)
        .map(e => [e.key, redact(e.key, e.value)])
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
    return ok(res, { key, value: redact(key, value) });
  } catch (err) {
    return serverError(res, err);
  }
});

// PUT /api/v1/settings/:key
settingsRouter.put("/:key", (req, res) => {
  try {
    const { key } = req.params;
    const rejection = configWriteRejection(key);
    if (rejection) return badRequest(res, rejection);
    const { value } = req.body;
    if (value === undefined) return badRequest(res, "value is required");
    const repos = getRepos();
    const before = repos.config.get(key);
    repos.config.set(key, String(value), new Date().toISOString());
    recordAudit(key, before, String(value));
    return ok(res, { key, value: String(value) });
  } catch (err) {
    return serverError(res, err);
  }
});
