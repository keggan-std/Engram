# Engram Documentation — Start Here

**Last reorganised:** 2026-08-02

> **If you are an agent starting a session: read this file, then only what it points you to.**
> Everything in [`archive/`](archive/) is superseded or shipped. Do not read it unless you are
> chasing history. It is kept because git history alone doesn't surface *why* something was dropped.

---

## The current working set

Read in this order. This is the whole active set — eleven files.

| # | Document | What it is | Read when |
|---|---|---|---|
| 1 | **[ENGRAM_CONSTITUTION.md](ENGRAM_CONSTITUTION.md)** | The map. All 90 `src/` files: what, why, holds, touches, gotchas. §12 is the danger index — **§12.1, 12.1b, 12.2 and 12.3 now read FIXED**, with the residual gaps stated. | **Always first.** Before opening any source file |
| 2 | **[engram-deep-audit-2026-08-02.md](engram-deep-audit-2026-08-02.md)** | 8 findings, 3 CRITICAL, each with an executable PoC. Three composed attack chains. **All four P0s are now fixed** (2026-08-02) — the finding text is preserved unedited as the dated record, so read §12 of the constitution for current state. | Before changing anything in `src/` |
| 3 | **[project-state-tracking-design.md](project-state-tracking-design.md)** | Why features get silently dropped and what actually catches it | Planning work, or wondering what's left |
| 4 | **[agent-accountability-design.md](agent-accountability-design.md)** | Sub-agent traceability and handoff | Spawning sub-agents, or designing handoff |
| 5 | **[trellis-engram-integration-analysis.md](trellis-engram-integration-analysis.md)** | Direction. Adopt 6 / adapt 2 / reject 3. Contains the 75-action shadowing argument | Deciding what Engram should become |

**Those five are "the design docs."** When a prompt says *"read the design docs,"* it means 3, 4 and 5 — with 1 and 2 as prerequisites.

### How to work

| Document | Read when |
|---|---|
| **[orchestration-guide.md](orchestration-guide.md)** | **Before delegating to sub-agents.** The prompt template, verification grades, the context tax, and the concurrency hazards — derived from running eight agents on this repo, including what went wrong |
| **[DEFERRED-CHANGES.md](DEFERRED-CHANGES.md)** | **Before every release, and before assuming any config is permanent.** Everything switched off, narrowed, or left half-done *on purpose*, each with the trigger that should switch it back on. Includes two breaking changes awaiting release handling |
| [reports/](reports/) | Dated session reports. What was done, what was proven versus assumed, and what turned up along the way. Chat is ephemeral; these are not |

### Supporting

| Document | What it is |
|---|---|
| [engram-self-audit-2026-08.md](engram-self-audit-2026-08.md) | The predecessor audit (2026-08-01). Cited throughout #2; all 8 of its findings were confirmed |
| [research/](research/) | Sourced evidence behind #3 — literature/tooling survey, and the live N3 evidence log |
| [engram-memory/](engram-memory/) | **Generated.** Decisions, conventions and observations exported from Engram's own store. Regenerate with `node scripts/export-memory-docs.mjs` — never hand-edit |
| [experience-logs/](experience-logs/) | Dated logs written after real sessions. The audit called these unusually valuable — **keep the habit** |

### Reference — live subsystems

| Document | Covers |
|---|---|
| [installation.md](installation.md) | Install guide (user-facing) |
| [how-to-schedule-events.md](how-to-schedule-events.md) | The scheduler feature (user-facing) |
| [cross-instance-infrastructure.md](cross-instance-infrastructure.md) | Cross-instance sharing design. **Caveat:** finding F4 (`searchAll()` skips `checkPermission()`) is still open |
| [multi-ide-concurrency.md](multi-ide-concurrency.md) | Per-IDE DB sharding. **Caveat:** finding F7 — sharding vs. the advertised multi-IDE continuity |
| [pm-framework-v1.10.0.md](pm-framework-v1.10.0.md) | PM-Lite / PM-Full feature reference |

---

## Where the current state actually lives

Documents describe. **Engram itself holds the live state**, and it is more current than any file here:

- **90 file notes** — one per `src/` file. Call `get_file_notes` before opening anything.
- **11 open tasks** — `#11` is the master plan; `#2`–`#5` are the P0 fixes; `#6`–`#10` follow.
- **14 decisions**, **20+ observations**, and a **pending handoff** surfaced at session start.

```js
engram_session({ action: "start", agent_name: "<you>", verbosity: "summary" })
```

---

## The archive convention

**When a doc's subject ships, is superseded, or is resolved:**

1. Add a banner at the top saying so, with the version and commit.
2. `git mv` it to [`archive/`](archive/).
3. Add a line to [`archive/README.md`](archive/README.md) saying why.

**Never leave a status-bearing doc claiming a state that is no longer true.** This isn't tidiness —
`archive/cross-instance-sharing-bugs.md` asserted "not yet fixed" for eight versions *after* the fix
shipped, and any agent trusting it would have burned a session re-fixing solved bugs. That is finding
F5, and the motivating case study for #3.

The banner on that file is deliberately preserved as evidence.

---

## Conventions for new docs

- **Date and status in the first five lines.** A doc with no date is a doc nobody can trust.
- **Grade your evidence.** The audit uses PROVEN (a PoC was run, output quoted) / VERIFIED (read in source, file:line cited) / REPORTED (found by a delegated agent, not re-checked). Mixing these silently is how an audit becomes folklore.
- **Link with relative paths** so links survive a move. Active docs are deliberately flat for this reason.
- **Generated files say so** and name the generator.

---

<!-- DOCS_ROUTER:COMPLETE -->
