# Project State Tracking — Why Things Get Dropped, and What Actually Catches It

**Date:** 2026-08-02 · **Author:** Opus 5 (with three delegated Sonnet research/analysis agents)
**Question:** Engram's own history shows features and plans being silently dropped with nobody noticing. There is no single source of truth where work signs in and signs off. How do we fix that without making Engram heavy?

**Related:** [`ENGRAM_CONSTITUTION.md`](ENGRAM_CONSTITUTION.md) · [`engram-deep-audit-2026-08-02.md`](engram-deep-audit-2026-08-02.md) · [`agent-accountability-design.md`](agent-accountability-design.md) · [`trellis-engram-integration-analysis.md`](trellis-engram-integration-analysis.md)

---

## 1. Verdict

**Your diagnosis is right. Your proposed cure is the one thing the evidence says will fail.**

You proposed a ledger where work signs in and off at each level. But **Engram already had one, and it became the disinformation source** — `docs/cross-instance-sharing-bugs.md` asserted "Status: not yet fixed" for eight versions after the fix shipped. And in your own skills, `ghostwriter/references/versions.md` asserts bug B7 was fixed by adding a prism chain to `deviations.md`; the file has no such section. It was never written.

So we have both failure directions, from two independent codebases:

> **A hand-maintained register lies in both directions — it claims work that never happened, and denies work that did. Neither error is visible from inside the register.**

The fix is not a better register. It is **reconciliation**: every tracked claim needs a cheap mechanical check against reality. Where a claim cannot be checked, don't track it.

---

## 2. The precise diagnosis

I checked Engram's schema for the links that would make drop-detection possible:

```
tasks.milestone_id  : NO   <-- milestone -> task link MISSING
changes.task_id     : NO   <-- task -> change link MISSING
decisions.task_id   : NO
tasks.decision_id   : NO
```

**Every table links to `session_id` and nothing else.**

So Engram has **horizontal memory** (what happened, when, by whom) and **no vertical traceability** (what serves what). You can ask *"what happened in session 5."* You cannot ask the three questions that actually catch a drop:

1. *What did we promise in milestone X, and did it ship?*
2. *Which changes implemented task #7?*
3. *Is decision D3 still reflected in the code?*

**Intent and outcome are stored in the same database and are not connected to each other.** That is why a feature can vanish with nobody noticing — nothing links the promise to the delivery, so nothing can report the gap.

Worth noting: `decisions` **already has** `supersedes` / `superseded_by` / `depends_on`. The decision level got vertical linkage; it was simply never extended to milestone → task → change.

**This is the same shape as every other finding in this audit cycle:** the mechanism was designed, partially built, and left disconnected.

---

## 3. What the evidence says survives

The research question was: which project-tracking mechanisms actually stay alive, and which rot? The answer is unusually clean.

| Mechanism | Survives? | Why |
|---|---|---|
| **Rust RFCs** | ✅ | Status lives in an **auto-created tracking issue** with labels, triaged every release — *not* in the proposal doc |
| **Kubernetes KEPs** | ✅ | A **dedicated subteam** verifies status each release cycle |
| **CI-enforced flag expiry** | ✅ | 30/7/0-day alerts; **deploy blocked** if a deprecated flag is still referenced |
| **api-extractor `.api.md`** | ✅ | Generated golden file; **PR review required** whenever it diffs |
| **Keep a Changelog** | ✅ | No tooling, no schema — updated as a side effect of a release that was happening anyway |
| **ADRs** | ❌ | *"Nobody superseded the ADR. It just sits there, looking authoritative, contradicting the codebase silently"* — one cited incident cost an engineer three days |
| **Traceability matrices** | ❌ | Shelfware outside FDA / ISO 26262 / DO-178C, where an external auditor forces them |
| **Capability manifests** | ❌ | Evidence is vendor marketing only |

> ### The survival criterion
> **The source of truth must be coupled to something that breaks a build or blocks a merge when it is stale.**
> Never ship a register whose accuracy depends on someone remembering. Either couple it to CI, or generate it from code.

Everything below follows from that one rule.

---

## 4. Which detector catches which failure

I classified all ten silent-drop incidents from the audit against the tooling that would actually have caught each. This corrects an overclaim I made earlier — **knip does not catch most of them.**

