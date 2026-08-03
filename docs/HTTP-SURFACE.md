# HTTP Surface — the dashboard API contract

**Generated:** 2026-08-03 · **Source:** `dist/http-server.js` via [`scripts/generate-http-surface.mjs`](../scripts/generate-http-surface.mjs)

> **Generated artifact — never hand-edit.** Regenerate with `npm run http-surface`;
> `npm run http-surface:check` fails on drift and runs in CI.
>
> Companion to [`CAPABILITY-SURFACE.md`](CAPABILITY-SURFACE.md), which covers the MCP
> tool contract. This covers the **HTTP API and its `packages/*` consumers** — the half
> that had no gate, and the half FR-D6 would break first.

---

## Why this file exists

If FR-D6 makes the response envelope uniform, **the dashboard breaks and nothing
reports it.** That is the silent-drop shape this project exists to stop, so the
contract is captured here *before* D6 rather than with it.

**44 endpoints** across **19 groups**, 1 consumer package(s).

> **The blast radius is smaller than the charter assumed, and that is worth knowing
> before D6 plans around it.** Charter §11b.1 lists "the dashboard, both thin clients
> and 14 IDE integrations" as consumers of this surface. Measured: **both thin clients
> have zero `/api/v1` references and zero `fetch`/http references**, and import MCP
> stdio transport instead. They consume the **MCP** contract, which
> [`CAPABILITY-SURFACE.md`](CAPABILITY-SURFACE.md) already gates. An HTTP envelope
> change touches `packages/engram-dashboard` only.

---

## Response envelope — the contract D6 must not break silently

Every route returns one of these two shapes, via `src/http-routes/api-helpers.ts`:

```jsonc
// success — ok / created
{ "ok": true, "data": <payload>, "meta": { /* pagination, optional */ } }

// failure — notFound / badRequest / serverError
{ "ok": false, "error": "<code>", "message": "<human text>" }
```

`noContent` returns HTTP 204 with no body.

> **This is already uniform, and the MCP side is not.** The MCP dispatchers return
> `isError: true` with **plain text** for errors while success returns JSON — the
> asymmetry that cost two false FAILs in the live harness (observation #49). Any D6
> work that unifies the MCP envelope must not "unify" this one to match a different
> shape without changing every consumer below.

**Known defect, preserved here because the generator reports what is real:**
`exportImportRouter` is mounted at both `/export` and `/import` while also defining
those segments internally, so the live paths are doubled — visible in the table below.

---

## Authentication

`app.use("/api", bearerAuth(token))` — **every** `/api/*` route requires the bearer
token. `/health` is the one deliberate exception. CORS is an explicit localhost
allowlist, and the server binds `127.0.0.1` (in `index.ts`, not the factory).

---

## Endpoints

### `/`

| Method | Path |
|---|---|
| GET | `/` |

### `/api/v1/analytics`

| Method | Path |
|---|---|
| GET | `/api/v1/analytics/activity` |
| GET | `/api/v1/analytics/session-stats` |
| GET | `/api/v1/analytics/summary` |

### `/api/v1/annotations`

| Method | Path |
|---|---|
| GET | `/api/v1/annotations` |
| POST | `/api/v1/annotations` |
| DELETE | `/api/v1/annotations/:id` |

### `/api/v1/audit`

| Method | Path |
|---|---|
| GET | `/api/v1/audit` |

### `/api/v1/changes`

| Method | Path |
|---|---|
| GET | `/api/v1/changes` |

### `/api/v1/conventions`

| Method | Path |
|---|---|
| GET | `/api/v1/conventions` |
| POST | `/api/v1/conventions` |
| DELETE | `/api/v1/conventions/:id` |
| GET | `/api/v1/conventions/:id` |

### `/api/v1/decisions`

| Method | Path |
|---|---|
| GET | `/api/v1/decisions` |
| POST | `/api/v1/decisions` |
| DELETE | `/api/v1/decisions/:id` |
| GET | `/api/v1/decisions/:id` |
| PUT | `/api/v1/decisions/:id` |

### `/api/v1/events`

| Method | Path |
|---|---|
| GET | `/api/v1/events` |

### `/api/v1/export`

| Method | Path |
|---|---|
| POST | `/api/v1/export/export` |
| POST | `/api/v1/export/import` |

### `/api/v1/file-notes`

| Method | Path |
|---|---|
| GET | `/api/v1/file-notes` |
| POST | `/api/v1/file-notes` |
| GET | `/api/v1/file-notes/:path` |

### `/api/v1/import`

| Method | Path |
|---|---|
| POST | `/api/v1/import/export` |
| POST | `/api/v1/import/import` |

### `/api/v1/instances`

| Method | Path |
|---|---|
| GET | `/api/v1/instances` |

### `/api/v1/milestones`

| Method | Path |
|---|---|
| GET | `/api/v1/milestones` |
| POST | `/api/v1/milestones` |
| GET | `/api/v1/milestones/:id` |

### `/api/v1/search`

| Method | Path |
|---|---|
| GET | `/api/v1/search` |

### `/api/v1/sensitive`

| Method | Path |
|---|---|
| GET | `/api/v1/sensitive` |

### `/api/v1/sessions`

| Method | Path |
|---|---|
| GET | `/api/v1/sessions` |
| DELETE | `/api/v1/sessions/:id` |
| GET | `/api/v1/sessions/:id` |

### `/api/v1/settings`

| Method | Path |
|---|---|
| GET | `/api/v1/settings` |
| GET | `/api/v1/settings/:key` |
| PUT | `/api/v1/settings/:key` |

### `/api/v1/tasks`

| Method | Path |
|---|---|
| GET | `/api/v1/tasks` |
| POST | `/api/v1/tasks` |
| DELETE | `/api/v1/tasks/:id` |
| GET | `/api/v1/tasks/:id` |
| PUT | `/api/v1/tasks/:id` |

### `/health`

| Method | Path |
|---|---|
| GET | `/health` |

---

## Consumers in this repo

These are the packages that break if the shapes above change. Paths are the literal
API references found in each package's source.

### `packages/engram-dashboard` — 12 endpoint reference(s)

- `/api/v1/analytics`
- `/api/v1/audit`
- `/api/v1/changes`
- `/api/v1/conventions`
- `/api/v1/decisions`
- `/api/v1/events`
- `/api/v1/file-notes`
- `/api/v1/instances`
- `/api/v1/milestones`
- `/api/v1/sessions`
- `/api/v1/settings`
- `/api/v1/tasks`

---

## What this gate does and does not catch

**Catches:** an endpoint added, removed, renamed or re-mounted; a method changed; a
consumer starting or stopping use of a path.

**Does not catch:** a change to the *shape of `data`* inside the envelope. The
envelope is captured, the payload schema is not — HTTP routes carry no Zod schema the
way the MCP dispatchers do, so there is nothing to introspect. Closing that would mean
giving the routes typed response contracts, which is FR-D6 work and is recorded here
rather than pretended away.

<!-- HTTP_SURFACE:GENERATED -->
