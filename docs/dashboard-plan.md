>> | Deployment mode | **Browser SPA shipped inside npm package** — served by Ex
press from `packages/engram-dashboard/dist/` | Zero external install; one binary |                                                                              >> | Auth model | **Bearer token** — generated on first `--mode=http` start, sto
red in OS keychain; required for all API calls | Defense-in-depth |             >>
>> ---
>>
>> ## 1. Package Structure
>>
>> ```
>> packages/
>>   engram-dashboard/          ← new monorepo package
>>     package.json
>>     vite.config.ts
>>     tsconfig.json
>>     index.html
>>     src/
>>       main.tsx
>>       App.tsx
>>       api/                   ← HTTP client layer (one file per resource)
>>         client.ts            ← fetch wrapper + bearer token + error envelope
>>         decisions.ts
>>         sessions.ts
>>         file-notes.ts
>>         tasks.ts
>>         conventions.ts
>>         changes.ts
>>         milestones.ts
>>         events.ts
>>         instances.ts
>>         analytics.ts
>>         settings.ts
>>       components/
>>         layout/
>>           Shell.tsx           ← outermost wrapper: sidebar + main area
>>           Sidebar.tsx
>>           CommandPalette.tsx  ← cmdk-based Cmd+K overlay
>>           TopBar.tsx          ← breadcrumbs + global actions
>>         memory/
>>           DecisionTable.tsx
>>           FileNoteTable.tsx
>>           TaskBoard.tsx
>>           TaskCard.tsx
>>           SessionTimeline.tsx
>>           ConventionBook.tsx
>>           ChangesFeed.tsx
>>           MilestoneLog.tsx
>>         instance/
>>           InstancePanel.tsx
>>           InstanceSwitcher.tsx
>>           ConflictResolution.tsx
>>           InstanceHealthCard.tsx
>>         analytics/
>>           StatsWidgets.tsx
>>           ActivityChart.tsx
>>           StalenessReport.tsx
>>         shared/
>>           Badge.tsx
>>           ConfidenceDot.tsx
>>           RelativeTime.tsx
>>           ExpandableRow.tsx
>>           EmptyState.tsx
>>           LoadingShimmer.tsx
>>           DiffViewer.tsx
>>           SearchInput.tsx
>>           PaginationBar.tsx
>>       hooks/
>>         useInstances.ts       ← TanStack Query: instance list + selected
>>         useWebSocket.ts       ← WS connection + cache invalidation
>>         useCommandPalette.ts  ← cmdk integration
>>         useSearch.ts          ← debounced FTS calls
>>       stores/
>>         instance.store.ts     ← Zustand: selectedInstanceId, allInstances, is
GlobalView                                                                      >>         ui.store.ts           ← Zustand: sidebarOpen, privacyMode, theme, not
ifications                                                                      >>       lib/
>>         utils.ts
>>         date.ts               ← date-fns wrappers
>>         diff.ts               ← react-diff-viewer-continued helpers
>>       routes/
>>         index.tsx             ← /  → Dashboard Overview
>>         sessions.tsx          ← /sessions
>>         decisions.tsx         ← /decisions
>>         file-notes.tsx        ← /file-notes
>>         tasks.tsx             ← /tasks
>>         conventions.tsx       ← /conventions
>>         changes.tsx           ← /changes
>>         analytics.tsx         ← /analytics
>>         instances.tsx         ← /instances
>>         import.tsx            ← /import
>>         settings.tsx          ← /settings
>>       types/
>>         api.ts                ← mirrored response types from server
>>
>> src/
>>   http-server.ts             ← new: Express 5 app factory
>>   http-auth.ts               ← new: Bearer token middleware
>>   http-pagination.ts         ← new: cursor pagination helpers
>>   http-routes/               ← new: one file per resource domain
>>     sessions.routes.ts
>>     decisions.routes.ts
>>     file-notes.routes.ts
>>     tasks.routes.ts
>>     conventions.routes.ts
>>     changes.routes.ts
>>     milestones.routes.ts
>>     events.routes.ts
>>     instances.routes.ts
>>     analytics.routes.ts
>>     settings.routes.ts
>>     export-import.routes.ts
>>     sensitive.routes.ts
>>     audit.routes.ts
>>     annotations.routes.ts
>>     search.routes.ts
>>     ws.routes.ts             ← WebSocket upgrade handler
>> ```
>>
>> ---
>>
>> ## 2. Schema Migrations (v18–v22)
>>
>> All migrations append-only in `src/migrations.ts`. Do NOT edit existing migra
tion entries.                                                                   >>
>> ### v18 — HTTP API Token
>> ```sql
>> -- Per-instance Bearer token stored as config key CFG_HTTP_TOKEN
>> -- Actual token value lives in OS keychain; config stores slug only
>> ```
>> *(Implemented as config table entry, not ALTER TABLE — config table is alread
y flexible)*                                                                    >>
>> ### v19 — Soft Delete Columns
>> ```sql
>> ALTER TABLE decisions ADD COLUMN deleted_at INTEGER;
>> ALTER TABLE file_notes ADD COLUMN deleted_at INTEGER;
>> ALTER TABLE tasks ADD COLUMN deleted_at INTEGER;
>> ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;
>> ```
>> All queries gain implicit `WHERE deleted_at IS NULL`. Recoverable via `?inclu
de_deleted=true`.                                                               >>
>> ### v20 — Audit Log
>> ```sql
>> CREATE TABLE IF NOT EXISTS audit_log (
>>   id INTEGER PRIMARY KEY AUTOINCREMENT,
>>   created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
>>   action TEXT NOT NULL,
>>   actor TEXT NOT NULL DEFAULT 'human',
>>   table_name TEXT NOT NULL,
>>   record_id INTEGER,
>>   before_json TEXT,
>>   after_json TEXT,
>>   session_id TEXT
>> );
>> CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);  
>> ```
>>
>> ### v21 — Import Jobs
>> ```sql
>> CREATE TABLE IF NOT EXISTS import_jobs (
>>   id INTEGER PRIMARY KEY AUTOINCREMENT,
>>   created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
>>   source_path TEXT NOT NULL,
>>   source_agent TEXT,
>>   status TEXT NOT NULL DEFAULT 'pending',
>>   total_records INTEGER DEFAULT 0,
>>   approved_count INTEGER DEFAULT 0,
>>   rejected_count INTEGER DEFAULT 0,
>>   trust_level TEXT DEFAULT 'review-required',
>>   raw_json TEXT NOT NULL,
>>   completed_at INTEGER
>> );
>> ```
>>
>> ### v22 — Human Annotations
>> ```sql
>> CREATE TABLE IF NOT EXISTS annotations (
>>   id INTEGER PRIMARY KEY AUTOINCREMENT,
>>   created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
>>   target_table TEXT NOT NULL,
>>   target_id INTEGER NOT NULL,
>>   note TEXT NOT NULL,
>>   author TEXT NOT NULL DEFAULT 'human'
>> );
>> CREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_table
, target_id);                                                                   >> ```
>>
>> ---
>>
>> ## 3. HTTP API Specification
>>
>> - **Bind:** `127.0.0.1:7432` only (never `0.0.0.0`)
>> - **Base path:** `/api/v1/`
>> - **Auth:** `Authorization: Bearer <token>` on every route
>> - **Response envelope (success):** `{ "ok": true, "data": { ... }, "meta": { 
"request_id": "...", "duration_ms": 12 } }`                                     >> - **Response envelope (error):** `{ "ok": false, "error": "NOT_FOUND", "messa
ge": "human text" }`                                                            >> - **Pagination:** cursor-based — `{ "data": [...], "cursor": "eyJ...", "hasMo
re": true, "total": 1200 }`                                                     >>
>> ### Route Catalog
>>
>> | Method | Path | Description |
>> |---|---|---|
>> | GET | `/api/v1/sessions` | List sessions — paginated, filterable by agent/d
ate |                                                                           >> | GET | `/api/v1/sessions/:id` | Session detail with changes count |
>> | GET | `/api/v1/decisions` | List decisions — status, tags, text filters |  
>> | GET | `/api/v1/decisions/:id` | Full decision detail |
>> | PUT | `/api/v1/decisions/:id` | Update decision text, rationale, tags |    
>> | DELETE | `/api/v1/decisions/:id` | Soft-delete |
>> | GET | `/api/v1/file-notes` | List file notes — sortable, staleness filter |
>> | GET | `/api/v1/file-notes/:id` | Full file note |
>> | PUT | `/api/v1/file-notes/:id` | Update fields |
>> | DELETE | `/api/v1/file-notes/:id` | Soft-delete |
>> | GET | `/api/v1/conventions` | All conventions |
>> | PUT | `/api/v1/conventions/:id` | Toggle enforced; update rule text |      
>> | GET | `/api/v1/tasks` | Tasks — status, priority, agent filters |
>> | GET | `/api/v1/tasks/:id` | Task detail |
>> | POST | `/api/v1/tasks` | Create task |
>> | PUT | `/api/v1/tasks/:id` | Update task |
>> | DELETE | `/api/v1/tasks/:id` | Soft-delete |
>> | GET | `/api/v1/changes` | Change feed — paginated |
>> | GET | `/api/v1/milestones` | All milestones |
>> | GET | `/api/v1/events` | Scheduled events |
>> | GET | `/api/v1/broadcasts` | Broadcast inbox |
>> | GET | `/api/v1/analytics/stats` | Aggregate counts per type |
>> | GET | `/api/v1/analytics/activity` | Sessions per day for chart |
>> | GET | `/api/v1/analytics/staleness` | Stale file notes ranked |
>> | GET | `/api/v1/analytics/coverage` | File note coverage map |
>> | GET | `/api/v1/search` | FTS5 across all memory types (`?q=&types=`) |
>> | GET | `/api/v1/instances` | All local instances |
>> | GET | `/api/v1/instances/:id` | Instance detail + health |
>> | PUT | `/api/v1/instances/:id/label` | Set instance label |
>> | PUT | `/api/v1/instances/:id/sharing` | Toggle sharing mode/types |        
>> | GET | `/api/v1/instances/:id/query` | Cross-instance read query |
>> | GET | `/api/v1/sensitive` | List sensitive keys |
>> | PUT | `/api/v1/sensitive/lock` | Lock records |
>> | PUT | `/api/v1/sensitive/unlock` | Unlock records |
>> | POST | `/api/v1/sensitive/request` | Create access request |
>> | PUT | `/api/v1/sensitive/:id/approve` | Approve access request |
>> | PUT | `/api/v1/sensitive/:id/deny` | Deny access request |
>> | POST | `/api/v1/export` | Export memory subset |
>> | POST | `/api/v1/import/preview` | Preview import file (no DB write) |      
>> | POST | `/api/v1/import/stage` | Stage an import job |
>> | PUT | `/api/v1/import/:id/approve` | Approve staged import |
>> | GET | `/api/v1/audit` | Audit log — paginated |
>> | GET | `/api/v1/annotations/:table/:id` | Annotations for one record |      
>> | POST | `/api/v1/annotations` | Create annotation |
>> | GET | `/api/v1/settings` | Current config |
>> | PUT | `/api/v1/settings` | Update config |
>> | POST | `/api/v1/token/rotate` | Rotate API token |
>> | GET/Upgrade | `/ws` | WebSocket upgrade |
>>
>> ---
>>
>> ## 4. WebSocket Protocol
>>
>> - **Connection:** `ws://localhost:7432/ws`
>> - **Handshake:** First message must be `{ "type": "auth", "token": "<bearer>"
 }` — server replies `{ "type": "auth_ok" }` or closes with code 4001           >>
