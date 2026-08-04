#!/usr/bin/env node
// ============================================================================
// HTTP surface generator  —  Foundations Review FR-0f item 4
//
//   node scripts/generate-http-surface.mjs           # write the file
//   node scripts/generate-http-surface.mjs --check   # exit 1 on drift
//
// Emits docs/HTTP-SURFACE.md: every route the dashboard API actually
// registers, the response envelope every route returns, and which of the
// packages/* consumers depend on what.
//
// WHY THIS EXISTS
// ---------------
// docs/CAPABILITY-SURFACE.md covers the MCP tool contract and a CI gate makes
// a changed action block the merge. The HTTP API had no equivalent.
//
// So if FR-D6 makes the response envelope uniform — which is on its list,
// because the MCP side currently returns plain text for errors and JSON for
// success — the dashboard breaks and NOTHING REPORTS IT. That is the exact
// shape of the ten silent-drop incidents this project was started over. The
// charter requires this closed BEFORE D6, not with it.
//
// IT ALSO NARROWS THE BLAST RADIUS, which is the more useful result. Charter
// §11b.1 says "the dashboard, both thin clients and 14 IDE integrations are
// consumers". Measured, that conflates two contracts: BOTH thin clients have
// zero /api/v1 references, zero fetch/http references, and import MCP stdio
// transport. They consume the MCP surface, which CAPABILITY-SURFACE.md already
// gates. Only packages/engram-dashboard consumes HTTP.
//
// HOW THE CAPTURE WORKS, AND WHY NOT A REGEX
// ------------------------------------------
// Express 5 does not expose mount prefixes: a mounted layer's `path` is
// undefined and its `matchers` are opaque closures, so the tree cannot be
// recovered by walking a built app. But `layer.handle === subRouter` holds, and
// both `express.application.use` and the `express.Router` factory are
// patchable. So this patches `use` to record (prefix, handle) pairs BEFORE
// importing the server, builds the real app, and reconstructs the tree by
// identity. Same principle as generate-capability-surface.mjs: capture what the
// code actually registers, never what a regex thinks it registers.
//
// Runs against dist/, so `npm run build` first.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "HTTP-SURFACE.md");
const CHECK = process.argv.includes("--check");

const dist = path.join(root, "dist", "http-server.js");
if (!existsSync(dist)) {
  console.error("dist/http-server.js not found. Run: npm run build");
  process.exit(1);
}

// ─── Patch express so every mount records itself ─────────────────────────────

const express = (await import("express")).default;

/** handle -> [{ prefix, handle }] */
const mounts = new Map();
function record(parent, prefix, handle) {
  if (typeof prefix !== "string" || typeof handle !== "function") return;
  if (!mounts.has(parent)) mounts.set(parent, []);
  mounts.get(parent).push({ prefix, handle });
}

function wrapUse(target) {
  const original = target.use;
  target.use = function patchedUse(...args) {
    if (typeof args[0] === "string") {
      for (const h of args.slice(1)) record(this, args[0], h);
    }
    return original.apply(this, args);
  };
}

wrapUse(express.application);

const originalRouter = express.Router;
express.Router = function patchedRouter(...args) {
  const r = originalRouter.apply(this, args);
  wrapUse(r);
  return r;
};

// ─── Build the real app ──────────────────────────────────────────────────────

const { createHttpServer } = await import(pathToFileURL(dist).href);
const built = createHttpServer({ port: 0, token: "surface-generator" });
const app = built?.app ?? built;

// ─── Walk: mounts by identity, leaf routes from each router's own stack ──────

