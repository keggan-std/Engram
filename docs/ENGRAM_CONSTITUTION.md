# Engram Constitution — What Is Here, Why, and Where

**Version:** 1.0 · **Date:** 2026-08-02 · **Covers:** `engram-mcp-server` @ 1.11.0, schema V24
**Purpose:** The single document a human or agent reads to understand this codebase without re-deriving it. What each file is, why it exists, what it holds, what it touches, and what will bite you.

> **This document describes the code as it is, not as the README says it is.** Where the two disagree, this document follows the code and says so. See [`engram-deep-audit-2026-08-02.md`](engram-deep-audit-2026-08-02.md) §7 for the full list of divergences.

---

## Part I — Orientation

### 1. What Engram is

A local-first **MCP server** giving AI coding agents persistent, structured memory across sessions. Instead of embedding text into a vector store, it stores **typed records** in SQLite with FTS5 full-text search: sessions, decisions, conventions, tasks, file notes, changes, observations, milestones, scheduled events.

The bet: an agent that *curates* structured memory beats one that *retrieves* fuzzy chunks — cheaper, auditable, and no embedding model in the loop.

### 2. The 30-second mental model

```
IDE spawns:  npx engram-mcp-server [--ide=<key>] [--mode=universal|http]
                      │
                      ▼
              src/index.ts                    ← the ONLY entrypoint
                      │
        ┌─────────────┼──────────────┬─────────────────┐
        ▼             ▼              ▼                 ▼
   installer/    record-commit   http-server      MCP stdio server
   (CLI setup)   (git hook)      (dashboard)      (the actual product)
                                                        │
                                    ┌───────────────────┴─────────────┐
                                    ▼                                 ▼
                            4 dispatcher tools              1 tool (universal mode)
                            engram_session                  engram({action})
                            engram_memory                   modes/universal.ts
                            engram_admin                    re-routes to the same 4
                            engram_find
                                    │
                                    ▼
                            src/database.ts                 ← composition root
                          getDb / getRepos / getServices
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             repositories/                      services/
             (SQL only)                    (business logic, I/O)
                    │
                    ▼
        .engram/memory[-<ide>].db  (SQLite, WAL, 24 migrations)
```

### 3. The four architectural laws

These are followed consistently. Breaking one is a bug, not a style choice.

| # | Law | Why |
|---|---|---|
| 1 | **`repositories/` owns SQL. `services/` owns logic and I/O. `tools/` owns MCP dispatch.** | The one clean separation in the codebase. Preserve it. |
| 2 | **Never write to stdout.** Logging goes to `console.error` / `src/logger.ts`. | stdout is the JSON-RPC framing channel. A stray `console.log` corrupts the protocol. |
| 3 | **All responses go through `src/response.ts`.** | One envelope shape; `stripNulls` cuts 3–8% of response tokens. |
| 4 | **Array/number params need `coerceStringArray()` / `coerceNumberArray()`.** | MCP clients serialize arrays inconsistently. Omitting these causes intermittent `"must be object"` failures. |

### 4. Where things live

```
src/
├── index.ts              ← entrypoint; CLI branching; the only file that registers tools
├── database.ts           ← composition root: open DB, migrate, build repos + services
├── migrations.ts         ← 24 versioned migrations; the entire schema history
├── constants.ts          ← every tunable, config key name, and detection marker
├── types.ts              ← all row shapes and enum unions
├── utils.ts              ← coercion, project-root detection, file scan, git shell wrappers
├── response.ts errors.ts logger.ts global-db.ts
│
├── repositories/  (14)   ← SQL ONLY. One class per table. No business logic.
├── services/      (13)   ← business logic + all external I/O (network, fs, process)
├── tools/         (20)   ← MCP dispatch — but only 5 are live (see §7)
├── modes/         (1)    ← universal.ts: single-tool alternative surface
├── knowledge/     (8)    ← static PM methodology data. Pure constants, no I/O.
├── installer/     (4)    ← writes MCP config into 14 IDEs
├── http-routes/   (17)   ← dashboard REST API
└── scripts/       (1)    ← git hook installer
packages/
├── engram-dashboard/            ← React 19 + Vite SPA
├── engram-thin-client/          ← Anthropic-API-specific client
└── engram-universal-thin-client/← framework-agnostic BM25-routing client
```

### 5. Data on disk