>> ### Server → Client Events
>>
>> | Event | Payload | Dashboard reaction |
>> |---|---|---|
>> | `session_started` | `{ session_id, agent, project_root }` | Invalidate sess
ions query |                                                                    >> | `session_ended` | `{ session_id, duration_ms }` | Invalidate sessions query
 |                                                                              >> | `conflict_detected` | `{ table, record_id, instances: [A, B] }` | Show conf
lict badge in status bar |                                                      >> | `backup_progress` | `{ job_id, percent, bytes_written }` | Update backup pa
nel progress bar |                                                              >> | `sync_received` | `{ instance_id, record_count }` | Invalidate cross-instan
ce queries |                                                                    >> | `task_updated` | `{ task_id, status, agent }` | Invalidate `tasks/:id` quer
y |                                                                             >> | `event_triggered` | `{ event_id, title }` | Show toast notification |      
>> | `sensitive_request` | `{ request_id, requester, key }` | Show access reques
t badge |                                                                       >>
>> ---
>>
>> ## 5. Performance Budget
>>
>> | Interaction | Target | Technique |
>> |---|---|---|
>> | Dashboard cold start | < 1.5s | Lazy routes; code-split per route |        
>> | Memory list render (1000 rows) | < 100ms | TanStack Virtual + indexed SQL q
ueries |                                                                        >> | FTS search (50k records) | < 50ms | SQLite FTS5 (already live) |
>> | Decision save (optimistic) | Instant + < 200ms confirm | Optimistic mutatio
n in TanStack Query |                                                           >> | WS event → UI update | < 50ms | `queryClient.invalidateQueries()` on messag
e |                                                                             >> | Route transition | < 150ms | Preload on hover; no data waterfalls |        
>> | Backup (100MB) | Progress shown; non-blocking | WS stream + progress events
 |                                                                              >>