| # | Incident | Detector |
|---|---|---|
| 1 | `lock_file`/`unlock_file` gone; README:727 still advertises | **Capability surface** / doc-anchor drift |
| 2 | Config whitelist dropped in the v1.6 consolidation | **Mutation testing** (deletion mutant survives) |
| 3 | Seven `z.enum`s + every numeric bound dropped | **Capability surface** + mutation testing |
| 4 | `replay` implemented then disconnected | **knip** ✅ *proven* |
| 5 | `parent_session_id` created, never wired | Orphaned-column detection |
| 6 | `import` narrowed 6 tables → 1, dry-run still reports 4 | **Contract/golden test** |
| 7 | Bug doc stale by 8 versions | Status-doc reconciliation |
| 8–9 | v1.11 release notes publish a schema that doesn't match | Doc-vs-code drift |
| 10 | 15 dead tool files, 4,057 lines | **knip** ✅ *proven* |

**Not one of these required a human to remember anything.** Every one is mechanically detectable.

### The single highest-value item

**One mechanism covers six of the ten: a generated capability surface.**

A build script emits `docs/CAPABILITY-SURFACE.md` from the dispatchers' Zod schemas — every action, every param, its type, its enum values, its `min`/`max`. Commit it. **CI fails if regenerating produces a diff that isn't in the commit.**

Then every removed action, every dropped enum, every loosened bound, and every narrowed contract becomes **a red line in code review**.

It satisfies the survival criterion completely: it is *generated* (cannot rot), *coupled to the PR* (blocks merge), and cheap. It would have caught incidents 1, 2, 3, 6 — and made 4 and 10 visible.

**And it is not an Engram feature. It is a build script.** That matters for your weight constraint.

### Verified, not assumed

I ran `npx -y knip` on this repo with zero configuration. It found **all 15 dead tool files** in one pass, plus `scripts/fix-mcp-config.js`, six unused exports in `constants.ts`, and the undeclared `reg`/`ioreg` binaries `utils.ts` shells out to.

One honest caveat: with no config it *also* flagged all of `packages/engram-dashboard/src/**` and both thin clients, because those are separate build entry points. It needs a small `knip.json` before it's CI-ready, or the signal drowns.

---

## 5. The design — four tiers, ordered by value ÷ weight

### Tier 0 — Not Engram at all *(highest value, zero Engram weight)*

| # | Item | Catches | Effort |
|---|---|---|---|
| 0.1 | **Generated capability surface** + CI diff gate | 6 of 10 | S |
| 0.2 | **knip** + a `knip.json` declaring entry points | 2 of 10, proven | S |
| 0.3 | **Mutation testing** (Stryker) on `src/tools/` + `src/repositories/` only | Dropped validation | M |
| 0.4 | **Keep a Changelog's `Removed` section**, used honestly | Intentional removals | Free |

Item 0.4 deserves a sentence: had `lock_file`'s removal been one line under **Removed**, incident #1 never happens. The cheapest mechanism in this entire document is a section heading that already exists in a convention the project already nominally follows.

### Tier 1 — Vertical linkage in Engram *(3 nullable columns)*

```
tasks.milestone_id   INTEGER   -- what goal does this serve?
changes.task_id      INTEGER   -- what work did this deliver?
decisions.task_id    INTEGER   -- what work did this decide?
```

Nullable, so nothing breaks and nothing is mandatory. This does not *enforce* anything — it makes the question **askable**. Without it, Tier 2 cannot exist.

### Tier 2 — One reconcile action *(zero new tables)*

`engram_admin(action:"reconcile")` — a deterministic pass that compares declared state to actual state and reports the delta. **Its output is a diff, not a status.**

| Check | Detects | Mostly built? |
|---|---|---|
| Milestone/task with no linked changes | **Promised, never delivered** | needs Tier 1 |
| Change with no linked task | Built, unplanned (scope creep) | needs Tier 1 |
| Task `done` with zero linked changes | **Signed off without evidence** | needs Tier 1 |
| File notes whose `content_hash` moved | Stale knowledge | ✅ exists |
| Decision superseded, dependents not updated | Broken decision chain | ✅ `getDependents` exists |
| Sessions never closed / orphaned task claims | Dropped work | ✅ per accountability design |
| `decisions.affected_files` pointing at deleted files | Orphaned intent | trivial |

Note how much is already there. As with `parent_session_id` and `replay`, **the parts exist and are not wired together.**

### Tier 3 — Two conventions worth stealing from your own skills

**3.1 The sentinel, from `write-manifest.md`.** Its lifecycle is `Declared → Writing → §Complete → ✓ Verified`, with `Incomplete` detected by a **missing sentinel on resume**. The design insight is that *the sentinel lives in the artifact, not the ledger* — so the ledger **claims** and the artifact **proves**. That is the reconciliation principle in miniature, and you had already invented it.

**3.2 The semantic hash, from `carto-src`.** It hashes a *stable projection* — `sha256(zone-names|symbol-names)` — rather than raw content, so cosmetic edits don't trigger false staleness. Engram's `file_notes.content_hash` hashes raw content and is therefore noisy. A one-line change with a real signal-to-noise payoff.

