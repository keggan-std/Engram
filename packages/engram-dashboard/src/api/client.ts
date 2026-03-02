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
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    sessionStorage.setItem("engram_token", fromUrl);
    // Remove token from URL bar without reload
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
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