>> ---
>>
>> ## 6. Implementation Phases
>>
>> ### Phase 0 — HTTP Foundation (Week 1)
>> No UI yet. All backend API and WebSocket infrastructure.
>>
>> **Files to create/modify:**
>>
>> | File | Action |
>> |---|---|
>> | `src/migrations.ts` | Append v18–v22 |
>> | `src/http-server.ts` | Create — Express 5 factory, cors, static, `/api/v1` 
mount |                                                                         >> | `src/http-auth.ts` | Create — Bearer middleware; keychain read; POSIX chmod
 fallback |                                                                     >> | `src/http-pagination.ts` | Create — `encodeCursor()`, `decodeCursor()`, `bu
ildPage()` helpers |                                                            >> | `src/http-routes/*.routes.ts` | Create — 16 route files (see structure abov
e) |                                                                            >> | `src/index.ts` | Modify — add `--mode=http` / `--mode=dashboard` flag; auto
-open browser |                                                                 >> | `package.json` | Modify — add `express`, `@types/express`, `cors`, `ws`, `@
types/ws`, `keytar`, `open` |                                                   >>
>> **Completion criteria:** `node dist/index.js --mode=http --port=7432` returns
 valid JSON envelopes on all routes; WS upgrade works; migration runs without error on existing DBs.                                                            >>
