// ============================================================================
// FR-D2 T6 — DNS rebinding, constant-time token compare, token out of the URL
//
// WHY A HOST CHECK WHEN CORS IS ALREADY CONFIGURED. In a DNS rebinding attack
// the browser believes it is talking to the attacker's own origin, so the
// request is SAME-ORIGIN: no Origin header is sent and the CORS middleware has
// nothing to reject. The Host header still carries the attacker's hostname,
// because that is the name that was resolved. Host is the only thing that sees
// the attack, which is why these tests send NO Origin — a test that set one
// would be exercising CORS and quietly proving nothing about rebinding.
//
// CALIBRATION, kept here so nobody later escalates it: /api is already behind a
// bearer header and /ws behind a token, so what rebinding actually reached was
// /health and a static asset bundle. This is defence in depth at its true size,
// not a patch for an RCE we had. Both MCP CVEs that motivated it
// (CVE-2025-49596, CVE-2025-66416/66414) required an UNAUTHENTICATED server.
// ============================================================================

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { bearerAuth, tokenMatches, isLocalHostHeader } from "../../src/http-auth.js";

const TOKEN = "testtoken1234567890abcdef1234567890ab";

// ─── The Host allow-list ─────────────────────────────────────────────
//
// Mounts the REAL predicate, isLocalHostHeader, in a bare app. Only the mount
// is reproduced, never the rule — createHttpServer() needs a live database and
// this behaviour is deliberately upstream of everything including the DB. The
// parity tests at the bottom assert the shipped server still installs it.

