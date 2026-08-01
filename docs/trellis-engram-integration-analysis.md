# Trellis × Engram — Integration Analysis

**Date:** 2026-08-02 · **Analyst:** Opus 5
**Inputs:** `TRELLIS.md` v1.0 (charter, design settled, nothing built) · Engram @ 1.11.0 as it actually exists ([`ENGRAM_CONSTITUTION.md`](ENGRAM_CONSTITUTION.md)) · [`engram-deep-audit-2026-08-02.md`](engram-deep-audit-2026-08-02.md) · 2026 agent-memory research landscape

---

## 0. Verdict up front

**Do not build Trellis inside Engram. Take six mechanisms from it, reject three, and use the rest as a diagnostic lens.**

Three reasons, in order of weight:

1. **They govern different things.** Trellis encodes *process* — how an agent should work. Engram stores *state* — what happened. Merging them would make Engram opinionated about workflow, which is the one thing its "unopinionated infrastructure" positioning currently gets right.
2. **Engram already has an unmeasured Trellis.** PM-Lite / PM-Full, `knowledge/` (6 phases, 5 principles, 5 gate checklists), and `workflow-advisor.service.ts` (8 nudge heuristics) are a partial Trellis that shipped without a baseline. Adding a second unmeasured process layer on top compounds the problem Trellis §17 exists to prevent.
3. **Trellis's own evidence argues against wholesale adoption.** §18.3: self-generated skills average **−1.3pp** against skill-free baselines. §18.4: an ablation with harsh governance thresholds scored **below baseline**. A charter that honest about its own base rates should not be adopted on enthusiasm.

But Trellis is the most useful document I have read against Engram, for a reason that has nothing to do with integration: **its evidence base diagnoses Engram's central design error**, which neither audit found. See §2.

---

## 1. What each system actually is

|  | Trellis | Engram |
|---|---|---|
| **Governs** | Process — how the agent works | State — what the agent knows |
| **Substrate** | Markdown read by the agent | SQLite queried by the agent |
| **Unit** | The skill (a procedure owning one trigger) | The record (typed row) |
| **Learning signal** | The **deviation** — where the agent departed from the prescribed step | None. Engram records outcomes, never departures |
| **Self-modification** | Gated: propose → human reviews a *diff* → script applies + verifies | None. Engram does not modify its own instructions |
| **Measurement** | A permanent no-skill baseline arm (§9.1); health metrics (§11); kill switches (§17) | None |
| **Status** | Designed, evidence-reconciled, **nothing built** | Shipped at 1.11.0, 557 tests, real users |

The complementarity is clean: **Trellis has the measurement discipline Engram lacks; Engram has the durable structured store Trellis assumes into existence.** Trellis §7.1 specifies `LEDGER.md`, `FRICTION.md`, `runs/*.jsonl`, `metrics.json` as append-only markdown/JSONL with `merge=union` in `.gitattributes`. That is a flat-file reimplementation of tables Engram already has, with FTS5, transactions, and migrations. If Trellis were ever built alongside Engram, its state layer should be Engram, not files.

---

## 2. The finding: Trellis's evidence base indicts Engram's tool surface

This is the most valuable thing in this analysis and it is not an integration recommendation.

### 2.1 The evidence

Trellis §18.1, from published results across 38 (task, model) pairs and ~2,545 trajectories:

> Expanding a skill library degraded pass rates by **8% at 52 skills, 14% at 102, and 21% at 202**. Decomposition attributed up to **68%** of the loss to *shadowing* — a wrong skill selected because its description matched better — while **context overhead was statistically insignificant at every size**. Oracle-selection fraction fell from 88% to 53%.

Trellis draws the right conclusion (its Principle 2):

> **The cost of a skill is not what it costs to read. It is the chance it gets chosen wrongly.**

### 2.2 Why this lands on Engram

Engram exposes **75 actions** (38 `engram_memory` + 37 `engram_admin`) behind 4 tools. Functionally, an action *is* a skill: a named capability the model selects by matching intent against a description. Engram's action count sits between the 52-skill and 102-skill measurement points — the range where the published degradation is 8–14%.