>> ---
>>
>> ### Phase 1 — Dashboard MVP (Weeks 2–4)
>> Functional read-heavy SPA. Every memory type browsable.
>>
>> **Bootstrap:**
>> ```bash
>> mkdir packages/engram-dashboard
>> cd packages/engram-dashboard
>> npm init -y
>> npm install react@19 react-dom@19 \
>>   @tanstack/react-query@5 @tanstack/react-router@1 \
>>   @tanstack/react-table@8 @tanstack/react-virtual@3 \
>>   zustand@5 cmdk lucide-react date-fns recharts \
>>   react-diff-viewer-continued tinykeys \
>>   react-hook-form zod
>> npm install -D vite@6 @vitejs/plugin-react typescript \
>>   @types/react @types/react-dom tailwindcss@4 autoprefixer
>> ```
>>
>> **Build order:**
>> 1. `Shell.tsx` + `Sidebar.tsx` — layout skeleton
>> 2. `App.tsx` — TanStack Router, all 11 routes registered
>> 3. `api/client.ts` — fetch wrapper with bearer token
>> 4. Overview page — 6 stat widgets + activity bar chart
>> 5. Decisions page — sortable table + expandable row detail
>> 6. Sessions page — timeline list + expand to changes
>> 7. File Notes page — table with staleness badge + confidence dot
>> 8. Tasks page — Kanban board (status columns) + list view toggle
>> 9. Conventions page — grouped by category + enforced toggle
>> 10. Changes page — feed with change_type chips
>> 11. `CommandPalette.tsx` — cmdk + FTS wiring
>> 12. `useWebSocket.ts` — WS connect + cache invalidation
>> 13. Instances page — instance cards + health badges
>> 14. Settings page — token rotation + theme + connection config
>>
>> **Completion criteria:** All 11 routes render live data. Cmd+K search returns
 results. WS live-updates visible (session start shows in timeline instantly). Build output served by `engram --mode=dashboard`.                                >>
>> ---
>>
>> ### Phase 2 — Full Management (Weeks 5–6)
>> Full write access across all memory types. Conflict resolution. Import wizard
.                                                                               >>
>> - Decision + convention CRUD
>> - Conflict resolution panel (side-by-side diff; audit log write)
>> - Import wizard (4-step; staged review; provenance tagging)
>> - Bulk select + soft-delete + recovery bin
>> - Analytics page: activity charts, staleness report, coverage heatmap
>> - Annotation UI (inline human notes on any record)
>> - Audit log page
>>
>> ---
>>
>> ### Phase 3 — Cloud Backup (Weeks 7–8)
>> Google Drive or self-hosted S3. AES-256-GCM encrypted. Scheduled.
>>
>> - OAuth2 Google flow (backend route + frontend wizard)
>> - `keytar` for refresh token + AES key storage
>> - Backup progress via WS `backup_progress` events
>> - Restore wizard (5-step; preview → execute)
>> - Key fingerprint display + rotation UI
>>
>> ---
>>
>> ### Phase 4 — Analytics & Intelligence (Weeks 9–10)
>> - Task velocity and agent activity charts
>> - Project KB report (Markdown/PDF export)
>> - Knowledge graph with React Flow (optional P5)
>>
>> ---
>>
>> ## 7. Development Workflow
>> 
>> ```bash
>> # Terminal 1 — backend (watch mode)
>> npm run dev  # tsc --watch; or: node dist/index.js --mode=http
>>
>> # Terminal 2 — frontend (hot reload)
>> cd packages/engram-dashboard
>> npm run dev  # Vite on :5173; proxies /api + /ws → :7432
>> ```
>>
>> `vite.config.ts` proxy:
>> ```ts
>> server: {
>>   proxy: {
>>     '/api': 'http://localhost:7432',
>>     '/ws': { target: 'ws://localhost:7432', ws: true }
>>   }
>> }
>> ```
>>
>> ---
>>
>> ## 8. Build & Release
>>
>> ```json
>> // Root package.json additions
>> "build:dashboard": "cd packages/engram-dashboard && npm run build",
>> "build:all": "tsc && npm run build:dashboard",
>> "start:dashboard": "node dist/index.js --mode=dashboard"
>> ```
>>
>> Production: built SPA (`packages/engram-dashboard/dist/`) is bundled into npm
 package. `express.static()` serves it at `/`. API at `/api/v1/`. SPA catch-all returns `index.html` for unknown GET routes.                                    >>
