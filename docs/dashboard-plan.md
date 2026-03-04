# Engram Dashboard — Implementation Master Plan

> **Status:** Ready to implement
> **Version target:** Engram v1.9.0 (Phase 1 MVP), v2.0.0 (Phase 2 Full)
> **Last updated:** 2026-03-01
> **Related docs:** `dashboard-design.md`, `dashboard-assets.md`, `cross-instance-infrastructure.md`

---

## 0. Context & Resolved Decisions

All open questions from the initial planning session are resolved below. No ambiguity remains.

| Question | Resolution | Rationale |
|---|---|---|
| Port | **7432** (7=Engram era, 432=Hz of A4) | Memorable, unlikely to collide |
| MCP + HTTP simultaneously? | **Yes** — `--mode=http` adds Express server alongside existing stdio MCP server | Same process, no conflicts |
| Auto-open browser? | **Yes by default**, `--no-open` flag to suppress | Consistent with Vite/dev-tool conventions |
| Real-time strategy | **WebSocket (`ws` library)** — no polling | Direct cache invalidation; no redundant fetches |
| Write scope in MVP | **Limited writes**: sharing toggle, labels, lock/unlock sensitive, access request approve/deny, task CRUD, annotation creation | Safe MVP; full CRUD in Phase 2 |
| Deployment mode | **Browser SPA shipped inside npm package** — served by Express from `packages/engram-dashboard/dist/` | Zero external install; one binary |
| Auth model | **Bearer token** — generated on first `--mode=http` start, stored in OS keychain; required for all API calls | Defense-in-depth |

---

## 1. Package Structure

```
packages/
  engram-dashboard/          ← new monorepo package
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      api/                   ← HTTP client layer (one file per resource)
        client.ts            ← fetch wrapper + bearer token + error envelope
        decisions.ts
        sessions.ts
        file-notes.ts
        tasks.ts
        conventions.ts
        changes.ts
        milestones.ts
        events.ts
        instances.ts
        analytics.ts
        settings.ts
      components/
        layout/
          Shell.tsx           ← outermost wrapper: sidebar + main area
          Sidebar.tsx
          CommandPalette.tsx  ← cmdk-based Cmd+K overlay
          TopBar.tsx          ← breadcrumbs + global actions
        memory/
          DecisionTable.tsx
          FileNoteTable.tsx
          TaskBoard.tsx
          TaskCard.tsx
          SessionTimeline.tsx
          ConventionBook.tsx
          ChangesFeed.tsx
          MilestoneLog.tsx
        instance/
          InstancePanel.tsx
          InstanceSwitcher.tsx
          ConflictResolution.tsx
          InstanceHealthCard.tsx
        analytics/
          StatsWidgets.tsx
          ActivityChart.tsx
          StalenessReport.tsx
        shared/
          Badge.tsx
          ConfidenceDot.tsx
          RelativeTime.tsx
          ExpandableRow.tsx
          EmptyState.tsx
          LoadingShimmer.tsx
          DiffViewer.tsx
          SearchInput.tsx
          PaginationBar.tsx
      hooks/
        useInstances.ts       ← TanStack Query: instance list + selected
        useWebSocket.ts       ← WS connection + cache invalidation
        useCommandPalette.ts  ← cmdk integration
        useSearch.ts          ← debounced FTS calls
      stores/
        instance.store.ts     ← Zustand: selectedInstanceId, allInstances, isGlobalView
        ui.store.ts           ← Zustand: sidebarOpen, privacyMode, theme, notifications
      lib/
        utils.ts
        date.ts               ← date-fns wrappers
        diff.ts               ← react-diff-viewer-continued helpers
      routes/
        index.tsx             ← /  → Dashboard Overview
        sessions.tsx          ← /sessions
        decisions.tsx         ← /decisions
        file-notes.tsx        ← /file-notes
        tasks.tsx             ← /tasks
        conventions.tsx       ← /conventions
        changes.tsx           ← /changes
        analytics.tsx         ← /analytics
        instances.tsx         ← /instances
        import.tsx            ← /import
        settings.tsx          ← /settings
      types/
        api.ts                ← mirrored response types from server

src/
  http-server.ts             ← new: Express 5 app factory
  http-auth.ts               ← new: Bearer token middleware
  http-pagination.ts         ← new: cursor pagination helpers
  http-routes/               ← new: one file per resource domain
    sessions.routes.ts
    decisions.routes.ts
    file-notes.routes.ts
    tasks.routes.ts
    conventions.routes.ts
    changes.routes.ts
    milestones.routes.ts
    events.routes.ts
    instances.routes.ts
    analytics.routes.ts
    settings.routes.ts
    export-import.routes.ts
    sensitive.routes.ts
    audit.routes.ts
    annotations.routes.ts
    search.routes.ts
    ws.routes.ts             ← WebSocket upgrade handler
```