Also worth taking: **`carto-src`'s `.carto/index.md`** — a single-glance inventory (`file · status · last-verified · hash`) is exactly the "where do I see everything at once" view you're missing, and it's a *view*, not a new store.

---

## 6. What I would not build

| Idea | Why not |
|---|---|
| A hand-maintained ledger / register | §1. It lies in both directions and manufactures false authority. Strongest counter-evidence found: *"a register you built carefully and then froze isn't neutral — it's worse than nothing, because it looks authoritative."* |
| A traceability matrix | Shelfware everywhere an auditor isn't forcing it |
| ADR status tracking as the source of truth | Rots. Rust's model works because status lives in a *tracker*, not the doc |
| Mandatory sign-off gates on every level | Agents ignore explicit instructions **67%** of the time (arXiv 2604.09409). A gate nobody passes through is theatre |
| New Engram tables for project state | `milestones`/`tasks`/`changes`/`decisions` already are that. They just aren't linked |
| Porting Prism's zone/frontmatter machinery | It solves a *rendering* problem — one file, two audiences. Engram has no rendering surface. ~60% of that skill's volume doesn't transfer |
| Anything from `tracer` | It persists nothing. Also its name collides with `codebase-memory`'s `trace_path`/`ingest_traces`, which is a live wrong-tool-selection risk |

---

## 7. Weight budget and kill switches

| Dimension | Cost |
|---|---|
| New Engram tables | **0** |
| New Engram actions | **1** (`reconcile`) |
| Migration | 1, three nullable columns |
| Tokens added to any existing response | **0** — `reconcile` is called on demand |
| Work outside Engram | 1 build script + 1 `knip.json` + 1 CI step |

**Kill switches — write these down first:**
1. If `reconcile` output is not acted on for two consecutive releases, delete it. An unread report is the same failure as an unmaintained register.
2. If the capability-surface diff gate is bypassed more than twice, it is wrong — fix the generator, don't relax the gate.
3. If the three FK columns are still >90% NULL after a release cycle, the linkage isn't being used; drop it rather than nagging for it.

---

## 8. Sequence

| Phase | Work | Why here |
|---|---|---|
| **0** | Audit P0s (tasks #2–#5), especially session identity | Two subagents clobbered each other's sessions **during this very research task** — see §9. Nothing built on that foundation is trustworthy |
| **1** | Capability surface generator + CI diff gate | Highest value, zero Engram weight, catches 6 of 10 |
| **2** | `knip.json` + knip in CI | Proven; 30 minutes |
| **3** | Three nullable FK columns | Makes the question askable |
| **4** | `engram_admin(reconcile)` | Wires together checks that mostly exist |
| **5** | Semantic hash; `Removed` changelog discipline | Cheap refinements |
| **6** | Mutation testing on `tools/` + `repositories/` | Highest effort; do last, scoped narrowly |

Phases 1–2 are days, need no schema change, and address the majority of the failure class.

---

## 9. A note on evidence quality

Three things in this document were observed rather than argued:

1. **knip's result** — run, output quoted.
2. **The schema linkage gap** — queried directly against the live database.
3. **Finding N3, reproduced twice, unprompted, by real concurrent subagents.** While three Sonnet agents worked in parallel on *this* research, the prism agent reported *"Session started as #10, but `engram_session end` returned `session_id: 12`"*, and the skills agent found its session #11 had been auto-closed by session #12 with `"(auto-closed: new session started)"`. Neither was trying to trigger the bug.

That third one is the most important sentence in this document. **The moment Engram was used the way it is marketed — an orchestrator delegating to parallel sub-agents — its own bookkeeping corrupted, twice, inside twenty minutes.** It also means any per-session statistic gathered during that window is unreliable, including the agents' own reported observation counts.

Use it as the regression test: three concurrent agents, each `start` + `end`, assert each session's summary belongs to the agent that wrote it.

---

## 10. The honest framing

You said the goal has expanded from persistent memory into project management, and worried that's scope creep.

I'd argue it hasn't expanded at all. **Remembering a decision, but not knowing it was silently reversed, is not memory — it is a confident wrong answer.** `docs/cross-instance-sharing-bugs.md` remembered perfectly. It was wrong for eight versions, and any agent that trusted it would have wasted a session.

Vertical traceability isn't a second product bolted onto a memory tool. It is the part of memory that makes the rest trustworthy. The reason it looks like scope creep is that Engram shipped the storage half first.

And the strongest argument for building it is that **Engram's own development history is the case study.** A memory tool that forgot ten of its own features is either the most embarrassing thing in this audit or the most compelling product requirement in it. It's the same fact either way.

---

<!-- PROJECT_STATE_TRACKING_DESIGN:COMPLETE -->
