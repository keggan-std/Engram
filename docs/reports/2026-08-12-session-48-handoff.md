# Session 48 — handoff

**Date:** 2026-08-12 · **Status:** complete, pushed · **Branch:** `v2-foundations` @ `2c66ad1`
**Agent:** `claude-opus-5-session-48`

> **Why this is a file and not an Engram handoff row.** Every long free-text write this
> session was refused by the write-integrity guard — the upstream decoder bug fired on
> strings as short as ~330 characters, with parameters ordered exactly as convention #7
> prescribes. See [observation #144](#5-convention-7s-ceiling-is-lower-than-its-text-implies).
> The Engram handoff row points here. **The commit messages carry the full rationale**
> and are the primary record for everything below.

---

## What shipped

Four commits, pushed to `origin/v2-foundations`.

| Commit | What |
|---|---|
| `d9f1bc5` | Two cold-start races — task #59 and one found while testing it |
| `fad790d` | VS Code misdetected as Antigravity; scriptable `--check --update` |
| `a2e4139` | Write-integrity detector was blind to the commonest fold shape |
| `2c66ad1` | `docs/STATE.md` regenerated |

**Verified, not asserted:** `tsc -p tsconfig.json` exit 0, `tsc -p tsconfig.test.json` exit 0,
`npm run build` clean, full suite **969/969 across 61 files** (was 948/60).

---

## 1. Two cold-start races (task #59 — closed)

`runMigrationsTo()` read the schema version and then ran each migration in its own DEFERRED
transaction. Nothing serialised read-version → run-chain *across processes*, so two servers
both read v0 and both ran the chain; the loser died on an unconditional `ALTER TABLE ADD COLUMN`.

Fixed with double-checked locking: an unlocked fast-path read, then `BEGIN IMMEDIATE` around a
**re-read** plus the chain. The re-read inside the lock is the whole fix.

**PROVEN both directions** by the new [`tests/migrations/concurrent-cold-start.test.ts`](../../tests/migrations/concurrent-cold-start.test.ts):
without the fix, 2 of 3 rounds fail with `duplicate column name: file_mtime` / `content_hash`;
with it, 5/5 pass.

### The second race, which task #59 did not know about

Writing that test surfaced a **different** crash in the same scenario:
`PRAGMA journal_mode = WAL` throws `SQLITE_BUSY` and kills the server.

**PROVEN against the real `initDatabase()`** — 3 of 20 processes died, then 1 of 30. The stack
put it at `Database.pragma` inside `openDatabaseWithRecovery`, *not* the migration chain.
**After the fix: 0 of 48.**

`busy_timeout` does not cover it. Measured directly: with `busy_timeout = 15000` and another
connection holding `BEGIN EXCLUSIVE`, the conversion still threw `SQLITE_BUSY` — after
**20,004 ms**. Converting to WAL needs an exclusive lock, and SQLite returns BUSY for a lock
upgrade it judges could deadlock rather than invoking the busy handler.

Reading the mode first is the actual fix, not a fast path: `journal_mode` is a property of the
*file* and reading it needs only a shared lock. The loser never needs to win the lock — it needs
to notice it no longer has to.

> **Both races have the same user-visible symptom, and it is why neither was found by reading:**
> the process dies, the data is fine, `integrity_check` returns `ok`, and the stderr explaining
> it is discarded by IDE MCP hosts (FR-D6 T6). Engram is simply *absent* on first run.

---

## 2. `install --universal` named the wrong product

Reported by the maintainer mid-session, running the real command in this repository:

```
Detected IDE  : Antigravity IDE (Gemini)
Config file   : C:\Users\El-Roi\.gemini\antigravity\mcp_config.json
```

It was VS Code. `VSCODE_CWD` read `...\Programs\Microsoft VS Code` — the running editor, named
unambiguously — and detection **fell through it** to a PATH substring match, where two entries
sat because Antigravity is *installed*, not because it was running.

This is **task #109's defect one file over**: evidence about the machine read as evidence about
the process. #109 was fixed by deleting the offending branch rather than tightening it, and the
same reasoning applies.

`VSCODE_CWD` is now authoritative when set. PATH is demoted from an assertion to an *ambiguity*
reported by `detectVscodeForkAmbiguity()`, resolved by asking — reusing the `select()` path
task #108 already built.

---

## 3. `--check --update` (task #107)

`--check` already offered to update outdated installs, but only through an interactive
`select()` that a script, a CI job or an agent cannot reach.

```
engram install --check --update               every outdated install
engram install --check --update --ide vscode  just that one
```

`--check` alone still never writes. Five e2e tests against the compiled CLI.

---

## 4. The write-integrity detector was blind to the commonest fold

A `record_decision(decision, rationale)` call in this very session folded `rationale` into
`decision`. The token *was* found — but `resumesProse()` looked at what followed, saw several
hundred ordinary words (because the swallowed parameter was itself prose), and waved it through.
**Decision #48 is permanently corrupt as a result**, and decisions cannot be repaired.

The discriminator that survives is **adjacency**, not what follows: the decoder closes one
parameter and opens the next in a single format switch, so the tags are neighbours.

The suite's own kill-switch test rejected the first version of this rule. **The rule was narrowed
rather than the test loosened**, twice.

**MEASURED against all 452 rows of the live store: +9 flagged, 0 lost.** All nine genuine — in
every one the swallowed column is `NULL`. Zero false positives, so task #77's kill switch is
satisfied on evidence rather than argument.

Corrupt and unrepairable: decisions **#16 #17 #18 #19 #26 #27 #48**, conventions **#3 #4**.

---

## 5. Convention #7's ceiling is lower than its text implies

Observation #144. Four `record_decision` calls were refused, including one of ~330 characters
with `tags` first and `decision` last — exactly as the convention prescribes. A ~65-character
decision passed.

**Ordering alone is not protection at that length.** Keep Engram free text short; put long
rationale in code comments and commit messages, which are durable and reviewable anyway.
This file exists because of that.

---

## What the next agent should pick up

### First: task #107 is now decided-shaped, and it is the maintainer's call

**PROVEN 2026-08-12:** `git show main:src/installer/index.ts | grep -c "process.exitCode"`
returns **0**. Published v1.13.0 does **not** carry the `--check` crash fix.

Measured on the maintainer's own machine:

| | Global install (`v1.12.0`) | This branch |
|---|---|---|
| `engram --check` exit | **127**, libuv `UV_HANDLE_CLOSING` assertion | **0**, clean |
| Update offer | absent | present |
| Outdated installs found | — | **9 of 11** |

Nine installer commits sit unpublished on `v2-foundations`. `npm i -g engram-mcp-server@latest`
would fix none of them.

**The recommendation: cut Release B (1.14.0) from `v2-foundations`.** That is a publishing
decision and no agent should take it — the branch hook denies writing history on `main`, which
is the correct constraint. What an agent *may* do is prepare it.

### Second: the advisory clock

Task #98 expires **2026-09-16** and `scheduled_events` still holds **zero rows**, in a product
that ships `schedule_event` for exactly this.

### Third: the board is healthier than it reads, but verify every row

Task #99 was `critical`/`backlog` for work that shipped in `379a407`, *with* the binding test the
row demanded. A delegated triage read all 39 open HIGH rows in full and found **no other stale
close candidates** — but it did find #57 superseded by #74, and #46's remaining scope entirely
reassigned to #107.

**Always check `git log`/`git show` before sizing work from a row.**

---

<!-- SESSION_48_HANDOFF:COMPLETE -->
