# Engram Dashboard — Master Implementation Plan

**Branch:** `develop`  
**Last updated:** 2026-03-01  
**Status:** Phase 0 (backend) ✅ complete — Phase 1 (frontend MVP) 🔄 in progress

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│  AI Agent (Claude / Cline / GitHub Copilot / etc.)  │
│         MCP stdio  ←→  src/index.ts (4 tools)       │
└────────────────────────┬────────────────────────────┘
                         │ same process
                         ▼
┌─────────────────────────────────────────────────────┐
│  Express HTTP Server (src/http-server.ts)           │
│  127.0.0.1:7432  •  Bearer token auth               │
│                                                     │
│  /health           (no auth, ping)                  │
│  /api/v1/…         (16 REST endpoints)              │
│  /                 (SPA static files)               │
│  /ws               (WebSocket — planned Phase 3)    │
└───────────┬─────────────────────────┬───────────────┘
            │                         │
   REST/WebSocket                  Static
            │                         │
┌───────────▼───────────┐  ┌──────────▼──────────────┐
│  SQLite WAL DB        │  │  React SPA              │
│  .engram/memory.db    │  │  packages/engram-        │
│  (per-IDE shard)      │  │  dashboard/dist/         │
└───────────────────────┘  └─────────────────────────┘
```

### How MCP and HTTP coexist

- **`engram --mode=stdio`** (default): MCP only, no HTTP.  
- **`engram --mode=http`**: initialises the database, starts Express on `127.0.0.1:7432`, opens browser. The MCP server is NOT started — HTTP mode is dashboard-only.  
- All route handlers call the same repos/services that MCP tools use. There is exactly one SQLite connection shared across both.

---

## Auth Model

A random 32-byte token is generated once and persisted to `.engram/token` (chmod 600).  
Every request to `/api/v1/…` must carry `Authorization: Bearer <token>`.  
The dashboard SPA reads the token from the `?token=` query param on first load and stores it in `sessionStorage`.

---

## What Is Done (Phase 0)

| File | Status | Description |
|------|--------|-------------|
| `src/constants.ts` | ✅ | `CFG_HTTP_TOKEN` added; `DB_VERSION=22` |
| `src/migrations.ts` | ✅ | v18–v22: soft deletes, audit_log, import_jobs, annotations |
| `src/http-auth.ts` | ✅ | `ensureToken()`, `bearerAuth()` middleware |
| `src/http-pagination.ts` | ✅ | `buildPage()`, `parseLimit()`, cursor encoding |
| `src/http-server.ts` | ✅ | Express factory: CORS, auth guard, all routes mounted |
| `src/index.ts` | ✅ | `--mode=http` / `--mode=dashboard` path added |
| `src/http-routes/api-helpers.ts` | ✅ | `ok()`, `created()`, `notFound()`, `badRequest()`, `serverError()` |
| `src/http-routes/sessions.routes.ts` | ✅ | GET list, GET :id, DELETE |
| `src/http-routes/decisions.routes.ts` | ✅ | GET list, GET :id, POST, PUT, DELETE |
| `src/http-routes/file-notes.routes.ts` | ✅ | GET list, GET :path, POST |
| `src/http-routes/tasks.routes.ts` | ✅ | GET list, GET :id, POST, PUT (status/priority), DELETE |
| `src/http-routes/conventions.routes.ts` | ✅ | GET list, GET :id, POST, DELETE (toggle off) |
| `src/http-routes/changes.routes.ts` | ✅ | GET list (by file or since-date) |
| `src/http-routes/milestones.routes.ts` | ✅ | GET list, GET :id, POST |
| `src/http-routes/events.routes.ts` | ✅ | GET list (filtered) |
| `src/http-routes/instances.routes.ts` | ✅ | GET list |
| `src/http-routes/analytics.routes.ts` | ✅ | GET /summary, GET /activity, GET /session-stats |
| `src/http-routes/settings.routes.ts` | ✅ | GET all, GET :key, PUT :key (token protected) |
| `src/http-routes/sensitive.routes.ts` | ✅ | GET list (stub — no raw values) |
| `src/http-routes/search.routes.ts` | ✅ | GET ?q=…&scope=… full-text search |
| `src/http-routes/export-import.routes.ts` | ✅ | POST /export (JSON snapshot), POST /import (staged) |
| `src/http-routes/audit.routes.ts` | ✅ | GET list, filterable by table |
| `src/http-routes/annotations.routes.ts` | ✅ | GET list, POST, DELETE |
| **Build** | ✅ | `npm run build` — zero TS errors |
| **Tests** | ✅ | 196/196 passing |

---

## What Remains — Phased Plan

### Phase 1 — Frontend MVP  *(current)*

Deliverable: A working React SPA that can be opened in the browser and shows real data from the local API.

**Directory:** `packages/engram-dashboard/`

```
packages/engram-dashboard/
├── package.json          # React 19 + Vite 6 + TanStack + Zustand + Tailwind
├── vite.config.ts        # proxy /api → 127.0.0.1:7432
├── tsconfig.json
├── index.html            # single entry point, injects token from URL
├── src/
│   ├── main.tsx          # React root
│   ├── App.tsx           # TanStack Router provider
│   ├── styles/
│   │   └── globals.css   # CSS custom properties (design tokens)
│   ├── api/
│   │   └── client.ts     # fetch wrapper (Bearer token, base URL)
│   ├── stores/
│   │   └── auth.store.ts # Zustand: token, isAuthed
│   ├── router.tsx        # TanStack Router route tree
│   ├── layouts/
│   │   ├── Shell.tsx     # sidebar + topbar wrapper
│   │   ├── Sidebar.tsx   # nav links
│   │   └── TopBar.tsx    # breadcrumb, search trigger, theme toggle
│   ├── pages/
│   │   ├── Dashboard.tsx # summary cards + activity chart
│   │   ├── Sessions.tsx
│   │   ├── Decisions.tsx
│   │   ├── Tasks.tsx
│   │   ├── FileNotes.tsx
│   │   ├── Conventions.tsx
│   │   ├── Changes.tsx
│   │   ├── Milestones.tsx
│   │   ├── Events.tsx
│   │   ├── Audit.tsx
│   │   └── Settings.tsx
│   └── components/
│       ├── DataTable.tsx       # TanStack Table wrapper
│       ├── StatusBadge.tsx     # colored pill for status fields
│       ├── CommandPalette.tsx  # cmdk global search
│       ├── ActivityChart.tsx   # Recharts bar chart
│       └── EmptyState.tsx      # illustrated empty state
└── assets/
    └── logo.svg              # placeholder