---

## 2. Schema Migrations (v18–v22)

All migrations append-only in `src/migrations.ts`. Do NOT edit existing migration entries.

### v18 — HTTP API Token
```sql
-- Per-instance Bearer token stored as config key CFG_HTTP_TOKEN
-- Actual token value lives in OS keychain; config stores slug only
```
*(Implemented as config table entry, not ALTER TABLE — config table is already flexible)*

### v19 — Soft Delete Columns
```sql
ALTER TABLE decisions ADD COLUMN deleted_at INTEGER;
ALTER TABLE file_notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE tasks ADD COLUMN deleted_at INTEGER;
ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;
```
All queries gain implicit `WHERE deleted_at IS NULL`. Recoverable via `?include_deleted=true`.

### v20 — Audit Log
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'human',
  table_name TEXT NOT NULL,
  record_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
```

### v21 — Import Jobs
```sql
CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  source_path TEXT NOT NULL,
  source_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_records INTEGER DEFAULT 0,
  approved_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  trust_level TEXT DEFAULT 'review-required',
  raw_json TEXT NOT NULL,
  completed_at INTEGER
);
```

### v22 — Human Annotations
```sql
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'human'
);
CREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_table, target_id);
```

---

## 3. HTTP API Specification

- **Bind:** `127.0.0.1:7432` only (never `0.0.0.0`)
- **Base path:** `/api/v1/`
- **Auth:** `Authorization: Bearer <token>` on every route
- **Response envelope (success):** `{ "ok": true, "data": { ... }, "meta": { "request_id": "...", "duration_ms": 12 } }`
- **Response envelope (error):** `{ "ok": false, "error": "NOT_FOUND", "message": "human text" }`
- **Pagination:** cursor-based — `{ "data": [...], "cursor": "eyJ...", "hasMore": true, "total": 1200 }`

### Route Catalog

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/sessions` | List sessions — paginated, filterable by agent/date |
| GET | `/api/v1/sessions/:id` | Session detail with changes count |
| GET | `/api/v1/decisions` | List decisions — status, tags, text filters |
| GET | `/api/v1/decisions/:id` | Full decision detail |
| PUT | `/api/v1/decisions/:id` | Update decision text, rationale, tags |
| DELETE | `/api/v1/decisions/:id` | Soft-delete |
| GET | `/api/v1/file-notes` | List file notes — sortable, staleness filter |
| GET | `/api/v1/file-notes/:id` | Full file note |
| PUT | `/api/v1/file-notes/:id` | Update fields |
| DELETE | `/api/v1/file-notes/:id` | Soft-delete |
| GET | `/api/v1/conventions` | All conventions |
| PUT | `/api/v1/conventions/:id` | Toggle enforced; update rule text |
| GET | `/api/v1/tasks` | Tasks — status, priority, agent filters |
| GET | `/api/v1/tasks/:id` | Task detail |
| POST | `/api/v1/tasks` | Create task |
| PUT | `/api/v1/tasks/:id` | Update task |
| DELETE | `/api/v1/tasks/:id` | Soft-delete |
| GET | `/api/v1/changes` | Change feed — paginated |
| GET | `/api/v1/milestones` | All milestones |
| GET | `/api/v1/events` | Scheduled events |
| GET | `/api/v1/broadcasts` | Broadcast inbox |
| GET | `/api/v1/analytics/stats` | Aggregate counts per type |
| GET | `/api/v1/analytics/activity` | Sessions per day for chart |
| GET | `/api/v1/analytics/staleness` | Stale file notes ranked |
| GET | `/api/v1/analytics/coverage` | File note coverage map |
| GET | `/api/v1/search` | FTS5 across all memory types (`?q=&types=`) |
| GET | `/api/v1/instances` | All local instances |
| GET | `/api/v1/instances/:id` | Instance detail + health |
| PUT | `/api/v1/instances/:id/label` | Set instance label |
| PUT | `/api/v1/instances/:id/sharing` | Toggle sharing mode/types |
| GET | `/api/v1/instances/:id/query` | Cross-instance read query |
| GET | `/api/v1/sensitive` | List sensitive keys |
| PUT | `/api/v1/sensitive/lock` | Lock records |
| PUT | `/api/v1/sensitive/unlock` | Unlock records |
| POST | `/api/v1/sensitive/request` | Create access request |
| PUT | `/api/v1/sensitive/:id/approve` | Approve access request |
| PUT | `/api/v1/sensitive/:id/deny` | Deny access request |
| POST | `/api/v1/export` | Export memory subset |
| POST | `/api/v1/import/preview` | Preview import file (no DB write) |
| POST | `/api/v1/import/stage` | Stage an import job |
| PUT | `/api/v1/import/:id/approve` | Approve staged import |
| GET | `/api/v1/audit` | Audit log — paginated |
| GET | `/api/v1/annotations/:table/:id` | Annotations for one record |
| POST | `/api/v1/annotations` | Create annotation |
| GET | `/api/v1/settings` | Current config |
| PUT | `/api/v1/settings` | Update config |
| POST | `/api/v1/token/rotate` | Rotate API token |
| GET/Upgrade | `/ws` | WebSocket upgrade |