Now look at what Engram optimised. From v1.6 through v1.11, the headline engineering effort went into **token reduction**: tiered verbosity (nano/minimal/summary/full), tiered tool catalogs (tier 0/1/2), universal mode's "~80-token schema", the v1.11 "~40% session-start reduction."

**Every one of those optimises context overhead — the variable the evidence says is statistically insignificant.** None of them touches selection accuracy — the variable responsible for up to 68% of the loss.

This reframes a finding from the audit. `nano` shipping ~850 tokens instead of its advertised "~10" ([audit N6](engram-deep-audit-2026-08-02.md)) is embarrassing, but by this evidence it is *nearly irrelevant to outcomes*. The real cost was never the tokens.

### 2.3 Universal mode is a shadowing machine

`modes/universal.ts` collapses 75 actions behind one tool and resolves the caller's `action` string with:
- exact match against the action sets, then
- **`fuzzyResolveAction()` — a BM25-style substring/length-ratio scorer with a 0.5 threshold.**

So when the model names an action ambiguously, Engram does not error. It **guesses**, using a lexical scorer, and dispatches. That is the shadowing failure mode implemented deliberately, as a feature, marketed as a token optimisation.

Compounding it: universal mode's `HandlerCapturer` **discards the Zod schemas** ([constitution §7](ENGRAM_CONSTITUTION.md)), so the mis-routed call also skips enum validation. A fuzzy-matched wrong action receives unvalidated params.

And there is no instrumentation anywhere to detect it. `tool_call_log` records the action that ran, never the action that was *meant*.

### 2.4 What to do about it

Apply Trellis §6.2 ("trigger discipline") to Engram's **action catalog** rather than to skills:

1. **Run the distinctness test.** Take ~40 representative task phrasings ("record that we chose Postgres", "note that the FTS index rebuilds on migration", "save what I just figured out"). For each, ask a model which of the 75 actions it would call. Any phrasing that routes ambiguously is a confirmed collision. This is cheap — one model call per phrase — and it is the highest-information experiment available to this project.
2. **Expect `record_decision` / `record_observation` / `dump` / `add_convention` to collide.** They already do conceptually: v1.11's own release notes say `record_observation` exists *because* "agents were forced to misuse `record_decision`." That is a shadowing report written by the maintainer without the word being used. Adding a fourth overlapping action was treated as the fix; the evidence says it likely made routing worse.
3. **Add exclusion clauses to descriptions** where confusion is likely — Trellis §6.2's "not for X — use Y" pattern. Zero code change, directly targets the dominant failure mode.
4. **Make `fuzzyResolveAction` observable, then probably remove it.** At minimum, return the match confidence and the runner-up in the response, and log both. A silent lexical guess between 75 capabilities is not a feature.
5. **Treat 75 as a budget, not an achievement.** Trellis §12.1 caps skills at 14 with a target of 5–9. Engram's actions are finer-grained, so the number isn't directly comparable — but the direction is. The next new action should have to displace one.

**This costs almost nothing and is the highest-expected-value work identified in this entire audit cycle.**

---

## 3. Where Trellis answers a question Engram cannot

The commissioning question was: *does Engram add weight and burn tokens instead of helping?*

Engram cannot answer it. There is no counterfactual anywhere in the system.

This is not a niche gap. The strongest methodological work in 2026 agent memory — **MemDelta, arXiv:2606.29914, "Controlled Baselines and Hidden Confounds in Agent Memory Evaluation"** — argues that most published memory-system gains **disappear once compute- and latency-matched control baselines are used**, and that current benchmarks conflate "memory helps" with "more inference-time compute helps." No memory vendor has published a rebuttal with controlled baselines.

Trellis anticipated exactly this. §9.1 mandates a **permanent no-skill baseline arm** and — critically — gets the statistics right for a low-volume project:

> **Pair within the task; never split between tasks.** Classic A/B is hopeless at this volume... the natural no-skill runs (tasks where nothing triggered) are not a valid control because they are systematically different from tasks that did trigger. That is selection bias, and a confounded baseline is worse than none.

Its two-instrument design is directly implementable for Engram:

| Instrument | How | Cost |
|---|---|---|
| **Shadow judgment** (primary) | After a task completes with Engram, a fresh-context judge — blind to arm — assesses whether the outcome *required* the recalled memory or would have been reached without it | 1 judge call per sampled task, 10–20% of tasks |
| **True suppression** (calibration) | Engram genuinely withheld; task run without it. Exists only to measure and correct the judge's bias | Small rotating sample |

Trellis §17's kill switch #1 then names the failure condition honestly:

> **Baseline delta ≤ 0 over a meaningful sample → retire.** This is drift, by definition... It is the only condition that can fire while everything *feels* fine.

**Recommendation: build this. It is the only mechanism that converts the commissioning question from opinion into measurement,** and it is the one thing that would let Engram make an efficacy claim no competitor can currently substantiate. Section 8 sizes it.

---

## 4. Where Trellis already specifies the fix for Engram's worst bug

Trellis §13 is, almost line for line, the remediation spec for [audit finding N1](engram-deep-audit-2026-08-02.md).

Trellis §13.1, on published memory-poisoning research:

> **Memory injection works through ordinary, unprivileged interaction**, inducing the agent to write the poisoned record itself, with reported success rates above 95%.
> This falsifies v0.2's provenance rule, which held that a record was trustworthy because the agent authored it. **The agent authored it while reading whatever it was reading.**

Map its controls onto Engram:

| Trellis §13.2 control | Engram today | Gap |
|---|---|---|
| **Structured records; free text is the injection vector** | Most tables are typed | **`dump` auto-classifies arbitrary free text into decisions/conventions and marks them `active`.** No provenance field |
| **Quarantined free text — never concatenated into a prompt, surfaced as data only** | Not implemented | `dump`-classified conventions flow straight into session-start context as authoritative |
| **Two-stage moderation at the write boundary** | None | No static or semantic check on anything entering state |
| **Diff-level human review; a summary is what an attacker controls** | N/A for state; **`agent_rules` is fetched and applied with no review at all** | This *is* N1 |
| **No automation path around the gate** | No gate exists | — |
| **Observed content is data, never instruction** | Violated by design: `agent_rules` is fetched content labeled CRITICAL/binding | The core of N1 |

Engram's `record_observation` already has a `source` field (`agent`/`user`/`automated`). `record_decision` and `add_convention` do not. Extending that one field across every memory table — plus `written_by` and a `trust_tier` — and then **excluding low-trust rows from auto-loaded session context** is a small schema change that implements Trellis §13.2's first two controls and closes both N1's blast radius and the `dump` provenance gap.

