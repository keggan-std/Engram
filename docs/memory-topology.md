# Memory topology — what a *global* install actually means

**Date:** 2026-08-11 · **Status:** Current. Describes shipped behaviour plus the two gaps closed on this date.
**Decision:** Engram #43 · **Evidence grade:** VERIFIED throughout — every claim cites `file:line` in this repo.

> **Read this before changing `findProjectRoot`, `initDatabase`, the installer's scope
> handling, or anything about cross-instance sharing.** It answers one question that has been
> asked repeatedly and answered by guesswork: *if Engram is installed globally, and many
> projects use it, do they share one memory?*

---

## The short answer

**No. A global install does not create a shared database.** The unit of memory is the
**project**, not the install.

- One server **process** serves exactly one project and holds exactly one database.
- A "global install" is a shared **config entry**, not a shared process. Each IDE window
  spawns its own Engram from that entry.
- Per-project databases are joined by **federated query**, not by merging.

The outcome people fear — one database for everything — does exist, but as a **detected
failure mode** with a warning attached, not as the design. See §4.

---

## 1 — Why "global" cannot mean "shared process"

An MCP stdio server is launched by the client, per client session. The config entry is a
recipe (`command` + `args`); the IDE runs it. So "installed globally" means *every project
uses the same recipe*, and each one gets its own process from it.

That is not an assumption. `initDatabase()` sets module-level singletons —
[`src/database.ts:106-114`](../src/database.ts) — and `_db` is one handle for the life of the
process. There is no structure in which a single process holds two projects' databases at once.

**The one exception, and it is sequential rather than concurrent.**
`engram_session({action:"start", project_root})` calls `reinitDatabase()` and swaps that
singleton — [`src/tools/sessions.ts:198-214`](../src/tools/sessions.ts). It exists as a
repair path for IDEs that spawn the server from `$HOME`, and it is correct for that. It is
**not** a multi-project mechanism: two projects served concurrently through it would race the
same handle.

---

## 2 — How the project is resolved, in priority order

[`findProjectRoot()`](../src/utils.ts) — `src/utils.ts:157` — six tiers:

| Tier | Source | Notes |
|---|---|---|
| 0 | `--project-root=<path>` CLI arg | Highest priority. What the installer injects |
| 1 | `ENGRAM_PROJECT_ROOT` env | |
| 2 | `PROJECT_ROOT` env | |
| 3 | `git rev-parse --show-toplevel` | Knows real boundaries, including worktrees |
| 4 | Walk up for **strong** markers — `.git`, `.engram` | Never present in an IDE install dir |
| 5 | Walk up for **soft** markers — `package.json`, … | Guarded against blocked paths, `$HOME`, and Engram's own source tree |
| 6 | `~/.engram/global/` | The fallback. §4 |

The database then lands at `<projectRoot>/.engram/memory.db`, or `memory-<ide>.db` when
`--ide=<key>` is present — the per-IDE shard that stops two IDEs contending for one write
lock (finding F7, [`multi-ide-concurrency.md`](multi-ide-concurrency.md)).

---

## 3 — The gap that made this look worse than it was

Tier 0 only fires if something supplies the path. **Seven of the fourteen supported IDEs had
nothing supplying it.**

| | IDEs | What told the server where the project was |
|---|---|---|
| **Workspace variable** | VS Code, Cursor, Visual Studio, Trae | The installer injects `--project-root=${workspaceFolder}`; the IDE expands it at launch. Deterministic |
| **No workspace variable** | Windsurf, Antigravity, Claude Desktop, Cline, Roo Code, Gemini CLI, JetBrains | **Nothing.** Tiers 3-5 inferred it from whatever working directory the IDE happened to use |

Inference is not the problem by itself — tiers 3-5 are good heuristics. The problems were
that **the user was never shown the answer**, and that the failure landed in §4 silently.

**Closed on 2026-08-11.** A *project-local* install on an IDE with no workspace variable now
writes an **absolute** `--project-root` into the entry
([`config-writer.ts:103`](../src/installer/config-writer.ts)). That is only sound because a
project-local config file already belongs to exactly one project.

