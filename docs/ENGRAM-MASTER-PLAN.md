# Engram — Master Plan

**Date:** 2026-08-05 · **Status:** Draft for adoption · **Engram task:** #11
**Produced by:** the foundations review — [`foundations/00-CHARTER.md`](foundations/00-CHARTER.md) Phase 2
**Inputs:** ten domain documents, [`foundations/01`](foundations/01-durability.md)…[`10`](foundations/10-public-surface.md) · [`DEFERRED-CHANGES.md`](DEFERRED-CHANGES.md) · [`foundations/measurements/`](foundations/measurements/README.md)

> **This document does not carry status.** Progress lives in the Engram task board.
> It is deliberately **thin**: index, direction, cut list, sequencing, release strategy.
> Everything with evidence behind it lives in a domain doc with its own binding.
> Charter §2 rejects the mega-document; this is not one.

---

## 1 — What ten domains actually found

Not "bugs". One shape, repeated in every domain without exception:

> **A capability that is advertised, is described accurately somewhere, and does
> not execute.**

| Domain | The inert thing | Grade |
|---|---|---|
| D1 | `restore` reported success and restored nothing | PROVEN |
| D2 | `sensitive_data` — a security feature that does not execute; `MAX_RESPONSE_LENGTH` referenced nowhere | VERIFIED |
| D3 | `fts_file_notes` has no triggers (96 notes unsearchable); four `deleted_at` columns nothing reads or writes; `ttl_minutes` written, never enforced | PROVEN |
| D4 | `lock_file`/`unlock_file` coordination that never refuses; `pruneStale` with no production caller | VERIFIED |
| D5 | `atomicWriteJson` exists and is module-private, so the installer cannot call it | VERIFIED |
| D6 | `errorWithData()`, `textResult()` and 10 error classes: 0 production callers; `/import` returns `ok:true` while writing nothing; `compact` could not compact | PROVEN |
| D7 | Agent rules labelled CRITICAL, measured at **21.1%** compliance — replayed, never enforced; an `owner` parameter with no `owner` column | PROVEN |
| D8 | The `knip` gate was red from the commit that introduced it and never once ran | PROVEN |
| D9 | `STATE.md`'s binding is *imaginary* — the scripts it names are referenced by no hook, no workflow, no code; the `enforced` column enforces nothing | PROVEN |
| D10 | The public surface had **zero** content assertions; eight verified errors accumulated | PROVEN |

**And the review reproduced it.** Every domain named a §5 binding. Not one of them
can currently fail a build — see §2. The pattern is strong enough that the review
performing it walked into it.

**This is the answer to "what is Engram for."** The product's claim is *trustworthy*
memory. An inert surface is not a cosmetic defect against that claim — it is the
claim failing. A tool that says it recorded something, and did not, is the
charter's framing question in its purest form: *a confident wrong answer that
survives.*

---

## 2 — The one change that makes the other ten real

**PROVEN, this session.** `main` and `v2-foundations` carry different CI workflows.

```
main   .github/workflows/ci.yml   on: push/PR → [main]
                                  steps: npm ci · npm run build · npm test

v2-foundations                    on: push/PR → [main, develop, v2-foundations, fr/**]
                                  job 2 adds:
                                    generate-capability-surface.mjs --check
                                    generate-http-surface.mjs --check
                                    knip
```

`v2-foundations` is **69 commits unpushed**. So:

- CI *has* run — on `main`, and what it ran was build + test.
- The three generator/dead-code gates exist **only** on the unpushed branch.
- Therefore **no gate this review built has ever executed in CI**, and every
  "all gates green" in ten documents means *a human ran it locally once*.

> D9 §2.6 states "no CI run has ever executed." That is too strong and it hides
> the shape. CI runs. It runs a workflow that omits every gate, on the one branch
> that has none of them.

**Charter §2's survival criterion — "coupled to something that breaks a build or
blocks a merge" — is currently satisfied by zero of the ten bindings.** They are
local-run conventions with test files attached, which is precisely the artifact
class §2 exists to reject.

**This is sequencing item 0 and it costs one workflow merge.** Nothing else in
this plan is worth doing first, because until it lands, every other item's
"definition of done" is unenforceable by construction.

