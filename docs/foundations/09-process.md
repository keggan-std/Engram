# Domain 9 — Process & Traceability

**Charter:** [`00-CHARTER.md`](00-CHARTER.md) · **Owns:** the anti-drift machinery, including §7's bindings
**Status lives in the Engram task board.** `FR-D9` tasks, not here.

> **The one-line finding.** The anti-drift machinery is **real, well built, and pointed in
> exactly one direction.** It gates *structural* drift between source and generated
> document — and it is blind both to the **prose an agent actually reads** and to the
> **record at the moment it is written**. PROVEN: a deliberately false parameter
> description, compiled into the shipped tool schema, passes `surface:check` at exit 0,
> while adding one optional parameter fails it at exit 1. That is not a nitpick — FR-D7's
> 21.1% compliance defect *was a description*. The gate built to keep the agent-facing
> contract honest cannot read the part of the contract that lied.

> **The second finding, and it is the one that should worry us most.** 51 rows in this
> project's own store carry transport corruption; **31 lost a field outright, 34 fields
> destroyed, across 7 agents.** 9 of 26 decisions have a NULL `rationale` — while a
> convention shipped to every agent as `enforced: true` reads *"Every decision requires a
> rationale. No undocumented choices."* Nothing reported this, for months, because
> **`enforced` enforces nothing**: every use of that column in the codebase is a retrieval
> filter or a sort key.

