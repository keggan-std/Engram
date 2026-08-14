# Session 49 — handoff

**Date:** 2026-08-12 · **Status:** complete, pushed, verified · **Branch:** `v2-foundations` @ `2141a3b`
**Agent:** `claude-opus-5-session-49` · **Predecessor:** [session 48](2026-08-12-session-48-handoff.md)

> **Rationale lives in the commit messages, not in Engram.** The upstream decoder bug
> (anthropics/claude-code#49747) refuses long free-text writes at this session's threshold —
> observation #144. Short records point here; the commits carry the reasoning.

---

## Verification — all green, all re-run at the end

| Gate | Result |
|---|---|
| `tsc -p tsconfig.json` | exit 0 |
| `tsc -p tsconfig.test.json` | exit 0 |
| `npm run build` | exit 0 |
| `npx vitest run` | **989 / 989** across 62 files |
| `npx knip` | exit 0 |
| `generate-state.mjs --check` | `docs/STATE.md is current.` |
| Working tree | clean, fully pushed |

Started at 948 tests / 60 files. Now 989 / 62.

---

## The board: 70 → 54 open

**Sixteen rows closed.** Ten of them were work that had already shipped and nobody had closed
the row — the failure mode this project documents. Every close cites `file:line` or a sha, and
the criticals were re-verified personally rather than accepted from a delegated report.

| Closed because already done | Closed because done this session |
|---|---|
| #7, #11, #46, #50, #51, #84, #89, #95, #96, #99, #100, #101 | #29, #31, #32, #33, #59, #64 |

Remaining: **54 open — 8 critical, 29 high, 15 medium, 2 low.**

---

## What was fixed

### Session 48 (see [its handoff](2026-08-12-session-48-handoff.md))
Two cold-start races, the Antigravity misdetection, `--check --update`, and a write-integrity
blind spot.

### Session 49

**#64 (CRITICAL) — freshness could be laundered.** `set_file_notes` re-stat'd the file on every
write while `upsert` preserves omitted fields, so a write supplying *one* field re-certified
fields it never read. AR-02 is CRITICAL and says to open the file only if the note is stale — so
the forged signal did not merely misinform, it **instructed the next agent not to look**.
`certifiesContent()` now refreshes only when nothing survives from an earlier write. The pinned
assertion flipped `high` → `stale` in the same commit, PROVEN load-bearing.

**#32 — export shipped 8 of 24 tables** and said "Memory exported". Sixteen missing, including
`observations` (146 rows), `handoffs`, `tool_call_log`. Now derived from `sqlite_master`.

**#33 — import's second half.** Three missing importers, one transaction, id remapping instead
of `INSERT OR IGNORE` on the source id, real row counts, shape validation.

**#31 — a database from the future** was opened and written to. Now refused.

**#29 — backup checked neither the checkpoint nor the copy.** A busy `wal_checkpoint` means the
WAL was not folded in, and `copyFileSync` never copies the `-wal` — so the "backup" silently
omitted recent commits. Now retried, verified, and deleted if verification fails.

---

## Three things the project's own machinery caught, not me

Worth recording because they are the argument for the machinery.

1. **The raw-SQL ratchet caught me twice.** #32's first attempt put a `sqlite_master` query in the
   dispatcher (22 → 23); #33's first attempt added four prepared statements (→ 25). Both were
   routed through `database.ts` / `repositories/` instead. `dispatcher-admin.ts` is now at **21**
   and the ceiling is lowered to match.
2. **The write-integrity kill-switch test rejected my first detector rule.** I narrowed the rule
   twice rather than loosen the test.
3. **I nearly created a credential leak.** `config` was not in the old 8-table export, so
   *completing* it is exactly what brings `http_token` into reach. Redacted, with a test that
   greps the raw file for the token.

**And one I got wrong myself:** my final clean-check used a byte `git diff` on `docs/STATE.md` and
reported drift. The project's actual gate (`--check`) deliberately normalises the volatile header
— it exits 0. The alarm was my method, not the file.

---

## What is left, and what is genuinely not an agent's call

### The release — the maintainer's decision, and it is now the gating one

Held deliberately until the table is clear, so 1.13.0's fate is not repeated. **PROVEN**:
`git show main:src/installer/index.ts | grep -c "process.exitCode"` returns **0** — published
1.13.0 does not carry the `--check` crash fix. On this machine the global 1.12.0 install exits
**127**, and `--check` reports **9 of 11** installs outdated.

### The clock keeps running regardless

**#98 expires 2026-09-16.** A scheduled event now exists for it. The master plan's own kill
switch says a hold that outlives the clock has become drift. If clearing the table runs past
mid-September, that is a decision to make on the merits, not by default.

### Next batch, in the order I would take it

| # | Why |
|---|---|
| **#58 / #12** | Same defect: 16 unscoped `getCurrentSessionId()` call sites. A test asserts the WRONG agent on purpose and must be edited in the fixing commit |
| **#61** | A crashed agent's claim is permanently unreclaimable; the sweep cannot fire |
| **#65, #67** | Small, mechanical FR-D3 fixes in two files |
| **#103** | A parameter the action ignores must be an error, not a wider result |
| **#75** | Capability surface renders no parameter descriptions — blind to the exact defect FR-D7 found |

`#57` is superseded in substance by `#74`; both are the STATE.md binding question, and `#57`'s own
text says not to improvise it.

---

<!-- SESSION_49_HANDOFF:COMPLETE -->
