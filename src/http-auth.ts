// ============================================================================
// Engram Dashboard — Bearer Token Authentication Middleware
// ============================================================================
// Token is stored in .engram/token (chmod 600 on POSIX).
// If not found, a new 32-byte hex token is generated on first start.
// ============================================================================

import { randomBytes } from "crypto";
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
 * Express middleware: validates Authorization: Bearer <token> header.
 */
export function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${token}`) {
      next();
      return;
    }
    res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Invalid or missing bearer token." });
  };
}