> **Method note.** Three sub-agents were used for breadth — binding inventory, failure
> literature, code-path enumeration — and **none of them wrote to Engram**, because records
> written while a sub-agent session is open are stamped with the wrong session (task #58).
> Every load-bearing claim below was re-checked personally; two sub-agent claims were
> narrowed as a result and are marked. Grades are per charter §5. §4 was not delegated.

> **Pre-registration.** Five predictions were written into **observation #92** before any
> sub-agent report landed and before any source was read beyond `ci.yml` and
> `package.json`. **Two were wrong.** Both are scored in §2.6 rather than quietly dropped.

---

## 1 — Claims

Inventoried from the charter's own survival criterion, the generated artifacts' headers,
the schema, the packaged conventions, and the tool descriptions an agent reads. This
domain is unusual: **most of its claims are made by the review itself**, not by the
product. That is deliberate — §9 owns the machinery this review runs on, so the review is
in scope.

| ID | Claim | Source |
|---|---|---|
| D9-C1 | "The source of truth must be coupled to something that **breaks a build or blocks a merge** when it is stale" | charter §2 — the survival criterion |
| D9-C2 | The generated capability surface keeps the **tool contract** from drifting; it is "the binding most domains reuse" | charter §12 phase 0d |
| D9-C3 | `STATE.md` is a **generated artifact — never hand-edit**, kept true by "a local git hook (`engram_admin install_hooks`) plus this check" | `generate-state.mjs:40-44`, `STATE.md:5-8` |
| D9-C4 | The HTTP surface gate covers the **dashboard's contract** | `generate-http-surface.mjs`, charter §11b.1 |
| D9-C5 | A convention marked **`enforced: true`** is enforced | `conventions` schema, `migrations.ts:80`; shipped to every agent at `sessions.ts:325` |
| D9-C6 | "**Every decision requires a rationale.** No undocumented choices." | `knowledge/conventions.ts:30` — `pmconv-traceability`, priority-surfaced every session |
| D9-C7 | The git post-commit hook records commits "**so the history stays complete** even when an agent doesn't call `record_change`" | `src/index.ts:38-41` |
| D9-C8 | Session end **reports what the session accomplished** | `sessions.ts:561-569` |
| D9-C9 | `get_file_history` returns "**all changes + decisions** for a specific file" — i.e. records are linked | tool catalog, `find.ts` |
| D9-C10 | Every domain doc **names a §5 mechanism that fails when its claims drift**; a doc without one does not ship | charter §7.5, kill switch 1 |
| D9-C11 | Every `DEFERRED-CHANGES.md` entry names a **mechanical trigger**, not a reminder | `DEFERRED-CHANGES.md:13-29` |
| D9-C12 | Removals are recorded, so a feature cannot be advertised after deletion | `project-state-tracking-design.md` §5 Tier 0.4; the `lock_file` incident |

---

## 2 — Reality

### 2.1 D9-C2 — the capability surface gate is blind to the prose · **PROVEN**

The gate works. It also cannot see the defect that cost this project its worst measured
number. Both halves were established by experiment, on a clean tree, this session.

**Baseline.** `npm run build && node scripts/generate-capability-surface.mjs --check` →
`Capability surface matches the committed file.`, exit **0**.

**Probe 1 — semantic drift.** The per-parameter description on `engram_memory`'s `action`
parameter was replaced with the literal string
`"FR-D9 PROBE: this description is a deliberate lie and must be reverted."`, then rebuilt.

```
$ node scripts/generate-capability-surface.mjs --check
Capability surface matches the committed file.
exit=0
```

**Probe 2 — the control**, so this is not a claim that the gate is useless. One optional
parameter `frd9_probe` was added to the same schema, and rebuilt.

```
$ node scripts/generate-capability-surface.mjs --check
CAPABILITY SURFACE DRIFT
exit=1
```

Both probes were reverted; `git status` clean, gate green.

**Cause — VERIFIED.** [`generate-capability-surface.mjs:42`](../../scripts/generate-capability-surface.mjs)
captures `config?.description` — the **tool-level** description. `describeType()` never
reads Zod's per-field `.description`, the property `.describe()` sets. So
`CAPABILITY-SURFACE.md` renders types, enums, bounds and required/optional, and **no
parameter prose at all**:

```
| `changes` | array<object> | no | — |
```

**Why this is the headline.** FR-D7 PROVED AR-01 compliance at 21.1% and traced it to
`record_change` advertising `file_path`, `change_type` and `description` while ignoring all
three and requiring a `changes` array. **That defect is a description telling an agent
something false.** The gate could not have caught it, cannot catch it now, and would not
catch its return.

**One sub-agent claim narrowed.** It was reported that reading `dist/` means `--check`
compares against stale compiled output. True, and PROVEN — probe 2 returned exit 0 before
rebuild, exit 1 after. But this is a **local hazard only**: CI runs `Build` before the
check ([`ci.yml:58-59`](../../.github/workflows/ci.yml)). Reported as a CI hole; it is not one.

### 2.2 D9-C5 and D9-C6 — `enforced` enforces nothing · **VERIFIED**

Every occurrence of the `enforced` column in `src/`:

| Use | Where |
|---|---|
| `WHERE enforced = 1` retrieval filter | [`conventions.repo.ts:37,41,61,78`](../../src/repositories/conventions.repo.ts), `dispatcher-memory.ts:569`, `intelligence.ts:91`, `cross-instance.service.ts:318` |
| Sort key | [`sessions.ts:318`](../../src/tools/sessions.ts) |
| The toggle that sets it | `conventions.repo.ts:85-88`, `dispatcher-memory.ts:584-587` |
| Hardcoded `true` on the way out to the agent | [`sessions.ts:325`](../../src/tools/sessions.ts) |

**There is no code path in which `enforced = 1` causes a write to be rejected or a check to
run.** The column selects what is *displayed*. `engram_find(action:"lint")` exists and can
check content against conventions — but nothing calls it automatically, so it is a tool an
agent must remember to use, which this project has measured the worth of.

**The consequence is measured, not hypothetical.** `pmconv-traceability` — *"Every decision
requires a rationale"* — is violated by **9 of 26 decisions** (#16, #17, #18, #19, #20,
#22, #23, #24, #26). Six of those are transport corruption (§2.3); three simply never had
one. Nothing reported either.

### 2.3 The record is corrupted on write, and nothing looks · **PROVEN**

Harness: [`measurements/measure-record-corruption.mjs`](measurements/measure-record-corruption.mjs),
run against a **copy** of the live store per charter §11b.3.

```
corrupted records:   51
...of which LOST a field: 31  (34 fields destroyed)
distinct agents hit: 7
per table: observations 15, tasks 12, decisions 10, sessions 7, handoffs 3, conventions 3, snapshot_cache 1
```

The agent-harness transport folds trailing tool-call parameters into the *preceding* string
parameter. The last long field written swallows every parameter after it.

**My first number was wrong, and it is reported as wrong.** The first version of the
harness matched one signature shape and reported 31 records / 30 losses. There are **four**:
the parameter tag, a leaked call-envelope tag, a bare closing tag naming a real field, and
a malformed-quote form. Decisions #23 and #24 carry no parameter tag at all and were
invisible to the first pass. Handoff #9 warned to check the denominator when a number
agrees with the thesis; this is that warning arriving a second time in two sessions. The
error was in the conservative direction, which is safe and still wrong.

**A prior conclusion is refuted.** FR-D7 recorded of decision #26 that its rationale folded
into the decision field but *"content is intact, nothing was lost."* True of the **text**,
false of the **record**. The `rationale` **column** is NULL. Anything reading it — a query,
the dashboard, export, a future `reconcile` — gets nothing. Handoffs **#8 and #9 both have
`next_agent_instructions` NULL**, with the entire 7,000+ character payload sitting in
`reason`; the next agent received it only because session start happens to surface `reason`.
Session #15's `agent_name` is the literal string `"agent_name"`.

**A mitigation, tested under control within one session.** Observation #92 was written with
the long `content` parameter **first** and `tags` after it → `tags` came back **NULL**.
Observation #93 was written with `tags` **first** and `content` **last** → `tags` survived
intact, residue limited to a cosmetic envelope fragment with **no field loss**. Same agent,
same session, same action, same tool, one variable changed.

**And it cannot be repaired through Engram's own surface · VERIFIED.** `update_decision`
accepts exactly `id` and `status` ([`dispatcher-memory.ts:530-536`](../../src/tools/dispatcher-memory.ts)).
**No action in the 83-action surface can write a rationale onto an existing decision**, and
none backfills a swallowed `tags`, `file_path`, `examples` or `next_agent_instructions`. The
34 destroyed fields are recoverable only by direct SQL that bypasses the dispatcher — the
one write path the product does not sanction.

> **This was proven the hard way, twice, while recording this domain's own adoption
> decision.** Ordering the parameters `rationale` then `decision`, the required `decision`
> was swallowed and the call **failed loudly** — `decision string required`. Ordering them
> `decision` then `rationale`, the call **succeeded** and `rationale` came back **NULL**.
> **Decision #27 documents a domain whose central finding is silent record corruption, is
> itself silently corrupted, and cannot be fixed by any action Engram offers.**
>
> The contrast between those two attempts is the whole argument for T2. Identical
> corruption, identical cause, two outcomes: one loud failure the agent noticed and
> corrected in thirty seconds, one silent success that produced a permanently damaged row.

**The mitigation, refined.** The rule is narrower than "put long text last": the parameter
that **follows** a long free-text parameter is the one swallowed. So the safe shape is
**exactly one long free-text parameter per call, placed last, with every short parameter
before it.** Calls with *two* long fields cannot satisfy that constraint and lose one every
time — which is exactly why `record_decision` loses `rationale` and why **handoffs #8 and
#9 both have `next_agent_instructions` NULL.** It is a property of the call shape, not of
the agent, and that is what makes it fixable.

> **This is what closes observation #89.** Convention #7 has been re-litigated **twelve**
> times across six agents and two model families because it states a **verdict** — *"this is
> the agent's syntax error"* — and no re-runnable check. Its verdict was correct the whole
> time and that never helped anyone. What it lacked was a **manipulation with an observable
> outcome**: *put long free-text parameters last, and nothing can be swallowed after them.*
> It fired on my own first write of this session, having read the warning twenty minutes
> earlier — the thirteenth occurrence, by the agent reviewing it.

### 2.4 D9-C3 — STATE.md's binding is imaginary · **VERIFIED**

`generate-state.mjs:40-44` is admirably honest about one half and wrong about the other:

> *"`.gitignore` ignores `.engram/`, so the database is local only and **CI cannot run this
> at all**. The binding is a local git hook (`engram_admin install_hooks`) plus this check."*

The CI half is true. The hook half is **false**. `engram_admin(action:"install_hooks")`
([`dispatcher-admin.ts:358-374`](../../src/tools/dispatcher-admin.ts)) writes a hook whose
entire body appends commit metadata to `.engram/git-changes.log`. It never touches the
database and **never invokes `generate-state.mjs`**. Nothing anywhere does: `state` and
`state:check` exist only as `package.json` scripts, referenced by no hook, no workflow, no
code.

> **This closes observation #91, and reverses its conclusion.** #91 diagnosed a *sequencing*
> problem — STATE.md is committed before the handoff and session-end rows that the next
> agent needs, so it cannot be current by construction. That is real, and FR-D7's inverted
> ordering worked (STATE.md arrived current for me — the first time in four handovers). But
> it is a workaround for a **symptom**. The cause is that **STATE.md is the only generated
> artifact in the repo with no gate of any kind**, and the binding its own generator names
> does not exist. Three consecutive agents followed the process correctly and still handed
> over a misdirecting file, because there was nothing to fail.

### 2.5 D9-C7, C8, C9 — traceability · **VERIFIED**

**C7 — the hook.** There are **three independent, disagreeing** hook installers:
`npm run install-hooks` ([`src/scripts/install-hooks.ts`](../../src/scripts/install-hooks.ts)),
`engram_admin(install_hooks)` ([`dispatcher-admin.ts:358`](../../src/tools/dispatcher-admin.ts)),
and the CLI `--install-hooks` ([`installer/index.ts:457-477`](../../src/installer/index.ts)).
**Only the third writes to the database.** The first two write a text file that is parsed
for *display* at session start ([`git.service.ts:51-93`](../../src/services/git.service.ts))
and never inserted into `changes`. So C7 — quoted by FR-D7 as the product conceding its
rules are unenforced — is true only on a CLI path most agents never take. The concession is
real; the mechanism is mostly unreachable. When it *does* run, it stamps
`session_id` from `SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`
([`index.ts:76-82`](../../src/index.ts)) — the newest open session belonging to **anyone** —
and records no agent at all.

**C8 — session-end stats. Task #63 confirmed, cause corrected.** The diagnosis (exact
`session_id` match) is right; the mechanism blamed (the git hook) is wrong. `tasks.session_id`
is stamped once at creation (`dispatcher-memory.ts:595`) and **`update_task` never touches
it** — VERIFIED by reading its `UPDATE` builder (`dispatcher-memory.ts:610-634`), which sets
`status`, `completed_at`, `priority`, `description`, `claimed_by`, `blocked_by`,
`assigned_files`, `tags`, `updated_at`, and nothing else. So *"I closed 7 tasks and it
reported 0"* happens whenever those tasks were **created in an earlier session** — the
overwhelmingly common case, since tasks are the one record type designed to outlive a
session. No hook required.

