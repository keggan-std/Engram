# Foundations Review — Charter

**Date:** 2026-08-02 · **Status:** Active · **Engram decision:** #18
**Produces:** `docs/ENGRAM-MASTER-PLAN.md` (Engram task #11)
**Prerequisites:** [`ENGRAM_CONSTITUTION.md`](../ENGRAM_CONSTITUTION.md) · [`engram-deep-audit-2026-08-02.md`](../engram-deep-audit-2026-08-02.md) · the three design docs · [`orchestration-guide.md`](../orchestration-guide.md)

> **This document does not carry status.** Progress lives in the Engram task board.
> A charter that also tracks state is the artifact §2 exists to prevent.

---

## 1. What this is

Not a refactor. Not an audit. Four established practices stacked, and naming them
keeps us from reinventing their known failure modes:

| Practice | Answers | Domain docs |
|---|---|---|
| **Production Readiness Review** | Does this deserve to run on someone's machine? | 1, 5, 6 |
| **Threat model** | What can an adversary do, and what do we refuse to promise? | 2, 4 |
| **Architecture Decision Records** | Why this and not the alternative — recorded so it survives | all |
| **Technical strategy** | What Engram is for, what stays, what is cut | the master plan |

The master plan is only the fourth. The first three are its **inputs**. Writing the
strategy first would be guessing.

**Framing question for the whole exercise:**

> Engram's failure mode is not a crash. It is a **confident wrong answer that
> survives**. Every domain is reviewed against that.

---

## 2. Why not one large document

The project's own research settled this. [`project-state-tracking-design.md`](../project-state-tracking-design.md) §3
surveyed what survives and what rots: Rust RFCs survive (status lives in a *tracker*),
CI-enforced flag expiry survives (it *blocks a merge*), generated API surfaces survive.
ADRs rot. Traceability matrices are shelfware. Capability manifests are vendor marketing.

> **The survival criterion.** The source of truth must be coupled to something that
> breaks a build or blocks a merge when it is stale.

A single authoritative mega-document is precisely the artifact that criterion rejects.
It would become [`archive/cross-instance-sharing-bugs.md`](../archive/README.md) at
scale — finding F5, but larger and more trusted. So:

- **§7's binding section is mandatory.** No domain doc ships without naming a mechanism
  that fails when its claims drift.
- **Status lives in the Engram task board**, never in these files.
- **The master plan stays thin** — index, direction, cut list, sequencing.

---

## 3. Settled inputs

Decided by the maintainer, 2026-08-02. These are premises, not open questions.

| # | Input | Decision | What it forces |
|---|---|---|---|
| 1 | **Audience** | Public product, wide adoption | Threat model assumes hostile repos and hostile PRs. A shipped vulnerability is a user-facing incident, not internal cleanup. Docs, migration paths and advisories are load-bearing |
| 2 | **Breaking changes** | Only where evidence demands | Every break needs a measured problem or a security finding behind it |
| 3 | **Sequencing** | Charter + gating measurements first | No domain doc written against opinion where a number is obtainable |
| 4 | **Delegation** | Aggressive for breadth | Sub-agents inventory and check; the lead reasons and decides |

**The interaction between 1 and 2 is the sharpest constraint in this document.**
Because breaks require evidence, the Phase 0 measurements are not preliminary —
they are **gating**. The action surface cannot be cut unless the distinctness test
proves collisions. The response envelope cannot be reshaped unless a measured problem
exists.

> **Evidence precedes permission.**

---

## 4. The unit of work is the claim

"Review everything" has no stopping rule. This does:

> **Every claim Engram makes — explicit or implied — is stated, graded, reasoned
> against rejected alternatives, and bound to a mechanism that keeps it true.**

Claims are finite, so the work terminates. Three consequences worth stating:

1. **It is already the method that works here.** *"The only outbound network call is
   the npm update check"* was a claim; checking it found an undisclosed GitHub fetch
   and, downstream, audit N1.
2. **Implied claims count, and are where the lies live.** Nobody wrote *"your memory
   survives an upgrade"* — but it is the product's whole premise, and it is the one
   path with no test coverage.
3. **"What is left / introduced / changed" becomes a query over claims**, not a
   register someone maintains. That is the difference between this and the ledger
   [`project-state-tracking-design.md`](../project-state-tracking-design.md) §1 rejects.

---

## 5. Evidence grading

Unchanged from the audit, because mixing these silently is how an audit becomes folklore.

| Grade | Meaning |
|---|---|
| **PROVEN** | An executable check was run; its output is quoted in the doc |
| **VERIFIED** | Read in source by the lead personally, with `file:symbol` cited |
| **REPORTED** | A sub-agent said so. A lead, not a fact |

Rules, learned the hard way in this session:

- **Anything CRITICAL needs an executable check.** Not an argument.
- **Never promote REPORTED to fact silently.**
- **Circumstantial evidence is not VERIFIED.** A finding in the P0 session was graded
  as verified on one suggestive observation, propagated into a commit message, a report
  and an Engram observation, and was wrong. See
  [`reports/2026-08-02-p0-remediation.md`](../reports/2026-08-02-p0-remediation.md) §5.1.
  **If the only evidence is "this is consistent with X", the grade is REPORTED.**

---

## 6. The ten domains

Partitioned so they do not overlap. Where two touch, the boundary is named.

| # | Domain | Covers | Boundary |
|---|---|---|---|
| **1** | **Durability & Recovery** | Migrations, backup/restore, corruption recovery, crash safety, WAL, transaction boundaries, export/import fidelity | *Owns* "the data survives". Storage shape → 3 |
| **2** | **Trust & Safety** | Threat model, provenance, injection surfaces, secrets, encryption at rest and in transit, what is protected and what we refuse to promise | *Owns* the adversary. Concurrent-agent trust → 4 |
| **3** | **Storage & Retrieval** | Schema shape and why, FTS5, query paths, retrieval quality, growth and compaction, what is stored where | *Owns* "can we get it back, and is it the right thing" |
| **4** | **Concurrency & Multi-Agent** | Sessions, claims, locks, handoffs, conflict handling, cross-instance, whether agents can see what others are doing | *Owns* "two agents at once". Single-agent durability → 1 |
| **5** | **Distribution & Lifecycle** | Build, publish, versioning, install across 14 IDEs, what lands on disk and why, upgrade, uninstall, rollback | *Owns* everything between a commit and a user's machine |
| **6** | **Failure & Observability** | Error taxonomy, response envelope, degradation, logging, diagnosis, what happens when anything goes off-expected | *Owns* "it went wrong — now what" |
| **7** | **Agent Ergonomics** | The 75-action surface, selection accuracy, token cost per tier, agent rules, catalog tiering. Help or burden | *Owns* the agent's experience. **Gated on Phase 0 numbers** |
| **8** | **Codebase & Maintainability** | Layering, dispatcher size, dead code, conventions, human maintainability, what belongs in this repo at all | *Owns* "can a person still work on this" |
| **9** | **Process & Traceability** | How decisions and changes get recorded and kept true. Capability surface, reconcile, changelog discipline, vertical linkage | *Owns* the anti-drift machinery — including §7's bindings |
| **10** | **Public Surface** | README, SECURITY.md, licence, contribution, issue/advisory process, what is public and what is not | *Owns* what a stranger sees |

**Risk order for Phase 1:** 1 → 2 → 5 → 6 → 4 → 3 → 7 → 9 → 8 → 10.
Durability first because it is the promise whose breach is unrecoverable.

---

## 7. The domain document template

**Normative.** Every domain doc has exactly these six sections, in this order.
`docs/foundations/NN-<domain>.md`.

### 1 — Claims
What Engram promises here. Explicit claims (README, SECURITY.md, tool descriptions,
release notes) **and implied ones** users reasonably infer. Each gets an ID: `D1-C3`.

### 2 — Reality
What is actually true, per claim, with a grade from §5. A claim that is false is a
finding and goes to Engram immediately, not just into the prose.

### 3 — Failure modes
What goes wrong — **adversarial and accidental**. For each: trigger, blast radius,
whether it is silent, and whether the user can recover. Silence is scored explicitly:
a loud failure is cheaper than a quiet one.

### 4 — Target and rejected alternatives
What should be true, and **why this and not the alternatives.** At least one
seriously-considered rejected option per target, with the reason it lost.
**This section is the point of the exercise.** A target with no rejected alternative
has not been reasoned about — it has been asserted.

### 5 — Binding
The concrete mechanism that fails when this drifts: a named test path, a CI job, a
generated artifact, a schema constraint. **"Be careful" is not a binding.**
A domain doc with no binding is not done.

### 6 — Kill switch
What would make us reverse this, written *before* attachment forms. Trellis §17.

---

## 8. Definition of done, per domain

Checkable, so "is this finished?" is not a matter of taste.

- [ ] Every claim in §1 carries a grade in §2
- [ ] Every target in §4 names at least one rejected alternative **and why it lost**
- [ ] §5 names a mechanism that can fail, not an intention
- [ ] Anything graded CRITICAL has an executable check, output quoted
- [ ] Every new finding is in **Engram** — task or observation — not only in prose
- [ ] Anything deferred is in [`DEFERRED-CHANGES.md`](../DEFERRED-CHANGES.md) with a trigger
- [ ] Cross-domain items are handed to the owning domain, not solved twice

---

## 9. Delegation protocol

Per [`orchestration-guide.md`](../orchestration-guide.md), with two additions this
project has now paid for.

**Delegate:** claim inventory (grep README/SECURITY/tool descriptions for promises),
call-site enumeration, checking a stated claim against source, test-coverage mapping,
external research with citations.

**Never delegate:** §4 in any domain. Target state and rejected alternatives are the
deliverable, and a sub-agent cannot know what we decided last week.

**Two additions:**

1. **Cap the report; prefer pointers.** *"Write N entries into Engram / this file and
   return a 20-line summary."* Reports were the single largest context cost in the last
   audit.
2. **Every sub-agent passes `agent_name` and its own `session_id`.** Sessions no longer
   clobber, but attribution under concurrency is only narrowed, not closed — see
   [D5](../DEFERRED-CHANGES.md). Parallel agents must not share an identity.

---

## 10. The baseline experiment

This review is itself long, multi-agent and document-heavy — the closest thing to a
real workload Engram has ever been measured on. That makes it the baseline arm the
project has never had.

**It only counts if we say in advance what would falsify it.** Deciding afterwards
whether Engram "felt useful" is selection bias, which
[`trellis-engram-integration-analysis.md`](../trellis-engram-integration-analysis.md) §3
covers at length. So the criteria below are fixed now, before the first domain doc.

### 10.1 What is being tested

**Not "is Engram good".** That is unfalsifiable. The claim under test is narrow:

> **Recalled memory changes what the agent does, in a direction that helps.**

Everything Engram does divides into *write* (storing) and *recall* (surfacing). Only
recall is measured here — a write nobody ever reads has already failed, and will show up
as recall that never happens.

| In the experiment | Assumed, not measured |
|---|---|
| Session-start auto-loaded context: `previous_session`, decisions, conventions, tasks, `changes_since_last` | The storage layer itself |
| `get_file_notes` | The task board (human-facing) |
| On-demand `search` / `get_decisions` / `get_observations` | The capability surface (a build script) |
| Handoffs between sessions | Telemetry (measures, isn't measured) |

### 10.2 The unit is the recall event, not the session

A **recall event** is one moment where Engram returned stored memory into an agent's
context. A domain doc might involve twenty. Sessions are too coarse — a session where
one recall was decisive and nineteen were noise is not "a success".

**Sample:** every recall event feeding a domain doc, ten docs. Expected n ≈ 50–150.

### 10.3 Instrument 1 — shadow judgment *(primary)*

After each domain doc completes, a **fresh-context judge, blind to whether the recall was
used**, sees the task, the outcome, and one recalled item, and answers one question:

> *Could this outcome have been reached without this specific recall — from the code
> itself, or from general knowledge?*

| Verdict | Meaning |
|---|---|
| **REQUIRED** | The outcome depended on it. Unavailable elsewhere at reasonable cost |
| **REPLACEABLE** | Genuinely helped, but reading the code would have got there |
| **IRRELEVANT** | Consumed context, changed nothing |
| **MISLEADING** | Was wrong, stale, or pointed the wrong way |

**MISLEADING is the bucket that matters and the one nobody measures.** For a memory tool,
a wrong recall is worse than no recall — it is the *confident wrong answer* this whole
review is organised around, and Chroma's distractor finding says even one of them drops
performance below baseline. A design that only counts hits cannot see its own harm.

This project has already produced two MISLEADING events in a single session: the stale
`.mcp.json` conclusion (report §5.1) and the `tool_call_log` claim in our own design doc.
Both were believed and acted on. Neither would have registered as anything but a hit.

### 10.4 Instrument 2 — true suppression *(calibration only)*

A judge told *"here is memory that was used"* will over-attribute. So on a **small
rotating sample — two of the ten domain docs** — Engram recall is genuinely withheld and
the work is done without it. Compare outcome and effort against the judged prediction.

This exists **only to calibrate instrument 1's bias.** It is not the primary measurement,
because at n=2 it cannot be.

**Pair within the unit, never between units.** Per Trellis §9.1: naturally-occurring
no-recall runs are *not* a valid control, because tasks where nothing was recalled are
systematically different from tasks where something was. A confounded baseline is worse
than none.

### 10.5 Retirement criteria — written before the data exists

These are commitments, not guidelines. If one fires, the feature goes.

| # | Condition | Consequence |
|---|---|---|
| **R1** | **MISLEADING ≥ 10%** of judged recalls | **Stop auto-loading memory at session start.** Recall becomes on-demand only. A tool that misleads one time in ten is worse than no tool, and auto-load is what makes it unavoidable |
| **R2** | REQUIRED + REPLACEABLE **< 50%** over ≥ 30 events | The recall surface is mostly noise. Cut what is delivered by default to the categories that scored |
| **R3** | Suppression shows **no detectable difference** in outcome or effort across both sampled docs | The counterfactual does not exist. Retire the auto-load path entirely — this is Trellis kill switch 1, the only one that can fire while everything feels fine |
| **R4** | Any single memory *category* scores **0 REQUIRED** over the full sample | That category stops being auto-delivered. It has never been load-bearing |

### 10.6 Honest limits

Stated because a measurement oversold is worse than none:

- **n is small and the operator is one person.** This produces a *local decision*, not a
  publishable claim. It cannot distinguish "Engram helps" from "Engram helps *this
  project, this agent, this codebase*."
- **The judge is a model, judging a model's work.** Shared blind spots are likely.
  Suppression partly checks this; two samples does not check it much.
- **The reviewer is not blind to the hypothesis.** I built the thing being measured. R1–R4
  are written now precisely because I will be motivated not to see them later.
- **Effort is not instrumented.** Token cost per outcome would strengthen this
  considerably and is not being captured. Recorded as a gap rather than pretended away.

---

## 11. Kill switches for this exercise

Written now, while it is still easy to be honest.

1. **If a domain doc cannot name a binding in §5, the domain does not get a doc.**
   Write the findings as Engram observations and move on. A doc with no mechanism is
   the shelfware this charter exists to avoid.
2. **If two consecutive domains produce no target that changes anything**, stop the
   review and write the master plan from what exists. The remaining domains are
   confirmation, and confirmation is not worth the cost.
3. **If Phase 0 measurements show the action surface is not colliding**, the surface
   reduction is off the table — settled input 2 applies to us too.
4. **If this review is still running when a security fix needs shipping, the fix wins.**
   Published v1.12.0 currently carries all four P0 findings — see
   [D11](../DEFERRED-CHANGES.md).

---

## 12. Sequence

| Phase | Work | Output |
|---|---|---|
| **0a** | This charter | ✓ |
| **0b** | Task board — one Engram task per Phase 0 item and per domain | The tracker |
| **0c** | **Gating measurements:** action distinctness (~40 phrases × 83 actions), never-called actions from `tool_call_log`, measured response size per verbosity tier, `knip` with a real config | ✅ [`measurements/`](measurements/README.md) |
| **0d** | Capability surface generator + CI diff gate | ✅ [`../CAPABILITY-SURFACE.md`](../CAPABILITY-SURFACE.md) — the binding most domains reuse |
| **0e** | Baseline experiment design | ✅ §10 above |
| **1** | Ten domain reviews, risk-ordered | `docs/foundations/01..10-*.md` |
| **2** | Synthesis | `docs/ENGRAM-MASTER-PLAN.md` |
| **3** | Skills and playbooks, **derived from Phase 1 findings** | `docs/skills/` or `.claude/skills/` |

Phase 3 is deliberately last. A watchlist written before the review is a guess; written
after, it is a summary of what was actually found.

---

<!-- FOUNDATIONS_CHARTER:ACTIVE -->
