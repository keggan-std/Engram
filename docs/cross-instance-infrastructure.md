# Engram Cross-Instance Infrastructure

# Engram Cross-Instance Infrastructure

> **Status:** Implemented (main, v1.7.3+)  
> **Implemented:** March 1, 2026 (sessions #33–#36)  
> **Migration:** v17  
> **Test coverage:** 77 new tests across 4 test files

---

## Overview

When you use Engram across multiple projects and IDEs, each project gets its own isolated `.engram/memory.db`. This infrastructure lets those instances **discover each other**, **share knowledge**, and **protect sensitive data** — all without a server, without network access, and without forcing any instance to expose anything it doesn't want to.

### What this enables

| Question | Tool |
|---|---|
| What Engram instances exist on my machine? | `discover_instances` |
| What decisions did I make in another project? | `query_instance` |
| Search "authentication" across all my projects | `search_all_instances` |
| Import a decision from another project | `import_from_instance` |
| Lock some decisions so other instances can't see them | `mark_sensitive` |
| Allow another instance to request access to locked data | `request_access` / `approve_access` |

### Design principles

- **Federated, not centralized** — each database is its own source of truth
- **Opt-in sharing** — default is `sharing_mode: "none"`; nothing leaks unless you explicitly allow it
- **Read-only cross-instance access** — foreign databases are opened with `{ readonly: true }`; writes to another instance's DB are architecturally impossible
- **No HTTP server needed** — all communication is direct SQLite file access; instances don't need to be running to be queried
- **Machine-local only** — `~/.engram/instances.json` is a local registry; no network traffic

---

## 1. Instance Identity

Every Engram database gets a **stable, unique identity** the first time it initializes after migration v17.

### Identity fields (stored in the `config` table)

| Key | Example | Notes |
|-----|---------|-------|
| `instance_id` | `a3f7c2b1-0d4e-4f2a-9c1b-abc123def456` | UUID v4, never changes after first set |
| `instance_label` | `vscode-Engram` | Auto-generated, human-editable |
| `instance_created_at` | `2026-02-28T22:40:00.000Z` | ISO timestamp, immutable |
| `machine_id` | `abc123def456...` | OS hardware fingerprint |
| `sharing_mode` | `none` | `none` \| `read` \| `full` |
| `sharing_types` | `["decisions","conventions"]` | JSON array |

### Label format

Labels are auto-generated as `<ide>-<project>`:

```
vscode-Engram
cursor-fundi-smart
claude-MCP-Builder
```

You can override any label at any time:

```js
engram_admin({ action: "set_instance_label", label: "my-main-project" })
```

### Machine ID derivation

| OS | Source |
|----|--------|
| Windows | Registry: `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` |
| macOS | `ioreg -rd1 -c IOPlatformExpertDevice` → `IOPlatformUUID` |
| Linux | `/etc/machine-id` or `/var/lib/dbus/machine-id` |
| Fallback | SHA-256 of `hostname + username + homedir` |

---

## 2. Instance Registry

All instances on a machine register themselves in `~/.engram/instances.json`. This is the machine-wide phonebook.

### Registry file format

```json
{
  "schema_version": 1,
  "machine_id": "abc123...",
  "last_updated": "2026-03-01T00:22:00.000Z",
  "instances": {
    "a3f7c2b1-...": {
      "instance_id": "a3f7c2b1-...",
      "label": "vscode-Engram",
      "project_root": "C:/Users/RG/repo/Engram",
      "db_path": "C:/Users/RG/repo/Engram/.engram/memory.db",
      "schema_version": 17,
      "server_version": "1.7.3",
      "sharing_mode": "read",
      "sharing_types": ["decisions", "conventions"],
      "stats": {
        "sessions": 36,
        "decisions": 19,
        "file_notes": 54,
        "tasks": 8,
        "conventions": 4,
        "db_size_kb": 572
      },
      "last_heartbeat": "2026-03-01T00:22:00.000Z",
      "status": "active",
      "pid": 12345
    }
  }
}
```

### Registry lifecycle

| Event | What happens |
|-------|-------------|
| `initDatabase()` called | Instance registers itself (upsert) |
| Every 60 seconds (while running) | Heartbeat updates `last_heartbeat` + stats |
| Process exits | Status set to `"stopped"`, PID cleared |
| Read by another instance | Entries with heartbeat > 5 min are marked `"stale"` |
| Entries > 7 days stale | Auto-pruned from registry |

### Concurrency safety

Writes use **atomic temp-file-then-rename**. Each instance only ever writes its own entry — it never modifies another instance's data in the registry file.

---

## 3. Sharing Configuration

Sharing is off by default. You control it per-instance.

### Sharing modes

| Mode | Meaning |
|------|---------|
| `none` (default) | Instance is invisible to cross-instance queries |
| `read` | Other instances can read your shared types |
| `full` | Other instances can read + import from your shared types |

### Enabling sharing

```js
// Share decisions and conventions (read access for others)
engram_admin({ action: "set_sharing", mode: "read" })

// Share with specific types
engram_admin({ action: "set_sharing", mode: "read", types: ["decisions", "file_notes"] })

// Enable full sharing (allows import)
engram_admin({ action: "set_sharing", mode: "full" })

// Disable sharing (back to private)
engram_admin({ action: "set_sharing", mode: "none" })
```

### Shareable types

| Type | Content |
|------|---------|
| `decisions` | Architectural decisions + rationale |
| `conventions` | Coding conventions |
| `file_notes` | File metadata and AI summaries |
| `tasks` | Task board |
| `sessions` | Session history |
| `changes` | Change log |

Default `sharing_types` when enabling: `["decisions", "conventions"]`.

---

## 4. Discovering Instances

### List all instances on this machine

```js
engram_admin({ action: "discover_instances" })
```

Response:

```json
{
  "instances": [
    {
      "instance_id": "a3f7c2b1",
      "label": "vscode-Engram",
      "project_root": "C:/Users/RG/repo/Engram",
      "status": "active",
      "sharing_mode": "read",
      "sharing_types": ["decisions", "conventions"],
      "last_heartbeat": "2026-03-01T00:22:00.000Z",
      "pid": 12345,
      "is_current": true,
      "stats": { "sessions": 36, "decisions": 19, "file_notes": 54 }
    },
    {
      "instance_id": "b4e8d3c2",
      "label": "cursor-fundi-smart",
      "project_root": "C:/Users/RG/Documents/Apps/fundi-smart",
      "status": "stale",
      "sharing_mode": "none",
      ...
    }
  ],
  "total": 10,
  "active": 1,
  "stale": 4,
  "stopped": 5,
  "sharing": 1
}
```

**Status values:**
- `active` — running right now (PID alive, recent heartbeat)
- `stale` — heartbeat > 5 minutes ago (process may have crashed)
- `stopped` — cleanly shut down

Include stale instances:

```js
engram_admin({ action: "discover_instances", include_stale: true })
```

### Get this instance's own info

```js
engram_admin({ action: "get_instance_info" })
```

---

## 5. Querying Other Instances

Only works against instances with `sharing_mode: "read"` or `"full"` and the requested type in their `sharing_types`. If the target instance has `sharing_mode: "none"`, the call returns a permission error.

### Query a specific type

```js
// Get decisions from another instance
engram_admin({
  action: "query_instance",
  instance_id: "b4e8d3c2",
  type: "decisions"
})

// Search decisions with a query filter
engram_admin({
  action: "query_instance",
  instance_id: "b4e8d3c2",
  type: "decisions",
  query: "authentication",
  limit: 10
})

// Get conventions
engram_admin({ action: "query_instance", instance_id: "b4e8d3c2", type: "conventions" })

// Get file notes
engram_admin({ action: "query_instance", instance_id: "b4e8d3c2", type: "file_notes" })

// Get tasks filtered by status
engram_admin({ action: "query_instance", instance_id: "b4e8d3c2", type: "tasks", status: "open" })
```

**Supported query types:** `decisions`, `conventions`, `file_notes`, `tasks`, `sessions`, `changes`

Response always includes a `source` block:

```json
{
  "source": {
    "label": "cursor-fundi-smart",
    "instance_id": "b4e8d3c2",
    "project": "C:/Users/RG/Documents/Apps/fundi-smart"
  },
  "type": "decisions",
  "results": [ ... ],
  "count": 5
}
```

### Search across all sharing instances

```js
engram_admin({ action: "search_all_instances", query: "authentication" })
```

Searches all instances with `sharing_mode ≠ "none"` in parallel. Results are grouped by source instance:

```json
{
  "query": "authentication",
  "results": [
    {
      "source_label": "cursor-fundi-smart",
      "source_instance_id": "b4e8d3c2",
      "count": 2,
      "items": [ ... ]
    },
    {
      "source_label": "vscode-AuraShield",
      "source_instance_id": "c5f9e4d3",
      "count": 3,
      "items": [ ... ]
    }
  ],
  "instances_searched": 2,
  "total_results": 5
}
```

Narrow the search scope:

```js
engram_admin({ action: "search_all_instances", query: "auth", scope: "decisions", limit: 5 })
```

---

## 6. Importing from Another Instance

Importing copies records from a foreign instance into your local database. Requires `sharing_mode: "full"` on the source instance.

```js
// Import all decisions from another instance
engram_admin({ action: "import_from_instance", instance_id: "b4e8d3c2", type: "decisions" })

// Import specific records by ID
engram_admin({ action: "import_from_instance", instance_id: "b4e8d3c2", type: "decisions", ids: [3, 7, 12] })

// Import conventions
engram_admin({ action: "import_from_instance", instance_id: "b4e8d3c2", type: "conventions" })
```

Imported records are tagged with the source label to preserve provenance:

```
[imported from cursor-fundi-smart] Use JWT with 1-hour expiry for API auth
```

**Supported import types:** `decisions`, `conventions`

---

## 7. Sensitive Data Protection

You can lock specific records so they are **hidden from cross-instance queries** by default. A remote instance can then file an access request, which you approve or deny as the human owner.

### Locking records

```js
// Lock specific decision IDs as sensitive
engram_admin({ action: "mark_sensitive", type: "decisions", ids: [5, 12, 18] })

// Lock file notes
engram_admin({ action: "mark_sensitive", type: "file_notes", ids: [3] })
```

Locked records are **completely invisible** to `query_instance`, `search_all_instances`, and `import_from_instance`. They are not filtered — they do not appear in results at all.

### Viewing locked records

```js
engram_admin({ action: "list_sensitive" })
```

Response:

```json
{
  "locked_items": [
    { "type": "decisions", "count": 3, "ids": [5, 12, 18] },
    { "type": "file_notes", "count": 1, "ids": [3] }
  ],
  "total_locked": 4
}
```

### Unlocking records

```js
engram_admin({ action: "unmark_sensitive", type: "decisions", ids: [12] })
```

### Access requests

A remote agent can request access to locked records. The request is stored in your database as `"pending"` and shown when you list access requests. You (the human) approve or deny it.

**Remote agent creates a request:**

```js
// On the instance that WANTS access to locked data on another instance
engram_admin({
  action: "request_access",
  requester_instance_id: "b4e8d3c2",
  requester_label: "cursor-fundi-smart",
  type: "decisions",
  ids: [5, 12],
  reason: "Need architecture decisions for auth implementation"
})
```

Response:

```json
{ "request_id": 1, "status": "pending" }
```

**Human reviews and approves/denies (on the instance that OWNS the data):**

```js
// List pending requests
engram_admin({ action: "list_access_requests", status: "pending" })

// Approve request #1
engram_admin({ action: "approve_access", request_id: 1 })

// Deny request #1
engram_admin({ action: "deny_access", request_id: 1 })
```

**List all requests (any status):**

```js
engram_admin({ action: "list_access_requests" })
engram_admin({ action: "list_access_requests", status: "approved" })
engram_admin({ action: "list_access_requests", status: "denied" })
```

---

## 8. How It Works Internally

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  ~/.engram/instances.json                        │
│                  (machine-wide registry)                         │
└──────────┬───────────────┬──────────────────┬───────────────────┘
           │               │                  │
    ┌──────┴──────┐  ┌─────┴──────┐  ┌───────┴──────┐
    │  Instance A  │  │ Instance B │  │  Instance C  │
    │  sharing:    │  │ sharing:   │  │  sharing:    │
    │  "read"      │  │ "none"     │  │  "full"      │
    │  .engram/    │  │ .engram/   │  │  .engram/    │
    │  memory.db   │  │ memory.db  │  │  memory.db   │
    └─────────────┘  └────────────┘  └──────────────┘
             ↑                               │
             │    readonly SQLite open       │
             └───────────────────────────────┘
                   (direct file access)
```

No HTTP server. No sockets. Instance A opens Instance C's `.db` file directly using `better-sqlite3({ readonly: true })`, runs a read query, and closes (or caches the handle for 5 minutes).

### Service layer

| Service | Location | Responsibility |
|---------|----------|---------------|
| `InstanceRegistryService` | `src/services/instance-registry.service.ts` | Manages `instances.json` — register, heartbeat, list, prune |
| `CrossInstanceService` | `src/services/cross-instance.service.ts` | Opens foreign DBs read-only, runs queries, caches handles |
| `SensitiveDataService` | `src/services/sensitive-data.service.ts` | Lock management + access request lifecycle |

### DB handle cache

`CrossInstanceService` caches open read-only DB handles with a **5-minute TTL** and a **max of 10 simultaneous handles**. This avoids the overhead of reopening databases on every query while not leaking handles indefinitely.

### Sensitive data storage

- **Locks** are stored as a JSON array in the `config` table under key `sensitive_keys`. Format: `[{"type":"decisions","ids":[5,12]},...]`
- **Access requests** are stored in the `sensitive_access_requests` table (created by migration v17), with columns: `id`, `requester_instance_id`, `requester_label`, `target_type`, `target_ids` (JSON), `reason`, `status`, `requested_at`, `resolved_at`, `resolved_by`

---

## 9. All Admin Actions Reference

### Discovery & identity

| Action | Params | Description |
|--------|--------|-------------|
| `discover_instances` | `{ include_stale?: boolean }` | List all instances on this machine with status, sharing, and stats |
| `get_instance_info` | `{}` | Detailed info about this instance |
| `set_instance_label` | `{ label: string }` | Rename this instance |
| `set_sharing` | `{ mode: "none"\|"read"\|"full", types?: string[] }` | Configure what this instance shares |

### Cross-instance queries

| Action | Params | Description |
|--------|--------|-------------|
| `query_instance` | `{ instance_id, type, query?, limit?, status? }` | Read memory from another instance |
| `search_all_instances` | `{ query, scope?, limit? }` | FTS search across all sharing instances |
| `import_from_instance` | `{ instance_id, type?, ids? }` | Copy records from another instance (requires `full` sharing) |

### Sensitive data

| Action | Params | Description |
|--------|--------|-------------|
| `mark_sensitive` | `{ type: string, ids: number[] }` | Lock records — hidden from all cross-instance queries |
| `unmark_sensitive` | `{ type: string, ids: number[] }` | Remove sensitivity lock |
| `list_sensitive` | `{}` | Show all currently locked records by type |
| `request_access` | `{ requester_instance_id, type, ids, requester_label?, reason? }` | Submit a pending access request for locked data |
| `approve_access` | `{ request_id: number, resolved_by?: string }` | Approve a pending access request (human action) |
| `deny_access` | `{ request_id: number, resolved_by?: string }` | Deny a pending access request (human action) |
| `list_access_requests` | `{ status?: "pending"\|"approved"\|"denied" }` | View access requests |

---

## 10. Quick-Start Walkthrough

### Scenario: you have two projects and want to share decisions between them

**Step 1 — Check what instances exist:**

```js
engram_admin({ action: "discover_instances" })
```

Note the `instance_id` of the other project (e.g., `b4e8d3c2`).

**Step 2 — Enable sharing on the source project (run this inside that project's IDE session):**

```js
engram_admin({ action: "set_sharing", mode: "read" })
```

**Step 3 — Query from your current project:**

```js
engram_admin({ action: "query_instance", instance_id: "b4e8d3c2", type: "decisions" })
```

**Step 4 — Search across everything:**

```js
engram_admin({ action: "search_all_instances", query: "database schema design" })
```

**Step 5 — Import a useful decision locally:**

First enable full sharing on the source:

```js
// on source instance
engram_admin({ action: "set_sharing", mode: "full" })
```

Then import:

```js
// on your instance
engram_admin({ action: "import_from_instance", instance_id: "b4e8d3c2", type: "decisions", ids: [7] })
```

---

### Scenario: protecting a sensitive decision

**Step 1 — Find the decision IDs you want to protect:**

```js
engram_memory({ action: "get_decisions" })
// note the id values of sensitive decisions
```

**Step 2 — Lock them:**

```js
engram_admin({ action: "mark_sensitive", type: "decisions", ids: [11, 15] })
```

Those decisions will no longer appear in any cross-instance query from any other instance.

**Step 3 — Review what's locked at any time:**

```js
engram_admin({ action: "list_sensitive" })
```

---

## 11. Security Notes

| Concern | How it's handled |
|---------|-----------------|
| Privacy by default | `sharing_mode: "none"` is the default — nothing is exposed unless you explicitly change it |
| Foreign DB writes | SQLite opened with `{ readonly: true }` — write attempts throw at the database driver level |
| Concurrent reads | SQLite WAL mode supports unlimited concurrent readers — no locking issues |
| Registry race conditions | Atomic temp-file + rename write; each instance only writes its own registry entry |
| Stale entries | Auto-pruned after 7 days; manual prune available |
| Sensitive data | Locked records are absent from results entirely — not masked, not redacted, simply not returned |
| Access request approval | Requires explicit human action (`approve_access`) — agents cannot self-approve |
| Machine scope | Registry and all queries are machine-local; nothing crosses a network boundary |

---

## 12. File Map

| File | Role |
|------|------|
| `src/constants.ts` | Config key constants (`CFG_INSTANCE_ID`, `CFG_SHARING_MODE`, `CFG_SENSITIVE_KEYS`, `HEARTBEAT_INTERVAL_MS`, etc.) |
| `src/migrations.ts` | Migration v17 — creates `sensitive_access_requests` table |
| `src/types.ts` | `InstanceEntry`, `InstanceRegistry`, `SensitiveAccessRequest`, `CrossInstanceSearchResult` |
| `src/utils.ts` | `getMachineId()`, `generateInstanceLabel()` |
| `src/database.ts` | Initializes identity on first run; wires `InstanceRegistryService`, `CrossInstanceService`, `SensitiveDataService` into `Services` |
| `src/index.ts` | Shutdown hooks — calls `crossInstance.closeAll()` then `registry.shutdown()` |
| `src/services/instance-registry.service.ts` | Registry CRUD; heartbeat loop; prune |
| `src/services/cross-instance.service.ts` | Read-only foreign DB queries; handle cache; permission checks |
| `src/services/sensitive-data.service.ts` | Lock management; access request lifecycle; `filterSensitive()` |
| `src/services/index.ts` | Barrel export for all 9 services |
| `src/tools/dispatcher-admin.ts` | 29 admin actions (7 discovery/sharing + 7 sensitive data) |
| `src/tools/find.ts` | `ADMIN_CATALOG` — 29 entries including all cross-instance actions |
| `tests/unit/instance-identity.test.ts` | 13 tests — identity generation, label, machine ID |
| `tests/services/instance-registry.test.ts` | 20 tests — registry lifecycle, heartbeat, prune |
| `tests/services/cross-instance.test.ts` | 14 tests — foreign DB queries, sharing checks, cache |
| `tests/services/sensitive-data.test.ts` | 30 tests — locks, filter, access request lifecycle |


Your machine has **10 isolated Engram databases** and **3 IDE installations**, each completely blind to the others:

### Discovered Instances

| # | Path | Size | Last Active | IDE/Context |
|---|------|------|-------------|-------------|
| 1 | `~/.engram/` (global) | 656 KB | 2026-02-28 22:17 | Global (all IDEs) |
| 2 | `~/Desktop/MCP/.engram/` | 236 KB | 2026-02-23 17:09 | MCP experiments |
| 3 | `~/Desktop/Rey App/Dady Website Redesign - VS Code/.engram/` | 4 KB | 2026-02-22 05:55 | Website project |
| 4 | `~/Documents/.engram/` | 328 KB | 2026-02-25 04:21 | Documents root |
| 5 | `~/Documents/Apps/fundi-smart/.engram/` | 244 KB | 2026-02-23 00:00 | Fundi Smart app |
| 6 | `~/Documents/MCP Builder/.engram/` | 480 KB | 2026-02-24 15:47 | MCP Builder workspace |
| 7 | `~/Documents/MCP Builder/Engram/.engram/` | 264 KB | 2026-02-24 06:49 | Engram sub-project |
| 8 | `~/repo/Engram/.engram/` | 572 KB | 2026-02-28 22:40 | Engram main dev |
| 9 | `~/source/repos/AuraShield/.engram/` | 236 KB | 2026-02-22 02:56 | AuraShield project |
| 10 | `~/source/repos/Fundi Smart Multi_Platform/.engram/` | 236 KB | 2026-02-23 09:07 | Fundi Smart full |

**Global DB:** `~/.engram/global.db` — 4 KB (barely used)

### IDE Configurations

| IDE | Config File | Mode | Version |
|-----|-------------|------|---------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | universal | 1.7.1 |
| Cursor | `~/.cursor/mcp.json` | universal | 1.7.1 |
| VS Code Copilot | `%APPDATA%\Code\User\mcp.json` | universal | 1.7.2 |

### What's Missing Today

1. **No instance identity** — databases have no UUID, no label, no way to know "which is which"
2. **No discovery** — no central registry of what exists on the machine
3. **No visibility** — can't query "how many sessions/decisions/tasks are in instance X?" from instance Y
4. **No sharing** — instance A can't access a decision from instance B, even if B wants to share it
5. **No communication** — instances can't coordinate, share learnings, or propagate conventions
6. **Global DB is an island** — `global.db` exists but has no link back to project instances
7. **`instances.json` doesn't exist** — was designed (Decision #10) but never built

---

## 2. Architecture Vision

### Core Principle: **Federated, Not Centralized**

Each Engram instance remains its own sovereign database. The global instance (`~/.engram/`) acts as the **registry** and **message bus** — it knows about all instances and routes sharing requests. No instance is forced to share; sharing is opt-in per-instance and per-memory-type.

```
┌─────────────────────────────────────────────────────────────────┐
│                    ~/.engram/ (Global Hub)                        │
│                                                                   │
│  instances.json ─── Registry of all known instances               │
│  global.db      ─── Shared decisions, conventions, shared keys    │
│  sharing.db     ─── Sharing permissions + cross-instance index    │
│                                                                   │
│  Functions:                                                       │
│   • Instance heartbeat registration                               │
│   • Cross-instance memory lookup (by key/query)                   │
│   • Sharing permission checks                                     │
│   • Convention propagation staging                                │
└──────────┬──────────────┬───────────────┬───────────────┬────────┘
           │              │               │               │
     ┌─────┴────┐   ┌────┴─────┐   ┌────┴─────┐   ┌────┴─────┐
     │ Instance │   │ Instance │   │ Instance │   │ Instance │
     │ repo/    │   │ fundi/   │   │ MCP/     │   │ Aura/    │
     │ Engram   │   │ smart    │   │ Builder  │   │ Shield   │
     │          │   │          │   │          │   │          │
     │ sharing: │   │ sharing: │   │ sharing: │   │ sharing: │
     │  all     │   │  none    │   │  read    │   │  read    │
     └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Design Boundaries

| What this infrastructure IS | What it is NOT |
|---|---|
| Instance identity + discovery | A dashboard UI |
| Registry file (`instances.json`) | An HTTP server |
| Per-instance sharing config | Cloud sync |
| Cross-instance read-only queries | Cross-instance writes |
| Convention propagation staging | Automatic convention merging |
| Machine-local only | Network/remote access |

---

## 3. Component Design

### 3.1 Instance Identity (Migration v17)

Every Engram database gets a stable identity on first initialization.

**Schema addition** (in `config` table via `ConfigRepo`):

| Key | Value | Set When |
|-----|-------|----------|
| `instance_id` | UUID v4 (e.g., `a3f7c2b1-...`) | First `initDatabase()` — never changes |
| `instance_label` | Human-readable (e.g., `vscode-Engram`) | Auto-generated, editable via `config` action |
| `instance_created_at` | ISO timestamp | First `initDatabase()` |
| `machine_id` | OS hardware fingerprint | First `initDatabase()` |
| `sharing_mode` | `none` / `read` / `full` | Default: `none` |
| `sharing_types` | JSON array of shareable types | Default: `["decisions","conventions"]` |

**Migration v17 SQL:**
```sql
-- No new table needed — uses existing config table.
-- Values are written by initDatabase() on first run after migration.
```

**`initDatabase()` changes:**
```typescript
// After migrations, check if instance_id exists in config
const existingId = repos.config.get('instance_id');
if (!existingId) {
    const instanceId = crypto.randomUUID();
    const label = generateInstanceLabel(projectRoot); // e.g., "vscode-Engram"
    const machineId = getMachineId(); // OS fingerprint
    repos.config.set('instance_id', instanceId, now());
    repos.config.set('instance_label', label, now());
    repos.config.set('instance_created_at', now(), now());
    repos.config.set('machine_id', machineId, now());
    repos.config.set('sharing_mode', 'none', now());
    repos.config.set('sharing_types', '["decisions","conventions"]', now());
}
```

**Machine ID derivation** (cross-platform):
- **Windows:** `wmic csproduct get uuid` or Registry `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
- **macOS:** `ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID`
- **Linux:** `/etc/machine-id` or `/var/lib/dbus/machine-id`
- **Fallback:** SHA-256 of `os.hostname() + os.userInfo().username + os.homedir()`

**Label generation:**
```
<IDE>-<project_basename>
```
Where IDE is detected from the process tree (Claude Desktop, Cursor, VS Code, unknown) and project_basename is `path.basename(projectRoot)`.

### 3.2 Instance Registry (`~/.engram/instances.json`)

A lightweight JSON file that acts as the machine-wide phonebook. Updated by every Engram instance on startup, periodically, and on shutdown.

**Format:**
```json
{
  "schema_version": 1,
  "machine_id": "abc123...",
  "last_updated": "2026-02-28T22:40:00.000Z",
  "instances": {
    "a3f7c2b1-...": {
      "instance_id": "a3f7c2b1-...",
      "label": "vscode-Engram",
      "project_root": "C:/Users/~ RG/repo/Engram",
      "db_path": "C:/Users/~ RG/repo/Engram/.engram/memory.db",
      "schema_version": 17,
      "server_version": "1.7.4",
      "sharing_mode": "read",
      "sharing_types": ["decisions", "conventions"],
      "stats": {
        "sessions": 33,
        "decisions": 12,
        "file_notes": 47,
        "tasks": 13,
        "conventions": 4,
        "db_size_kb": 572
      },
      "last_heartbeat": "2026-02-28T22:40:00.000Z",
      "status": "active",
      "pid": 12345
    }
  }
}
```

**Lifecycle:**
1. **On `initDatabase()`:** Register/update entry in `instances.json`
2. **Every 60 seconds** (if process is alive): Update `last_heartbeat`
3. **On process exit:** Update `status` to `"stopped"`, clear PID
4. **On read:** Entries with heartbeat > 5 minutes old are marked `"stale"`

**Concurrency safety:** Atomic write via temp file + rename. File lock via `proper-lockfile` or platform `flock()`. Each instance only writes its own entry — never modifies another's.

### 3.3 Instance Registry Service (`src/services/instance-registry.service.ts`)

New service that manages the registry file:

```typescript
export class InstanceRegistryService {
    private intervalId: NodeJS.Timeout | null = null;
    
    constructor(
        private config: ConfigRepo,
        private projectRoot: string,
        private db: DatabaseType
    ) {}
    
    // Register this instance in ~/.engram/instances.json
    register(): void { ... }
    
    // Update heartbeat timestamp + stats
    heartbeat(): void { ... }
    
    // Start periodic heartbeat (every 60s)
    startHeartbeat(): void { ... }
    
    // Stop heartbeat and mark as stopped
    shutdown(): void { ... }
    
    // Read the full registry (all instances on machine)
    getRegistry(): InstanceRegistry { ... }
    
    // Get just this instance's info
    getSelf(): InstanceEntry { ... }
    
    // List all known instances with status
    listInstances(): InstanceEntry[] { ... }
    
    // Remove stale entries (heartbeat > 7 days)
    pruneStale(): number { ... }
    
    // Update this instance's label
    setLabel(label: string): void { ... }
}
```

### 3.4 Cross-Instance Query Service (`src/services/cross-instance.service.ts`)

Opens **read-only** connections to other instances' databases to answer queries. This is the core of "one Engram can access another's memory."

**Design rules:**
- Only reads from instances with `sharing_mode` ≠ `"none"`
- Only reads the `sharing_types` that the source instance permits
- Opens DBs in read-only mode (`{ readonly: true }`)
- Caches open DB handles with 5-minute TTL
- Never writes to foreign databases

```typescript
export class CrossInstanceService {
    private dbCache: Map<string, { db: DatabaseType; expires: number }> = new Map();
    
    constructor(private registry: InstanceRegistryService) {}
    
    // List all instances with their stats and sharing config
    discoverInstances(): InstanceSummary[] { ... }
    
    // Query decisions from another instance (if sharing allows)
    queryDecisions(instanceId: string, options?: { query?: string; limit?: number }): Decision[] { ... }
    
    // Query conventions from another instance
    queryConventions(instanceId: string): Convention[] { ... }
    
    // Query file notes from another instance
    queryFileNotes(instanceId: string, filePath?: string): FileNote[] { ... }
    
    // Query tasks from another instance
    queryTasks(instanceId: string, options?: { status?: string }): Task[] { ... }
    
    // Search across ALL sharing instances at once
    searchAll(query: string, scope?: string): CrossInstanceSearchResult[] { ... }
    
    // Get stats from another instance without opening DB
    getInstanceStats(instanceId: string): InstanceStats | null { ... }
    
    // Import specific records from another instance (with provenance)
    importFrom(instanceId: string, type: string, ids: number[]): ImportResult { ... }
    
    private openReadOnly(dbPath: string): DatabaseType | null { ... }
    private closeExpired(): void { ... }
}
```

### 3.5 Sharing Configuration

Per-instance sharing is controlled through the `config` table:

| `sharing_mode` | Meaning |
|---|---|
| `none` | Instance is invisible to cross-instance queries (default) |
| `read` | Other instances can read from shared types |
| `full` | Other instances can read + import from shared types |

| Shareable types | Description |
|---|---|
| `decisions` | Architectural decisions + rationale |
| `conventions` | Coding conventions |
| `file_notes` | File metadata and summaries |
| `tasks` | Task board |
| `sessions` | Session history |
| `changes` | Change log |
| `milestones` | Project milestones |

Default `sharing_types`: `["decisions", "conventions"]` — the most useful for cross-project knowledge sharing, least sensitive.

### 3.6 New Dispatcher Actions

These actions are added to `engram_admin`:

| Action | Description | Params |
|---|---|---|
| `discover_instances` | List all Engram instances on this machine | `{ include_stale?: boolean }` |
| `get_instance_info` | Get detailed info about this instance | `{}` |
| `set_sharing` | Configure sharing for this instance | `{ mode: 'none'\|'read'\|'full', types?: string[] }` |
| `query_instance` | Query memory from another instance | `{ instance_id: string, type: string, query?: string, limit?: number }` |
| `search_all_instances` | Search across all sharing instances | `{ query: string, scope?: string }` |
| `import_from_instance` | Import records from another instance | `{ instance_id: string, type: string, ids?: number[], all?: boolean }` |
| `set_instance_label` | Rename this instance's label | `{ label: string }` |

---

## 4. Data Flows

### Flow 1: Instance Registration (on every startup)

```
initDatabase(projectRoot)
  │
  ├─ runMigrations() ─── v17 creates instance_id if missing
  │
  ├─ registryService.register()
  │     │
  │     ├─ Read ~/.engram/instances.json (create if missing)
  │     ├─ Upsert this instance's entry with:
  │     │   • instance_id, label, project_root, db_path
  │     │   • schema_version, server_version
  │     │   • sharing_mode, sharing_types (from config)
  │     │   • stats (query counts from DB)
  │     │   • last_heartbeat = now(), status = "active", pid
  │     └─ Atomic write back
  │
  └─ registryService.startHeartbeat() ─── every 60s update
```

### Flow 2: Cross-Instance Discovery

```
Agent calls: engram_admin({ action: "discover_instances" })
  │
  ├─ registryService.listInstances()
  │     │
  │     ├─ Read ~/.engram/instances.json
  │     ├─ For each entry:
  │     │   ├─ Check if process is alive (PID check)
  │     │   ├─ Mark as active/stale/stopped
  │     │   └─ Include sharing_mode + sharing_types
  │     └─ Return sorted by last_heartbeat
  │
  └─ Return formatted instance list to agent
```

### Flow 3: Cross-Instance Query

```
Agent calls: engram_admin({ action: "query_instance", instance_id: "abc...", type: "decisions" })
  │
  ├─ Lookup instance in registry
  │     ├─ Verify instance exists → error if not
  │     ├─ Verify sharing_mode ≠ "none" → error if blocked
  │     └─ Verify "decisions" ∈ sharing_types → error if not shared
  │
  ├─ crossInstanceService.queryDecisions("abc...", { query, limit })
  │     │
  │     ├─ Open target DB in READ-ONLY mode
  │     ├─ Run SELECT on decisions table
  │     ├─ Tag results with source: { instance_id, label, project_root }
  │     └─ Return results
  │
  └─ Return decisions with provenance to agent
```

### Flow 4: Convention Propagation

```
Agent calls: engram_memory({ action: "add_convention", ... , propagate: true })
  │
  ├─ Write convention to local DB (existing flow)
  │
  ├─ Write to global.db (existing flow for export_global)
  │
  └─ Write to sharing index in ~/.engram/sharing.db
        │
        ├─ shared_conventions table:
        │   source_instance_id, convention_id, category, rule, timestamp
        │
        └─ Other instances see this on next `check_shared_conventions()`
```

### Flow 5: Search Across All Instances

```
Agent calls: engram_admin({ action: "search_all_instances", query: "authentication" })
  │
  ├─ Get all instances with sharing_mode ≠ "none"
  │
  ├─ For each sharing instance:
  │     ├─ Open DB read-only
  │     ├─ FTS5 search decisions (if "decisions" in sharing_types)
  │     ├─ FTS5 search sessions (if "sessions" in sharing_types)
  │     └─ Tag results with source instance
  │
  └─ Merge + rank results by relevance
       Return: [
         { source: "vscode-Engram", type: "decision", text: "...", score: 8.2 },
         { source: "MCP Builder", type: "decision", text: "...", score: 5.1 },
       ]
```

---

## 5. Implementation Plan

### Phase A: Instance Identity (2-3 hours)

| Step | File(s) | What |
|------|---------|------|
| A1 | `src/constants.ts` | Add `DB_VERSION = 17`, config key constants |
| A2 | `src/migrations.ts` | Add migration v17 (no-op SQL — identity is written by initDatabase) |
| A3 | `src/utils.ts` | Add `getMachineId()`, `generateInstanceLabel()` |
| A4 | `src/database.ts` | Generate instance_id on first init after migration v17 |
| A5 | Tests | Test identity generation, label format, machine ID |

### Phase B: Instance Registry (3-4 hours)

| Step | File(s) | What |
|------|---------|------|
| B1 | `src/types.ts` | Add `InstanceEntry`, `InstanceRegistry` types |
| B2 | `src/services/instance-registry.service.ts` | Full registry service |
| B3 | `src/services/index.ts` | Export new service |
| B4 | `src/database.ts` | Wire registry into Services, start heartbeat |
| B5 | `src/index.ts` | Graceful shutdown hook for registry deregister |
| B6 | Tests | Test registry read/write, heartbeat, prune |

### Phase C: Cross-Instance Queries (3-4 hours)

| Step | File(s) | What |
|------|---------|------|
| C1 | `src/services/cross-instance.service.ts` | Cross-instance read service |
| C2 | `src/services/index.ts` | Export new service |
| C3 | `src/database.ts` | Wire into Services |
| C4 | Tests | Test read-only access, sharing checks, cache |

### Phase D: Dispatcher Wiring (2-3 hours)

| Step | File(s) | What |
|------|---------|------|
| D1 | `src/tools/dispatcher-admin.ts` | Add 7 new actions |
| D2 | `src/tools/find.ts` | Add to ADMIN_CATALOG |
| D3 | `src/tools/dispatcher-memory.ts` | Add `propagate` param to `add_convention` |
| D4 | Tests | Smoke tests for new actions |

### Phase E: Existing Infrastructure Wiring (1-2 hours)

| Step | File(s) | What |
|------|---------|------|
| E1 | `src/global-db.ts` | Add `shared_memories` table to global.db schema |
| E2 | `src/tools/sessions.ts` | Show instance info in session start response |
| E3 | All | Integration testing with multiple real DBs |

**Total estimate: 11-16 hours of implementation**

---

## 6. File Impact Map

| File | Change Type | Impact |
|------|-------------|--------|
| `src/constants.ts` | Modified | New config key constants, DB_VERSION bump |
| `src/migrations.ts` | Modified | Add migration v17 |
| `src/types.ts` | Modified | New InstanceEntry/Registry types |
| `src/utils.ts` | Modified | getMachineId(), generateInstanceLabel() |
| `src/database.ts` | Modified | Instance identity init, registry wiring |
| `src/index.ts` | Modified | Shutdown hook for registry |
| `src/services/instance-registry.service.ts` | **Created** | Registry service |
| `src/services/cross-instance.service.ts` | **Created** | Cross-instance queries |
| `src/services/index.ts` | Modified | Export new services |
| `src/tools/dispatcher-admin.ts` | Modified | 7 new actions |
| `src/tools/find.ts` | Modified | New catalog entries |
| `src/tools/sessions.ts` | Modified | Instance info in start response |
| `src/global-db.ts` | Modified | Shared memories index |
| `src/repositories/index.ts` | Unchanged | No new repos needed |
| `tests/services/instance-registry.test.ts` | **Created** | Registry tests |
| `tests/services/cross-instance.test.ts` | **Created** | Cross-instance tests |

---

## 7. Security Considerations

| Concern | Mitigation |
|---|---|
| Reading private project data | `sharing_mode: "none"` is the default — opt-in only |
| Write access to foreign DB | Databases opened with `{ readonly: true }` — physically impossible |
| Race conditions on `instances.json` | Atomic write (temp + rename); each instance only writes its own entry |
| Malicious instance registration | All local (no network); instances.json is in user home dir; OS file permissions apply |
| DB corruption via concurrent read | SQLite WAL mode supports unlimited concurrent readers safely |
| Stale entries consuming resources | Auto-prune entries with heartbeat > 7 days; manual prune via `prune_stale` |

---

## 8. Agent Experience (What Agents See)

### On Session Start (after infrastructure is live)

```json
{
  "instance": {
    "id": "a3f7c2b1-...",
    "label": "vscode-Engram",
    "sharing": "read",
    "peer_count": 9
  }
}
```

### Discovering Other Instances

```js
engram_admin({ action: "discover_instances" })
// Returns:
{
  "instances": [
    { "id": "a3f7c2b1", "label": "vscode-Engram", "project": "Engram", "status": "active", "sharing": "read", "stats": { "decisions": 12, "tasks": 13 } },
    { "id": "b4e8d3c2", "label": "cursor-MCP-Builder", "project": "MCP Builder", "status": "stale", "sharing": "read", "stats": { "decisions": 5, "tasks": 3 } },
    { "id": "c5f9e4d3", "label": "claude-Documents", "project": "Documents", "status": "stopped", "sharing": "none", "stats": { "decisions": 8 } },
    // ... 7 more
  ],
  "total": 10,
  "sharing_enabled": 4,
  "this_instance": "a3f7c2b1"
}
```

### Querying Another Instance

```js
engram_admin({ action: "query_instance", instance_id: "b4e8d3c2", type: "decisions", query: "architecture" })
// Returns:
{
  "source": { "id": "b4e8d3c2", "label": "cursor-MCP-Builder", "project": "MCP Builder" },
  "results": [
    { "id": 3, "decision": "Use React 19 + Vite 6 for dashboard", "rationale": "..." },
    { "id": 7, "decision": "Express for HTTP transport", "rationale": "..." }
  ],
  "total": 2
}
```

### Searching Everything

```js
engram_admin({ action: "search_all_instances", query: "authentication" })
// Returns results from all sharing instances, tagged with source
```

---

## 9. What This Unlocks

| Capability | Enabled By |
|---|---|
| "What projects have I worked on?" | `discover_instances` |
| "What decisions did I make in the MCP project?" | `query_instance` with `type: "decisions"` |
| "Find anything about auth across all projects" | `search_all_instances` |
| "Share this project's conventions globally" | `set_sharing` + convention propagation |
| "How many total memories do I have?" | `discover_instances` (includes stats) |
| Dashboard MVP (future) | Registry as data source for instance panel |
| Cloud sync (future) | Instance identity as sync anchor |
| Multi-machine sync (future) | Machine ID + instance ID = globally unique |

---

## 10. Existing Decisions Alignment

This plan aligns with and builds on:

- **Decision #10** (Global instance as trust root): ✅ Global `~/.engram/` is the registry hub
- **Decision #9** (Harmonize algorithm): ✅ Deferred to dashboard phase — this layer is read-only queries, not merge
- **Decision #7** (Phase 0 prerequisites): ✅ Instance identity (0-B) is implemented here; HTTP server (0-A) is NOT needed for this — direct SQLite access is sufficient
- **Decision #12** (Cloud encryption): ✅ Unchanged — cloud layer builds on top of instance identity

### Key Insight: HTTP Server Is NOT Required For Cross-Instance Access

The original Phase 0 design assumed instances would communicate via HTTP API calls. But since all instances are on the same machine with access to the same filesystem, **direct read-only SQLite access is far simpler and more reliable**:

- No HTTP server to run → no port conflicts, no auth tokens, no CORS
- Works even when instances are stopped (DB files are always on disk)
- SQLite WAL mode supports unlimited concurrent readers
- Zero additional dependencies

The HTTP server remains needed for the dashboard UI (browser cannot open SQLite directly), but for instance-to-instance communication, `better-sqlite3({ readonly: true })` is the optimal path.

---

## 11. Open Questions

1. **Should instances auto-set sharing to `read` on upgrade?** Or keep default `none` and require explicit opt-in? (I recommend opt-in — `none` default.)

2. **Should `instances.json` include instances from other machines** (via cloud sync)? Or keep it strictly machine-local? (I recommend machine-local for now.)

3. **Should there be a `sharing_keys` mechanism** where instance A can grant instance B a specific key to access only certain records? (Overkill for now — `sharing_mode` per type is sufficient.)

4. **Convention propagation: push or pull?** Should adding a convention with `propagate: true` write to every instance immediately, or should instances poll for new shared conventions? (I recommend pull — each instance checks on session start.)

---

*This document is the implementation blueprint. No dashboard required. No HTTP server required. Just identity, discovery, and direct cross-DB read access.*