```

**Steps:**
1. `npm create vite@latest packages/engram-dashboard -- --template react-ts`  
2. Install deps: `react-router-dom` replaced by TanStack Router, add TanStack Query v5, Zustand, Recharts, Tailwind v4, cmdk, lucide-react, date-fns  
3. Wire `vite.config.ts` proxy to `http://127.0.0.1:7432`  
4. Implement `api/client.ts` — reads token from `sessionStorage`, falls back to `?token=` URL param  
5. Build each page top-down: Dashboard → Sessions → Decisions → Tasks → FileNotes  
6. Add `build:dashboard` script to root `package.json`  
7. Verify `dist/` is produced and Express serves it correctly

### Phase 2 — Dashboard Polish & Full Pages

- Command palette (Cmd+K) with global search  
- Row-click → detail drawer/modal  
- Inline status change on tasks (click badge to cycle)  
- Annotations panel (add notes on any record)  
- Export button (triggers POST /export, downloads JSON)  
- Dark/light theme toggle (CSS variable swap)  
- Mobile-responsive layout

### Phase 3 — WebSocket Live Updates

- Add `ws` upgrade handler in `src/http-server.ts`  
- Broadcast events: new session, task update, new decision  
- Dashboard auto-refreshes affected query without full page reload  
- Toast notification for new events  

### Phase 4 — `npm run dashboard` Convenience Script

Add to root `package.json`:  
```json
"dashboard": "node dist/index.js --mode=http",
"dev:dashboard": "concurrently \"npm run dev\" \"cd packages/engram-dashboard && npm run dev\""
```

### Phase 5 — Test Coverage for HTTP Layer

Add `tests/http/` directory with:  
- `api-auth.test.ts` — 401 on missing/wrong token  
- `api-routes.test.ts` — smoke test each endpoint with in-memory DB  
- `api-pagination.test.ts` — cursor encoding/decoding round-trips

---

## API Reference (v1)

