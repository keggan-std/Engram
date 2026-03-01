# Hotfix 1.8.1 — Multi-IDE Database Isolation

**Branch**: `hotfix/multi-ide-db-isolation`  
**Released**: 2026-03-01  
**Severity**: High — data corruption risk under concurrent multi-IDE usage

---

## Problems Identified

### Issue 1 — SQLite write-lock contention across multiple IDEs on the same project

When two or more different IDEs (e.g. VS Code Copilot + Cline + Claude Desktop) are open
on the same project simultaneously, each spawns its own `engram-mcp-server` process.
All processes opened the same `{project}/.engram/memory.db` file.

SQLite allows only one writer at a time. Because `better-sqlite3` is fully synchronous, the
entire Node.js process **freezes** while waiting for the write lock. The previous
`busy_timeout = 5000 ms` (5 s) was often not enough — MCP clients disconnect before it
expires, causing cascading `SQLITE_BUSY` failures and lost writes.

**Affected IDEs**: any combination of VS Code, Cursor, Windsurf, Cline, Claude Desktop,
Claude Code, JetBrains, Trae, Antigravity — whenever ≥2 are open on the same project.

---

### Issue 2 — Instance registry recorded wrong `db_path` for sharded databases

`InstanceRegistryService.buildEntry()` and `collectStats()` hardcoded `DB_FILE_NAME`
(`memory.db`) when computing the `db_path` field written to `~/.engram/instances.json`.
After this fix, instances that use a non-primary shard would register the wrong path,
making them invisible to cross-instance discovery.

---

### Issue 3 — `busy_timeout` too low for any concurrent access scenario

Even with per-IDE sharding (same IDE, multiple windows on the same project still share one
shard), 5 s is not enough when a slow write queues behind another. Bumped to 15 s.

---

## Root Cause

Global IDE configurations (Claude Desktop, Windsurf, Cline, JetBrains, etc.) have no
`workspaceVar` — they cannot inject the project root at spawn time. All their server
processes land on whatever `cwd` the IDE started with. When multiple such IDEs are open on
the same project, `findProjectRoot()` resolves to the same path for all of them, causing
every process to open the identical database file simultaneously.

---

## Solutions Applied

### Fix 1 — Per-IDE database sharding (`memory-{ideKey}.db`)

**Files**: `src/database.ts`, `src/index.ts`, `src/installer/config-writer.ts`,
`src/installer/index.ts`

The installer now injects `--ide=<ideKey>` into the MCP config entry for every IDE that
does **not** have a `workspaceVar` (i.e., global-only IDEs). When the server starts it
reads this flag and opens `memory-{ideKey}.db` instead of `memory.db`:

```
{project}/.engram/memory.db          ← primary (VS Code, Cursor, Visual Studio — have workspaceVar)
{project}/.engram/memory-windsurf.db ← Windsurf
{project}/.engram/memory-cline.db    ← Cline / Roo Code
{project}/.engram/memory-claudedsk.db← Claude Desktop
{project}/.engram/memory-claudecode.db ← Claude Code (global install)
{project}/.engram/memory-jetbrains.db← JetBrains
```

Rules:
- IDEs **with** `workspaceVar` (VS Code, Cursor, Visual Studio) always use the primary
  `memory.db`. The `workspaceVar` already guarantees they receive the correct project root.
- IDEs **without** `workspaceVar` and installed globally get `--ide=<key>` injected.
- Project-level (local) installs never get `--ide` — their working directory IS the project.
- The cross-instance federation (`CrossInstanceService`) discovers all shard DBs via
  `~/.engram/instances.json` — agents in any shard still see each other's decisions and
  conventions on session start.

### Fix 2 — `InstanceRegistryService` uses real `dbFileName`

**File**: `src/services/instance-registry.service.ts`

`initDatabase()` now passes the actual `dbFileName` (e.g. `memory-cline.db`) through to
`InstanceRegistryService`. The service stores it and uses it in:
- `collectStats()` — `db_size_kb` now reflects the actual shard size
- `buildEntry()` — `db_path` in `instances.json` now points to the actual file

### Fix 3 — `busy_timeout` bumped 5 s → 15 s + WAL performance pragmas

**File**: `src/database.ts`

| Change | Before | After |
|---|---|---|
| `busy_timeout` | 5000 ms | 15000 ms |
| `wal_autocheckpoint` | *(default 1000 pages)* | 100 pages |
| `mmap_size` | *(OS default)* | 64 MB |

- **15 s timeout**: handles the residual case where two instances of the same IDE open the
  same shard simultaneously (e.g. 3 Cline windows on the same project). Writes are
  infrequent and microseconds-long; 15 s is more than enough for any realistic queue.
- **`wal_autocheckpoint = 100`**: checkpoints more aggressively, keeping the WAL file small
  and reducing the time readers spend waiting for pages to be flushed.
- **`mmap_size = 67108864`**: 64 MB memory-mapped I/O reduces syscall overhead for read-heavy
  operations like session start context assembly.

All three `busy_timeout` assignments in `openDatabaseWithRecovery` (first open, WAL
recovery path, corrupt-DB fresh path) and the post-WAL re-affirmation in `initDatabase`
are updated to 15000.

---

## Same-IDE Multiple-Windows Scenario

**3 Cline windows all on the same project** → all get `--ide=cline` → all open
`memory-cline.db`. This is intentional and safe:

- The per-IDE shard eliminates cross-IDE contention entirely.  
- Same-IDE same-project contention is handled by the bumped `busy_timeout` (15 s).  
- Writes in Engram are low-frequency discrete events (session start/end, explicit
  `record_change` / `create_task` calls) — not a continuous stream. Actual write-lock hold
  time is microseconds. Three simultaneous writers almost never collide in practice.

Full per-instance sharding (one DB per process) was considered but rejected: it requires a
stable identifier *before* the DB is opened (chicken-and-egg with `instance_id`) and
accumulates DB files requiring aggressive pruning. The WAL approach is sufficient.

---

## Upgrade Path

**Existing users**: no action needed. Existing databases are untouched.  
- IDEs with `workspaceVar` continue using `memory.db` exactly as before.  
- Global-only IDEs will create a fresh `memory-{ide}.db` on the next IDE launch. Their
  historical data in `memory.db` is not lost — it remains accessible via the cross-instance
  query tools (`query_instance`, `search_all_instances`).

**Re-run the installer** (`npx -y engram-mcp-server install`) to pick up the `--ide=<key>`
injection in your global MCP config entries. Existing project-level installs are unaffected.

---

## Files Changed

| File | Change |
|---|---|
| `src/database.ts` | `initDatabase(root, ideKey?)`, per-IDE dbFileName, busy_timeout 15 s, WAL pragmas |
| `src/services/instance-registry.service.ts` | Constructor + `collectStats()` + `buildEntry()` use actual `dbFileName` |
| `src/index.ts` | Parse `--ide=<key>` arg, pass to `initDatabase` |
| `src/installer/config-writer.ts` | `makeEngramEntry(ide, universal, ideKey?)`, `addToConfig(…, ideKey?)` |
| `src/installer/index.ts` | `installToPath(…, ideKey?)`, inject `globalIdeKey` for global installs without `workspaceVar` |
| `package.json` | Version bump 1.8.0 → 1.8.1 |