**C9 — vertical traceability is absent, not partial.** No `task_id`, `decision_id` or
`change_id` column exists anywhere in the schema. Of ~14 session-linking columns, **exactly
one** is a declared foreign key (`observations.session_id`, `migrations.ts:742`). The only
decision→change association is `affected_files`, a JSON array of **path strings** matched by
`LIKE`/`json_each` (`decisions.repo.ts:108-119`). Decision→task and change→task have no
path at all. `get_file_history`'s "all changes + decisions for a specific file" is a string
join, and it is the *only* traversal that exists.

### 2.6 CI's fourth gate has been red since the commit that added it · **PROVEN**

On a clean tree, every other gate green and 714/714 tests passing:

```
$ npx -y knip@5 --no-progress ; echo "exit=$?"
Unused files (15)   src/tools/{backup,changes,compaction,conventions,coordination,
                    decisions,export-import,file-notes,intelligence,knowledge,
                    milestones,report,scheduler,stats,tasks}.ts
Unused exports (22) · Unlisted binaries (1)
exit=1
```

Not caused by this session — no file was added under `src/`. `git log -S knip --
.github/workflows/ci.yml` shows the step was introduced by **`307d2f2` (FR-0d)**, and
`src/tools/tasks.ts` was already present *at that commit*. **The gate was red on the day it
was written**, and seven domain reviews have merged past it.