**A global install deliberately still gets nothing**, and this is the important half: pinning
an absolute path into a user-level config would tie every project on the machine to whichever
one happened to be open at install time. Both directions are asserted in
[`tests/installer/discovery-and-ledger.test.ts`](../tests/installer/discovery-and-ledger.test.ts).

So the honest summary of a **global install on a no-workspace-variable IDE** is: the project
is still inferred at runtime, because it genuinely has to be. What changed is that the
installer now says so instead of implying a path it does not control.

---

## 4 — The shared-database failure mode

When every tier fails, tier 6 returns `~/.engram/global/` — `src/utils.ts:248-256`. Every
project that lands there shares one database. The code already says this out loud, at
[`src/tools/sessions.ts:229`](../src/tools/sessions.ts):

> *"Engram could not detect your project directory. Memory is currently stored in a shared
> global location, which means different projects would share the same data."*

Two limits worth knowing before trusting that warning:

1. **It only fires when `--ide=<key>` is present.** The reasoning — a user with no `--ide`
   flag chose a global install deliberately — is defensible but leaves a real hole: an IDE
   that fails to expand `${workspaceFolder}` produces a literal, not a fallback, so it fails
   a different way and is not covered by this check at all.
2. **It asks the agent to ask the user.** It is a prompt, not an enforcement, and agent-rule
   compliance in this project has been measured at 21.1% ([`07-ergonomics.md`](foundations/07-ergonomics.md)).

Treat tier 6 as *"the install is not finished"*, not as a supported configuration.

---

## 5 — How the databases connect

They are **not** merged. They are federated, and the machinery already exists.

Every `initDatabase()` calls `registry.register()` and starts a heartbeat —
`src/database.ts:167-168` — writing into `~/.engram/instances.json`
(`constants.ts:289-290`) an entry carrying `instance_id`, label, `db_path`, `sharing_mode`
and stats. On top of that:

| Action | What it does |
|---|---|
| `discover_instances` | Every Engram on this machine, online plus permanently enrolled |
| `query_instance` | Read one other instance's decisions, conventions, file notes, tasks, sessions, changes |
| `search_all_instances` | One query across every instance that shares |
| `import_from_instance` | Copy records across, requires full sharing |
| `set_sharing` / `set_visibility` | Opt in per instance; default is heartbeat-only |

See [`cross-instance-infrastructure.md`](cross-instance-infrastructure.md) — and note its
open caveat: **the trust root is unsigned** (constitution §12.8).

### Why federated and not one database

*Rejected — one global DB with a `project_id` column.* It makes cross-project leakage the
default rather than an opt-in; destroys the "delete the folder, delete the memory" property;
puts every project behind one write lock, which is the contention per-IDE sharding was added
to remove; and contradicts README's Storage section, which promises a portable per-project file.

*Rejected — a broker process owning many databases.* MCP stdio has no lifecycle that supports
it, and the nearest existing thing (`reinitDatabase`) swaps a singleton — see §1.

---

## 6 — Finding installs again: the ledger

Federation covers *running* instances. It says nothing about **where Engram was installed**,
and until 2026-08-11 nothing did: status was re-derived each time by scanning the config paths
of the 14 known IDEs, which by construction cannot find an install into a custom directory —
an option the installer itself offers.

`~/.engram/installs.json` now records each install: config path, IDE, scope, mode, version,
project root, database path, timestamp. `install --check` reads it alongside the live scan and
shows only rows the scan could not reach, marking any whose entry has since vanished from the
config file — because the host application rewrites those files on its own schedule (D5 F11).

**`--isolated` opts out.** The install happens; the ledger row does not. The installer prints
the path and states plainly that `--check` will not find it. That is the trade being offered:
an install nothing can enumerate is only acceptable if the user is handed the path at the
moment they choose it.

---

## 7 — What is still open

| | Where |
|---|---|
| The tier-6 warning does not fire without `--ide=`, and cannot cover an unexpanded `${workspaceFolder}` | §4 |
| The cross-instance trust root is unsigned | constitution §12.8 |
| A **global** install still shows no database path, because it genuinely has none until launch | §3 |
| `pruneStale()` has no production caller, so `instances.json` only grows | D5, handed to domain 4 |

---

<!-- MEMORY_TOPOLOGY:COMPLETE -->