>> ---
>>
>> ## 9. Test Coverage Requirements
>>
>> | Area | Tooling | Target |
>> |---|---|---|
>> | HTTP route handlers | Vitest + supertest | 80% line |
>> | Repository methods (v18–v22 entities) | Vitest + test-db.ts | 80% line |
>> | Dashboard API client | Vitest (mocked fetch) | 100% error paths |
>> | WS event dispatch | Vitest | All 8 event types |
>> | E2E flows (Phase 2+) | Playwright | 6 key UX flows |
>>
>> ---
>>
>> ## 10. Security Checklist
>>
>> - [ ] HTTP server binds `127.0.0.1` only — never `0.0.0.0`
>> - [ ] Bearer token is `crypto.randomBytes(32).toString('hex')`
>> - [ ] Token stored in OS keychain (`keytar`); fallback to `.engram-token` fil
e at `chmod 600`                                                                >> - [ ] Token transmitted only in `Authorization` header — never in URL        
>> - [ ] CORS: allow-list `http://localhost:5173` (dev) + `http://localhost:7432
` (prod SPA) only                                                               >> - [ ] All destructive mutations write to `audit_log` before executing        
>> - [ ] Cloud backup encrypted AES-256-GCM; key never leaves device without use
r action                                                                        >> - [ ] `deleted_at` soft-delete on all writable tables; no hard-deletes via AP
I in Phase 1                                                                    >>
>> ---
>>
>> *Cross-instance infrastructure (v1.8.0) is the hard part — done. The dashboar
d is the face on top of it.*                                                    >>
>> *See `dashboard-design.md` for visual design system, micro-interactions, and 
per-page UX specs.*                                                             >> *See `dashboard-assets.md` for all production assets that cannot be coded.*  
>> '@
ew monorepo package\x0a    package.json\x0a    vite.config.ts\x0a    tsconfig.js
on\x0a    index.html\x0a    src/\x0a      main.tsx\x0a      App.tsx\x0a      api/                   TTP client layer (one file per resource)\x0a        client.ts            etch wrapper + bearer token + error envelope\x0a        decisions.ts\x0a        sessions.ts\x0a        file-notes.ts\x0a        tasks.ts\x0a        conventions.ts\x0a        changes.ts\x0a        milestones.ts\x0a        events.ts\x0a        instances.ts\x0a        analytics.ts\x0a        settings.ts\x0a      components/\x0a        layout/\x0a          Shell.tsx           utermost wrapper: sidebar + main area\x0a          Sidebar.tsx\x0a          CommandPalette.tsx  mdk-based Cmd+K overlay\x0a          TopBar.tsx          readcrumbs + global actions\x0a        memory/\x0a          DecisionTable.tsx\x0a          FileNoteTable.tsx\x0a          TaskBoard.tsx\x0a          TaskCard.tsx\x0a          SessionTimeline.tsx\x0a          ConventionBook.tsx\x0a          ChangesFeed.tsx\x0a          MilestoneLog.tsx\x0a        instance/\x0a          InstancePanel.tsx\x0a          InstanceSwitcher.tsx\x0a          ConflictResolution.tsx\x0a          InstanceHealthCard.tsx\x0a        analytics/\x0a          StatsWidgets.tsx\x0a          ActivityChart.tsx\x0a          StalenessReport.tsx\x0a        shared/\x0a          Badge.tsx\x0a          ConfidenceDot.tsx\x0a          RelativeTime.tsx\x0a          ExpandableRow.tsx\x0a          EmptyState.tsx\x0a          LoadingShimmer.tsx\x0a          DiffViewer.tsx\x0a          SearchInput.tsx\x0a          PaginationBar.tsx\x0a      hooks/\x0a        useInstances.ts       anStack Query: instance list + selected\x0a        useWebSocket.ts       S connection + cache invalidation\x0a        useCommandPalette.ts  mdk integration\x0a        useSearch.ts          ebounced FTS calls\x0a      stores/\x0a        instance.store.ts     ustand: selectedInstanceId, allInstances, isGlobalView\x0a        ui.store.ts           ustand: sidebarOpen, privacyMode, theme, notifications\x0a      lib/\x0a        utils.ts\x0a        date.ts               ate-fns wrappers\x0a        diff.ts               eact-diff-viewer-continued helpers\x0a      routes/\x0a        index.tsx             ␦ Dashboard Overview\x0a        sessions.tsx          essions\x0a        decisions.tsx         ecisions\x0a        file-notes.tsx        ile-notes\x0a        tasks.tsx             asks\x0a        conventions.tsx       onventions\x0a        changes.tsx           hanges\x0a        analytics.tsx         nalytics\x0a        instances.tsx         nstances\x0a        import.tsx            mport\x0a        settings.tsx          ettings\x0a      types/\x0a        api.ts                irrored response types from server\x0a\x0asrc/\x0a  http-server.ts             ew: Express 5 app factory\x0a  http-auth.ts               ew: Bearer token middleware\x0a  http-pagination.ts         ew: cursor pagination helpers\x0a  http-routes/               ew: one file per resource domain\x0a    sessions.routes.ts\x0a    decisions.routes.ts\x0a    file-notes.routes.ts\x0a    tasks.routes.ts\x0a    conventions.routes.ts\x0a    changes.routes.ts\x0a    milestones.routes.ts\x0a    events.routes.ts\x0a    instances.routes.ts\x0a    analytics.routes.ts\x0a    settings.routes.ts\x0a    export-import.routes.ts\x0a    sensitive.routes.ts\x0a    audit.routes.ts\x0a    annotations.routes.ts\x0a    search.routes.ts\x0a    ws.routes.ts             ebSocket upgrade handler\x0a```\x0a\x0a---\x0a\x0a## 2. Schema Migrations (v18-v22)\x0a\x0aAll migrations append-only in `src/migrations.ts`. Do NOT edit existing migration entries.\x0a\x0a### v18 - HTTP API Token\x0a```sql\x0a-- Per-instance Bearer token stored as config key CFG_HTTP_TOKEN\x0a-- Actual token value lives in OS keychain\x3b config stores slug only\x0a```\x0a*(Implemented as config table entry, not ALTER TABLE - config table is already flexible)*\x0a\x0a### v19 - Soft Delete Columns\x0a```sql\x0aALTER TABLE decisions ADD COLUMN deleted_at INTEGER\x3b\x0aALTER TABLE file_notes ADD COLUMN deleted_at INTEGER\x3b\x0aALTER TABLE tasks ADD COLUMN deleted_at INTEGER\x3b\x0aALTER TABLE sessions ADD COLUMN deleted_at INTEGER\x3b\x0a```\x0aAll queries gain implicit `WHERE deleted_at IS NULL`. Recoverable via `?include_deleted=true`.\x0a\x0a### v20 - Audit Log\x0a```sql\x0aCREATE TABLE IF NOT EXISTS audit_log (\x0a  id INTEGER PRIMARY KEY AUTOINCREMENT,\x0a  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),\x0a  action TEXT NOT NULL,\x0a  actor TEXT NOT NULL DEFAULT 'human',\x0a  table_name TEXT NOT NULL,\x0a  record_id INTEGER,\x0a  before_json TEXT,\x0a  after_json TEXT,\x0a  session_id TEXT\x0a)\x3b\x0aCREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)\x3b\x0a```\x0a\x0a### v21 - Import Jobs\x0a```sql\x0aCREATE TABLE IF NOT EXISTS import_jobs (\x0a  id INTEGER PRIMARY KEY AUTOINCREMENT,\x0a  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),\x0a  source_path TEXT NOT NULL,\x0a  source_agent TEXT,\x0a  status TEXT NOT NULL DEFAULT 'pending',\x0a  total_records INTEGER DEFAULT 0,\x0a  approved_count INTEGER DEFAULT 0,\x0a  rejected_count INTEGER DEFAULT 0,\x0a  trust_level TEXT DEFAULT 'review-required',\x0a  raw_json TEXT NOT NULL,\x0a  completed_at INTEGER\x0a)\x3b\x0a```\x0a\x0a### v22 - Human Annotations\x0a```sql\x0aCREATE TABLE IF NOT EXISTS annotations (\x0a  id INTEGER PRIMARY KEY AUTOINCREMENT,\x0a  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),\x0a  target_table TEXT NOT NULL,\x0a  target_id INTEGER NOT NULL,\x0a  note TEXT NOT NULL,\x0a  author TEXT NOT NULL DEFAULT 'human'\x0a)\x3b\x0aCREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_table, target_id)\x3b\x0a```\x0a\x0a---\x0a\x0a## 3. HTTP API Specification\x0a\x0a- **Bind:** `127.0.0.1:7432` only (never `0.0.0.0`)\x0a- **Base path:** `/api/v1/`\x0a- **Auth:** `Authorization: Bearer <token>` on every route\x0a- **Response envelope (success):** `{ "ok": true, "data": { ... }, "meta": { "request_id": "...", "duration_ms": 12 } }`\x0a- **Response envelope (error):** `{ "ok": false, "error": "NOT_FOUND", "message": "human text" }`\x0a- **Pagination:** cursor-based - `{ "data": [...], "cursor": "eyJ...", "hasMore": true, "total": 1200 }`\x0a\x0a### Route Catalog\x0a\x0a| Method | Path | Description |\x0a|---|---|---|\x0a| GET | `/api/v1/sessions` | List sessions - paginated, filterable by agent/date |\x0a| GET | `/api/v1/sessions/:id` | Session detail with changes count |\x0a| GET | `/api/v1/decisions` | List decisions - status, tags, text filters |\x0a| GET | `/api/v1/decisions/:id` | Full decision detail |\x0a| PUT | `/api/v1/decisions/:id` | Update decision text, rationale, tags |\x0a| DELETE | `/api/v1/decisions/:id` | Soft-delete |\x0a| GET | `/api/v1/file-notes` | List file notes - sortable, staleness filter |\x0a| GET | `/api/v1/file-notes/:id` | Full file note |\x0a| PUT | `/api/v1/file-notes/:id` | Update fields |\x0a| DELETE | `/api/v1/file-notes/:id` | Soft-delete |\x0a| GET | `/api/v1/conventions` | All conventions |\x0a| PUT | `/api/v1/conventions/:id` | Toggle enforced\x3b update rule text |\x0a| GET | `/api/v1/tasks` | Tasks - status, priority, agent filters |\x0a| GET | `/api/v1/tasks/:id` | Task detail |\x0a| POST | `/api/v1/tasks` | Create task |\x0a| PUT | `/api/v1/tasks/:id` | Update task |\x0a| DELETE | `/api/v1/tasks/:id` | Soft-delete |\x0a| GET | `/api/v1/changes` | Change feed - paginated |\x0a| GET | `/api/v1/milestones` | All milestones |\x0a| GET | `/api/v1/events` | Scheduled events |\x0a| GET | `/api/v1/broadcasts` | Broadcast inbox |\x0a| GET | `/api/v1/analytics/stats` | Aggregate counts per type |\x0a| GET | `/api/v1/analytics/activity` | Sessions per day for chart |\x0a| GET | `/api/v1/analytics/staleness` | Stale file notes ranked |\x0a| GET | `/api/v1/analytics/coverage` | File note coverage map |\x0a| GET | `/api/v1/search` | FTS5 across all memory types (`?q=&types=`) |\x0a| GET | `/api/v1/instances` | All local instances |\x0a| GET | `/api/v1/instances/:id` | Instance detail + health |\x0a| PUT | `/api/v1/instances/:id/label` | Set instance label |\x0a| PUT | `/api/v1/instances/:id/sharing` | Toggle sharing mode/types |\x0a| GET | `/api/v1/instances/:id/query` | Cross-instance read query |\x0a| GET | `/api/v1/sensitive` | List sensitive keys |\x0a| PUT | `/api/v1/sensitive/lock` | Lock records |\x0a| PUT | `/api/v1/sensitive/unlock` | Unlock records |\x0a| POST | `/api/v1/sensitive/request` | Create access request |\x0a| PUT | `/api/v1/sensitive/:id/approve` | Approve access request |\x0a| PUT | `/api/v1/sensitive/:id/deny` | Deny access request |\x0a| POST | `/api/v1/export` | Export memory subset |\x0a| POST | `/api/v1/import/preview` | Preview import file (no DB write) |\x0a| POST | `/api/v1/import/stage` | Stage an import job |\x0a| PUT | `/api/v1/import/:id/approve` | Approve staged import |\x0a| GET | `/api/v1/audit` | Audit log - paginated |\x0a| GET | `/api/v1/annotations/:table/:id` | Annotations for one record |\x0a| POST | `/api/v1/annotations` | Create annotation |\x0a| GET | `/api/v1/settings` | Current config |\x0a| PUT | `/api/v1/settings` | Update config |\x0a| POST | `/api/v1/token/rotate` | Rotate API token |\x0a| GET/Upgrade | `/ws` | WebSocket upgrade |\x0a\x0a---\x0a\x0a## 4. WebSocket Protocol\x0a\x0a- **Connection:** `ws://localhost:7432/ws`\x0a- **Handshake:** First message must be `{ "type": "auth", "token": "<bearer>" }` - server replies `{ "type": "auth_ok" }` or closes with code 4001\x0a\x0a### Server ␦ Client Events\x0a\x0a| Event | Payload | Dashboard reaction |\x0a|---|---|---|\x0a| `session_started` | `{ session_id, agent, project_root }` | Invalidate sessions query |\x0a| `session_ended` | `{ session_id, duration_ms }` | Invalidate sessions query |\x0a| `conflict_detected` | `{ table, record_id, instances: [A, B] }` | Show conflict badge in status bar |\x0a| `backup_progress` | `{ job_id, percent, bytes_written }` | Update backup panel progress bar |\x0a| `sync_received` | `{ instance_id, record_count }` | Invalidate cross-instance queries |\x0a| `task_updated` | `{ task_id, status, agent }` | Invalidate `tasks/:id` query |\x0a| `event_triggered` | `{ event_id, title }` | Show toast notification |\x0a| `sensitive_request` | `{ request_id, requester, key }` | Show access request badge |\x0a\x0a---\x0a\x0a## 5. Performance Budget\x0a\x0a| Interaction | Target | Technique |\x0a|---|---|---|\x0a| Dashboard cold start | < 1.5s | Lazy routes\x3b code-split per route |\x0a| Memory list render (1000 rows) | < 100ms | TanStack Virtual + indexed SQL queries |\x0a| FTS search (50k records) | < 50ms | SQLite FTS5 (already live) |\x0a| Decision save (optimistic) | Instant + < 200ms confirm | Optimistic mutation in TanStack Query |\x0a| WS event ␦ UI update | < 50ms | `queryClient.invalidateQueries()` on message |\x0a| Route transition | < 150ms | Preload on hover\x3b no data waterfalls |\x0a| Backup (100MB) | Progress shown\x3b non-blocking | WS stream + progress events |\x0a\x0a---\x0a\x0a## 6. Implementation Phases\x0a\x0a### Phase 0 - HTTP Foundation (Week 1)\x0aNo UI yet. All backend API and WebSocket infrastructure.\x0a\x0a**Files to create/modify:**\x0a\x0a| File | Action |\x0a|---|---|\x0a| `src/migrations.ts` | Append v18-v22 |\x0a| `src/http-server.ts` | Create - Express 5 factory, cors, static, `/api/v1` mount |\x0a| `src/http-auth.ts` | Create - Bearer middleware\x3b keychain read\x3b POSIX chmod fallback |\x0a| `src/http-pagination.ts` | Create - `encodeCursor()`, `decodeCursor()`, `buildPage()` helpers |\x0a| `src/http-routes/*.routes.ts` | Create - 16 route files (see structure above) |\x0a| `src/index.ts` | Modify - add `--mode=http` / `--mode=dashboard` flag\x3b auto-open browser |\x0a| `package.json` | Modify - add `express`, `@types/express`, `cors`, `ws`, `@types/ws`, `keytar`, `open` |\x0a\x0a**Completion criteria:** `node dist/index.js --mode=http --port=7432` returns valid JSON envelopes on all routes\x3b WS upgrade works\x3b migration runs without error on existing DBs.\x0a\x0a---\x0a\x0a### Phase 1 - Dashboard MVP (Weeks 2-4)\x0aFunctional read-heavy SPA. Every memory type browsable.\x0a\x0a**Bootstrap:**\x0a```bash\x0amkdir packages/engram-dashboard\x0acd packages/engram-dashboard\x0anpm init -y\x0anpm install react@19 react-dom@19 \x5c\x0a  @tanstack/react-query@5 @tanstack/react-router@1 \x5c\x0a  @tanstack/react-table@8 @tanstack/react-virtual@3 \x5c\x0a  zustand@5 cmdk lucide-react date-fns recharts \x5c\x0a  react-diff-viewer-continued tinykeys \x5c\x0a  react-hook-form zod\x0anpm install -D vite@6 @vitejs/plugin-react typescript \x5c\x0a  @types/react @types/react-dom tailwindcss@4 autoprefixer\x0a```\x0a\x0a**Build order:**\x0a1. `Shell.tsx` + `Sidebar.tsx` - layout skeleton\x0a2. `App.tsx` - TanStack Router, all 11 routes registered\x0a3. `api/client.ts` - fetch wrapper with bearer token\x0a4. Overview page - 6 stat widgets + activity bar chart\x0a5. Decisions page - sortable table + expandable row detail\x0a6. Sessions page - timeline list + expand to changes\x0a7. File Notes page - table with staleness badge + confidence dot\x0a8. Tasks page - Kanban board (status columns) + list view toggle\x0a9. Conventions page - grouped by category + enforced toggle\x0a10. Changes page - feed with change_type chips\x0a11. `CommandPalette.tsx` - cmdk + FTS wiring\x0a12. `useWebSocket.ts` - WS connect + cache invalidation\x0a13. Instances page - instance cards + health badges\x0a14. Settings page - token rotation + theme + connection config\x0a\x0a**Completion criteria:** All 11 routes render live data. Cmd+K search returns results. WS live-updates visible (session start shows in timeline instantly). Build output served by `engram --mode=dashboard`.\x0a\x0a---\x0a\x0a### Phase 2 - Full Management (Weeks 5-6)\x0aFull write access across all memory types. Conflict resolution. Import wizard.\x0a\x0a- Decision + convention CRUD\x0a- Conflict resolution panel (side-by-side diff\x3b audit log write)\x0a- Import wizard (4-step\x3b staged review\x3b provenance tagging)\x0a- Bulk select + soft-delete + recovery bin\x0a- Analytics page: activity charts, staleness report, coverage heatmap\x0a- Annotation UI (inline human notes on any record)\x0a- Audit log page\x0a\x0a---\x0a\x0a### Phase 3 - Cloud Backup (Weeks 7-8)\x0aGoogle Drive or self-hosted S3. AES-256-GCM encrypted. Scheduled.\x0a\x0a- OAuth2 Google flow (backend route + frontend wizard)\x0a- `keytar` for refresh token + AES key storage\x0a- Backup progress via WS `backup_progress` events\x0a- Restore wizard (5-step\x3b preview ␦ execute)\x0a- Key fingerprint display + rotation UI\x0a\x0a---\x0a\x0a### Phase 4 - Analytics & Intelligence (Weeks 9-10)\x0a- Task velocity and agent activity charts\x0a- Project KB report (Markdown/PDF export)\x0a- Knowledge graph with React Flow (optional P5)\x0a\x0a---\x0a\x0a## 7. Development Workflow\x0a\x0a```bash\x0a# Terminal 1 - backend (watch mode)\x0anpm run dev  # tsc --watch\x3b or: node dist/index.js --mode=http\x0a\x0a# Terminal 2 - frontend (hot reload)\x0acd packages/engram-dashboard\x0anpm run dev  # Vite on :5173\x3b proxies /api + /ws ␦ :7432\x0a```\x0a\x0a`vite.config.ts` proxy:\x0a```ts\x0aserver: {\x0a  proxy: {\x0a    '/api': 'http://localhost:7432',\x0a    '/ws': { target: 'ws://localhost:7432', ws: true }\x0a  }\x0a}\x0a```\x0a\x0a---\x0a\x0a## 8. Build & Release\x0a\x0a```json\x0a// Root package.json additions\x0a"build:dashboard": "cd packages/engram-dashboard && npm run build",\x0a"build:all": "tsc && npm run build:dashboard",\x0a"start:dashboard": "node dist/index.js --mode=dashboard"\x0a```\x0a\x0aProduction: built SPA (`packages/engram-dashboard/dist/`) is bundled into npm package. `express.static()` serves it at `/`. API at `/api/v1/`. SPA catch-all returns `index.html` for unknown GET routes.\x0a\x0a---\x0a\x0a## 9. Test Coverage Requirements\x0a\x0a| Area | Tooling | Target |\x0a|---|---|---|\x0a| HTTP route handlers | Vitest + supertest | 80% line |\x0a| Repository methods (v18-v22 entities) | Vitest + test-db.ts | 80% line |\x0a| Dashboard API client | Vitest (mocked fetch) | 100% error paths |\x0a| WS event dispatch | Vitest | All 8 event types |\x0a| E2E flows (Phase 2+) | Playwright | 6 key UX flows |\x0a\x0a---\x0a\x0a## 10. Security Checklist\x0a\x0a- [ ] HTTP server binds `127.0.0.1` only - never `0.0.0.0`\x0a- [ ] Bearer token is `crypto.randomBytes(32).toString('hex')`\x0a- [ ] Token stored in OS keychain (`keytar`)\x3b fallback to `.engram-token` file at `chmod 600`\x0a- [ ] Token transmitted only in `Authorization` header - never in URL\x0a- [ ] CORS: allow-list `http://localhost:5173` (dev) + `http://localhost:7432` (prod SPA) only\x0a- [ ] All destructive mutations write to `audit_log` before executing\x0a- [ ] Cloud backup encrypted AES-256-GCM\x3b key never leaves device without user action\x0a- [ ] `deleted_at` soft-delete on all writable tables\x3b no hard-deletes via API in Phase 1\x0a\x0a---\x0a\x0a*Cross-instance infrastructure (v1.8.0) is the hard part - done. The dashboard is the face on top of it.*\x0a\x0a*See `dashboard-design.md` for visual design system, micro-interactions, and per-page UX specs.*\x0a*See `dashboard-assets.md` for all production assets that cannot be coded.*\x0a'@;791ed203-1408-48f2-8789-58ecd71c57a5                                                                      