---

## 4. WebSocket Protocol

- **Connection:** `ws://localhost:7432/ws`
- **Handshake:** First message must be `{ "type": "auth", "token": "<bearer>" }` — server replies `{ "type": "auth_ok" }` or closes with code 4001

### Server → Client Events

| Event | Payload | Dashboard reaction |
|---|---|---|
| `session_started` | `{ session_id, agent, project_root }` | Invalidate sessions query |
| `session_ended` | `{ session_id, duration_ms }` | Invalidate sessions query |
| `conflict_detected` | `{ table, record_id, instances: [A, B] }` | Show conflict badge in status bar |
| `backup_progress` | `{ job_id, percent, bytes_written }` | Update backup panel progress bar |
| `sync_received` | `{ instance_id, record_count }` | Invalidate cross-instance queries |
| `task_updated` | `{ task_id, status, agent }` | Invalidate `tasks/:id` query |
| `event_triggered` | `{ event_id, title }` | Show toast notification |
| `sensitive_request` | `{ request_id, requester, key }` | Show access request badge |

---

## 5. Performance Budget

| Interaction | Target | Technique |
|---|---|---|
| Dashboard cold start | < 1.5s | Lazy routes; code-split per route |
| Memory list render (1000 rows) | < 100ms | TanStack Virtual + indexed SQL queries |
| FTS search (50k records) | < 50ms | SQLite FTS5 (already live) |
| Decision save (optimistic) | Instant + < 200ms confirm | Optimistic mutation in TanStack Query |
| WS event → UI update | < 50ms | `queryClient.invalidateQueries()` on message |
| Route transition | < 150ms | Preload on hover; no data waterfalls |
| Backup (100MB) | Progress shown; non-blocking | WS stream + progress events |

---

## 6. Implementation Phases

### Phase 0 — HTTP Foundation (Week 1)
No UI yet. All backend API and WebSocket infrastructure.

**Files to create/modify:**

| File | Action |
|---|---|
| `src/migrations.ts` | Append v18–v22 |
| `src/http-server.ts` | Create — Express 5 factory, cors, static, `/api/v1` mount |
| `src/http-auth.ts` | Create — Bearer middleware; keychain read; POSIX chmod fallback |
| `src/http-pagination.ts` | Create — `encodeCursor()`, `decodeCursor()`, `buildPage()` helpers |
| `src/http-routes/*.routes.ts` | Create — 16 route files (see structure above) |
| `src/index.ts` | Modify — add `--mode=http` / `--mode=dashboard` flag; auto-open browser |
| `package.json` | Modify — add `express`, `@types/express`, `cors`, `ws`, `@types/ws`, `keytar`, `open` |

**Completion criteria:** `node dist/index.js --mode=http --port=7432` returns valid JSON envelopes on all routes; WS upgrade works; migration runs without error on existing DBs.

---

### Phase 1 — Dashboard MVP (Weeks 2–4)
Functional read-heavy SPA. Every memory type browsable.

**Bootstrap:**
```bash
mkdir packages/engram-dashboard
cd packages/engram-dashboard
npm init -y
npm install react@19 react-dom@19 \
  @tanstack/react-query@5 @tanstack/react-router@1 \
  @tanstack/react-table@8 @tanstack/react-virtual@3 \
  zustand@5 cmdk lucide-react date-fns recharts \
  react-diff-viewer-continued tinykeys \
  react-hook-form zod
npm install -D vite@6 @vitejs/plugin-react typescript \
  @types/react @types/react-dom tailwindcss@4 autoprefixer
```