function makeGuardedApp() {
  const app = express();
  app.use((req, res, next) => {
    if (isLocalHostHeader(req.headers.host)) return next();
    res.status(403).json({ ok: false, error: "FORBIDDEN_HOST" });
  });
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", bearerAuth(TOKEN));
  app.get("/api/thing", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("Host allow-list", () => {
  it("refuses a foreign Host with no Origin — the rebinding shape", async () => {
    const res = await request(makeGuardedApp()).get("/health").set("Host", "attacker.example.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN_HOST");
  });

  it("refuses a foreign Host that merely CONTAINS an allowed name", async () => {
    for (const host of ["localhost.attacker.com", "attacker.com:4100", "127.0.0.1.attacker.com", "notlocalhost"]) {
      const res = await request(makeGuardedApp()).get("/health").set("Host", host);
      expect(res.status, `${host} should be refused`).toBe(403);
    }
  });

  it("guards /health, which sits above the auth guard on purpose", async () => {
    // The unauthenticated endpoint is precisely what rebinding could reach.
    const res = await request(makeGuardedApp()).get("/health").set("Host", "evil.test");
    expect(res.status).toBe(403);
  });

  it("runs BEFORE auth, so a foreign host gets 403 and not 401", async () => {
    // Ordering matters: 401 would tell an attacker the host was accepted and
    // only the token was missing.
    const res = await request(makeGuardedApp()).get("/api/thing").set("Host", "evil.test");
    expect(res.status).toBe(403);
  });

  it("KILL SWITCH — every legitimate local form still passes", async () => {
    for (const host of ["localhost:4100", "127.0.0.1:4100", "localhost", "127.0.0.1", "[::1]:4100", "LOCALHOST:4100"]) {
      const res = await request(makeGuardedApp()).get("/health").set("Host", host);
      expect(res.status, `${host} should be allowed`).toBe(200);
    }
  });

  it("KILL SWITCH — any port is accepted, because the port defends nothing", () => {
    // Pinning the port broke 40 existing tests: supertest binds an ephemeral
    // one, so the Host it sends never matches the port the factory was told
    // about. Rebinding turns on the NAME, never the port.
    for (const port of ["", ":1", ":7432", ":54321", ":65535"]) {
      expect(isLocalHostHeader(`127.0.0.1${port}`), `127.0.0.1${port}`).toBe(true);
      expect(isLocalHostHeader(`localhost${port}`), `localhost${port}`).toBe(true);
    }
  });

  it("matches the hostname exactly — never a substring", () => {
    // `endsWith` or `includes` would wave through every one of these, and they
    // are all names an attacker can register and point at 127.0.0.1.
    for (const host of [
      "localhost.attacker.com", "attacker.com", "127.0.0.1.attacker.com",
      "xlocalhost", "localhostx", "sub.localhost", "127.0.0.10",
      "attacker.com#localhost", "attacker.com/localhost",
    ]) {
      expect(isLocalHostHeader(host), `${host} must be refused`).toBe(false);
    }
    expect(isLocalHostHeader(undefined)).toBe(false);
    expect(isLocalHostHeader("")).toBe(false);
  });
});

// ─── Constant-time comparison ────────────────────────────────────────

describe("token comparison", () => {
  it("KILL SWITCH — the correct token is still accepted", async () => {
    const app = express();
    app.use(bearerAuth(TOKEN));
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/ping").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token, a missing header and a bare token", async () => {
    const app = express();
    app.use(bearerAuth(TOKEN));
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    // NOT included: `Bearer <token> ` with a trailing space. HTTP strips
    // leading and trailing whitespace from field values (RFC 9110 §5.5) before
    // the value ever reaches this middleware, so that string is the same header
    // as the valid one and authenticating is correct. Asserted below rather
    // than left as a gap, because it looks like a bypass and is not one.
    for (const header of [undefined, "", "Bearer wrong", TOKEN, `bearer ${TOKEN}`, `Bearer  ${TOKEN}`]) {
      const req_ = request(app).get("/ping");
      if (header !== undefined) req_.set("Authorization", header);
      const res = await req_;
      expect(res.status, `${JSON.stringify(header)} must not authenticate`).toBe(401);
    }
  });

  it("trailing whitespace is stripped by HTTP itself, not by us", async () => {
    const app = express();
    app.use(bearerAuth(TOKEN));
    app.get("/ping", (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/ping").set("Authorization", `Bearer ${TOKEN} `);
    expect(res.status).toBe(200);
  });

  it("tokenMatches accepts the right token and refuses everything else", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    for (const bad of [null, undefined, "", "wrong", TOKEN + "x", TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
      expect(tokenMatches(bad, TOKEN), `${JSON.stringify(bad)} must not match`).toBe(false);
    }
  });

  it("compares candidates of any length without throwing", () => {
    // timingSafeEqual throws on a length mismatch, which is why both sides are
    // hashed to a fixed width first. A throw here would be a 500, and a 500 that
    // only happens on wrong-length input is itself an oracle.
    for (const len of [0, 1, 10, 35, 36, 37, 1000, 100_000]) {
      expect(() => tokenMatches("x".repeat(len), TOKEN)).not.toThrow();
    }
  });

  it("does not short-circuit on a shared prefix", () => {
    // Behavioural proxy for constant time: a candidate sharing all but the last
    // character is refused exactly like one sharing nothing. Timing itself is
    // not asserted — a wall-clock assertion would be flaky on CI and would fail
    // for reasons unrelated to the code.
    expect(tokenMatches(TOKEN.slice(0, -1) + "z", TOKEN)).toBe(false);
    expect(tokenMatches("z".repeat(TOKEN.length), TOKEN)).toBe(false);
  });
});

// ─── Derived parity with the real server ─────────────────────────────

describe("the shipped server carries these guards", () => {
  it("http-server.ts installs a Host allow-list before CORS and before /health", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/http-server.ts", "utf-8");

    const hostIdx = src.indexOf("FORBIDDEN_HOST");
    const corsIdx = src.indexOf("app.use(cors(");
    const healthIdx = src.indexOf('app.get("/health"');

    expect(hostIdx, "no Host allow-list in http-server.ts").toBeGreaterThan(-1);
    expect(hostIdx, "Host check must precede CORS").toBeLessThan(corsIdx);
    expect(hostIdx, "Host check must precede /health").toBeLessThan(healthIdx);
  });

  it("the WS upgrade path checks Host and uses the constant-time compare", async () => {
    // This handler is attached to the raw server and never passes through
    // Express, so it does not inherit the middleware above. It has to repeat
    // the check, and this asserts it still does.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/index.ts", "utf-8");
    const upgrade = src.slice(src.indexOf('httpServer.on("upgrade"'), src.indexOf('wss.on("connection"'));

    expect(upgrade).toMatch(/headers\.host/);
    expect(upgrade).toMatch(/tokenMatches\(/);
    expect(upgrade, "raw !== comparison reintroduces the timing leak").not.toMatch(/searchParams\.get\("token"\)\s*!==/);
  });

  it("the browser is opened with the token in the fragment, not the query", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/index.ts", "utf-8");
    expect(src, "token in the query string reaches the access log and Referer")
      .not.toMatch(/open\(`http:\/\/localhost:\$\{openPort\}\?token=/);
    expect(src).toMatch(/open\(`http:\/\/localhost:\$\{openPort\}#token=/);
  });
});
