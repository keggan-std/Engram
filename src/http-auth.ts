// ============================================================================
// Engram Dashboard — Bearer Token Authentication Middleware
// ============================================================================
// Token is stored in .engram/token (chmod 600 on POSIX).
// If not found, a new 32-byte hex token is generated on first start.
// ============================================================================

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Request, Response, NextFunction } from "express";
import { DB_DIR_NAME } from "./constants.js";
import { log } from "./logger.js";

const TOKEN_FILE_NAME = "token";

export function getTokenFilePath(projectRoot: string): string {
  return path.join(projectRoot, DB_DIR_NAME, TOKEN_FILE_NAME);
}

/**
 * Read the persisted token or generate + persist a new one.
 */
export function ensureToken(projectRoot: string): string {
  const tokenPath = getTokenFilePath(projectRoot);

  if (fs.existsSync(tokenPath)) {
    try {
      const t = fs.readFileSync(tokenPath, "utf-8").trim();
      if (t && t.length >= 32) return t;
    } catch {
      /* fall through to regenerate */
    }
  }

  const token = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, token, { encoding: "utf-8", mode: 0o600 });

  log.info(`[Dashboard] New API token generated at ${tokenPath}`);
  return token;
}

/**
 * Constant-time string comparison.
 *
 * FR-D2 T6. The bearer check was `auth === \`Bearer ${token}\``, which returns
 * on the first differing byte and so leaks the length of the matching prefix
 * through timing. Over a loopback socket the signal is small but it is not zero,
 * and the token is a 32-byte hex secret that grants full read/write access to
 * every memory row — the one value in this product worth grinding for.
 *
 * timingSafeEqual throws on a length mismatch, which would reintroduce the leak
 * it exists to close. Both sides are hashed to a fixed 32 bytes first so the
 * comparison is always over equal lengths and reveals nothing about the
 * candidate's size.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Express middleware: validates Authorization: Bearer <token> header.
 */
export function bearerAuth(token: string) {
  const expected = `Bearer ${token}`;
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers["authorization"] ?? "";
    if (typeof auth === "string" && safeEqual(auth, expected)) {
      next();
      return;
    }
    res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Invalid or missing bearer token." });
  };
}

/**
 * Constant-time token comparison for callers outside Express — the WebSocket
 * upgrade handler in index.ts, which did its own `!==` check.
 */
export function tokenMatches(candidate: string | null | undefined, token: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  return safeEqual(candidate, token);
}

/** Hostnames this server will answer to. Names only — see below. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Is this `Host` header addressed to us by a loopback NAME?
 *
 * FR-D2 T6, the DNS-rebinding guard. It lives here, beside the token check,
 * because it has TWO call sites that share no middleware: the Express stack in
 * http-server.ts, and the raw `upgrade` handler in index.ts, which is attached
 * to the HTTP server itself and never passes through Express. Those two sites
 * are exactly the shape this project has now been bitten by four times — a rule
 * hand-copied with nothing able to find copy N+1 — so it gets one definition.
 *
 * THE PORT IS STRIPPED AND IGNORED. Rebinding turns on which NAME resolved to
 * this socket, never on the port, and pinning the port breaks every legitimate
 * caller reaching the server on one the factory was not told about.
 *
 * Matching is exact on the hostname, never `includes` or `endsWith`:
 * `localhost.attacker.com` and `127.0.0.1.attacker.com` are attacker-controlled
 * names that a substring test would wave through.
 */
export function isLocalHostHeader(hostHeader: string | string[] | undefined): boolean {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return false;
  const host = hostHeader.trim().toLowerCase();

  // Bracketed IPv6 literal, with or without a port: [::1] / [::1]:8787
  const v6 = /^(\[[0-9a-f:]+\])(?::\d+)?$/.exec(host);
  if (v6) return LOCAL_HOSTNAMES.has(v6[1]);

  // A bare IPv6 literal has more than one colon and carries no port.
  if ((host.match(/:/g)?.length ?? 0) > 1) return LOCAL_HOSTNAMES.has(host);

  const name = host.split(":")[0];
  return LOCAL_HOSTNAMES.has(name);
}