**Build order:**
1. `Shell.tsx` + `Sidebar.tsx` — layout skeleton
2. `App.tsx` — TanStack Router, all 11 routes registered
3. `api/client.ts` — fetch wrapper with bearer token
4. Overview page — 6 stat widgets + activity bar chart
5. Decisions page — sortable table + expandable row detail
6. Sessions page — timeline list + expand to changes
7. File Notes page — table with staleness badge + confidence dot
8. Tasks page — Kanban board (status columns) + list view toggle
9. Conventions page — grouped by category + enforced toggle
10. Changes page — feed with change_type chips
11. `CommandPalette.tsx` — cmdk + FTS wiring
12. `useWebSocket.ts` — WS connect + cache invalidation
13. Instances page — instance cards + health badges
14. Settings page — token rotation + theme + connection config

**Completion criteria:** All 11 routes render live data. Cmd+K search returns results. WS live-updates visible (session start shows in timeline instantly). Build output served by `engram --mode=dashboard`.

---

### Phase 2 — Full Management (Weeks 5–6)
Full write access across all memory types. Conflict resolution. Import wizard.

- Decision + convention CRUD
- Conflict resolution panel (side-by-side diff; audit log write)
- Import wizard (4-step; staged review; provenance tagging)
- Bulk select + soft-delete + recovery bin
- Analytics page: activity charts, staleness report, coverage heatmap
- Annotation UI (inline human notes on any record)
- Audit log page

---

### Phase 3 — Cloud Backup (Weeks 7–8)
Google Drive or self-hosted S3. AES-256-GCM encrypted. Scheduled.

- OAuth2 Google flow (backend route + frontend wizard)
- `keytar` for refresh token + AES key storage
- Backup progress via WS `backup_progress` events
- Restore wizard (5-step; preview → execute)
- Key fingerprint display + rotation UI

---

### Phase 4 — Analytics & Intelligence (Weeks 9–10)
- Task velocity and agent activity charts
- Project KB report (Markdown/PDF export)
- Knowledge graph with React Flow (optional P5)

---

## 7. Development Workflow

```bash
# Terminal 1 — backend (watch mode)
npm run dev  # tsc --watch; or: node dist/index.js --mode=http

# Terminal 2 — frontend (hot reload)
cd packages/engram-dashboard
npm run dev  # Vite on :5173; proxies /api + /ws → :7432
```

`vite.config.ts` proxy:
```ts
server: {
  proxy: {
    '/api': 'http://localhost:7432',
    '/ws': { target: 'ws://localhost:7432', ws: true }
  }
}
```

---

## 8. Build & Release

```json
// Root package.json additions
"build:dashboard": "cd packages/engram-dashboard && npm run build",
"build:all": "tsc && npm run build:dashboard",
"start:dashboard": "node dist/index.js --mode=dashboard"
```

Production: built SPA (`packages/engram-dashboard/dist/`) is bundled into npm package. `express.static()` serves it at `/`. API at `/api/v1/`. SPA catch-all returns `index.html` for unknown GET routes.

---

## 9. Test Coverage Requirements

| Area | Tooling | Target |
|---|---|---|
| HTTP route handlers | Vitest + supertest | 80% line |
| Repository methods (v18–v22 entities) | Vitest + test-db.ts | 80% line |
| Dashboard API client | Vitest (mocked fetch) | 100% error paths |
| WS event dispatch | Vitest | All 8 event types |
| E2E flows (Phase 2+) | Playwright | 6 key UX flows |

---

## 10. Security Checklist

- [ ] HTTP server binds `127.0.0.1` only — never `0.0.0.0`
- [ ] Bearer token is `crypto.randomBytes(32).toString('hex')`
- [ ] Token stored in OS keychain (`keytar`); fallback to `.engram-token` file at `chmod 600`
- [ ] Token transmitted only in `Authorization` header — never in URL
- [ ] CORS: allow-list `http://localhost:5173` (dev) + `http://localhost:7432` (prod SPA) only
- [ ] All destructive mutations write to `audit_log` before executing
- [ ] Cloud backup encrypted AES-256-GCM; key never leaves device without user action
- [ ] `deleted_at` soft-delete on all writable tables; no hard-deletes via API in Phase 1

---

*Cross-instance infrastructure (v1.8.0) is the hard part — done. The dashboard is the face on top of it.*

*See `dashboard-design.md` for visual design system, micro-interactions, and per-page UX specs.*
*See `dashboard-assets.md` for all production assets that cannot be coded.*
