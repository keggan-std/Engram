# FR-0c — Gating Measurements

**Date:** 2026-08-02 · **Engram task:** #14 · **Charter:** [`../00-CHARTER.md`](../00-CHARTER.md)

These are **gating**, not preliminary. Settled input 2 is *break only where evidence
demands*, so the action surface cannot be cut and the response envelope cannot be
reshaped unless something here shows a measured problem. **Evidence precedes permission.**

Raw data and the scripts that produced it are in this directory. Everything below is
reproducible: `node <script> "<repo-root>"`.

| # | Measurement | Status | Headline |
|---|---|---|---|
| 1 | Action distinctness | ✅ ran | Routing is **stable** (97.5%) but only **55% genuinely distinct** |
| 2 | Never-called actions | ❌ **impossible** | 72 of 75 actions have **no telemetry at all** |
| 3 | Session-start cost per tier | ✅ ran | Up to **66× the documented figure**; 88% of a response is overhead |
| 4 | `knip` dead code | ✅ ran | Exactly **15 dead files**, zero false positives |

---

## 1 — Action catalog distinctness

**Method.** 40 phrases ([`distinctness-phrases.json`](distinctness-phrases.json), committed
in `47ee561` *before* any routing ran), each routed by three raters working blind to one
another, using only the catalog descriptions an agent actually receives
([`action-catalog.json`](action-catalog.json)). Inter-rater disagreement is the collision
signal, rather than self-reported confidence, because confidence is not calibrated and
cannot be audited. No phrase contains an action name.

**Limitation, stated up front.** All three raters are the **same model** with the **same
prompt**. This measures *routing stability*, not inter-model agreement. High agreement here
does **not** prove the catalog is unambiguous to a different model. A cross-model rerun is
the obvious follow-up and is not yet done.

### Result

```
First-choice agreement
  unanimous ..................... 39/40   97.5%
  majority (2 of 3) .............  1/40    2.5%
  three-way split ...............  0/40    0.0%

Discrimination
  unanimous AND all "clear" ..... 22/40   55.0%   <- genuinely distinct
  unanimous BUT close/coinflip .. 17/40   42.5%   <- resolves the same way, but not distinct
  AMBIGUOUS (either signal) ..... 18/40   45.0%
```

**The two numbers tell different stories, and both are true.**

Routing is *consistent*: the same phrase produces the same action every time. Engram is not
randomly misrouting these phrasings. But **45% of phrases are ambiguous** — the model picks
the same action repeatedly while reporting it was a close call. That is a latent collision:
stable for *this* model and *this* phrasing, and not something to rely on.

### Where it concentrates

| Cluster | n | unanimous | low-confidence |
|---|---|---|---|
| **record-knowledge** | 12 | 11 | **7** |
| admin | 5 | 5 | 3 |
| retrieve | 6 | 6 | 2 |
| tasks | 5 | 5 | 2 |
| session | 4 | 4 | 2 |
| files | 4 | 4 | 1 |
| multi-agent | 4 | 4 | 1 |

The only outright disagreement in the whole set is also in that cluster:

> **#9** *"The team agreed all PRs need two approvals. Log it."*
> → `add_convention` | `record_decision` | `record_decision` — margins: coinflip, close, coinflip

### `dump` shadows everything

Broadest shadowers, by how many distinct intents named them as runner-up:

```
14x  dump              7x  record_decision     6x  create_task     6x  search
 7x  get_file_history  6x  stats               5x  add_convention  4x  record_observation
```

**`dump` is "almost right" for 14 different intents.** That is structural rather than
accidental: it is described as auto-classifying free text into memory categories, which
makes it by construction a superset of every recording action. An action that can absorb
any input competes with every action that should have handled it.

Strongest mutual collisions:

```
6x  record_observation -> create_task      5x  record_decision -> add_convention
5x  record_decision    -> dump             4x  add_convention  -> record_decision
5x  record_observation -> dump             3x  record_decision -> update_decision
```

`record_decision` / `record_observation` / `add_convention` / `dump` shadow each other in
every direction. v1.11's release notes state `record_observation` was added *because* agents
were misusing `record_decision` — a shadowing report written without the word, and the fix
was a fourth overlapping action.

### What this licenses, and what it does not

| | |
|---|---|
| **Licensed** | Acting on the record-knowledge cluster — exclusion clauses (*"not for X — use Y"*), and reconsidering whether four actions should be fewer. Evidence: 7/12 low-confidence, the only disagreement, and mutual shadowing in all directions |
| **Licensed** | Making `dump`'s scope explicit, or removing it. 14× shadowing is the single strongest signal here |
| **NOT licensed** | A wholesale cut of the 75-action surface. Most clusters route cleanly and stably. Charter kill switch 3 applies |
| **Not yet earned** | Any claim that the catalog *is* distinct. Same-model raters cannot establish that |

---

## 2 — Never-called actions: **cannot be measured**

**This measurement is impossible, and finding that out is worth more than the measurement.**

`logToolCall` is called from **exactly 5 sites, all in `src/tools/sessions.ts`**, producing
exactly 3 distinct `tool_name` values: `start_session`, `start_session_sub`, `end_session`.

```
grep -c logToolCall  src/tools/dispatcher-memory.ts   -> 0
                     src/tools/dispatcher-admin.ts    -> 0
                     src/tools/find.ts                -> 0
                     src/modes/universal.ts           -> 0
```

Live database: 24 rows, 3 distinct `tool_name` values, nothing else ever logged.
**72 of 75 actions have no telemetry whatsoever.**

