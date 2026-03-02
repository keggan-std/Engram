// ============================================================================
// HTTP Auth Tests — bearerAuth middleware
// Uses a minimal in-process Express app (no listen) via supertest.
// No database interaction — pure middleware behaviour.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bearerAuth, ensureToken, getTokenFilePath } from "../../src/http-auth.js";

// ─── bearerAuth middleware ────────────────────────────────────────────────────

describe("bearerAuth", () => {
  const TOKEN = "testtoken1234567890abcdef1234567890ab";

  function makeApp() {
    const app = express();
    app.use(bearerAuth(TOKEN));
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("allows request with correct Bearer token", async () => {
    const res = await request(makeApp())
      .get("/ping")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects request with no Authorization header (401)", async () => {
    const res = await request(makeApp()).get("/ping");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("rejects request with wrong token (401)", async () => {
    const res = await request(makeApp())
      .get("/ping")
      .set("Authorization", "Bearer wrongtoken");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("rejects Basic auth instead of Bearer (401)", async () => {
    const res = await request(makeApp())
      .get("/ping")
      .set("Authorization", `Basic ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("rejects token without 'Bearer ' prefix (401)", async () => {
    const res = await request(makeApp())
      .get("/ping")
      .set("Authorization", TOKEN);
    expect(res.status).toBe(401);
  });

  it("rejects empty Authorization header (401)", async () => {
    const res = await request(makeApp())
      .get("/ping")
      .set("Authorization", "");
    expect(res.status).toBe(401);
  });

  it("response body has ok/error/message envelope on failure", async () => {
    const res = await request(makeApp()).get("/ping");
    expect(res.body).toMatchObject({
      ok: false,
      error: "UNAUTHORIZED",
      message: expect.any(String),
    });
  });
});

// ─── ensureToken ─────────────────────────────────────────────────────────────

describe("ensureToken", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a new token when none exists", () => {
    const token = ensureToken(tmpDir);
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64); // 32 bytes hex = 64 chars
  });

  it("persists the token to .engram/token file", () => {
    const token = ensureToken(tmpDir);
    const tokenPath = getTokenFilePath(tmpDir);
    expect(fs.existsSync(tokenPath)).toBe(true);
    expect(fs.readFileSync(tokenPath, "utf-8").trim()).toBe(token);
  });

  it("returns the same token on subsequent calls", () => {
    const token1 = ensureToken(tmpDir);
    const token2 = ensureToken(tmpDir);
    expect(token1).toBe(token2);
  });

  it("reads an existing token file", () => {
    const tokenPath = getTokenFilePath(tmpDir);
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "myexistingtoken123456789012345678", "utf-8");
    const token = ensureToken(tmpDir);
    expect(token).toBe("myexistingtoken123456789012345678");
  });

  it("generates new token if existing file has short content", () => {
    const tokenPath = getTokenFilePath(tmpDir);
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "short", "utf-8"); // too short
    const token = ensureToken(tmpDir);
    expect(token.length).toBe(64);
    expect(token).not.toBe("short");
  });

  it("getTokenFilePath includes .engram/token", () => {
    const p = getTokenFilePath("/some/project");
    expect(p).toContain(".engram");
    expect(p).toContain("token");
  });
});
