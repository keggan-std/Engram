// ============================================================================
// Engram Dashboard — API Client
// All API calls go through here. Token is managed by auth.store.ts.
// ============================================================================

import type { ApiOk } from "./types.js";

const BASE = "/api/v1";

let _token: string | null = null;

export function setToken(token: string) {
  _token = token;
}

export function getToken(): string | null {
  if (_token) return _token;
  // Fallback: read from URL on first load, then persist in sessionStorage
  const fromSession = sessionStorage.getItem("engram_token");
  if (fromSession) { _token = fromSession; return _token; }

  // FR-D2 T6. Prefer the URL FRAGMENT over the query string. A fragment is
  // never transmitted: it does not appear in the request line, so it cannot
  // reach the server's access log, and it is stripped from the Referer header
  // of every subresource request the page makes.
  //
  // The query form was scrubbed from the address bar below, which reads like a
  // fix and is not one — by the time this code runs the token has already been
  // sent to the server in the GET line and is already in the Referer of
  // anything the page loaded first. Portainer GHSA-jvp4-q659-95mj is the worked
  // example: JWTs harvested from ?token= via logs and Referer, and an injected
  // meta referrer tag forces full-URL leakage. This dashboard RENDERS MEMORY
  // CONTENT, so that injection primitive points straight at our own token.
  //
  // The query string is still ACCEPTED so a newer bundle keeps working against
  // an older server that only knows how to emit it.
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  const fromQuery = new URLSearchParams(window.location.search).get("token");
  const fromUrl = fromHash ?? fromQuery;

  if (fromUrl) {
    sessionStorage.setItem("engram_token", fromUrl);
    // Clear both carriers from the address bar so a copied link is inert.
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    url.hash = "";
    history.replaceState({}, "", url.toString());
    _token = fromUrl;
    return _token;
  }
  return null;
}

export class ApiResponseError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiResponseError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as unknown as T;

  const json = await res.json() as ApiOk<T> | { ok: false; error: string; message: string };

  if (!res.ok || !json.ok) {
    const err = json as { ok: false; error: string; message: string };
    throw new ApiResponseError(res.status, err.error ?? "UNKNOWN", err.message ?? "Request failed");
  }

  return (json as ApiOk<T>).data;
}

export const api = {
  get:    <T>(path: string)                => request<T>("GET",    path),
  post:   <T>(path: string, body: unknown) => request<T>("POST",   path, body),
  put:    <T>(path: string, body: unknown) => request<T>("PUT",    path, body),
  delete: <T>(path: string)               => request<T>("DELETE", path),

  // Convenience: GET with query string
  query: <T>(path: string, params: Record<string, string | number | undefined>) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return request<T>("GET", qs ? `${path}?${qs}` : path);
  },
};