**Keeping the files is correct and must not change.** [D10](../DEFERRED-CHANGES.md) records
that they are the only surviving record of validation the v1.6 consolidation silently
dropped — `stats.ts`'s `KNOWN_CONFIG_KEYS` was recovered from there for task #4. The defect
is that a gate was added on top of a known, accepted, *documented* condition it was
guaranteed to flag, with no ignore entry and no note. **Nobody reconciled the new gate
against the state it would report.**

A permanently red gate is functionally switched off: it trains every reader to skip it, and
a genuinely new dead file would land in a list of 15 nobody looks at. That is §3b's
abandonment pattern arriving from the opposite direction to the usual one — not a gate
rubber-stamped green, but one abandoned red.

> **And it narrows a claim seven sessions have made, including mine.** Nothing has ever been
> pushed (decision #19), so **no CI run has ever executed.** Every *"gates green"* in this
> review means build, `surface:check`, `http-surface:check` and the test suite, run locally.
> It has never meant knip. Stated plainly because quiet scope narrowing is exactly what this
> domain exists to catch. Task #79; the fix is an ignore entry, not a deletion.

### 2.7 Scoring the pre-registration

Written into observation #92 before any report landed. **Two of five wrong.**

| # | Prediction | Outcome |
|---|---|---|
| P1 | `state:check` absent from CI (stated as anchor, not scored) | Correct |
| **P2** | ≥1 domain doc names a §5 binding that doesn't exist or never runs — 60% | **WRONG.** All 9 artifacts exist; all 9 run; every doc satisfies kill switch 1. The machinery is **better** than I predicted |
| **P3** | `PRAGMA foreign_keys` never enabled — 75% | **WRONG.** It is on, `database.ts:120`. The finding is stranger: the pragma is correct and nearly moot, because only one declared FK exists to enforce |
| P4 | No change→task/decision linkage column exists — 80% | Correct |
| P5 | `--check` gates are byte-exact and blind to semantic drift — 85% | Correct, and sharper than predicted (§2.1) |

P2 being wrong is the more useful result. It sent me looking for where the machinery
*actually* fails instead of confirming that it does, and §2.1 is what that produced. The
real per-target picture: **13 of 22 §5 rows across the seven docs are `Task`/`Gap` rows with
no artifact** — correctly labelled, not overclaimed, but the charter's "every target names a
mechanism" is satisfied per *doc*, not per *target*.

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| F1 | A tool description drifts from behaviour | Every agent using the tool calls it wrong; compliance collapses | **Totally** — gate green | Yes, once noticed |
| F2 | A parameter is swallowed on write | The field is NULL; text survives inside its sibling | **Totally** | Text yes, field no — 34 already lost |
| F3 | `enforced: true` is read as a guarantee | Decisions ship without rationale; a reviewer trusts a check that isn't running | **Totally** | Yes |
| F4 | STATE.md goes stale | The next agent orients on a false picture — the exact "confident wrong answer that survives" | Partly — nothing reports it | Yes |
| F5 | A task is closed in a later session than it was created | Session end reports 0; the record understates what happened | **Totally** | Data intact, report wrong |
| F6 | A generated artifact is added with no gate | The project gains a document that *looks* authoritative and rots | **Totally** | Yes — **now bound**, §5 |
| F7 | A domain doc cites a binding that cannot run | Kill switch 1 is bypassed; the doc is shelfware | **Totally** | Yes — **now bound**, §5 |
| F8 | A gate is added on top of a condition it will always flag | It is red forever, so it is ignored forever, and real signal lands in a list nobody reads | Loud but **habituated**, which is worse | Yes — task #79 |

**Silence is the pattern, not a coincidence.** Six of seven are fully silent. Every one of
them is a case where the *record* of what happened diverges from what happened, and the
record is the only thing anyone checks.

### 3b — Prior art: how this has gone wrong for other people

Grades are per charter §5. The research agent was explicit about which sources it could and
could not reach directly, and those grades are carried through unchanged rather than
laundered.

**The Post Office Horizon scandal — the strongest finding, and it changes §4.**
Horizon's transaction logs were treated as infallible by investigators, prosecutors and
courts for over a decade. Over 900 sub-postmasters were wrongfully prosecuted and 236
imprisoned on the evidence of a system-of-record that was itself wrong, and whose wrongness
was invisible to everyone who trusted it.
([CCRC](https://ccrc.gov.uk/post-office-horizon-cases/),
[Computer Weekly](https://www.computerweekly.com/feature/Post-Office-Horizon-scandal-explained-everything-you-need-to-know)) — **REPORTED**, corroborated across official and journalistic sources.

> **What it changes.** This project's survival criterion (D9-C1) is *"coupled to something
> that breaks a build."* Horizon says that is **necessary and not sufficient.** A gate that
> regenerates an artifact from a source and diffs it proves only **internal consistency** —
> that the document matches the source. It cannot detect that **the source is lying.**
> `CAPABILITY-SURFACE.md` is perfectly consistent with a schema that advertises three
> parameters it ignores. That is §2.1 stated as a principle, and it is why T1 and T2 below
> are about *second, independent observations* rather than more diffing.

**Traceability's real barrier is perceived ROI, not tooling.** A survey of 55 practitioners
plus 14 interviews found traceability is abandoned even where mandated, because it is
experienced as manual cost with no tangible return
([Requirements Engineering, 2023](https://link.springer.com/article/10.1007/s00766-023-00408-9)) — **REPORTED** (summary level).
Against that, a controlled experiment with 71 practitioners found subjects with *maintained*
trace links were 24% faster and produced 50% more correct solutions
([Mäder & Egyed, EMSE 2015](https://link.springer.com/article/10.1007/s10664-014-9314-z)) — **REPORTED**.
Together they say the value is real **and conditional on currency** — which is an argument
for task #10's `reconcile` being automatic, and against any design that asks an agent to
maintain links by hand.

**Keep a Changelog's own authors concede automation is insufficient** — *"a generated
changelog is raw material at best… machines can draft, but humans curate"*
([keepachangelog.com 1.1.0](https://keepachangelog.com/en/1.1.0/)) — **PROVEN** (read
directly). And a rival spec, [Common Changelog](https://common-changelog.org/), exists
specifically because Keep a Changelog's `Unreleased` section creates merge friction that
discourages upkeep — **PROVEN** (read directly).

> **What it changes.** [D8](../DEFERRED-CHANGES.md) currently says "adopt Keep a Changelog."
> That should not be adopted unexamined: the `Unreleased`-section friction is exactly the
> mechanism by which this project's other hand-maintained registers died, and the format's
> own maintainers say the generated form does not work alone.

**Snapshot/golden-file gates degrade into rubber stamps** — the failure mode where `--update`
is run reflexively. A study of 1,487 JS projects found snapshot files touched in 8.2% of
commits ([ICPC](https://ieeexplore.ieee.org/document/10336316/)) — **REPORTED, LOW
confidence**: fetch returned 403, the figure reached us via search synthesis, and the paper
does not distinguish reviewed from blind updates. A 2023 grey-literature review found *no
prior academic work on snapshot testing at all*
([JSS 2023](https://www.sciencedirect.com/science/article/abs/pii/S0164121223001929)) — so
the "well-documented" failure this project assumed exists is, in hard numbers, largely
**asserted rather than measured**. Stated because charter §7 §3b requires saying when prior
art is absent: on this specific question, **we are closer to being the ones cited than we
assumed**, and confidence should drop accordingly.

**Audit logs that name the wrong actor, unresolved and shipping today.** Zendesk's audit log
attributes automation-caused field changes to whichever human triggered the workflow, and a
practitioner demonstrated the log can be made to record a false actor by renaming an account
around an action; the vendor acknowledged it with no fix timeline
([Zendesk community](https://community.zendesk.com/ideas/the-audit-log-is-not-an-actual-audit-log-due-to-wrong-actor-names-6050)) — **PROVEN** (read directly).
This is D5/task #58's defect in a shipped commercial product.

**Offline attribution in multi-agent systems is close to a coin flip.** Best automated
methods reach 53.5% accuracy identifying the responsible agent and 14.2% for the failure
step, with annotators themselves disagreeing on ~20% of ground-truth labels
([arXiv:2505.00212](https://arxiv.org/pdf/2505.00212)) — **REPORTED, LOW confidence**, PDF
not read directly. If it holds, it says D5's attribution defect cannot be fixed
retrospectively — provenance must be recorded correctly at write time or not at all, which
is T2's argument.

**Inverse scaling under distractors.** Frontier reasoning models show up to 80% performance
drops with contextual distractors present, and *more* test-time reasoning made it **worse**;
prompting, context engineering, SFT and outcome-only RL all failed to fix it
([arXiv:2601.07226](https://arxiv.org/abs/2601.07226)) — **REPORTED, HIGH confidence**
(fetched and read directly; arXiv was not blocked for this URL, unlike FR-D7's session).

> **What it changes.** It contradicts the implicit assumption behind a growing `STATE.md`
> and a growing recall payload — that an agent given more state will reason its way to
> correctness. FR-D7 measured session start at 59,705 tokens against a documented ~730.
> This is direct experimental evidence that the cost is not only tokens.

**Goodhart on process metrics: anecdote only.** The best available are named-practitioner
accounts — a coverage bonus that produced >25% of tests with no assertions at all, and a
100% mandate walked back to 80% then retracted
([Optivem Journal](https://journal.optivem.com/p/code-coverage-targets-recipe-for-disaster)) — **REPORTED**, secondhand, no controlled study found. Relevant to §5: it is the argument
against ever making "number of bindings" a target.

---

## 4 — Target and rejected alternatives

### T1 — The capability surface must render parameter descriptions · task #75

Descriptions are the part of the contract an agent reads at the moment it chooses a
parameter. They are currently the only part of the schema with **no** gate.

**Rejected — a lint rule requiring every parameter to have a description.** It enforces
*presence*, not *truth*, and FR-D7's defect was a description that was present and wrong.
It would have passed.

**Rejected — assert specific description strings in a test.** That is a register maintained
by hand, restated rather than derived, and charter §2 rejects exactly this: it fails on
every legitimate edit and gets switched off within a week.

**Chosen: render them into the generated artifact.** Then a changed description is a **diff
in review**, which is the weakest useful mechanism and the only one that scales. It does not
make descriptions *true* — nothing can, from inside the same source — but it makes a change
to them visible, which today it is not. Honest about its ceiling: this is the internal-
consistency gate Horizon says is necessary and insufficient. T2 is the other half.

### T2 — Malformed records must be rejected on write, not audited afterwards · task #77

A dispatcher-level validator: any string parameter containing `<parameter name=`, a leaked
call-envelope tag, or a closing tag naming a sibling parameter of the same action is a
**malformed call**. Return an error naming the swallowed field.

**Rejected — repair it silently.** Strip the fragment, re-parse the swallowed parameters,
store the intended row. Tempting, and wrong: the agent learns nothing, the call *appears* to
succeed, and the store fills with rows reconstructed by heuristic. That is the confident
wrong answer that survives — the failure mode this whole review is organised around.

**Rejected — keep it as convention #7 and write it more forcefully.** Twelve occurrences
across six agents and two model families, including one by the agent who had just diagnosed
it and written the section about it. This is not a discipline problem, and treating it as
one is what FR-D7 measured at 21.1%.

**Rejected — detect it in a nightly job over the store.** That is what
`measure-record-corruption.mjs` already does, and it is the right instrument — but detection
after the fact cannot restore a NULL column, and §3b's attribution finding says
retrospective reconstruction is unreliable in principle. **Provenance must be right at write
time or not at all.**

**Consequence accepted:** this rejects calls that "look fine" to an agent, and the error
message must therefore be excellent — it must name the field that was lost and state the
fix (*one long free-text parameter, last*), or it will read as Engram being broken.

**Second-order target — the surface should not require an impossible call.** `record_decision`
(`decision` + `rationale`) and `engram_session(handoff)` (`reason` +
`next_agent_instructions`) each declare **two** long free-text parameters, and §2.3 shows
that shape loses one every time. A validator that rejects the call without fixing the shape
just converts silent loss into a wall. Either the second field moves to a follow-up call, or
these actions accept a single structured object. Folded into task #77 rather than split out,
because shipping the validator without it would be the worse outcome.

**And a repair path is required, not optional.** No action can currently backfill a
destroyed field. T2 is prevention; the 34 fields already lost need an `engram_admin` repair
action or they stay lost.

### T3 — `enforced` must enforce, or be renamed · task #76

**Rejected — wire every convention into a blocking check.** Conventions are prose
("Identify risks before committing to estimates"). Most are not machine-checkable, and
pretending otherwise produces the vacuous gates §3b's Goodhart material describes.

**Chosen: split the concept.** Rename the display semantics to `active`/`surfaced`, and
reserve `enforced` for conventions that name a mechanism — mirroring FR-D7's rule registry,
which made "does a mechanism exist?" a step that cannot be skipped. A convention that
enforces nothing is still worth surfacing; it is not worth calling *enforced*, because a
reviewer who trusts the word stops checking.

### T4 — STATE.md gets a real gate, or stops claiming currency · task #74

CI **cannot** gate it: the source is `.engram/memory.db` and `.gitignore` excludes it. That
is not a bug to fix — the database is genuinely local. So there are three honest options and
one dishonest one.

**Rejected — commit the database.** It carries `machine_id`, `http_token` and `instance_id`,
and charter §11b.1 already sanitises a fixture precisely because the live store cannot be
committed.

**Rejected — leave it as-is and rely on ordering discipline.** FR-D7's inverted sequence
worked, and it worked because one agent remembered. Three previous agents also did
everything right and still handed over a misdirecting file. That is a workaround; charter
§7.5 is explicit that it is not a binding.

**Chosen: a `pre-commit` hook that regenerates STATE.md when `.engram/memory.db` is newer,
plus an honest header.** The hook is local — which is exactly the right scope, because the
staleness is local. And the header must stop asserting a binding that does not exist. If
the hook is judged too invasive, the fallback is **explicitly the honest one**: keep
`state:check` manual and **delete the "never hand-edit / kept true by" claim**, because an
artifact that overstates its own guarantees is Horizon in miniature.

### T5 — `tasks.session_id` must record where work happened · task #78

Session end under-reports because a task's `session_id` is frozen at creation. **Rejected —
update `session_id` on close**, which merely moves the lie: the row would then misreport
where the task was *created*. **Chosen: count by event, not by row ownership** — session-end
statistics should read from `changes`/`audit_log` entries stamped in that session, or a
`completed_in_session` column should be added. Feeds task #10's vertical traceability rather
than competing with it.

### T6 — Do not adopt Keep a Changelog unexamined · updates D8

§3b changed this one. [D8](../DEFERRED-CHANGES.md) proposes Keep a Changelog. Its own
maintainers say the generated form is "raw material at best", and a rival spec exists
because its `Unreleased` section creates merge friction. **Chosen: evaluate Common Changelog
against it in the master plan**, and require whichever is chosen to record removals — the
`lock_file` incident (D9-C12) is the reason the section exists at all. Not decided here;
flagged so the master plan does not inherit an unexamined choice.

---

## 5 — Binding

**[`tests/process/anti-drift.test.ts`](../../tests/process/anti-drift.test.ts)** — 19 tests, passing.

This domain's binding has to do something the others did not: bind **the fact that a
mechanism exists**. Charter §7.5 and kill switch 1 have been rules since 2026-08-02, and
until now nothing enforced either — they were replayed, which is precisely the condition
FR-D7 measured at 21.1%.

1. **The generated-artifact registry.** Every file carrying a `<!-- NAME:GENERATED -->`
   banner — **discovered by walking `docs/`, never restated** — must be classified as
   `GATED`, naming a CI step resolved by reading `.github/workflows/ci.yml`, or `UNGATED`
   against a task with a stated reason. **A fourth generated artifact cannot ship without
   someone deciding, in review, whether a mechanism keeps it true.** This is the assertion
   that caught STATE.md.
2. **Domain-doc bindings resolve.** Every `tests/**.test.ts` path cited in any
   `docs/foundations/NN-*.md` must exist **and** be matched by vitest's `include` glob, read
   from `vitest.config.ts` rather than assumed. A doc may not cite a binding that cannot
   run. **This makes kill switch 1 mechanical for domains 8 and 10, which are not yet
   written.**
3. **Convention enforceability.** Every packaged PM convention must be classified as
   `UNENFORCED` against a task or name a mechanism that is resolved in source.
4. **Two pinned `DEFECT`s**, per the D3/D4/D6/D7 precedent: STATE.md is ungated (#74), and
   the surface generator holds exactly one `.description` reference (#75). Fixing either
   **breaks the suite**, forcing the assertion to be edited in the commit a human reviews.

**Proven to fail, not assumed to.** A binding that cannot fail is not a binding, so it was
tested against the condition it exists to catch:

```
$ printf '<!-- FRD9_PROBE:GENERATED -->' > docs/frd9-probe.md
$ npx vitest run tests/process/anti-drift.test.ts
  × every :GENERATED file is in the registry
$ rm docs/frd9-probe.md
  Tests  19 passed (19)
```

It also caught **itself**. The first version of the detector matched the `:GENERATED`
marker anywhere in a file, and **this document** tripped it — because §5 describes the
marker in prose and shows it in a shell example. That is the orchestration guide's own
warning arriving in practice: *beware greps that match the vocabulary of a problem rather
than the problem.* A banner is now required to stand alone on a line, which all three real
banners already do. Worth recording because it is the same class as the false-positive
"leak check" the guide documents, found the same way — by running the thing.

**What it deliberately does not bind.** The 51 corrupted records. That state lives in
`.engram/`, which CI cannot see; asserting it would produce a test that is green on a fresh
clone for the wrong reason. `measure-record-corruption.mjs` is the **instrument** — re-run
it, do not assert it. This is the same line FR-D7 drew for compliance, and drawing it
consistently matters more than the extra coverage would.

---

## 6 — Kill switch

Written before attachment forms.

1. **If the registry in §5 is edited more often than the artifacts it classifies**, it has
   become the hand-maintained register charter §2 rejects, and it should be deleted rather
   than maintained. Trigger: three consecutive commits touching the registry without adding
   a generated artifact.
2. **If T2's validator rejects a well-formed call even once**, revert it immediately. A
   write path that refuses correct input is worse than one that stores corrupt rows —
   corruption is recoverable in the text, a refused write is not written at all.
3. **If T1 makes `CAPABILITY-SURFACE.md` churn on every unrelated commit**, the descriptions
   are too volatile to gate and the target is wrong. Render them, but drop them from the
   `--check` comparison and say so in the file.
4. **If the next domain doc's §5 is written to satisfy this test rather than to bind
   anything** — a token test file cited to pass assertion 2 — the mechanism has become a
   target and §3b's Goodhart material applies. Delete assertion 2 and go back to review.

---

<!-- FOUNDATIONS_D9:COMPLETE -->