/** @returns {Array<{method:string, path:string}>} */
function ownRoutes(router) {
  const out = [];
  for (const layer of router?.stack ?? []) {
    if (!layer.route) continue;
    for (const [m, on] of Object.entries(layer.route.methods)) {
      if (on && m !== "_all") out.push({ method: m.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

const endpoints = [];
const seen = new Set();

function walk(node, prefix) {
  if (!node || seen.has(node)) return;
  // A router can legitimately be mounted twice (see /export and /import below),
  // so identity is tracked per traversal path rather than globally.
  for (const r of ownRoutes(node)) {
    const full = (prefix + (r.path === "/" ? "" : r.path)) || "/";
    endpoints.push({ method: r.method, path: full.replace(/\/{2,}/g, "/") });
  }
  for (const { prefix: p, handle } of mounts.get(node) ?? []) {
    walk(handle, prefix + (p === "/" ? "" : p));
  }
}

walk(app, "");
// The app object itself is not in `mounts` as a key when express() built it —
// walk from its router too, in case the top-level mounts landed there.
if (app?.router) walk(app.router, "");

endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const unique = [];
const key = new Set();
for (const e of endpoints) {
  const k = `${e.method} ${e.path}`;
  if (!key.has(k)) { key.add(k); unique.push(e); }
}

// ─── Which packages/* consume which endpoints ────────────────────────────────

function scanConsumers() {
  const pkgRoot = path.join(root, "packages");
  const consumers = {};
  if (!existsSync(pkgRoot)) return consumers;

  const SKIP = new Set(["node_modules", "dist", "build", ".git", ".vite", "coverage"]);
  const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte", ".vue"]);

  for (const pkg of readdirSync(pkgRoot)) {
    const dir = path.join(pkgRoot, pkg);
    if (!statSync(dir).isDirectory()) continue;
    const hits = new Set();

    const files = [];
    (function collect(d, depth) {
      if (depth > 6) return;
      for (const name of readdirSync(d)) {
        if (SKIP.has(name)) continue;
        const p = path.join(d, name);
        let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) collect(p, depth + 1);
        else if (EXT.has(path.extname(name))) files.push(p);
      }
    })(dir, 0);

    for (const f of files) {
      let text; try { text = readFileSync(f, "utf-8"); } catch { continue; }
      for (const m of text.matchAll(/["'`](\/api\/v1\/[^"'`\s?]*)/g)) hits.add(m[1]);
      // Template-built paths: `${base}/decisions/${id}` — capture the literal segment.
      for (const m of text.matchAll(/["'`]\/(sessions|decisions|file-notes|tasks|conventions|changes|milestones|events|instances|analytics|settings|sensitive|search|export|import|audit|annotations)\b/g)) {
        hits.add("/api/v1/" + m[1]);
      }
    }
    if (hits.size) consumers[pkg] = [...hits].sort();
  }
  return consumers;
}

const consumers = scanConsumers();

// ─── Response envelope, parsed from source ───────────────────────────────────
// FR-D6. The envelope was previously a hardcoded template literal in this file,
// so the "gate" on it was a sentence a human had to remember to update. It is
// now derived: change a helper's status code, its `ok` flag or its error code,
// and HTTP-SURFACE.md changes with it and `--check` fails.
function scanEnvelope() {
  const src = readFileSync(path.join(root, "src", "http-routes", "api-helpers.ts"), "utf-8");
  const rows = [];
  const parsed = new Map();
  // Split on export boundaries so each helper's body is scanned in isolation;
  // a single regex over the whole file would attribute codes to the wrong helper.
  const parts = src.split(/export function /).slice(1);
  for (const part of parts) {
    const name = part.match(/^(\w+)/)?.[1];
    if (!name) continue;
    const body = part.slice(0, part.indexOf("\n}") + 1);

    const statuses = [...body.matchAll(/\.status\((\d+)\)/g)].map((m) => m[1]);
    const defaulted = body.match(/status\s*=\s*(\d+)/)?.[1];
    const delegated = body.match(/return (\w+)\(res[^)]*?,\s*(\d+)\)/);
    if (delegated) statuses.push(delegated[2]);
    if (defaulted) statuses.push(defaulted);

    // A helper that delegates (created -> ok) inherits the target's envelope.
    // Reporting "—" there would understate the contract, which is the failure
    // this whole table replaced.
    const inherited = delegated ? parsed.get(delegated[1]) : undefined;
    const okFlag = /ok:\s*true/.test(body) ? "true"
      : /ok:\s*false/.test(body) ? "false"
        : inherited?.okFlag ?? "—";
    const code = body.match(/error:\s*"([A-Z_]+)"/)?.[1] ?? inherited?.code ?? "—";
    const bodyShape = /\.end\(\)/.test(body)
      ? "(empty)"
      : okFlag === "true"
        ? "`{ ok, data, meta? }`"
        : okFlag === "false"
          ? "`{ ok, error, message }`"
          : "—";

    parsed.set(name, { okFlag, code });
    const via = inherited ? ` (via \`${delegated[1]}()\`)` : "";
    rows.push(`| \`${name}()\`${via} | ${[...new Set(statuses)].join(", ") || "—"} | \`${okFlag}\` | \`${code}\` | ${bodyShape} |`);
  }
  return [
    "| helper | HTTP status | `ok` | error code | body |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
const envelopeTable = scanEnvelope();

// ─── Render ──────────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().slice(0, 10);
const byPrefix = new Map();
for (const e of unique) {
  const seg = e.path.split("/").slice(0, 4).join("/") || "/";
  if (!byPrefix.has(seg)) byPrefix.set(seg, []);
  byPrefix.get(seg).push(e);
}

let m = `# HTTP Surface — the dashboard API contract

**Generated:** ${stamp} · **Source:** \`dist/http-server.js\` via [\`scripts/generate-http-surface.mjs\`](../scripts/generate-http-surface.mjs)

> **Generated artifact — never hand-edit.** Regenerate with \`npm run http-surface\`;
> \`npm run http-surface:check\` fails on drift and runs in CI.
>
> Companion to [\`CAPABILITY-SURFACE.md\`](CAPABILITY-SURFACE.md), which covers the MCP
> tool contract. This covers the **HTTP API and its \`packages/*\` consumers** — the half
> that had no gate, and the half FR-D6 would break first.

---

## Why this file exists

If FR-D6 makes the response envelope uniform, **the dashboard breaks and nothing
reports it.** That is the silent-drop shape this project exists to stop, so the
contract is captured here *before* D6 rather than with it.

**${unique.length} endpoints** across **${byPrefix.size} groups**, ${Object.keys(consumers).length} consumer package(s).

> **The blast radius is smaller than the charter assumed, and that is worth knowing
> before D6 plans around it.** Charter §11b.1 lists "the dashboard, both thin clients
> and 14 IDE integrations" as consumers of this surface. Measured: **both thin clients
> have zero \`/api/v1\` references and zero \`fetch\`/http references**, and import MCP
> stdio transport instead. They consume the **MCP** contract, which
> [\`CAPABILITY-SURFACE.md\`](CAPABILITY-SURFACE.md) already gates. An HTTP envelope
> change touches \`packages/engram-dashboard\` only.

---

## Response envelope — the contract D6 must not break silently

**Derived from \`src/http-routes/api-helpers.ts\`, not asserted.** Every route
returns through one of these helpers.

${envelopeTable}

> This block used to be a hand-written \`jsonc\` literal in the generator. It was
> prose pretending to be a gate: FR-D6 changed \`POST /api/v1/import\` from
> \`ok:true\` to a 501 and added a \`notImplemented\` helper, and
> \`http-surface:check\` passed unchanged, because the generator read the endpoint
> list from \`dist/\` and the envelope from itself. The table above is now parsed
> out of the helper source, so an envelope change fails the gate the way an
> endpoint change already did.

> **This is already uniform, and the MCP side is not.** The MCP dispatchers return
> \`isError: true\` with **plain text** for errors while success returns JSON — the
> asymmetry that cost two false FAILs in the live harness (observation #49). Any D6
> work that unifies the MCP envelope must not "unify" this one to match a different
> shape without changing every consumer below.

**Known defect, preserved here because the generator reports what is real:**
\`exportImportRouter\` is mounted at both \`/export\` and \`/import\` while also defining
those segments internally, so the live paths are doubled — visible in the table below.

---

## Authentication

\`app.use("/api", bearerAuth(token))\` — **every** \`/api/*\` route requires the bearer
token. \`/health\` is the one deliberate exception. CORS is an explicit localhost
allowlist, and the server binds \`127.0.0.1\` (in \`index.ts\`, not the factory).

---

## Endpoints

`;

for (const [group, list] of [...byPrefix.entries()].sort()) {
  m += `### \`${group}\`\n\n| Method | Path |\n|---|---|\n`;
  for (const e of list) m += `| ${e.method} | \`${e.path}\` |\n`;
  m += `\n`;
}

m += `---

## Consumers in this repo

These are the packages that break if the shapes above change. Paths are the literal
API references found in each package's source.

`;

if (Object.keys(consumers).length === 0) {
  m += `_No \`/api/v1\` references found in \`packages/*\`._\n`;
} else {
  for (const [pkg, paths] of Object.entries(consumers).sort()) {
    m += `### \`packages/${pkg}\` — ${paths.length} endpoint reference(s)\n\n`;
    for (const p of paths) m += `- \`${p}\`\n`;
    m += `\n`;
  }
}

m += `---

## What this gate does and does not catch

**Catches:** an endpoint added, removed, renamed or re-mounted; a method changed; a
consumer starting or stopping use of a path.

**Does not catch:** a change to the *shape of \`data\`* inside the envelope. The
envelope is captured, the payload schema is not — HTTP routes carry no Zod schema the
way the MCP dispatchers do, so there is nothing to introspect. Closing that would mean
giving the routes typed response contracts, which is FR-D6 work and is recorded here
rather than pretended away.

<!-- HTTP_SURFACE:GENERATED -->
`;

// ─── Write or check ──────────────────────────────────────────────────────────

// Line endings MUST be normalised before comparing. The generator writes LF;
// git's autocrlf rewrites the working copy to CRLF on checkout, so a naive
// comparison fails on every Windows machine while passing in Ubuntu CI — a gate
// that is broken exactly where it is used most, and cries wolf until someone
// switches it off. generate-capability-surface.mjs already got this right.
const normalise = (s) => s
  .replace(/\r\n/g, "\n")
  .replace(/^\*\*Generated:\*\* \d{4}-\d{2}-\d{2} /m, "**Generated:** <date> ")
  .trimEnd();

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error("docs/HTTP-SURFACE.md does not exist. Run: npm run http-surface");
    process.exit(1);
  }
  if (normalise(readFileSync(OUT, "utf-8")) !== normalise(m)) {
    console.error("docs/HTTP-SURFACE.md is out of date — the HTTP surface changed.");
    console.error("Regenerate with: npm run http-surface");
    process.exit(1);
  }
  console.log(`HTTP surface matches the committed file (${unique.length} endpoints).`);
  process.exit(0);
}

writeFileSync(OUT, m, "utf-8");
console.log(`docs/HTTP-SURFACE.md written — ${unique.length} endpoints, ${Object.keys(consumers).length} consumer package(s).`);