### It falsifies a claim in our own design doc

[`trellis-engram-integration-analysis.md`](../../trellis-engram-integration-analysis.md) §6
states:

> *"Engram's `tool_call_log` table already records every invocation — it has the raw data for
> an `unused` metric and has never computed it. That is a report, not a feature."*

**False.** The data does not exist. This is exactly why the charter puts measurement before
the domain docs: reasoning would have carried the claim straight into the master plan.

### Two consequences

1. **The signal that would license deletion cannot be computed, retroactively or otherwise.**
   Instrumentation has to ship, then time has to pass. Until then the surface can only grow —
   the asymmetry Trellis names: *a loop that learns only from failure can only add.*
2. **`replay` is hollow.** `intelligence.ts:615` reconstructs a session timeline from
   `SELECT * FROM tool_call_log WHERE session_id = ?`, and its own description reads
   *"reconstructing what sub-agents did, and auditing multi-agent sessions."* Reconnecting it
   as the accountability design proposes would replay session start and session end and
   nothing else. **The feature is not merely disconnected — its data source is empty.**

Recorded as Engram observation #52.

---

## 3 — Session-start cost per verbosity tier

**Method.** [`measure-session-cost.mjs`](measure-session-cost.mjs) drives the compiled
`dist/` over real MCP stdio. Each configuration gets **its own server and its own fresh copy
of this repo's real database** — an empty DB would measure the floor, and a shared DB let
each measurement pollute `previous_session` for the next. Token figures estimate at ~4
chars/token; character counts are exact. Punctuation-dense JSON usually tokenises higher, so
these estimates understate if anything.

Compared against the figures the tool's own `.describe()` string promises the agent *at the
moment it picks the parameter*.

| config | claimed | first session | | repeat | |
|---|---|---|---|---|---|
| `nano` / full_context | ~10 | **2,021** | 202× | 712 | 71× |
| `nano` / quick_op | ~10 | 2,008 | 201× | 700 | 70× |
| `minimal` / full_context | ~730 | 5,586 | 7.7× | 1,994 | 2.7× |
| `summary` / full_context | ~730 | 5,976 | 8.2× | 2,233 | 3.1× |
| **`full` / full_context** | ~730 | **48,496** | **66×** | 41,235 | 56× |
| any / quick_op | ~200 | 3,952 | 19.8× | 700 | 3.5× |
| **`agent_role:"sub"`** | ~300–500 | **120** | **0.3×** | 120 | 0.3× |

**`full` verbosity costs ~48,500 tokens — roughly a quarter of a 200K context window, in one
call.** Against a documented ~730.

**`agent_role:"sub"` is the only claim that holds**, and it is 3× *cheaper* than advertised.
It is also the one path that omits both `agent_rules` and `tool_catalog` — which is the whole
explanation, and points directly at the fix for every other row.

### Where the tokens go

[`measure-response-composition.mjs`](measure-response-composition.mjs), `summary` /
`full_context`, first session:

| field | tokens | share |
|---|---|---|
| `tool_catalog` | 2,278 | **38.7%** |
| `update_available` | 1,304 | **22.2%** |
| `handoff_pending` | 723 | 12.3% |
| `previous_session` | 371 | 6.3% |
| `agent_rules` | 307 | 5.2% |
| `active_conventions` | 251 | 4.3% |
| `changes_since_last` | 157 | 2.7% |
| `open_tasks` | 148 | 2.5% |
| `active_decisions` | 136 | 2.3% |
| `pm_agent_rules` | 131 | 2.2% |

> **The memory Engram exists to deliver — conventions, changes, tasks, decisions — is
> 692 tokens, 11.8% of the response. The other 88% is overhead.**

Two specifics worth naming:

- **`update_available` is 22% of the response** because it embeds the *entire v1.12.0 release
  notes markdown*. An agent can do nothing with it. It is the single largest piece of pure
  waste, and it explains the whole first-session/repeat gap (~1,300 tokens).
- **`tool_catalog` at 38.7%** is delivered in full on first contact. `selectCatalogTier`
  already tracks per-agent delivery, so the mechanism to stop this exists and is not used for
  `agent_rules`.

---

## 4 — Dead code (`knip`)

[`knip.json`](../../../knip.json) scopes to `src/` and declares `src/scripts/install-hooks.ts`
as an entry point, since it is reached via `npm run install-hooks` rather than an import.

**Result: exactly 15 unused files — the 15 dead tool files, and nothing else.** Zero false
positives. Zero-config runs also flagged `packages/engram-dashboard` and both thin clients,
which are separate build entry points; that drowns the signal.

Also surfaced, and worth carrying into the domain reviews:

- **`errorWithData` is an unused export** — the JSON error shape exists and nothing uses it,
  while `error()` returns plain text. Directly relevant to observation #49.
- **The entire typed error hierarchy is unused** — `EngramError`, `NotFoundError`,
  `SafetyCheckError`, `NoActiveSessionError`. Confirms the constitution's "dead in practice".
- **`writeJson`** (the non-atomic config writer) is an unused export.
- 23 unused exports and 28 unused exported types total.

This config is CI-ready as-is.

---

## Reproduce

```bash
node docs/foundations/measurements/measure-session-cost.mjs        "$PWD" --json .../session-cost.json
node docs/foundations/measurements/measure-response-composition.mjs "$PWD" summary full_context
node docs/foundations/measurements/analyse-distinctness.mjs         --json .../distinctness-result.json
npx -y knip@5 --no-progress
```

---

<!-- FR_0C_MEASUREMENTS:COMPLETE -->
