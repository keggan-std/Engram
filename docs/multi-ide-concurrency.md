# Multi-IDE Concurrency — Problem Analysis & Recommended Solution

**Date**: 2026-03-01  
**Status**: Design proposal — awaiting decision

---

## The Problem

When multiple IDEs are open on the same project simultaneously, every IDE spawns its own
`engram-mcp-server` process. All of those processes call `findProjectRoot()`, land on the
same directory, and open the same SQLite file at:

```
{project-root}/.engram/memory.db
```

Multiple concurrent writers on a single SQLite file cause **lock contention** — even with
WAL mode, only one writer can hold the write-lock at a time. Under sustained concurrent
write activity (`record_change`, `create_task`, `session start/end`, etc.) processes block
for up to `busy_timeout = 5000 ms` and MCP clients disconnect when that timeout fires.

### Why Global-Only IDEs Make This Worse

IDEs with only global configs (Claude Desktop, Windsurf, Cline, JetBrains) have **no
`workspaceVar`** injected into their MCP args, so the spawned server falls back to
`findProjectRoot(cwd)`. The `cwd` is whatever working directory the IDE was launched from.
In the best case this resolves to the right project root — but it may also resolve to `~`
or another unrelated path, creating **orphan databases** that no other instance ever sees.

---

## What Already Exists

| Infrastructure | Location | Relevance |
|---|---|---|
| `busy_timeout = 5000` + WAL | `src/database.ts` | Handles low-contention cases |
| Instance identity (`instance_id`, `instance_label`) | `src/database.ts` + `constants.ts` | Each process already gets a stable UUID |
| Instance registry | `src/services/instance-registry.service.ts` | `~/.engram/instances.json` — all running instances registered, with DB path |
| Cross-instance read service | `src/services/cross-instance.service.ts` | Opens foreign DBs **read-only**, FTS5 federated search across all instances |
| Global DB (`~/.engram/global.db`) | `src/global-db.ts` | Already a separate DB for cross-project shared decisions/conventions |

The cross-instance infrastructure was built anticipating exactly this scenario — but its
"merge on session start" path still needs to be wired up to per-IDE isolated databases.

---

## Options Considered

### Option 1 — Rely on WAL + bump `busy_timeout` *(current state, partially effective)*

Increase `busy_timeout` from 5 s to 15–30 s. Add `wal_autocheckpoint = 100`.

- ✅ Zero code changes to data model  
- ❌ Still blocks the Node.js process synchronously while waiting (better-sqlite3 is sync)  
- ❌ MCP protocol timeout can kill the connection during a long wait  
- ❌ Does nothing for the orphan-DB problem on global installs  
- **Verdict**: necessary but not sufficient as the only mitigation.

---

### Option 2 — Daemon / Socket architecture

One `engram-daemon` holds the DB write lock per project. IDE-spawned processes are thin
clients talking over a Unix socket / named pipe.

- ✅ Completely eliminates lock contention  
- ❌ Requires daemon lifecycle management (start, stop, restart on crash)  
- ❌ Large implementation surface — socket protocol, client stub, discovery  
- ❌ Not cloud-friendly (no socket across remote dev containers)  
- **Verdict**: correct long-term architecture but too heavy for now.

---

### Option 3 — Per-IDE isolated databases + cross-instance federation *(recommended)*

Each IDE spawn uses its own DB file, namespaced by IDE identity:

```
{project-root}/.engram/memory.db           ← primary / first writer
{project-root}/.engram/memory-windsurf.db  ← Windsurf instance
{project-root}/.engram/memory-cline.db     ← Cline instance
{project-root}/.engram/memory-claudedsk.db ← Claude Desktop instance
```

**How it works:**

1. The global MCP config for each IDE gets an `--ide=<id>` arg added by the installer
   (e.g. `--ide=windsurf`). Project-level installs that already have `workspaceVar`
   continue using the primary DB (no `--ide` flag needed — they're the "coordinator").

2. `initDatabase()` uses `--ide` (if provided) to select
   `memory-{ide}.db` as the DB file name, keeping everything else identical.

3. On **session start** (`sessions.ts`), each non-primary instance calls
   `CrossInstanceService.searchAll()` to pull in decisions, conventions, and significant
   tasks from sibling instances in the same project. This gives the agent access to all
   accumulated knowledge without competing on the write lock.

4. On **session end**, important outputs (decisions, conventions) are already written to
   `global.db` via `writeGlobalDecision()` / `writeGlobalConvention()`, making them
   visible to all future sessions everywhere.

**Why this works well:**

- Zero write-lock contention — each IDE writes only to its own file.
- Cross-instance reads are already implemented and are always read-only (`readonly: true`).
- The instance registry (`~/.engram/instances.json`) already tracks all DB paths — 
  `CrossInstanceService.discoverInstances()` already enumerates all sibling DBs.
- `workspaceVar` IDEs (VS Code, Cursor) are the natural "coordinators" — they always know
  their project root precisely and use the primary DB. Global-only IDEs get a shard.

**What needs to be built:**

| Task | Size |
|---|---|
| Accept `--ide=<id>` arg in `src/index.ts`, pass to `initDatabase()` | XS |
| Change `initDatabase()` to accept optional `ideId`, set `DB_FILE_NAME` to `memory-{ideId}.db` | XS |
| Installer: inject `--ide=windsurf` (etc.) into global-only IDE configs | S |
| Session start: cross-instance pull for non-primary instances | M (infra exists) |
| Prune stale per-IDE DB files (>7 days unused) | S |

---

### Option 4 — Write queue / batching

Buffer all writes in memory and flush in a single serialized transaction. Each process
writes at most once per N seconds.

- ✅ Dramatically reduces lock contention for bursty writes  
- ❌ Risk of data loss if process crashes between flushes  
- ❌ Complex to implement correctly with better-sqlite3's sync API  
- **Verdict**: good complementary optimization, but doesn't solve the root isolation issue.

---

## Recommended Path

**Phase 1 (quick wins, ~1 day):**
1. Increase `busy_timeout` to `15000` (15 s).
2. Add `PRAGMA wal_autocheckpoint = 100` and `PRAGMA mmap_size = 67108864`.
3. Installer: add `--ide=<id>` to global-only IDE entries in `makeEngramEntry()`.

**Phase 2 (isolation, ~2 days):**
4. `initDatabase(root, ideId?)` → selects `memory-{ideId}.db` when `ideId` is set.
5. Session start: for non-primary instances, pull sibling context via `CrossInstanceService`.
6. Session end: already writes to `global.db`; verify it covers decisions + conventions.

**Phase 3 (maintenance, ~half day):**
7. `compact` / prune admin action: remove unused per-IDE DB files older than 7 days.

---

## Open Questions

1. **Which IDE is "primary"?** Proposal: the one with `workspaceVar` (project-level install)
   is always primary and uses the default `memory.db`. If no project-level install exists,
   the first process to start (earliest mtime on DB file) is primary.

2. **Should `--ide` be injected automatically or require `--global` flag too?**
   Proposal: any IDE that only has a global config path (no `localDirs`) automatically gets
   `--ide=<ideKey>` injected by the installer, regardless of `--global`.

3. **Cross-write scenario**: Two global IDEs both observe a bug in the code. Both agents
   want to record a `record_change` for the same file. With isolated DBs they'd each write
   independently. The cross-instance pull at next session start merges them. This is
   acceptable — eventual consistency is fine for memory.
