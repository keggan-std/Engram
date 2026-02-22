# v1.3.0 — Token Efficiency, Batch Ops, Health Tooling & Path Normalization

**Engram v1.3.0 is live.** This release focuses on making agents smarter with their context budget, more reliable across platforms, and better equipped to inspect their own memory layer.

---

## Breaking Changes

None. v1.3.0 is fully backwards-compatible. All existing tool calls and configurations work unchanged.

---

## What's New

### Session Verbosity Control
`engram_start_session` now accepts a `verbosity` parameter:

| Value | Description | Token Savings |
|-------|-------------|---------------|
| `"minimal"` | Counts only — no raw rows | ~90% fewer |
| `"summary"` | Truncated recent items (default) | ~60–80% fewer |
| `"full"` | Full context including file tree | Unchanged |

Agents working on large projects no longer need to burn their context window just to start a session.

### New Tool: `engram_config`
Read or update Engram's runtime configuration directly from agent tools — no file edits required:
- `auto_compact` (true/false)
- `compact_threshold` (number of sessions)
- `retention_days`
- `max_backups`

### New Tool: `engram_health`
On-demand database diagnostics:
- SQLite integrity check
- Schema version
- FTS5 availability
- WAL mode status
- Per-table row counts
- Active config dump

### Batch Operations
Both `engram_record_decision` and `engram_set_file_notes` now accept arrays. Multiple entries are written in a single atomic SQLite transaction — faster and safer when documenting a batch of changes at once.

### Path Normalization
File paths are now normalized on write and lookup:
- Backslashes → forward slashes
- `./` prefix stripped
- Consecutive slashes collapsed
- Trailing slashes stripped

This fixes silent mismatches on Windows where agents use `\` and lookups fail against stored `/` paths.

### Similar Decision Detection
When calling `engram_record_decision`, Engram now checks for semantically similar active decisions using keyword matching. A `similar_decisions` warning is returned if matches are found — helping agents avoid creating duplicate entries.

### Unified Response Helpers
All 30+ tools now return responses through shared `success()` / `error()` helpers. The output shape is now consistent and predictable across every tool, making response parsing reliable for agent integrations.

### Services Layer
Internal refactoring: `CompactionService`, `EventTriggerService`, `GitService`, and `ProjectScanService` are now initialized as proper singletons via `getServices()` and injected into tools — separating business logic from raw SQL.

### Expanded Test Suite
- `tests/repositories/batch.test.ts` — covers `upsertBatch` and `createBatch`
- `tests/unit/normalize-path.test.ts` — covers all `normalizePath()` edge cases
- `tests/unit/repos.test.ts` — covers repository layer methods

Total automated tests now exceed **50**.

---

## Fixes in v1.2.7 – v1.2.9

These patch releases shipped between v1.2.6 and v1.3.0:

| Version | Fix |
|---------|-----|
| v1.2.7 | Include `dist/` in the published npm package; document Windows build requirements for native SQLite binaries |
| v1.2.8 | Correct IDE detection logic and fix local install path default |
| v1.2.9 | Installer UX improvements; remove package bloat; sync version across files; pin `prebuild-install` to 7.1.3 |

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.2.9...v1.3.0
