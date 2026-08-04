// ============================================================================
// Shared HTTP API response helpers
// All route files import from here for consistent envelope shape.
// ============================================================================

import type { Response } from "express";

export interface ApiOk<T = unknown> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
}

export type ApiResponse<T = unknown> = ApiOk<T> | ApiError;

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json({ ok: true, data, ...(meta ? { meta } : {}) } satisfies ApiOk<T>);
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, undefined, 201);
}

export function notFound(res: Response, message = "Not found") {
  return res.status(404).json({ ok: false, error: "NOT_FOUND", message } satisfies ApiError);
}

export function badRequest(res: Response, message: string) {
  return res.status(400).json({ ok: false, error: "BAD_REQUEST", message } satisfies ApiError);
}

export function serverError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ ok: false, error: "SERVER_ERROR", message } satisfies ApiError);
}

export function noContent(res: Response) {
  return res.status(204).end();
}

/**
 * FR-D6: for a route that is mounted and routable but does no work.
 *
 * The alternative this replaces is the one that shipped: returning `ok:true`
 * with a state noun ("staged") for a payload that was parsed and discarded.
 * Every consumer of this API branches on `ok` — packages/engram-dashboard does
 * it at client.ts:59 — so a truthful `ok:false` is the only value that reaches
 * a user as the truth. 501 rather than 500 because nothing went wrong: the
 * feature is absent, which is a fact about the server, not an incident.
 */
export function notImplemented(res: Response, message: string) {
  return res.status(501).json({ ok: false, error: "NOT_IMPLEMENTED", message } satisfies ApiError);
}
