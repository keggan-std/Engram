# Engram — working instructions

**Bound by** `tests/process/claude-md.test.ts`. If you edit this file and that suite goes red,
the edit is the thing that is wrong. Keep it under 200 lines.

## This file is a recall channel — declare it if you are suppressing

Charter §10.4a defines recall as *any* path by which stored Engram content re-enters an agent's
context, including generated re-exports and content returned by write calls. It enumerates three
channels. **This file is a fourth.** It restates one Engram convention (the write-order rule below)
because that rule has to be known *before* the first write of a session, and every other route to it
is a write. If you are running a suppressed arm of the charter §10 experiment, you have been
contaminated by reading this — record it, as `docs/STATE.md` already instructs for channel 1.

Nothing else here is copied from the store. Everything else is a pointer.

## Read order

1. [`docs/STATE.md`](docs/STATE.md) — generated from Engram; where the project actually is.
2. [`docs/README.md`](docs/README.md) — the documentation router. It names the active set.
3. [`docs/foundations/00-CHARTER.md`](docs/foundations/00-CHARTER.md) — the spec this work executes from.

Do not read `docs/archive/` unless you are chasing history.

## Before you open a source file

Call `engram_memory(action:"get_file_notes")` first. Every file under `src/` is already noted.
Open the file only if the note is absent or you have reason to think it is stale. Re-reading the
codebase to rediscover what is already recorded is the single most expensive habit here.

## Engram write syntax — pass non-text parameters first

**Free text last, every time.** On any `engram_*` call that takes both, pass every non-text
parameter (`action`, `id`, `status`, `priority`, `tags`, `task_id`, …) *before* any long free-text
field (`decision`, `rationale`, `notes`, `content`, `summary`, `description`).

This is convention #7. Malformed records here are the agent's tool-call syntax error, not a server
bug, and the record lands truncated with fields silently lost. The ordering is a mitigation, not a
fix — the server-side rejection is task #91, and until it ships this is all that stands between a
session and a corrupted row. It has held across every write of the sessions that applied it.

## Evidence grading — do not promote silently

| Grade | Means |
|---|---|
| **PROVEN** | You ran an executable check and quoted its output |
| **VERIFIED** | You personally read the source and cited `file:line` |
| **REPORTED** | A sub-agent said so, and you have not re-checked it |

Anything CRITICAL needs an executable check, not an argument. *"This is consistent with X"* is
REPORTED, never VERIFIED. Never let a REPORTED claim reach a deliverable ungraded.

## Status lives in the task board, not in documents

Documents describe; Engram holds state. Two consequences that have each cost a session:

- **Check the tree before sizing work from a task row.** Rows have repeatedly read `backlog` for
  work that had already shipped — the artifact gets fixed and the row does not, so the board reads
  as the pessimistic view of a project further along than it says. Verify with `git log`/`git show`
  before you plan against a row.
- **When a plan summarises a domain doc, the domain doc wins.** A master-plan definition of done
  has already described a fix its own domain rejected.

## Never leave a status-bearing doc claiming a state that is no longer true

When a doc's subject ships, is superseded, or is resolved: add a banner saying so with the version
and commit, `git mv` it to `docs/archive/`, and add a line to `docs/archive/README.md` saying why.
This is convention #2, and `docs/archive/cross-instance-sharing-bugs.md` is the preserved evidence
of what happens otherwise — it asserted "not yet fixed" for eight versions after the fix shipped.

## What is enforced, and what is only written down

`.claude/hooks/guard-branches.mjs` is a `PreToolUse` hook and it will stop you:

- **Writing history on `main` or `develop`** is denied. Work on `v2-foundations` or a branch off it.
- **Any `git push` asks first.** Pushing *is* disclosure — the published line still carries the
  hazards, and a push fires the tripwire that commits to a release that week. It is a human decision.

Everything else in this file is context, not enforcement. Claude Code delivers `CLAUDE.md` as a user
message after the system prompt; compliance is not guaranteed. If something must happen at a fixed
point in the lifecycle, it belongs in a hook, and the hook above is the worked example.

## Never apply prism markers to this file

**PROVEN 2026-08-06.** Claude Code strips block-level HTML comments from `CLAUDE.md` before it
reaches context. A canary file was probed headlessly: the plain-prose marker and the prose inside a
`[H]` zone both arrived; the `[A:gist]` line inside an HTML comment did not.

So applying prism here inverts prism exactly — the agent loses every compressed directive and
receives every word of the prose the convention meant it to skip. Prism is correct for specs, plans
and reference docs. It is actively harmful in `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`
and auto-memory files. The bound test asserts no zone markers appear here.

## Session start is expensive — ask for what you need

`engram_session(action:"start")` at `verbosity:"full"` has been measured returning ~277,000
characters, and `get_tasks` at `compact:true` ~190,000. Both overflow a tool result. Use
`verbosity:"summary"`, and filter reads rather than pulling the board whole.