---

## 3 — Direction

### 3.1 What Engram is for

Persistent memory was the v1 goal. The review widened it, and the widening is not
rhetorical — it changes what may ship:

> **Engram stores what happened and is answerable for it.** Recall that is wrong
> is worse than recall that is absent.

Charter §10.3 already encoded this: `MISLEADING` is the bucket that matters, and
Chroma's distractor result says a single wrong recall drops performance below
having no tool at all. Every direction decision below follows from it.

### 3.2 The rule that replaces "is this feature good?"

> **Every advertised capability must execute, and something must fail when it
> stops.** A capability that cannot meet both halves is deleted, or its claim is
> deleted. Not documented as a limitation — deleted.

This is FR-D2's *"a security feature that does not execute is worse than one that
does not exist"* generalised to the whole surface, and §1 shows it has ten
independent supporting instances.

**Rejected — document the limitations instead.** This is the status quo. It
produced `SECURITY.md` denying a live network call, `STATE.md` claiming a binding
that does not exist, and agent rules marked CRITICAL at 21.1% compliance.
Documentation of an inert feature decays into an assertion that it works.

### 3.3 The action surface is not the problem, and is not being cut

Stated flatly because three separate lines of evidence now converge and the
instinct to "simplify to 20 actions" will keep returning:

| Source | Says |
|---|---|
| FR-0c distinctness | 55% genuinely distinct. Charter kill switch 3: **if not colliding, surface reduction is off the table** |
| FR-D7 §3b — [TxAgent](https://arxiv.org/abs/2503.10970) | Adding 211 curated tools *improved* reasoning |
| DEFERRED [D12](DEFERRED-CHANGES.md) | The never-called-action report cannot run yet; "ever" starts at `5ff7e2f`. **No action may be deleted until it exists** |

**What is actually wrong is the parameter surface**, not the action count:
`engram_memory` advertises **79 optional top-level parameters** across 38 actions
with nothing marking which apply. That is FR-D7 T1 (task #71), and it is blocked —
see §7.

> **Caution carried forward.** DEFERRED [D13](DEFERRED-CHANGES.md): the 97.5%
> unanimity figure came from three samples of *one model* and measures routing
> stability, not agreement. The 55% is safe to act on; the 97.5% is not.

---

## 4 — Release strategy

The charter and [D11](DEFERRED-CHANGES.md) both require this plan to own the
release explicitly, *"or the release becomes a receding horizon."*

### 4.1 What is live on users' machines right now

`main` is public, is the default branch, and is the source of npm `latest`
(v1.12.0). Four hazards ship in it. **Three need no attacker at all:**

| # | Hazard | Attacker needed? | Blast radius |
|---|---|---|---|
| **H1** | Installer replaces another product's user-level config with a stub on a JSON parse error. `addToConfig` backs up **best-effort** (`try{…}catch{/* best-effort */}`) then starts fresh. `~/.claude.json` measured at **40.5 KB / 53 top-level keys** | **No** | Another product's entire user state, no undo if the backup throws |
| **H2** | `restore` reports success and restores nothing | **No** | The user's own recovery path, at the moment they need it |
| **H3** | Agent rules fetched from a GitHub README at session start and cached to disk, read back with a cast (audit N1) | Yes — a crafted repo | Attacker-authored instructions labelled CRITICAL |
| **H4** | `/export` claims "all data", ships 5 of 24 tables | **No** | Silent partial backup believed complete |

**H1 is the largest and it is the one D11 never considered.** D11's entire risk
calculus is about *disclosure* — "residual risk is independent discovery on an
unwatched repo." H1 is not discovered. It fires when a config file is malformed.
Download counts, stars and watchers are irrelevant to it.

### 4.2 D11's risk argument does not survive its own domain's research

| D11 says | FR-D10 §3b establishes |
|---|---|
| *"a targeted attack on a package with 26 downloads/week"* | [postmark-mcp](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html) — the first malicious MCP server found in the wild — had **~1,500 weekly downloads** and went unscrutinised for 15 versions **because** low counts draw less attention |
| *"too small to be worth attacking"* | [arXiv:2003.03471](https://arxiv.org/pdf/2003.03471): **93.9%** of npm packages get <350 weekly downloads. Obscurity is the ecosystem's default state, not a defence |
| *"exposure is low because it is undisclosed"* | [Arora et al. 2006](https://link.springer.com/article/10.1007/s10796-006-9012-5): undisclosed vulnerabilities are attacked at slowly *increasing* rates. The silent case is not the zero case |

### 4.3 The recommendation

**Split the release in two.** The blocking condition on decision #19 was "no
release until the master plan is drafted and solidified" — this document is that
condition being met, and it does not require all 68 open tasks to land first
(charter kill switch 2 exists to prevent exactly that).

**Release A — `1.12.1`, a patch off `main`. Non-breaking. Ships first.**

Contents: H1, H2, H3, H4. The [tripwire runbook](foundations/tripwire-patch-runbook.md)
already verified **Recipe B** (N1 + N2) cherry-picks onto `main` with zero code
conflicts. H1's fix is small and non-breaking (rethrow instead of `config = {}`;
make the backup blocking). H2 is already fixed on the review line.

> **Re-verify before use.** The runbook's "builds and passes 603/603" was measured
> at 603 tests. The suite is now **733 across 41 files**. The cherry-pick result
> must be re-run, not assumed.

**Release B — `2.0.0`, from the review line. Breaking. Ships when its targets land.**

Major, not minor: `agent_name` is required on session start ([D2](DEFERRED-CHANGES.md))
and the agent-rules path is gone ([D3](DEFERRED-CHANGES.md)). Two breaking changes
are already queued before any Phase-1 target is implemented.

**Rejected — one 2.0.0 carrying everything.** It keeps H1 and H2 live on users'
machines for the length of the whole implementation programme, to save one release.
H1 destroys data belonging to a different product and needs no attacker.

**Rejected — keep holding until the review's targets are implemented.** This is
the receding horizon D11 names by that phrase and guards against by name. The
master plan existing is the condition; waiting for implementation moves it.

**Rejected — patch silently, no advisory.** FR-D10 §3b: Fortinet silently patched
a zero-day under active exploitation and left only *defenders* uninformed. A patch
whose notes omit why is a second false statement, one week after we removed the
first.

### 4.4 The tripwire needs a clock

D11's tripwire has event triggers and no deadline. Indefinite silence is the
failure mode the institution exists to prevent — [CERT/CC](https://certcc.github.io/certcc_disclosure_policy/)
publishes at **45 days regardless of patch status**, while warning that
*"gratuitously announcing vulnerabilities may not be in the best interest of
public safety."*

**Adopt a clock: 45 days from 2026-08-02** (the date the P0 findings were
recorded) **→ 2026-09-16.** On that date, either the advisory is published or the
reason for extending it is written down as a decision. The clock's purpose is not
to force disclosure; it is to make continued silence a *decision* rather than a
default.

### 4.5 Migration path is a gate, not a step

Charter §11b.1 already binds this: the golden fixture, CI-migrated to head on
every change. It is FR-D1's §5 binding and it supersedes task #7's framing. **It
does not currently run in CI** — see §2. Item 0 fixes that too.

---

## 5 — The cut list

What is deleted, and what deliberately is **not**.

### 5.1 Cut — inert surface

| Item | Domain | Task |
|---|---|---|
| `sensitive_data` claims (the feature does not execute) | D2 T4 | #39 |
| Four `deleted_at` columns — nothing reads or writes them | D3 T5 | #66 |
| `errorWithData()`, `textResult()`, 10 classes in `src/errors.ts` — 0 callers | D6 T8 | #55 |
| Agent rule AR-01 (21.1% compliance; the git post-commit hook already does the job) | D7 T2 | #69 |
| `lock_status`, the `file_locks` table, `README:750` — **or** restore real refusal | D4 T2 | #60 |
| `.js.map` / `.d.ts.map` from the tarball — **611,655 B, 38.3%** of unpacked size | D5 T6 | #48 |
| The committed `releaseNotes` blob — `prepack` overwrites it, so it is structurally untrustworthy | D5 T6 / D10 T3 | #86 |
| Two `engram-*` packages documented as installable that have **never been published** — publish or remove | D10 / D8 | #83 |

### 5.2 Explicitly NOT cut

| Item | Why |
|---|---|
| **Any action** | §3.3 — three independent lines of evidence, and D12's report cannot run yet |
| **The 15 dead files in `src/tools/` (4,057 lines)** | D8 T2 freezes them. They are the only record of validation the v1.6 consolidation dropped, and `stats.ts`'s `KNOWN_CONFIG_KEYS` was already recovered from them once. Knight Capital ($440M/45min) is the cited failure mode for deleting on a schedule |
| **The `SECURITY.md` SLA table** | D10 T2 rejected deleting it: it is already published, and silently removing a commitment is the same move as the denial we just corrected. Make it accurate, or change it *visibly* |

---

## 6 — Workspace, codebase, and the change ledger

### 6.1 Codebase

From D8, adopted as decision #28: **aim at Law 1 only.** A ratchet on raw-SQL
count per dispatcher — may fall, may never rise. Not a 91-call-site refactor;
Carbon Health's 107 incidents say decomposition relocates failure classes rather
than removing them.

`packages/*` and the 29 dashboard files have **never been subject to dead-code
analysis of any kind** — they sit outside knip's `project` glob entirely. D14's
description of this was wrong about the mechanism and is corrected in place
(task #83).

### 6.2 What replaces `DEFERRED-CHANGES.md`

The file's own preamble concedes it violates the criterion it was written under,
and names its successor: task #10's `engram_admin(reconcile)` plus the capability
surface. **Retirement condition, stated so it is checkable:**

> Every remaining entry's **trigger** is expressible as a query or a gate. When
> that holds, migrate the entries and delete the file.

Not "when it feels tidy". Three entries already qualify — D9's coverage number is
a command, D12's is a `SELECT`, D13's is a re-run.

### 6.3 Changelog format — decide, do not inherit

D9 T6 flagged this and deliberately did not decide it. It is also **the one target
across all 26 in D6–D9 with no rejected alternative** (charter §8 defect, noted so
it is not repeated).

**Recommendation: Common Changelog, with `Removed` mandatory and gated.**

- Keep a Changelog's own maintainers say the generated form is *"raw material at
  best"* — and generation plus a diff gate is this project's entire strategy.
- [Common Changelog](https://common-changelog.org/) exists partly because Keep a
  Changelog's `[Unreleased]` section creates merge friction — **the exact mechanism
  by which every other hand-maintained register in this repo died** (finding F5).
- Whichever wins, `Removed` is non-negotiable: incident #1 (`lock_file` advertised
  in the README for versions after deletion) is one line under `Removed`.
- **Gate it:** a test asserting every action absent from `CAPABILITY-SURFACE.md`
  but present in the previous release appears under `Removed`. Otherwise this is
  one more hand-maintained register.

---

## 7 — Sequencing

Ordered by *what unblocks what* and *what is live on a user's machine*. Definition
of done is the binding, not the edit.

| # | Item | Done when | Tasks |
|---|---|---|---|
| **0** | **Merge the CI job so the gates run** | `capability-surface --check`, `http-surface --check` and `knip` execute on push for `main` and the review line, and one of them has been observed failing | — |
| **1** | **H1 — installer config clobber** | `addToConfig` rethrows; backup is blocking; `config-write-safety.test.ts` runs in CI | #46, #47 |
| **2** | **Release A (`1.12.1`)** | Recipe B re-verified against 733 tests; H1/H2/H4 included; notes state why | #49 |
| **3** | **Advisory decision** | Published, or the extension recorded as a decision, by **2026-09-16** | #87 |
| **4** | **Reject malformed records on write** | The one-regex acceptance test in task #91 rejects the convention-#7 signature; `update_observation` exists | #77, #91 |
| **5** | **Provenance (D2 T1)** | Every memory row carries server-resolved author/route/trust tier | #38, #58 |
| **6** | **Trust-tiered replay (D2 T2)** | Blocked on 5. *"The most important target in this document and currently the least bound"* | #40 |
| **7** | **`packages/*` get a generated surface** | A second knip config + CI step, warnings first | #83 |
| **8** | **D7 T1 — per-action schemas** | **Blocked on 7** by D14. This dependency is stated in D8 and appears nowhere in D7 — a plan read from D7 alone would ship it early | #71 |
| **9** | **Storage integrity** | FTS triggers exist; freshness cannot be laundered by a partial write | #35, #64 |
| **10** | **Release B (`2.0.0`)** | Golden fixture migrates v1 → head in CI | #34, #49 |

### 7.1 Conflicts this plan resolves

**`better-sqlite3` — D1 T7 vs D5 T1 disagree, on the record.** D1 queues the bump
behind decision #19 and accepts 12.10.0. D5 targets 13.x, explicitly rejects D1's
framing, and reclassifies task #34 from `medium` to **blocker**.

> **Resolved for D5.** 13.x removes the install script *and* closes the SQLite WAL
> bug; 12.10.0 closes only the bug. D5 reasoned about the delivery mechanism, which
> is the deciding fact, and D1 did not have it. It rides Release B, not Release A —
> a native-dependency major bump does not belong in a patch shipped for data loss.

**Charter §8 defects, recorded not repeated.** Two targets ship with no rejected
alternative: **D4 T4** (`agent_name` validation) and **D9 T6** (changelog format,
decided in §6.3 above). Both were found by extraction, not by the domains
themselves — which is an argument for a §8 checker, not for re-opening the docs.

---

## 8 — What the experiment says, and what this plan does about it

Charter §10's instrument 1 ran once, in D10, after nine domains of zero output.
**n = 14**, two blind judges, reconstructed rather than logged.

| Retirement criterion | Fires? |
|---|---|
| **R1** — MISLEADING ≥ 10% | **Reported as 21%, and must NOT be treated as fired.** The sample was deliberately enriched with known-wrong records; all 3 MISLEADING came from those 5, and the other 9 produced 0. The rate is uninterpretable |
| **R2** — REQUIRED + REPLACEABLE < 50% | No — 79% |
| **R3** — suppression shows no difference | **Unevaluable.** Both arms leaked |
| **R4** — a category scores 0 REQUIRED | **Yes, for 4 of 5.** Decisions, observations, tasks and handoffs all scored 0. The only REQUIRED was a convention |

**This plan retires nothing on these numbers**, per D10 §8.3, and the reason is
not caution — it is that the judges' stated reason for REPLACEABLE was repeatedly
*"the same fact is in a committed file."* Recall is replaceable **here** largely
because this project also writes everything into git. That is a property of this
project, not a verdict on the tool.

**What does change:** tasks #89 (define recall to include generated re-exports and
write-call responses — charter R1 as written would not achieve what it describes,
because two of the three leak channels are not session start) and #90 (log recall
events when they happen, so a future run samples instead of reconstructing).
Without #90, no future run does better than n=14.

---

## 9 — Decisions this plan does not make

Stated explicitly so they are not absorbed silently. Each needs the maintainer.

1. **Whether to publish a security advisory, and when.** §4.4 recommends a clock,
   not a disclosure. The advisory itself is a judgement about users, not code.
2. **Whether to push `v2-foundations`.** D11: pushing **is** disclosure and
   inverts the calculus. Unchanged by this plan.
3. **Whether `packages/*` stay in this repo.** D8 kill switch 3: if they are cut,
   task #83 and D14 both dissolve. Two of the three have never been published.
4. **Whether the `SECURITY.md` SLA (48h/7d/30d) is one person can meet.** D10 F4
   is the review's only *unrecoverable* failure mode, because the SLA is already
   public.

---

## 10 — Kill switches for this plan

Written before attachment forms.

1. **If item 0 has not landed within two working sessions, stop implementing
   targets.** Every definition of done in §7 is a CI gate. Building more targets
   against gates that do not run is how ten bindings became decoration in the
   first place.
2. **If Release A slips past the 45-day clock without a written decision**, the
   hold has become drift, and D11's guard has failed. Publish the advisory.
3. **If a domain target is implemented and its §5 binding is edited in the same
   commit to make it pass**, treat that as the pinned-defect permission slip D4
   and D9 both warn about — revert and re-review.
4. **If instrument 1 is re-run at larger n and inverts R4**, §8 goes with it.
   n=14 is a signal, not a result.

---

<!-- ENGRAM_MASTER_PLAN:DRAFT -->