Base URL: `http://127.0.0.1:7432/api/v1`  
Auth: `Authorization: Bearer <token>` on all routes.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sessions` | List sessions `?limit=&offset=&agent=` |
| GET | `/sessions/:id` | Single session |
| DELETE | `/sessions/:id` | Auto-close session |
| GET | `/decisions` | List active decisions |
| GET | `/decisions/:id` | Single decision |
| POST | `/decisions` | Create decision `{decision, rationale, tags?, supersedes?}` |
| PUT | `/decisions/:id` | Update status `{status}` |
| DELETE | `/decisions/:id` | Soft-delete (status → superseded) |
| GET | `/tasks` | List tasks `?status=&limit=` |
| GET | `/tasks/:id` | Single task |
| POST | `/tasks` | Create task `{title, description?, priority?, blocked_by?}` |
| PUT | `/tasks/:id` | Update task `{status?, description?, priority?}` |
| DELETE | `/tasks/:id` | Cancel task |
| GET | `/file-notes` | List all `?file_path=` for specific file |
| GET | `/file-notes/:path` | Get by URL-encoded path |
| POST | `/file-notes` | Upsert `{file_path, purpose?, executive_summary?, ...}` |
| GET | `/conventions` | List conventions |
| POST | `/conventions` | Create `{rule, category?}` |
| DELETE | `/conventions/:id` | Toggle off |
| GET | `/changes` | List changes `?since=ISO&file=&limit=` |
| GET | `/milestones` | List milestones |
| POST | `/milestones` | Create `{title, description?, version?, tags?}` |
| GET | `/events` | Scheduled events `?status=&limit=` |
| GET | `/instances` | Registered IDE instances |
| GET | `/analytics/summary` | Counts across all entities |
| GET | `/analytics/activity` | Changes by day (last 30 days) |
| GET | `/analytics/session-stats` | Session duration stats |
| GET | `/settings` | All config (token excluded) |
| GET | `/settings/:key` | Single config key |
| PUT | `/settings/:key` | Set config value |
| GET | `/search?q=&scope=` | Full-text search across entities |
| POST | `/export` | Download full JSON snapshot |
| POST | `/import` | Stage import for review |
| GET | `/audit` | Audit log `?table=&limit=` |
| GET | `/annotations?target_table=&target_id=` | Annotations |
| POST | `/annotations` | Add annotation `{target_table, target_id, note}` |
| DELETE | `/annotations/:id` | Delete annotation |
| GET | `/health` | Health check (no auth) |

---

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#0d0d0d` | App background |
| `--bg-surface` | `#141414` | Cards, tables |
| `--bg-elevated` | `#1c1c1c` | Dropdowns, modals |
| `--border` | `#2a2a2a` | All borders |
| `--text-primary` | `#e8e8e8` | Body text |
| `--text-muted` | `#888` | Secondary labels |
| `--accent` | `#c9a96e` | Warm gold — CTAs, highlights |
| `--accent-hover` | `#d4b882` | Hover state |
| `--success` | `#4caf76` | Done/active status |
| `--warning` | `#e6a817` | Medium priority |
| `--danger` | `#e05252` | Errors, cancelled |
| `--radius` | `6px` | Border radius |
| `--font-mono` | `"JetBrains Mono", monospace` | Code, paths |

---

## Running the Dashboard

```bash
# Build the TypeScript backend
npm run build

# Build the frontend (once Phase 1 is scaffolded)
npm run build:dashboard

# Start dashboard mode
node dist/index.js --mode=http

# Or with a specific port
node dist/index.js --mode=http --port=7432

# Development (hot reload frontend, static backend)
node dist/index.js --mode=http --no-open &
cd packages/engram-dashboard && npm run dev
```

---

## Conventions for This Work

1. **Backend routes** live in `src/http-routes/*.routes.ts` — one file per entity.  
2. All responses use helpers from `src/http-routes/api-helpers.ts` — never raw `res.json()`.  
3. Pagination always uses `buildPage()` from `src/http-pagination.ts`.  
4. **Never expose** the raw bearer token or sensitive-data values via any API route.  
5. Frontend API calls always go through `src/api/client.ts` — never raw `fetch()` in components.  
6. All frontend state that needs persistence uses Zustand stores in `src/stores/`.  
7. **Console output**: `console.error` only in backend, never `console.log` (corrupts MCP stdio).

---

## Open Questions / Future

- Should the dashboard support multi-project switching (show `memory-{ide}.db` selector)?  
- Cloud sync (AES-256-GCM) — already decided in decision #11, dashboard will show sync status.  
- Plugin system for custom panels (post-v2.0).
