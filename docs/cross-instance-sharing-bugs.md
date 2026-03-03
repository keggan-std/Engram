# Cross-Instance Sharing — Bug Report & Fix Suggestions

**Discovered:** 2026-03-03 · Session #66  
**Status:** Documented, not yet fixed  
**Related decisions:** #26, #27, #28, #29  

---

## Context

During an attempt to read the `Skill-and-Instructions-Builder` instance from within the `Engram` instance (using `query_instance` and `get_instance_info`), four distinct bugs were uncovered that collectively make cross-instance sharing non-functional. None of the cross-instance admin actions actually read from the foreign instance's database.

---

## Bug #1 — `query_instance` ignores `instance_id` (Decision #26)

### What happened
Called `query_instance` with `instance_id = '3f7189b4-9f95-45aa-95b8-15c1c3aa5123'` (Skill-and-Instructions-Builder). The response came back with data belonging to the local Engram instance (`bb48f545...`), not the target.

### Root cause
The action handler does not use the `instance_id` param to locate and open the foreign DB. It falls through to whatever the current `getRepos()` context is — the local instance.

### Impact
`query_instance` is entirely broken for all callers. Any cross-instance read silently returns wrong data with no error.

### Suggested fix
In the `query_instance` case branch in `dispatcher-admin.ts`:
1. Look up the target instance entry from `instances.json` using `instance_id`.
2. Resolve the correct DB file path for that instance (see Bug #3).
3. Open it read-only with `better-sqlite3 { readonly: true }`.
4. Run the query against that DB connection, not `getRepos()`.
5. Close the foreign DB connection after the query.

---

## Bug #2 — `query_instance` only returns decisions for any `query_type` (Decision #27)

### What happened
Called `query_instance` with `query_type = 'conventions'` and separately with `query_type = 'file_notes'`. Both calls returned the same decisions result set — no error, no indication of fallback.

### Root cause
The `query_type` switch/if block likely only has a `decisions` branch and falls through or defaults to it for all other values.

### Impact
Silent wrong-data bug. An agent asking for `conventions` from another instance gets decisions instead, with no indication anything went wrong.

### Suggested fix
Implement a proper `query_type` router in the handler with explicit branches for:
- `decisions` → query `decisions` table
- `conventions` → query `conventions` table
- `file_notes` → query `file_notes` table
- `tasks` → query `tasks` table
- `changes` → query `changes` table (last N, configurable)
- `sessions` → query `sessions` table (summaries only)

Add a Zod `z.enum([...])` constraint on `query_type` so unknown values are rejected at the schema level rather than falling through silently.

---

## Bug #3 — `instances.json` missing `db_path`; IDE-suffixed filenames break direct access (Decision #28)

### What happened
Attempted direct `better-sqlite3` access to `<project>/.engram/memory.db`. File does not exist. The actual file is `memory-antigravity.db` (created by Antigravity IDE). The `instances.json` registry entry only stores `project_root`, not the actual DB filename.

### Root cause
The DB filename is determined at runtime based on which IDE spawned the process (e.g. `memory-antigravity.db`, `memory-cursor.db`, `memory.db`). This information is never written to the registry, so any code that tries to locate a foreign DB by convention (`project_root + '/.engram/memory.db'`) will fail when the IDE is not VS Code / standard.

### Confirmed registry entry structure (current)
```json
{
  "instance_id": "3f7189b4...",
  "label": "Skill-and-Instructions-Builder",
  "project_root": "C:\\Users\\~ RG\\repo\\Skill and Instructions Builder",
  "sharing_mode": "full",
  "sharing_types": ["decisions", "conventions"],
  "status": "active",
  "last_heartbeat": "2026-03-03T05:42:30.894Z"
}
```

### Missing field
```json
"db_path": "C:\\Users\\~ RG\\repo\\Skill and Instructions Builder\\.engram\\memory-antigravity.db"
```

### Suggested fix (two-part)

**Part A — Add `db_path` to registry writes:**  
In `instance-registry.ts` (or wherever heartbeat writes occur), add the resolved absolute DB file path to the entry written to `instances.json`. This is already known at write time from `initDatabase()`.

**Part B — Fallback discovery for entries missing `db_path`:**  
For registry entries written by older Engram versions that lack the field, add a `resolveDbPath(project_root)` helper that:
1. Checks for `memory-*.db` files inside `<project_root>/.engram/`
2. Picks the most recently modified one
3. Falls back to `memory.db` as the default
4. Returns `null` (and surfaces an error) only if nothing is found

---

## Bug #4 — `get_instance_info` ignores `instance_id` (Decision #29)

### What happened
Called `get_instance_info` with `instance_id = '3f7189b4...'` (Skill-and-Instructions-Builder). Response returned `instance_id: 'bb48f545...'`, `label: 'Engram'`, and stats from the local DB.

### Root cause
Same root cause as Bug #1 — the handler does not route to the foreign instance. It reads from local repos /  local config.

### Impact
`get_instance_info` only ever describes the calling instance regardless of what was asked.

### Suggested fix
In the `get_instance_info` case branch:
1. If `instance_id` matches `self_instance_id` → return local info (current behavior, correct).
2. If `instance_id` differs → look it up in `instances.json`, open the foreign DB read-only, query `config` table for `instance_id`, `label`, `schema_version`, `server_version`, then query table row counts for stats. Close and return.

---

## Summary Table

| # | Action | Bug | Severity | Fix Effort |
|---|--------|-----|----------|------------|
| 26 | `query_instance` | Ignores `instance_id`; always queries self | Critical | Medium |
| 27 | `query_instance` | All `query_type` values fall back to decisions | High | Low |
| 28 | `instances.json` | Missing `db_path`; IDE-suffixed filenames not discoverable | Critical | Low–Medium |
| 29 | `get_instance_info` | Ignores `instance_id`; always returns self | High | Low |

---

## Recommended Fix Order

1. **Bug #28 first** — Add `db_path` to the registry write. This is a prerequisite for Bugs #1 and #4. Also add the fallback `resolveDbPath()` helper for backward compatibility.
2. **Bug #26** — Wire `query_instance` to actually open and read the foreign DB using `db_path`.
3. **Bug #29** — Wire `get_instance_info` to the foreign DB for non-self `instance_id` values.
4. **Bug #27** — Expand `query_type` routing after the foreign DB connection is working.

All four fixes can ship together as a single patch version (`v1.9.2` or bundled into a larger cross-instance feature release).

---

## Files Expected to Change

| File | Change |
|------|--------|
| `src/services/instance-registry.ts` | Add `db_path` to heartbeat write; add `resolveDbPath()` helper |
| `src/tools/dispatcher-admin.ts` | Fix `query_instance` and `get_instance_info` case branches |
| `src/types.ts` | Add `db_path` to `InstanceEntry` type (if typed) |
| `tests/tools/` | Add tests for cross-instance query against a temp foreign DB |
