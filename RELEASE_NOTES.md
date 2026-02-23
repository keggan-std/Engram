# v1.4.0 — Versioned Installs, Auto-Update & Update CLI

**Engram v1.4.0 is live.** This release brings full version awareness to the installer, a background update check service, and user-controlled update management — so agents can keep users informed about new releases without ever interrupting their work.

---

## Breaking Changes

None. v1.4.0 is fully backwards-compatible. Existing IDE config entries (without `_engram_version`) are automatically adopted on the next `engram install` run.

---

## What's New

### Version-Tracked Installer Entries

Every IDE config entry written by the installer is now stamped with `_engram_version`. On re-install, the installer detects one of four states and reports it clearly:

| State | Meaning |
|-------|---------|
| `added` | Fresh install — no prior entry existed |
| `exists` | Already installed at this version — nothing written |
| `upgraded` | Updated from a known older version to the current one |
| `legacy-upgraded` | Entry existed without a version stamp (pre-v1.4.0) — adopted and stamped |

The old `"updated"` status has been replaced by the more precise `"upgraded"` and `"legacy-upgraded"` outcomes.

### Background Auto-Update Check

Engram now checks for new versions silently after the MCP server connects. The check is:
- **Fire-and-forget:** runs via `setImmediate`, never blocks startup or any tool call
- **Throttled:** runs at most once per 24 hours
- **Opt-out:** disabled via `engram_config set auto_update_check false`
- **Snooze-aware:** respects `auto_update_remind_after` (e.g., `7d`, `2w`, `1m`)
- **Skip-aware:** respects `auto_update_skip_version` to permanently silence a specific version
- **Level-aware:** `auto_update_notify_level` (`"major"` | `"minor"` | `"patch"`) controls which bump sizes trigger a notification

### Update Notifications via `engram_start_session`

When a newer version is available, `engram_start_session` includes an `update_available` field in its response across all three verbosity levels (`minimal`, `summary`, `full`):

```json
"update_available": {
  "installed_version": "1.3.0",
  "available_version": "1.4.0",
  "changelog": "### v1.4.0 — ...",
  "releases_url": "https://github.com/keggan-std/Engram/releases"
}
```

The agent presents this to the user, who can respond with any of:
- **Update** → agent tells user to run `npx -y engram-mcp-server install`
- **Skip this version** → `engram_config set auto_update_skip_version 1.4.0`
- **Postpone** → `engram_config set auto_update_remind_after 7d`
- **Disable checks** → `engram_config set auto_update_check false`

### Two-Source Changelog Delivery

Update notifications include the release changelog fetched from:
1. **npm registry** (`https://registry.npmjs.org/engram-mcp-server/latest`) — includes the `releaseNotes` field injected at publish time by the new pre-publish script
2. **GitHub Releases API** — fallback when the registry is unreachable or `releaseNotes` is absent

Both sources use a 5-second timeout. Network failures are silent — startup is never affected.

### New `--check` CLI Flag

```bash
npx -y engram-mcp-server install --check
```

Shows the installed version for every detected IDE, fetches the npm latest, and correctly handles three scenarios:

| Scenario | Label |
|----------|-------|
| Running == npm latest | `✅ up to date` |
| Running > npm latest | `⚡ running pre-release (vX.Y.Z > npm vA.B.C)` |
| Running < npm latest | `⬆  npm has vX.Y.Z — run: npx -y engram-mcp-server install` |

### `engram_stats` — Version & Update Status

`engram_stats` now returns:

```json
{
  "server_version": "1.4.0",
  "update_status": { "available": true, "version": "1.5.0", "releases_url": "..." },
  "auto_update_check": "enabled",
  "last_update_check": "2026-02-23T00:00:00.000Z"
}
```

### `engram_config` — New Update Keys

Four new keys are now accepted by `engram_config`:

| Key | Type | Description |
|-----|------|-------------|
| `auto_update_check` | `true`/`false` | Enable/disable background update checks |
| `auto_update_skip_version` | string | Version to permanently silence (e.g., `1.4.1`) |
| `auto_update_remind_after` | duration or ISO date | Snooze updates (`7d`, `2w`, `1m`, or ISO string) |
| `auto_update_notify_level` | `major`/`minor`/`patch` | Minimum bump size to trigger a notification |

### Pre-publish Release Notes Injection

A new `scripts/inject-release-notes.js` script runs automatically before every `npm publish` (as part of the `prepack` lifecycle). It reads `RELEASE_NOTES.md`, extracts the current version's section, and writes it into `package.json` as `releaseNotes`. This allows the update service to deliver changelogs in a single HTTP call to the npm registry — no CDN dependency, no GitHub rate limits.

---

## Fixes & Internal

- Removed duplicate `getVersion()` function from `src/installer/index.ts` — now uses `getInstallerVersion()` from `config-writer.ts` as single source of truth
- `UpdateService` uses only built-in Node.js 18+ `fetch` — no new runtime dependencies added
- `addToConfig()` now uses version-first comparison instead of full JSON deep-equal, making the comparison logic explicit and testable

---

**Full Changelog**: https://github.com/keggan-std/Engram/compare/v1.3.0...v1.4.0

---

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