| Path | Contents | Committed? |
|---|---|---|
| `<project>/.engram/memory.db` | Per-project memory. WAL mode. | No — `.engram/.gitignore` is `*` |
| `<project>/.engram/memory-<ide>.db` | Per-IDE shard (global installs without a workspace var) | No |
| `<project>/.engram/token` | Dashboard bearer token, `0o600` (POSIX only — **weaker on Windows**) | No |
| `<project>/.engram/agent_rules_cache.json` | Cached "binding" agent rules — **see §9, CRITICAL** | No |
| `<project>/.engram/backups/*.db` | Timestamped backups | No |
| `<project>/.engram/git-changes.log` | Git post-commit hook output | No |
| `~/.engram/global.db` | Cross-project decisions/conventions. **No migration system** — additive `CREATE IF NOT EXISTS` only | — |
| `~/.engram/instances.json` | Machine-global instance registry. **Unsigned, trusted — see §9** | — |
| `~/.engram/global/` | Fallback DB location when no project root is detected | — |

---

## Part II — The Code

### 6. Core (`src/*.ts`)

#### `index.ts` (335) — Entrypoint
- **What:** `#!/usr/bin/env node`. Branches on CLI args into installer / `record-commit` git hook / HTTP dashboard / MCP stdio server.
- **Why:** The only file the `bin` field points at. Every other file is reached through a branch here.
- **Holds:** `runRecordCommit()` (post-commit hook: reads `git show --name-only HEAD`, inserts `changes` rows, **always exits 0** so it can never block a commit); `main()`.
- **Notes:** HTTP mode binds `127.0.0.1` only (line 243) and auto-shuts-down after 5 min idle. The WS upgrade takes the token as a **query-string param** (line 217) — lands in logs/history; low risk on loopback but not best practice. Registers exactly four tools; see §7.

#### `database.ts` (430) — Composition root
- **What:** Opens the DB with corruption recovery, runs migrations, constructs all repositories and services, seeds instance identity, manages backup and re-init.
- **Why:** Every tool and route reaches persistence through `getDb()` / `getRepos()` / `getServices()` here.
- **Holds:** `initDatabase`, `reinitDatabase`, `backupDatabase`, `openDatabaseWithRecovery`, `ensureGitignore`, `queryAll/queryOne/execute/executeMany`, `now`, `getCurrentSessionId`, `logToolCall`.
- **Notes — must know:**
  - `busy_timeout` is set **before any other pragma** (the "FLAW-2 fix"). Preserve that ordering.
  - `SQLITE_BUSY` is explicitly **not** treated as corruption ("FLAW-3 fix"). Do not re-conflate them.
  - **Corruption recovery is destructive.** A corrupt main DB is renamed `.corrupt.<ts>.bak` and replaced with an *empty* one. Warning to stderr only, no prompt. Coverage on this path: **3%**.
  - `queryAll/queryOne/execute/executeMany` take raw SQL strings — an unguarded escape hatch around the repository layer. No current caller abuses it. Watch it.
  - `getCurrentSessionId(agentName?)` (line 375) duplicates `SessionsRepo.getOpenSessionId()`. Both now take an optional agent scope (§12.1). **The unscoped form is still what ~40 call sites in `dispatcher-memory.ts` use to stamp `session_id` on records** — and since sessions are no longer force-closed on start, several may be open at once. Pass an agent name wherever identity is available.

