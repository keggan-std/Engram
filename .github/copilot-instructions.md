# Engram — AI Agent Instructions

Engram is a local MCP server providing persistent memory for AI coding agents. It exposes 4 dispatcher tools (`engram_session`, `engram_memory`, `engram_admin`, `engram_find`) backed by a project-local SQLite WAL database at `.engram/memory.db`.

---

## ⚠️ Mandatory Agent Session Protocol

Every agent working in this repo MUST follow these rules every chat, no exceptions.

### Session Start — ALWAYS FIRST
```js
engram_session({ action: "start", agent_name: "claude", verbosity: "summary", focus: "topic if known", project_root: "/absolute/path/to/project" })
```
- `project_root` (optional): Pass the absolute path to the workspace when the IDE may not set cwd to the project directory (e.g. Antigravity, Windsurf, Claude Desktop). Engram will re-initialize its database at the correct location. Omit if the IDE already provides `${workspaceFolder}` (VS Code, Cursor).

Act on everything returned: `active_decisions` (binding), `active_conventions` (enforce), `open_tasks`, `agent_rules`, `triggered_events`.  
Unknown action? → `engram_find({ query: "what I want to do" })`

### Before Opening Any File
```js
engram_memory({ action: "get_file_notes", file_path: "..." })
```
`high` confidence → use notes, skip opening. `stale`/absent → read file, then immediately call `set_file_notes` with `executive_summary`.

### Before Architecture/Design Decisions
```js
engram_memory({ action: "search", query: "...", scope: "decisions" })
```
Follow existing decisions. Supersede with `record_decision({ ..., supersedes: <id> })`. Always include `rationale`.

### After Every File Edit
```js
engram_memory({ action: "record_change", changes: [{ file_path, change_type, description, impact_scope }] })
```
`change_type`: `created|modified|refactored|deleted|renamed|moved|config_changed`  
`impact_scope`: `local|module|cross_module|global` — batch all edits in one call.

### Documentation Rule
Multi-step plans, analyses, proposals → write to `docs/<name>.md`. Chat gets summary only.

### Session End — ALWAYS LAST
1. Record unrecorded changes
2. Mark done tasks: `engram_memory({ action: "update_task", id: N, status: "done" })`
3. Create tasks for incomplete work
4. `engram_session({ action: "end", summary: "files touched, pending work, blockers" })`

### Sub-Agent Sessions (v1.7+)
```js
engram_session({ action: "start", agent_name: "sub-agent-X", agent_role: "sub", task_id: 42 })
```
Returns only the assigned task, its file notes, matching decisions, and up to 5 conventions (~300–500 tokens).

---

## Architecture

```
src/index.ts          ← entry: CLI args → standard 4-tool or --mode=universal single-tool
src/tools/            ← dispatcher layer: each file routes many actions via switch
src/services/         ← business logic (compaction, git, event-trigger, project-scan)
src/repositories/     ← all SQL behind typed classes (one per domain entity)
src/database.ts       ← opens DB, runs migrations, creates repo/service singletons
src/migrations.ts     ← versioned schema migrations, append-only
src/types.ts          ← all DB row types and union-type enums (zero runtime code)
src/response.ts       ← ALL MCP response construction (must use these helpers)
src/utils.ts          ← coerceStringArray(), normalizePath(), findProjectRoot()
src/errors.ts         ← EngramError hierarchy (NotFoundError, ValidationError, etc.)
```

**Universal mode** (`--mode=universal` or `ENGRAM_MODE=universal`): registers a single `engram` tool (~80 token schema). `src/modes/universal.ts` uses `HandlerCapturer` (duck-typed SDK stub) to re-use all dispatcher handlers, then BM25-fuzzy-routes the `action` param to the correct one.

## Critical Conventions

### 1. Logging — `console.error` ONLY
```typescript
console.error('[Engram] message');  // ✅ correct
console.log('anything');            // ❌ corrupts MCP JSON-RPC stdout
```

### 2. Response construction — always use `src/response.ts`
```typescript
import { success, error, textResult } from '../response.js';
return success({ id: 1, name: 'foo' });   // null-stripped compact JSON
return error('Not found');                 // isError: true
return textResult('Done.');                // plain text
// Never: return { content: [{ type: 'text', text: '...' }] }
```

### 3. Zod schema params
- String arrays: use `coerceStringArray()` (not `z.array(z.string())`) — MCP clients serialize arrays as JSON strings
- Array-of-object params: add `.passthrough()` to avoid VS Code Copilot / Cursor validation crashes
```typescript
import { coerceStringArray } from '../utils.js';
tags: coerceStringArray().optional(),
files: z.array(z.object({ path: z.string() }).passthrough()).optional(),
```

### 4. Enum validation
All enum values are defined in `src/types.ts`. Use Zod `.enum([...])` — never accept raw strings for `change_type`, `impact_scope`, `priority`, `status`:
```typescript
change_type: z.enum(['created','modified','deleted','refactored','renamed','moved','config_changed'])
impact_scope: z.enum(['local','module','cross_module','global'])
priority: z.enum(['critical','high','medium','low'])
```

## Developer Workflows

```bash
npm run build          # tsc compile → dist/
npm test               # vitest (all tests in tests/**)
npm run test:coverage  # v8 coverage — 75% line threshold on src/repositories/**
npm run dev            # tsc --watch
npm run inspect        # MCP Inspector UI for manual tool testing
node dist/index.js --install   # run installer interactively
```

**Test helper**: `tests/helpers/test-db.ts` — creates an isolated in-memory SQLite DB per test. Use this in all repository and tool tests.

**ENGRAM_LOG_LEVEL=warn** is set during tests to suppress migration noise.

## Adding a New Action

1. **Repository**: add SQL method to the relevant `src/repositories/*.repo.ts`
2. **Action handler**: add a `case 'action_name':` branch in `src/tools/dispatcher-memory.ts` (or `dispatcher-admin.ts`)
3. **Catalog**: add the action to `MEMORY_CATALOG` or `ADMIN_CATALOG` in `src/tools/find.ts` — this drives both `engram_find` help responses and universal-mode routing
4. **Schema changes**: append a new `Migration` object to the array in `src/migrations.ts` (never edit existing migrations)

## Key Data Flows

- **Session start**: `sessions.ts` → compaction check → git state → FTS5-ranked context assembly (decisions, tasks, events, file-notes filtered by `focus` param) → update check → tiered tool catalog delivery
- **DB init**: `initDatabase(root)` in `database.ts` → WAL open → auto-recovery on corrupt WAL/SHM → `runMigrations()` → `createRepositories()` → `createServices()` → module-level singletons (`getDb()`, `getRepos()`, `getServices()`)
- **File path normalization**: always pass paths through `normalizePath()` before storing — handles backslash→slash, relative→absolute

## Common Gotchas

- `HandlerCapturer` in universal mode **bypasses Zod `.transform()` preprocessing** — any array coercion must handle both `string[]` and raw JSON string inputs (see `parseDepsField()` in `file-notes.repo.ts`)
- The DB file is `.engram/memory.db` relative to `--project-root` (defaults to `process.cwd()`). Tests use in-memory `:memory:` via `test-db.ts`
- `src/index.ts` also handles a `record-commit` subcommand invoked by the git post-commit hook — keep CLI arg parsing there, not in tools