This converges with the independent recommendation from the competitive research (arXiv:2606.24535's four-tier provenance model), which reached the same conclusion from a different direction. Two independent lines pointing at the same fix is the strongest signal in this document.

---

## 5. Where Trellis is wrong, and Engram is right

I owe the charter a real critique, not a reading list.

### 5.1 §21.1 mandates the attack it documents in §13

Trellis §21.1:

> **If it isn't committed to the repository, it does not exist.**

And §21.6 commits `LEDGER.md`, `FRICTION.md`, `BACKLOG.md`, `metrics.json`, `runs/`, `golden/` — with the justification: *"This is the memory. Uncommitted memory is amnesia."*

**This is precisely the MemoryTrap vector.** CVE-2026-21852 (Cisco Talos, 2026-04-01): attacker text reached Claude Code's `MEMORY.md`, which was auto-loaded into the system prompt every session and treated as high-authority operating instructions. Anthropic's fix in v2.1.50 was to remove memory from that path entirely.

Committing agent memory to a repository means:
- **A clone carries it.** Anyone who publishes a repo publishes its ledger and friction log. A hostile repo ships poisoned memory to every agent that opens it — no compromise required.
- **A pull request can edit it.** `merge=union` on append-only logs (§21.6) means a PR *appends without conflict*, and appended lines are exactly the injection surface. §13.2's diff-level review is specified for skills and `AGENTS.md` — **not for state files, which §5.3 says are written by "scripts and hooks only."** A contributor's PR reaches state through a path the gate does not cover.
- **A fork inherits it.**

So §21.1 and §13 contradict each other. §13 assumes the poisoned record is *agent-authored* (its threat model is "the agent wrote it while reading something bad"). §21.1 opens a second door where the record is *stranger-authored and arrives by clone* — which §13's controls, all of which sit at the agent's write boundary, do not see at all.

**Engram gets this right.** `.engram/.gitignore` is `*` ([`database.ts:319`](../src/database.ts#L319)) — memory is deliberately not committed. Engram's [N1](engram-deep-audit-2026-08-02.md) bug is precisely the *one* file that escapes that discipline in practice (the agent-rules cache, which can be shipped in a repo even though Engram never commits it), and it is a CRITICAL finding for exactly the reason §21.1 should worry Trellis.

**Recommendation for Trellis:** committed state needs the same treatment as skills — either diff-level review at merge, or an integrity binding (per-install HMAC) so state that arrives by clone is recognised as foreign and quarantined. Trellis's own §13.2 control set is right; §21.1 just needs to be inside its scope.

### 5.2 §12.1's "zero ambiguous routings" is not achievable, and Trellis half-knows it

§12.1 sets **"Zero ambiguous routings on the representative phrase set"** as a lint-enforced budget. §20's open question 6 then admits:

> Do 14 broad skills shadow worse than 50 narrow ones? The measured libraries were narrow task-skills; Trellis's are broad workflow skills with inherently higher overlap.

Broad workflow skills — `implement`, `shape`, `diagnose`, `review` — have irreducible overlap. "This function is slow and I want to restructure it" legitimately spans three of them. A zero-ambiguity budget on a set like that will either be gamed (curate the phrase set until it passes) or block every admission.

The honest budget is **"no *silent* ambiguous routing"** — measure it, report it, and make the router say when it is unsure. Which, notably, is the same recommendation §2.4 makes for Engram's `fuzzyResolveAction`.

### 5.3 Trellis has no answer for concurrency; Engram at least has the schema for one

Trellis §20 open question 9: *"Two agents, one ledger, advisory locks. Unsolved; single-writer by convention."* §4.2 pushes parallel execution to the harness.

Engram is worse in *behavior* right now (audit N3: bidirectional session clobbering, `pending_work` mass-abandonment, unscoped handoffs) — but it has agent identity, task claiming with atomic `WHERE claimed_by IS NULL`, broadcasts, and a sensitivity/approval model. It has the schema for a real answer and a broken implementation. Trellis has neither.

If the two ever combine, **Engram owns concurrency, not Trellis** — after N3 is fixed.

---

## 6. Adopt / adapt / reject

### Adopt — six mechanisms, ranked by value ÷ effort

| # | Trellis § | Mechanism | Why for Engram | Effort |
|---|---|---|---|---|
| **1** | §6.2, §12.1 | **Distinctness testing on the action catalog** | Targets the dominant failure mode (§2). ~40 phrases × 1 model call. Also gives the first real measurement of Engram's routing quality | **S** |
| **2** | §13.2 | **Structured records + quarantined free text + provenance** | Implements the fix for N1 and the `dump` gap. Converges with independent research (§4) | **S–M** |
| **3** | §11 | **Cost accounting shipped with the feature, not after** | "An unmeasured budget is a wish." Engram's token claims are off by up to 85x precisely because nothing measures them. A build-time assertion on response size per tier makes N6 impossible to reintroduce | **S** |
| **4** | §9.1 | **Paired baseline arm (shadow judgment + suppression calibration)** | The only way to answer the commissioning question. The strongest available differentiator (§3) | **M** |
| **5** | §7.3 | **Deviation capture as the unit of learning** | Engram records outcomes, never departures. `observations` is 90% of the table already needed | **M** |
| **6** | §17 | **Kill switches as written commitments** | Cheapest cultural import. Retirement criteria written *before* attachment forms | **S** |

**On #5**, Trellis's insight is worth restating because it is genuinely non-obvious:

> A run that **succeeded while following the skill exactly** confirms it and teaches nothing. A run that **succeeded only because the agent improvised at step 3** and a run that **failed at step 3** carry the same information — a gap at step 3 — differing only in what it cost to find out.
> `absent` grows a skill. `unused` shrinks it. **A loop that learns only from failure can only ever add.**

That last sentence explains Engram's action-count growth directly. `record_observation` was added because agents misused `record_decision` (an `absent` signal, correctly acted on). Nothing has ever been removed, because nothing tracks `unused`. Engram's `tool_call_log` table already records every invocation — it has the raw data for an `unused` metric and has never computed it. **That is a report, not a feature: which of the 75 actions has never been called?**

**On #6**, three kill switches worth writing down today:
- If the baseline delta (#4) is ≤ 0 over a meaningful sample, retire the tiers it covers.
- If any action goes unused for two release cycles, remove it.
- If measured session-start cost exceeds its documented figure and the proposed fix is "update the docs," revisit the tier instead. (Trellis §17 #7, exactly.)

### Adapt — two

| Trellis § | Adapt to |
|---|---|
| §14 maturity tiers (Seed/Growing/Established/Experimental) | Engram already has PM-disabled / PM-Lite / PM-Full. Add Trellis's gating rule: **never advance past the middle tier without §11 instrumentation running.** PM-Full currently activates on a nudge with no measurement behind it |
| §5.4 the gate (halt for human approval on a Major Change) | Engram has confirm strings for `restore`/`clear`. Extend to the security-relevant `config` keys ([N2](engram-deep-audit-2026-08-02.md)) — `sharing_mode`, `sharing_types`, `http_token`, `sensitive_keys` should require a confirm token, or be unwritable from the tool surface |

### Reject — three

| Trellis § | Reject because |
|---|---|
| §8 skill lifecycle (grow new skills from traces) | Trellis's own §18.3: self-generated skills average **−1.3pp**; 1 of 5 configurations improved. Trellis ships it off by default behind a positive baseline delta. Engram has no baseline at all, so the precondition can't even be evaluated |
| §21.1 commit-everything | Contradicts §13's own threat model and reproduces CVE-2026-21852 at repo scope (§5.1). Engram's gitignore-by-default is correct |
| The 14-skill set as a deliverable | Engram is not a skill library. Importing `orient`/`implement`/`review` would put Engram in the workflow-opinion business and collide with what its host harness already does |

---

## 7. What this means for the user's actual question

*"Engram should help the agent move quick and do more without redoing what it already did — without adding weight."*

Trellis's Principle 1 is the sharpest test available:

> **Structure earns its place by removing work, not by describing it.** Every element must answer: *what does the agent no longer have to figure out?* If the answer is "nothing — it just says be careful," delete it.

Run Engram's surface through it:

| Element | What does the agent no longer figure out? | Verdict |
|---|---|---|
| `get_decisions`, `search`, `get_file_notes` | Why a past choice was made; where something lives; what a file is for | **Earns its place** — this is the product |
| Session resume / `previous_session` | What the last session did | **Earns its place** |
| File-note staleness (mtime + SHA-256 + branch) | Whether cached knowledge is still valid | **Earns its place, and is uncommon** |
| Sub-agent task-scoped slice | What a spawned agent needs, without re-reading everything | **Right idea, currently broken** ([N3](engram-deep-audit-2026-08-02.md)) |
| `agent_rules` (8 CRITICAL rules, every session, every tier) | Nothing. It says *be careful* — literally "call X after every edit" | **Fails Principle 1.** ~330 tokens on every start, plus it is the N1 attack surface |
| PM-Lite nudges | Arguably nothing — they prompt, they don't answer | **Unproven.** Exactly what the baseline arm (§3) exists to settle |
| `tool_catalog` in every tier | The action names — but `selectCatalogTier` already knows the agent has seen them | **Fails on repeat sessions.** Tier 0 still ships ~330 tokens to an agent that by definition already knows |
| 75 actions across 4 tools | More capability — at a measured selection cost (§2) | **Net negative above some count.** Nobody knows where that count is because nobody has measured |

The two clearest wins, both cheap:

1. **Drop `agent_rules` and tier-0 `tool_catalog` from repeat sessions.** `selectCatalogTier` already tracks per-agent delivery. Reusing that signal for the rules too removes ~660 tokens from every repeat session start, and simultaneously shrinks N1's blast radius. This is the "removing work" half of Principle 1 applied to Engram's own payload.
2. **Run the distinctness test (§2.4).** If four actions collide on "record what I just learned," collapsing them removes a decision the agent currently has to make on every write — the purest form of "what does the agent no longer have to figure out."

---

## 8. Recommended sequence

Nothing here should start before the [audit's P0 items](engram-deep-audit-2026-08-02.md#6-prioritized-recommendations). A measurement layer over a system that silently corrupts multi-agent state measures noise.

| Phase | Do | From | Effort |
|---|---|---|---|
| **0 — prerequisite** | Audit P0: session identity, config whitelist, agent-rules trust boundary, `pending_work` scoping | Audit §6 | — |
| **1 — measure before changing** | Distinctness test on 75 actions, ~40 phrases. Report ambiguous routings. **Also:** query `tool_call_log` for never-called actions (the `unused` signal) | §6.2, §7.3 | **S** |
| **2 — cheap wins from phase 1** | Exclusion clauses on colliding descriptions. Make `fuzzyResolveAction` report confidence + runner-up. Drop `agent_rules`/tier-0 catalog from repeat sessions | §6.2, §7 | **S** |
| **3 — close the trust boundary** | `source` + `written_by` + `trust_tier` on every memory table. Quarantine `dump`-classified records: never auto-`active`, excluded from auto-loaded context | §13.2 | **S–M** |
| **4 — instrument** | Measured response size per verbosity tier, asserted at build time. Action-selection accuracy. Never-called-action report | §11, §12 | **S–M** |
| **5 — the baseline arm** | Shadow judgment on 10–20% of sessions + a small suppression sample for calibration. Write kill switch #1 down *first* | §9.1, §17 | **M** |
| **6 — deviation capture** | Extend `observations` with a deviation record: what the agent did that the recalled memory did not anticipate. Feed phases 1 and 5 | §7.3 | **M** |

Phases 1 and 2 are a few days and target the dominant failure mode. Phase 5 is the one that answers the commissioning question and would give Engram an efficacy claim nobody else in this field can currently substantiate.

---

## 9. Closing judgment

Trellis's real contribution here is not a subsystem. It is **a set of questions Engram has never asked itself**, backed by published numbers:

- How often does the model pick the wrong action? *(Never measured. Up to 68% of degradation in comparable systems.)*
- Which of the 75 actions has never been called? *(The data exists in `tool_call_log`. Never queried.)*
- Is a session with Engram better than the same session without it? *(No counterfactual exists. The strongest 2026 methodology work says most systems claiming otherwise are measuring a confound.)*
- What would make us turn a feature off? *(Nothing is written down.)*

Engram is a well-built store with an unmeasured surface. Trellis is an unbuilt process with a rigorous measurement discipline. **Take the discipline, leave the process** — and note that the discipline is worth more to Engram than any feature in this document, because it is the only thing that turns "does this help?" from an argument into a number.

One caution, in Trellis's own voice (§18.4): an ablation with harsh governance thresholds scored *below* the no-governance baseline. **Governance can harm.** Every item in §6 should be adopted with its own kill switch attached — including the measurement itself.

---

<!-- TRELLIS_ANALYSIS:COMPLETE -->