#### `migrations.ts` (823) — Schema history
- **What:** 24 sequential migrations, V1 → V24, plus the runner.
- **Why:** Every table, index, FTS5 virtual table and sync trigger originates here. This is the schema's only source of truth.
- **Notes:**
  - Each migration runs in **its own transaction**; a failure rolls back and is retried from scratch next boot. Safe only because migrations are idempotent.
  - **V23 is not idempotent** — unconditional `ALTER TABLE conventions ADD COLUMN summary/tags` (674-677). If a later step in V23 throws after the ALTERs succeed, the retry fails with "duplicate column."
  - V19 is the only migration using per-statement `try/catch` (SQLite can't multi-ADD-COLUMN). Its bare catches would also swallow unrelated failures.
  - **No test migrates a DB containing data.** Branch coverage 33%. See audit §5.

#### `constants.ts` (231) — Tunables
Holds `SERVER_VERSION` (read from `package.json` at import), `DB_VERSION = 24`, all limits, `EXCLUDED_DIRS`, `STRONG_/SOFT_PROJECT_MARKERS`, `BLOCKED_PATH_PATTERNS`, `LAYER_PATTERNS`, `PHASE_MAP`, and every `CFG_*` config-key name. **`.engram` was deliberately removed from `STRONG_PROJECT_MARKERS`** in v1.9.1 — it was self-referential.

The security-relevant config keys (see §9): `http_token`, `sharing_mode`, `sharing_types`, `sensitive_keys`, `instance_id`, `machine_id`, `instance_visible`.

#### `utils.ts` (550) — Shared helpers
- **Holds:** `coerceStringArray` / `coerceNumberArray` (Zod preprocessors — law #4); `normalizePath`; **`findProjectRoot`** — a 6-tier chain: `--project-root` arg → `ENGRAM_PROJECT_ROOT`/`PROJECT_ROOT` env → `git rev-parse --show-toplevel` → strong markers → soft markers (blocked-path filtered) → `~/.engram/global`; `scanFileTree` (respects `.engramignore`); `detectLayer`; git wrappers; `ftsEscape`; `getFileHash` (SHA-256); `getMachineId`.
- **Notes:** `gitCommand` (line 338) uses `execSync(\`cd "${projectRoot}" && git ${command}\`)` — `command` is interpolated **unquoted into a shell**. Not currently reachable with user input; see §9.

#### `types.ts` (413) · `response.ts` (57) · `errors.ts` (116) · `logger.ts` (59)
Row shapes and enum unions · the four response builders (`success`/`textResult`/`error`/`errorWithData`, with `stripNulls`) · a typed error hierarchy that **no live dispatcher actually imports** (dead in practice) · leveled stderr logger, level read once at import.

#### `global-db.ts` (168) — Cross-project store
Lazy singleton over `~/.engram/global.db` with its own hand-rolled schema. **No migration system** — evolution is additive `CREATE TABLE IF NOT EXISTS` only. Every function returns `null`/`[]` on failure with a `log.warn` (a good, consistent pattern).

---

### 7. Tools (`src/tools/`) — read this before touching anything here

> **Only 4 of the 20 files in `src/tools/` are reachable.** `index.ts` imports exactly:
> `registerSessionDispatcher` (`sessions.ts`), `registerMemoryDispatcher` (`dispatcher-memory.ts`), `registerAdminDispatcher` (`dispatcher-admin.ts`), `registerFindTool` (`find.ts`).
>
> The other **15 files (4,057 lines, 23% of `src/`) are dead** — verified zero external references. They are v1.6-era predecessors whose logic was copy-pasted into the dispatchers.
>
> **Do not delete them yet.** They hold validation the live code lost. See §8.

#### Live: `sessions.ts` (459) — `engram_session`
Actions: `start` · `end` · `get_history` · `handoff` · `acknowledge_handoff`.

`start` is the densest code path in the project — a matrix of `verbosity` (nano/minimal/summary/full) × `intent` (full_context/quick_op/phase_work) × `agent_role` (primary/sub), plus runtime project-root override, focus filtering, abandoned-work detection, handoff surfacing, and PM phase detection.

**Notes:** delivers a tiered tool catalog (tier 2 first-ever → tier 1 after 30 days → tier 0) via `selectCatalogTier`. `agent_rules` and `tool_catalog` are **unconditional in every tier**, which is why the token claims in the schema descriptions are wrong (audit N6). `AGENT_RULES` is imported and never used. Session identity is resolved by the file-local `resolveSession()` (§12.1), **not** by `getCurrentSessionId` — that import was removed deliberately; don't reintroduce it here. Still contains §12.1b.

#### Live: `dispatcher-memory.ts` (1,183) — `engram_memory`
One flat Zod schema + a 38-branch switch. Everything that is not session or admin lives here: file notes, changes, decisions, conventions, tasks, checkpoints, search, dependency maps, milestones, scheduler, `dump`, observations, and multi-agent coordination (`claim_task`, `agent_sync`, `broadcast`, `route_task`).

**Notes:** every response is wrapped with a PM-advisor nudge via `pmSafe`. `search` is FTS5-with-LIKE-fallback across 7 tables. `dump` heuristically classifies free text into decision/task/convention/observation — **with no provenance marker**, so pasted external text becomes an authoritative record.

#### Live: `dispatcher-admin.ts` (768) — `engram_admin`
37 actions: backup/restore/export/import/compact/clear/stats/health/config/hooks/reports, plus the entire cross-instance sharing subsystem (8 actions) and the sensitive-data access-control workflow (7 actions), plus PM toggles.

**Notes:** **0% test coverage** — the whole file. The `config` action has no key whitelist (§9). `default:` sits at line 702 *before* seven more PM cases — harmless in JS, but a real reading trap. Cross-instance error paths return raw `(e as Error).message`, which can leak absolute DB paths.

#### Live: `find.ts` (299) — `engram_find`
`search`/`discover` (BM25-lite catalog lookup) and `lint` (checks text against active conventions). Also **exports the data other files depend on**: `MEMORY_CATALOG` (38), `ADMIN_CATALOG` (37), `buildToolCatalog(tier)`, `AGENT_RULES` (the 8 hardcoded fallback rules).

> **Sync hazard:** `MEMORY_CATALOG`/`ADMIN_CATALOG` here and `MEMORY_ACTIONS`/`ADMIN_ACTIONS` in the dispatchers are **two independently hand-maintained lists**. They currently match. Adding an action to a dispatcher without mirroring it here makes it silently unreachable in universal mode while working normally in standard mode.

#### `modes/universal.ts` (253) — single-tool surface
Collapses the four tools into one `engram({action, ...})` for clients that penalize schema size. `HandlerCapturer` stores the dispatcher handlers and **discards their Zod schemas**, then invokes them directly.

> **Consequence:** universal mode **bypasses Zod entirely.** `coerceParams()` re-implements only the array-JSON half — no enum rejection, no bounds, no type checking. **The same action validates differently depending on how the server was launched.**

#### The 15 dead files — what each still holds that the live code lost

| File | Lines | Dead but contains |
|---|---|---|
| `stats.ts` | 288 | **`KNOWN_CONFIG_KEYS` whitelist** — the missing guard from audit N2. Richer `stats` and `health`. |
| `file-notes.ts` | 428 | **`lock_file` / `unlock_file`** — documented in README:727, absent from the live surface. `z.enum` for layer/complexity. |
| `intelligence.ts` | 642 | **`replay`** — full chronological session-timeline reconstruction. No live equivalent, undocumented anywhere. Bounded search `scope`/`limit`. |
| `scheduler.ts` | 528 | **`track_context`** — the byte-accumulation feed for context-pressure detection. Without it the live detector only works at "agent self-reports tokens." Enum-validated trigger types. |
| `export-import.ts` | 205 | A **fuller `import`** that merges 6 tables with session-ID remapping. The live one imports decisions only. |
| `coordination.ts` | 493 | `.min(1).max(1440)` on `expires_in_minutes`; `.min(5)` on `content`. |
| `decisions.ts` | 214 | `z.enum` status; `.min(1).max(100)` limit. |
| `tasks.ts` | 205 | `z.enum` status/priority; `.min(3)` title; bounded limit. |
| `conventions.ts` | 143 | `z.enum` category. |
| `compaction.ts` | 116 | `z.enum` clear scope. |
| `report.ts` | 169 | Actual **Markdown** report rendering. The live one returns a raw object. |
| `milestones.ts` | 83 | Bounded title/limit. |
| `knowledge.ts` | 179 | `list_tools` — a catalog of an even older architecture. Purely stale. |
| `backup.ts` | 193 | Near-identical duplicate. Nothing lost. |
| `changes.ts` | 171 | Near-identical duplicate. Nothing lost. |

**Deletion order:** port the validation → restore or retract `lock_file` → fix `import` → *then* delete.

---

### 8. Repositories (`src/repositories/`) — SQL only

One class per table, constructed once by `createRepositories(db)` in `index.ts` (the barrel). All value binding uses `?` placeholders throughout — **no SQL injection was found via user-supplied values anywhere in the codebase.**

| File | L | Owns | Watch for |
|---|---|---|---|
| `sessions.repo.ts` | 158 | sessions: create/close/autoClose/getOpenSessions/history/duration | `getOpenSessionId(agentName?)` takes an agent scope; `close`/`autoClose` guard on `ended_at IS NULL` and return whether they acted; `create` writes `parent_session_id` (§12.1). `countBySession(id, table)` still interpolates the table name; only ever called with the literal `"decisions"` |
| `decisions.repo.ts` | 173 | decisions + supersession + `depends_on` graph | `findSimilar` builds an FTS string but passes it as a **bound param** — safe. `getByFile` doesn't escape LIKE metacharacters |
| `changes.repo.ts` | 101 | per-file change log | `recordBulk` correctly transactional. `insertCompacted`/`deleteNonCompacted` are only atomic because the *caller* wraps them |
| `file-notes.repo.ts` | 141 | file metadata, staleness hashes | `upsert` uses `COALESCE(?, col)` so partial updates don't clobber. Defensively re-parses JSON strings (universal-mode fallout) |
| `tasks.repo.ts` | 142 | task board | `update()`'s dynamic SET uses only **compile-time literals** — the safe version of the pattern |
| `events.repo.ts` | 123 | scheduled_events | **`updateStatus(id, status, extraFields)` interpolates `Object.keys` into the SET clause (line 107).** Currently **zero callers** — dead, but a live injection vector the moment anyone wires it up |
| `observations.repo.ts` | 65 | observations (V24) | `search()` has **no FTS fallback**, unlike decisions/conventions/tasks. Inconsistent |
| `conventions.repo.ts` | 94 | conventions | FTS-focused query falls back to `getActive` on failure |
| `broadcasts.repo.ts` | 57 | agent messaging | `markRead` is a **read-modify-write with no transaction** — concurrent marks lose updates |
| `config.repo.ts` | 53 | key/value settings | `get`/`getAll` swallow errors (pre-migration tolerance) — masks real SQL errors identically |
| `agents.repo.ts` | 42 | agent heartbeats | `releaseStale` needs consistent ms epochs from callers |
| `milestones.repo.ts` | 34 | milestones | Simplest file. No dynamic SQL |
| `snapshot.repo.ts` | 22 | snapshot cache | Stores `ttlMinutes` but **never enforces it** — expiry lives in the caller |
| `index.ts` | 69 | barrel + `createRepositories` | The only file importing individual repo classes. Clean composition root |

---

### 9. Services (`src/services/`) — logic and all external I/O

**Every network call, every file write outside `.engram/`, and every process spawn in the server originates here or in `installer/`.**

| File | L | What | External touchpoints |
|---|---|---|---|
| `agent-rules.service.ts` | 125 | Fetches "binding" rules from the GitHub README; caches 7d; falls back to hardcoded | **`https.get` → `raw.githubusercontent.com/keggan-std/Engram/main/README.md`** (mutable branch, no integrity check, undisclosed in SECURITY.md). Writes `.engram/agent_rules_cache.json` |
| `update.service.ts` | 190 | 24h-throttled version check | **`fetch` → `registry.npmjs.org`**, fallback **`fetch` → `api.github.com/.../releases/latest`**. Stores remote `releaseNotes` verbatim, unsanitized |
| `instance-registry.service.ts` | 523 | Machine-wide instance discovery via heartbeat | **Reads/writes `~/.engram/instances.json`** (atomic temp+rename — good). `process.kill(pid, 0)` liveness probe |
| `cross-instance.service.ts` | 560 | Read-only queries against *other* instances' DBs | **Opens arbitrary local `.db` paths** taken from the registry; `readdirSync` on foreign project dirs |
| `compaction.service.ts` | 116 | Prunes old sessions past a threshold | `autoCompact` backs up in a bare try/catch — a **silently failed backup does not block deletion** |
| `project-scan.service.ts` | 76 | TTL-cached project snapshot | Walks the project tree via `scanFileTree` |
| `git.service.ts` | 96 | Git wrappers + hook-log parsing | Shells out via `utils.gitCommand` |
| `sensitive-data.service.ts` | 272 | Sensitivity locks + human-approval access requests | None. **Fully parameterized SQL** |
| `workflow-advisor.service.ts` | 280 | PM-Lite/PM-Full nudge heuristics | None. In-memory + config |
| `event-trigger.service.ts` | 144 | Fires scheduled events | None. **Every method swallows errors with zero logging** — the least observable service |
| `pm-diagnostics.ts` | 112 | `pmSafe()` isolation wrapper + failure tracker | None. Zero imports |
| `update`/`index.ts` | — | Barrel | — |

---

### 10. Installer (`src/installer/`) — what it does to a user's machine

Supports **14 IDEs**: vscode, cursor, windsurf, antigravity, claudecode, claudedesktop, visualstudio, cline, roocode, geminicli, firebasestudio, trae, jetbrains, **androidstudio** (the last is undocumented in the README).

| Behavior | Reality |
|---|---|
| **Backup before write** | **Only when the existing config is already invalid JSON** (`.invalid.<ts>.bak`). Valid configs are never backed up |
| **Atomicity** | **None.** `writeJson` is a direct `fs.writeFileSync`. Contrast `instance-registry`'s correct temp+rename. A crash mid-write can truncate a user's real `~/.claude.json` |
| **Merge safety** | Only touches `config[key].engram` — unrelated entries survive structurally |
| **Re-install** | Compares a stamped `_engram_version`: same → no-op; older → **entry replaced wholesale** (manual edits lost); missing stamp → `legacy-upgraded` |
| **Two versions installed** | No detection, no warning. Each config tracks its own stamp independently. At runtime `--ide=<key>` shards the DB per IDE to avoid write contention |
| **Uninstall** | `--remove --ide <name>`, **one IDE at a time**. No global uninstall |
| **Never cleaned up** | `.engram/` (DB, caches, token, backups); the `~/.engram/instances.json` entry (only pruned after 7 days of no heartbeat); the git hook (needs a separate `--remove-hooks`) |
| **Git hook** | `installer/index.ts:472` writes `.git/hooks/post-commit` **with no existence check — unconditionally overwriting any pre-existing hook.** `src/scripts/install-hooks.ts` (the `npm run install-hooks` path) checks and *appends* instead. **Two code paths, different content, different safety, no coordination** |
| **Coverage** | `installer/index.ts` **0%**, `ide-detector.ts` **0%**, `config-writer.ts` 73% |

**Also in-tree, both unsafe duplicates of `config-writer.ts`:**
- `scripts/install-mcp.js` (175) — no backup, no version stamping; treats a parse failure as "file doesn't exist" and overwrites.
- `scripts/fix-mcp-config.js` (23) — hardcodes the original maintainer's personal path (`~/Documents/MCP Builder/Engram/dist/index.js`), no try/catch, unconditionally overwrites `~/.claude.json`. **Should be deleted.**

---

### 11. HTTP dashboard (`src/http-*.ts`, `src/http-routes/`, `packages/engram-dashboard/`)

Express 5 + `ws`, started only with `--mode=http`. Binds `127.0.0.1` exclusively. All `/api/*` behind one bearer token (`http-auth.ts`); `/health` intentionally open. React 19 + Vite SPA in `packages/engram-dashboard/`, proxying `/api`, `/health`, `/ws` to `127.0.0.1:7432`.

**Known issues, all low-severity given loopback-only binding:**
- **Route double-mount:** `export-import.routes.ts` is mounted at `/export` *and* `/import`, but defines those paths internally — so the real endpoints are `/api/v1/export/export` and `/api/v1/import/import`. `POST /import` is also a **no-op** that never touches the DB.
- **`decodeCursor` has zero callers.** Every route emits a cursor; none accepts one. Cursor pagination is inert; real pagination uses `?offset=`.
- **`sensitive.routes.ts` is a stub** returning `[]` unconditionally. The real `SensitiveDataService` is never wired to it.
- **DELETE routes always return 204**, even for nonexistent IDs (decisions, conventions, sessions, tasks).
- **`search.routes.ts` ignores FTS5 entirely** — pulls up to 1000 rows per scope and does in-process `.includes()`.
- `api-helpers.serverError` returns raw `Error.message` to clients.
- Token comparisons (`http-auth.ts:50`, `index.ts:217`) are non-constant-time.
- `PUT /settings/:key` **now shares the §12.2 write policy** and redacts secrets on read. It previously wrote any config key — the same gap as §12.2 through a different door.

---

### 12. Danger index — the things that will bite you

Full analysis in [`engram-deep-audit-2026-08-02.md`](engram-deep-audit-2026-08-02.md). Summarised here so this document stands alone.

#### 12.1 Session identity is globally scoped *(CRITICAL — **FIXED**, was proven)*

> **FIXED on `review/engram-audit` (task #2).** Session ownership is now enforced.
> `tests/tools/session-identity.test.ts` (13 tests) is the regression suite; it failed
> 11/13 against the pre-fix code. **N3c/N3d below are still open — see 12.1b.**

**Was:** `sessions.repo.ts:30` and `database.ts:375` both defined "the current session" as `SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1` — **no agent, no connection, no parent scoping** — and `sessions.ts:147/187` auto-closed whatever that found, overwriting `summary`. Any agent's `start` destroyed any other agent's open session in **both directions**, and `end` attached one agent's summary to another's record.

**Now:**

| Change | Where |
|---|---|
| `agent_name` **required** on `start` (breaking) — it used to default to the literal `"unknown"`, which is why scoping on it alone was insufficient | `sessions.ts` start branch |
| `start` retires **only the calling agent's own** previous session | `sessions.ts`, via `getOpenSessionId(agentName)` |
| `getOpenSessionId(agentName?)` / `getCurrentSessionId(agentName?)` take an optional agent scope | `sessions.repo.ts:30`, `database.ts:375` |
| `close()` / `autoClose()` guard on `AND ended_at IS NULL` and return whether they acted — a closed session's summary can no longer be overwritten | `sessions.repo.ts` |
| `end` / `handoff` / `acknowledge_handoff` resolve via `resolveSession()`: explicit `session_id` → caller's `agent_name` → newest-open, and the last rung reports `session_resolution` rather than guessing silently | `sessions.ts` |
| `parent_session_id` is **written** on sub-agent start (explicit param, else inferred as the newest open session of another agent). The column existed unused since the V1 baseline | `sessions.repo.ts` `create()`, `sessions.ts` |

**Consequence for the rest of the codebase:** more than one session can now be open at a time. The ~40 unscoped `getCurrentSessionId()` call sites in `dispatcher-memory.ts` still stamp records with the *newest open* session, so record attribution under concurrency is narrowed but not closed — that needs a caller-supplied handle on the memory surface and is tracked separately, not silently absorbed here.

#### 12.1b `pending_work` and handoffs were unscoped *(CRITICAL — **FIXED**, was proven)*

> **FIXED on `review/engram-audit` (task #5).** These were N3c/N3d; 12.1's fix was their
> prerequisite. Covered by the same regression suite.

| Was | Now |
|---|---|
| Every session start ran `UPDATE pending_work SET status='abandoned' WHERE status='pending' AND (session_id IS NULL OR session_id < ?)` — any agent starting flagged *every* other agent's in-flight work abandoned, plus every orphaned row. The `if (lastSession?.id)` guard was dead | Scoped to `agent_id = <caller>` **and** the owning session must be closed. Another agent's work is never touched; neither is the caller's own still-open work. `abandoned_work` in the response is filtered to the caller |
| `begin_work` wrote `agent_id` as the literal `"unknown"` when the param was omitted — one bucket, so scoping could not work | Falls back to the owning session's `agent_name` |
| `record_change` auto-close swept **every** agent's pending rows on a file-path overlap, so B recording a change completed A's declared work | Scoped to the session's own agent |
| Handoffs surfaced `ORDER BY created_at DESC LIMIT 1`, so with two outstanding one was silently invisible | All pending surfaced: `handoff_pending` prefers one authored by *another* agent, `other_handoffs_pending[]` carries the rest (capped 4) |
| `acknowledge_handoff` required no session, fell back to `acknowledged_by: "unknown"`, and let any agent clear any handoff | Requires an active session; records the real agent; refuses a handoff created by the *same* session; reports who acknowledged first on a double-ack |

**Deliberately not restricted:** a *later* session of the same agent may still acknowledge — a handoff is addressed to whoever comes next, and there is no `to_agent` column to address it more precisely.

#### 12.2 `engram_admin(config)` has no key whitelist *(CRITICAL — **FIXED**, was verified)*

> **FIXED on `review/engram-audit` (task #4).** Regression suite:
> `tests/tools/config-policy.test.ts` (12 tests).

**Was:** `dispatcher-admin.ts` wrote **any** key — `http_token`, `sharing_mode`, `sharing_types`, `sensitive_keys` included — with no confirmation and no audit entry, so one tool call disabled cross-instance access control. The whitelist existed in `stats.ts:22-31` and was dropped in the v1.6 consolidation. `config` with no key also returned the **whole table**, dashboard bearer token and machine GUID included.

**Now** — one policy in `constants.ts`, applied at both doors:

| Set | Contents | Behaviour |
|---|---|---|
| `TUNABLE_CONFIG_KEYS` | `auto_compact`, `compact_threshold`, `retention_days`, `max_backups`, `pm_lite_enabled`, `pm_full_enabled`, the four `auto_update_*` | Writable |
| `PROTECTED_CONFIG_KEYS` | `sharing_mode`, `sharing_types`, `instance_visible`, `instance_label`, `sensitive_keys`, `http_token`, `instance_id`, `machine_id`, `instance_created_at` | Rejected, **naming the action that owns the key** (`set_sharing`, `set_visibility`, `mark_sensitive`, …) |
| `SECRET_CONFIG_KEYS` | `http_token`, `machine_id` | Value replaced with `[redacted]` on every read |
| anything else | — | Rejected as unknown, listing what is settable |

Every accepted mutation writes an `audit_log` row (the table has existed since V20 and this path never used it). A refused write logs nothing.

**Design note:** a named owning action was chosen over a confirm token because it keeps validation in one place instead of duplicating it behind a prompt. Nothing legitimate broke — every protected key is already written by its own service or action straight through `ConfigRepo`, bypassing the tool surface entirely.

**The second door mattered as much as the first.** `PUT /api/v1/settings/:key` blocked only `http_token`, so `sharing_mode`, `sensitive_keys`, `instance_id` and `machine_id` were all writable over the API. Both now import the same `configWriteRejection()`.

#### 12.3 Agent-rules cache is unvalidated attacker-reachable input *(CRITICAL, proven)*
`agent-rules.service.ts:63` reads `.engram/agent_rules_cache.json`, `JSON.parse`s and **casts** — no schema, no size cap, no provenance, and a future `fetched_at` never expires. A repository that ships this file (`git add -f`) injects attacker-controlled CRITICAL-priority binding instructions on clone. **Structurally identical to CVE-2026-21852 ("MemoryTrap"), which Anthropic patched by removing memory from the system-prompt path entirely.**

#### 12.4 Negative `limit` bypasses every cap *(HIGH, proven)*
`limit: z.number().int().optional()` has no `.min()`; SQLite treats `LIMIT -1` as unlimited. Affects `get_tasks`, `get_decisions`, `get_milestones`, `get_scheduled_events`, `get_observations`, `search`, and — cross-instance — `query_instance`, `search_all_instances`.

#### 12.5 Validation was silently eroded by one refactor *(HIGH)*
The v1.6 consolidation dropped one config whitelist, seven enums, and every numeric/length bound. **Coverage on the file that received them is 0%.** The dead files are the only record of what was lost.

#### 12.6 Universal mode bypasses Zod *(HIGH)*
`HandlerCapturer` discards the schemas. Same action, different validation, depending on launch flags.

#### 12.7 Shell interpolation in `gitCommand` *(MEDIUM)*
`utils.ts:338` interpolates `command` unquoted into `execSync`. Not currently reachable with user input; `GitService.runGitCommand` exposes it as a general pass-through.

#### 12.8 The cross-instance trust root is unsigned *(MEDIUM)*
`~/.engram/instances.json` is machine-global and unsigned; `db_path` and `project_root` from it are used directly to open and scan files. `searchAll()` skips `checkPermission()` and reaches `` `SELECT * FROM ${scope}` `` gated only by the *foreign* instance's self-reported `sharing_types`.

#### 12.9 Destructive corruption recovery *(MEDIUM)*
A corrupt main DB is renamed and replaced with an empty one. Warning to stderr only. 3% coverage on this path.

#### 12.10 Two git-hook installers, one of which clobbers *(MEDIUM)*
`installer/index.ts:472` overwrites `.git/hooks/post-commit` unconditionally; `scripts/install-hooks.ts` appends. Different content, no coordination.

---

### 13. Test posture

**570/570 pass**, ~20s, zero skipped. Coverage **28.7% stmt / 20.2% branch** (measured at 557; the 13 added tests raise `sessions.ts` but the headline has not been re-measured).

| Surface | Cov | |
|---|---|---|
| `dispatcher-admin.ts` | **0%** | All 36 admin actions incl. backup/restore/clear |
| `installer/index.ts` | **0%** | 921 lines that write to real machines |
| `installer/ide-detector.ts` | **0%** | |
| `database.ts` | **3%** | Incl. destructive corruption recovery |
| `agent-rules.service.ts` | **7.8%** | Mocked away by every consumer test |
| `dispatcher-memory.ts` | 8.7% | |
| `sessions.ts` | 48.5% | Uncovered range covers the whole sub-agent path |
| `cross-instance.service.ts` | 48.9% | Permission checks themselves are well tested |
| `migrations.ts` | 91% / **33% br** | See below |

**The gap that matters most:** *no test migrates a database containing data.* Every suite builds a fresh `:memory:` DB and runs v1→v24 on empty tables, so V23's `UPDATE conventions SET summary = SUBSTR(rule,1,80) WHERE summary IS NULL` backfill — which only acts on pre-existing rows — is never exercised. Neither are the idempotency `catch` guards. Upgrading a real user's database is the one path with no coverage.

Also: `dispatcher-smoke.test.ts` mocks `database.js` without `getServices`, so every test in it throws inside `pmSafe` and passes anyway.

`agent_role` / `sub-agent` / `parent_session_id` used to appear **zero times** in `tests/`. `tests/tools/session-identity.test.ts` now covers the whole sub-agent + concurrency path (§12.1). It is deliberately written against real migrations and real repositories with a mock that mirrors the *unscoped* `getCurrentSessionId` — so the dispatcher cannot pass by leaning on a friendlier mock.

---

### 14. Working on this codebase

**Adding an action:**
1. Add the `case` to the dispatcher's switch.
2. Add params to that dispatcher's flat Zod schema — **with enums and bounds** (`.min(1).max(200)` on limits).
3. Add the name to the dispatcher's `MEMORY_ACTIONS`/`ADMIN_ACTIONS` array.
4. **Add it to `find.ts`'s `MEMORY_CATALOG`/`ADMIN_CATALOG` too** — otherwise it is unreachable in universal mode.
5. Wrap arrays in `coerceStringArray()`/`coerceNumberArray()`.
6. Update `README.md`. (~45% of live actions are currently undocumented.)

**Adding a table:** append a migration to `migrations.ts` (never edit an existing one); bump `DB_VERSION`; add a repo class; register it in `repositories/index.ts`; add the row type to `types.ts`. If it needs search, add the FTS5 virtual table **and its three sync triggers**.

**Never:** write to stdout · build SQL from a caller-supplied identifier without a whitelist · edit a shipped migration · add a raw `fs.writeFileSync` to a user config file without temp+rename.

**Verify:** `npm run build && npm test`.

---

## Appendix — File census

| Area | Files | Lines | Live? |
|---|---|---|---|
| Core (`src/*.ts`) | 10 | ~2,900 | Yes |
| `repositories/` | 14 | ~1,250 | Yes |
| `services/` | 13 | ~2,700 | Yes |
| `tools/` — live | 4 | 2,709 | Yes |
| `tools/` — dead | 15 | 4,057 | **No** |
| `modes/` | 1 | 253 | Opt-in |
| `knowledge/` | 8 | ~750 | Yes |
| `installer/` | 4 | 1,619 | CLI only |
| `http-routes/` + http core | 20 | ~1,000 | `--mode=http` only |
| `scripts/` | 1 | 96 | npm script |
| **Total `src/`** | **90** | **17,560** | **~77% reachable** |

---

<!-- ENGRAM_CONSTITUTION:COMPLETE -->
