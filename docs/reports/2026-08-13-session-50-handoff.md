# Session 50 — handoff

**Date:** 2026-08-13 · **Status:** complete, committed, all gates green · **Branch:** `v2-foundations` @ `a355c1d`
**Agent:** `claude-opus-5-session-50` · **Predecessor:** [session 49](2026-08-12-session-49-handoff.md)

> **Not pushed.** Every commit below is local. `git push` fires the release tripwire and is a human
> decision — see [The release](#the-release--your-decision-and-it-is-now-unblocked).

---

## Verification — every gate, re-run at the end

| Gate | Result |
|---|---|
| `tsc -p tsconfig.json` | exit 0 |
| `tsc -p tsconfig.test.json` | exit 0 |
| `npm run build` | exit 0 |
| `npx vitest run` | **1021 / 1021** across 65 files |
| `npx knip` | exit 0 |
| `surface:check` | exit 0 |
| `http-surface:check` | exit 0 |
| `state:check` | `docs/STATE.md is current.` |
| Working tree | clean |

Started at 1004 / 63. Now 1021 / 65.

---

## The batch handoff #23 named, in the order it named it

**All of it. #58/#12, #61, #65, #67, #103, #75 — plus #68**, which was not on the list and turned out
to be the same defect family as #103.

| # | What was actually wrong |
|---|---|
| **#58 / #12** | `getCurrentSessionId()` bare at 16 sites is *"the newest open session belonging to anyone"*. A parent session always predates the sub-agents it spawns, so `ORDER BY id DESC` handed every write to a live child. The lead lost **100% of the time** — deterministic, not a race |
| **#61** | The stale-claim sweep required `status='working'`, a value **nothing in the product ever wrote**. `claim_task` only SELECTed from `agents` and a SELECT creates no row; `agent_sync` defaults to `'idle'`. Dead by default, in two independent ways |
| **#65** | `FileNotesRepo.upsert` used `?? null` for four fields and `\|\| null` for four others. With `COALESCE`, `""` **cleared** one group and was **ignored** by the other. `purpose` and `notes` — exactly what an agent corrects after finding a note wrong — were the uncorrectable ones |
| **#67** | `getByFile` used `LIKE '%path%'`: `_` is a wildcard and it was a substring match, so `src/a.ts` matched `src/a.ts.bak`. And `snapshot_cache.ttl_minutes` was written on every upsert and never read — entries were immortal |
| **#103** | **Six** parameters advertised and read by nothing, not the two the row named |
| **#68** | Session start at `verbosity:"full"` cost **59,721 tokens against a documented ~730** |
| **#75** | The capability-surface gate was blind to the exact defect FR-D7 found |

### The one that generalises

**#58's fix was not a better query — it was noticing that identity already existed.** An MCP server is
spawned **per client**, so the process handling agent A's `record_decision` is the one that handled
A's `session start`, and a *different process* from B's. The session a process opened is a fact about
the caller, not a guess about the store. Three rungs of a resolution ladder already existed in
`sessions.ts` and `engram_memory` could reach none of them, because callers do not repeat their
identity on every write — and nothing ever asked them to.

`src/tools/session-identity.ts` now owns that ladder with the process rung at 3 and store-wide
newest-open demoted to 4, where it reports that it guessed.

---

## What the numbers moved to

All measured on this repo's real store or by the committed harness, not estimated.

| | Before | After |
|---|---|---|
| `engram_session(start, verbosity:"full")` | 59,721 tokens | **9,521** first / **7,027** repeat |
| `get_tasks({compact:true, limit:60})` | 126,254 chars | **45,628** chars |
| `install --check` on published 1.13.0 | crashes, **exit 127** | exit **0** |

`project_snapshot` was 153,194 of 246,118 characters, because it embeds `fileNotes.getAll()` — every
note in full — **and** duplicated `recent_decisions` and `active_conventions`, which the same
response already returned as top-level siblings. Shipped twice, in one object, to be read once.

---

## Your reported CLI issues — where each one actually stood

**Five of the six were already fixed on this branch and unreleased.** That is the finding, not a
deflection: it is [task #107](#the-release--your-decision-and-it-is-now-unblocked) — shipping that
did not reach installed machines — in its most concrete form.

| Symptom | Status |
|---|---|
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` | **Already fixed here.** `process.exit()` after a `fetch()` trips it on Windows. Root-caused to nodejs/node[#58091](https://github.com/nodejs/node/issues/58091) / [#64322](https://github.com/nodejs/node/issues/64322) — undici keeps the connection alive after the body resolves. VERIFIED against upstream: stalled in review since Jan 2025, so there is no Node version to wait for. Local build exits 0; published exits 127 |
| No way to proceed to install | **Already fixed here** — but only in a TTY. Published 1.13.0 has no prompt at all |
| No way to select which to update | **Fixed this session.** `select()` could only ask "which ONE" of ten rows. New `multiselect()` — space toggles, `a` toggles all, and it scrolls, since the list length is "however many installs this machine has" |
| `Run: npx -y engram-mcp-server install` | **Already fixed here** — `main:src/installer/index.ts:449`, absent from this branch. Also fixed the `--help` usage line, which omitted `@latest`: [README.md:263-264](../../README.md#L263-L264) documents that trap and the help text taught the opposite |
| "installed" with no version | **Fixed this session.** It printed `v?` — honest, and unreadable. Now `unversioned (pre-1.9)`, which says what the state *means* |
| Can't see other IDEs / details / local vs global | **Fixed this session** — see below |

### The real defect behind the last two

**Two discovery engines.** `discovery.ts` returns *every* install with scope, path, version and mode,
and `--check` used it. `resolveIdeInstallStatus` returns **one first-match status per IDE**, and the
interactive installer used that. On your machine — four Android Studio channels — that is not a
summary, it is a coin toss: three real installs went unmentioned and the one named was whichever path
was reached first.

The interactive path now reads `discovery.ts`. Added: a **details view** listing every instance with
scope, mode, config path, project root and the database it will open; and `abbreviatePath()`, which
collapses `$HOME` to `~` and elides the **middle, never the tail** — your four channels differ only in
their second-to-last segment, so a tail-truncating shortener would render them identical, which is
worse than printing nothing.

Also: `--check` printed four *identical* `--ide androidstudio` commands. It now prints one, and lists
the four paths it covers.

---

## Three things the project's own machinery caught, again

Worth recording because it is the argument for the machinery, and because two of them caught **me**.

1. **The raw-SQL ratchet caught me twice.** #61's sweep and #103's `tool_call_log` query both went
   into the dispatcher first. Both moved to the repository layer instead of the ceiling moving.
   `dispatcher-memory.ts` is now at **66**, lowered from 69 in the same commit.
2. **My own new gate caught my own new parser.** `schema-consumption.test.ts` reported
   `change_type`, `diff_summary` and `impact_scope` as inert. They are fields of the `changes`
   **array item**, which an indentation-based scan cannot tell from a top-level key. A false positive
   there sends the next person to fix a schema that is correct. The parser is now brace-depth aware
   and both the false-positive case and a deliberately-broken-parser case have their own tests.
3. **My first ceilings could not discriminate.** `session-start-cost.test.ts` shipped with up to
   **52% headroom** on round numbers — a ceiling that cannot fail is the inert-surface defect this
   repo keeps finding, reproduced inside its own new gate. Now ~15% over measured.

**And one I got wrong myself:** I widened `AgentsRepo.releaseStale()` to every non-stale agent, which
broke an existing test that was *right*. Claim recovery had already moved to `reclaimStaleClaims()`,
so widening the bookkeeping method bought nothing and changed what `idle` means. Reverted.

---

## What is left, and what is genuinely not an agent's call

### The release — your decision, and it is now unblocked

**The table is clear in the sense the hold was waiting for.** 48 open tasks, none of them in the
named batch. Seven commits, 136 ahead of `main`.

**PROVEN, re-run this session:** `git show main:src/installer/index.ts | grep -c "process.exitCode"`
returns **0**. Published 1.13.0 still does not carry the `--check` crash fix, and `--check` on this
machine reports **10 of 12** installs outdated.

Nothing here pushes, publishes or merges. Those are yours.

### The clock

**#98 expires 2026-09-16** — 34 days. The master plan's kill switch says a hold that outlives the
clock has become drift. This batch removes the argument for holding further, so the decision is now
about *when to publish*, not *whether the work is ready*.

### Next batch, in the order I would take it

| # | Why |
|---|---|
| **#38 / #40** | The last two criticals. #40 is blocked on #38; #38 is the provenance columns, and #58's fix is its prerequisite, now landed |
| **#69** | Its own text says start at **step 2, a measurement**, not an edit. Do not skip to deleting AR-01 |
| **#71** | The 79-parameter flat schema. **Gated by DEFERRED-CHANGES D14** — designed and tested, but must not merge until `packages/*` has a surface gate |
| **#112, #113** | Opened by me this session, so the remaining scope of #103 and #75 is recorded rather than implied by a closed row |

`#57` remains superseded in substance by `#74`.

---

<!-- SESSION_50_HANDOFF:COMPLETE -->
