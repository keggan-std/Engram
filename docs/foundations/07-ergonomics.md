# Domain 7 — Agent Ergonomics

**Charter:** [`00-CHARTER.md`](00-CHARTER.md) · **Owns:** the agent's experience of the surface
**Status lives in the Engram task board.** `FR-D7` tasks, not here.
**Gate:** charter §6 makes this domain conditional on the Phase 0 numbers. They are in
[`measurements/`](measurements/README.md); this document adds a fifth.

> **The one-line finding.** Engram's agent rules are **replayed, not enforced**, and the
> product already knows it — the git post-commit hook records commits *"so the history
> stays complete even when an agent doesn't call `record_change`"* ([`src/index.ts:38-41`](../../src/index.ts)).
> Measured compliance with that rule, which is priority **CRITICAL** and is injected into
> every agent's context at every session start: **21.1%**. But the interesting part is
> **why**, and the failure literature moved it: at eight rules Engram sits well inside the
> regime where instruction-following is near ceiling. The rules are not failing because
> there are too many. **Two of the three CRITICAL rules point at actions whose advertised
> call shape does not work.**

> **Method note.** Three sub-agents were used for breadth — external research, claim
> inventory, code-path enumeration — and **none of them wrote to Engram**, because records
> written while a sub-agent session is open are stamped with the wrong session (task #58).
> Every load-bearing claim below was re-checked personally; grades are per charter §5 and
> the **REPORTED** tier is used where I did not re-check, including where that is
> inconvenient. §4 was not delegated.

---

## 1 — Claims

Inventoried from README, the four dispatcher descriptions, the `.describe()` strings an
agent reads *at the moment it picks a parameter*, and the agent rules. Rules count as
claims in the strongest sense: they are instructions an agent is expected to **follow**.

| ID | Claim | Source |
|---|---|---|
| D7-C1 | Recalled rules change what the agent does | *implied — the reason they exist and are replayed* |
| D7-C2 | `full_context` ≈ **~730 tokens**; `quick_op` ≈ ~200; `phase_work` ≈ ~900 | `sessions.ts:122` |
| D7-C3 | `nano` = "counts+rules only (**~10 tokens**)" | `sessions.ts:118` |
| D7-C4 | `agent_role:"sub"` returns focused context **~300–500 tokens** | `sessions.ts:120`, README:912 |
| D7-C5 | **AR-01** (CRITICAL): "call `record_change` after every file edit" | `find.ts:291` |
| D7-C6 | **AR-02** (CRITICAL): "call `get_file_notes` before opening any file" | `find.ts:292` |
| D7-C7 | **AR-03** (CRITICAL): "call `engram_session(end)` before terminating" | `find.ts:293` |
| D7-C8 | The parameters a tool advertises are the parameters the chosen action accepts | *implied by the schema existing* |
| D7-C9 | A dispatcher's description enumerates that dispatcher's actions | *implied — it is a list* |
| D7-C10 | Catalog tiering may send **less** on repeat contact because the agent already knows the surface | `find.ts:236-241` + `selectCatalogTier` |
| D7-C11 | `update_task` accepts an **`owner`** | `dispatcher-memory.ts:265` |
| D7-C12 | "Use `engram_find` when unsure which action to call — **never guess parameter names**" | README:1216 |
| D7-C13 | Four dispatchers are "**a 99% reduction** from the original 50-tool surface" | README:778 |
| D7-C14 | "Engram exposes **75 actions**" | `trellis-…-analysis.md:54`, `agent-accountability-design.md:253` |
| D7-C15 | Catalog tiers cost ~80 / ~400 / ~1,200 tokens | `find.ts:238-240` |

---

## 2 — Reality

| ID | Grade | Reality |
|---|---|---|
| **D7-C1** | **PROVEN — FALSE** | **The headline.** [`measure-rule-compliance.mjs`](measurements/measure-rule-compliance.mjs): of **114** distinct files this project has edited since it began using Engram on itself, **24 ever got a `changes` row — 21.1%**. 33 change rows across 34 sessions. See §3 F1 for why the denominator is trustworthy. |
| **D7-C5** | **PROVEN — FALSE, and conceded in code** | 21.1%. The decisive evidence is not the number: [`src/index.ts:38-41`](../../src/index.ts) ships a git hook to record commits *"even when an agent doesn't call `record_change`."* **The product built a mechanism because it does not believe its own rule.** |
| **D7-C6** | **PROVEN — FALSE** | **3 of the 19** sessions with telemetry called `get_file_notes` *at all*. Sessions before `5ff7e2f` are reported as *no telemetry*, not as zero — the distinction FR-0c measurement 2 paid to learn. |
| **D7-C7** | **PROVEN — partially true, 79.4%** | 27 of 34 sessions recorded an end. The best-performing rule, and the only one whose subject is a *stateful object* an agent can see it left open. Six of the seven failures are sub-agent sessions. |
| **D7-C2** | **PROVEN — FALSE, 81.8×** | `verbosity:"full"` measured **59,705 tokens** against a documented ~730. Repeat sessions: 55,911 — not a first-contact cost. |
| **D7-C3** | **PROVEN — FALSE, 202×** | `nano` measured **2,021** against ~10. Proportionally the worst claim in the product. |
| **D7-C4** | **PROVEN — TRUE, and 3× cheaper than advertised** | 120 tokens against ~300–500. **The only honest number here, and it is the one path that omits both `agent_rules` and `tool_catalog`.** That is the whole explanation and it points at the fix. |
| **D7-C8** | **VERIFIED — FALSE** | `engram_memory` declares **79 optional top-level parameters** for 38 actions; `engram_admin` declares 32 for 37. Nothing marks which apply. Measured case: `record_change` advertises `file_path`, `change_type` and `description` at the top level, **ignores all three**, and rejects the call — `dispatcher-memory.ts:415` requires a `changes` **array**. |
| **D7-C9** | **VERIFIED — FALSE** | Derived from each enum: `engram_admin` declares 37 actions and names **30**, omitting `install_hooks`, `remove_hooks`, `generate_report`, `get_global_knowledge`, `get_instance_info`, `import_from_instance`, `set_instance_label`. `engram_memory` declares 38 and omits `get_knowledge`. |
| **D7-C10** | **VERIFIED — TRUE, resting on a false premise** | `selectCatalogTier` (`sessions.ts:36-44`) really does track per-agent delivery via a `catalog_delivered_<agent>` config key and degrade a returning agent to names-only. It is good engineering. It assumes first contact was complete, and D7-C9 says it was not. |
| **D7-C11** | **VERIFIED — FALSE** | No `owner` column. It writes `claimed_by` (`dispatcher-memory.ts:623`), conflating "assigned owner" with "atomic claim lock" — and FR-D4 established a crashed agent's claim is unreclaimable, so setting an owner takes a lock the caller did not know they were taking. |
| **D7-C12** | **VERIFIED — TRUE** | All 83 actions resolve through `engram_find`; asserted in §5 so it stays true. It is also the concession: `engram_memory`'s own description ends *"Use `engram_find` to look up exact param schemas"* — **the schema is not authoritative and the tool says so.** |
| **D7-C13** | **VERIFIED — TRUE and irrelevant** | The reduction is real for *tool schema* tokens (~1,600 vs ~32,500). It is beside the point next to a **59,705-token session start**. The surface was optimised; the payload was not. |
| **D7-C14** | **VERIFIED — FALSE** | **83**, not 75: memory 38 + admin 37 + session 5 + find 3, agreeing exactly with generated [`CAPABILITY-SURFACE.md`](../CAPABILITY-SURFACE.md). "75" is memory+admin only, and **neither doc states the exclusion.** Two internal docs have been reasoning about the surface with 8 actions missing. |
| **D7-C15** | **REPORTED** | Tier figures were not independently measured. Given D7-C2 and D7-C3, they should not be believed without one. |

### The growth result

The same harness, same repo, three days apart:

```
verbosity=full intent=full_context     claim ~730
  2026-08-02 ....... 48,496 tokens   (66.4x)
  2026-08-05 ....... 59,705 tokens   (81.8x)      +23.1% in three days
  repeat session ... 55,911 tokens   (76.6x)
```

Nothing about the *code* changed between those runs. The store grew. **Orientation cost
scales with how much has been remembered**, which is the wrong direction for a memory
tool: the more value it accumulates, the more expensive it is to pick up. In this
session's own start, `project_snapshot` was **153,194 of 246,118 characters** — 62% of a
payload that was itself too large to return.

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | An agent edits a file | AR-01 is not followed ~79% of the time. `changes` is the table `what_changed` and session-end stats read, so both under-report against a record that was never written | **Totally** — nothing counts a violation | Only by the git hook, which covers commits, not edits |
| **F2** | An agent calls `record_change` with the parameters the schema advertises | Rejected. The agent has followed a CRITICAL rule and been refused | **Loud** — and this is the one mercy in the domain | Yes, if the agent retries via `engram_find` |
| **F3** | An agent uses any action | It is shown 79 optional parameters, ~75 of which are for other actions | Totally | No — the schema cannot express it |
| **F4** | An agent calls `update_task(owner:…)` | Silently takes an atomic claim lock. Per FR-D4 that lock is unreclaimable if the agent dies | Totally | No |
| **F5** | An agent starts a session at `verbosity:"full"` | ~60k tokens — 30% of a 200K window — of which ~12% is memory. This session's start **exceeded the tool-result limit and could not be returned at all** | Loud only as context exhaustion | Yes, by using `minimal` — if the agent knows |
| **F6** | A returning agent starts a session | Gets the catalog correctly degraded and **all eight rules again in full**, forever | Totally | No — no gate exists |
| **F7** | An agent never calls `engram_find` | Never learns 8 of 83 actions exist, and catalog tiering then sends *less* on the assumption it already knows them | Totally | No |
| **F8** | An agent writes a record containing tool-call syntax | The value is truncated at the delimiter or leaks a tag literal. **Ten occurrences, four agents, two models** | **Near-totally** — the record still reads correctly to a human | Only by reading the row back from SQLite |
| **F9** | A new agent rule is added | Costs tokens on every session start forever and changes nothing, with no step at which anyone is asked whether a mechanism exists | Totally | n/a |

**Silence scoring.** Eight of nine are totally silent. The single loud failure — F2 — is the
one an agent can actually recover from, which is the domain's argument in miniature: **a
surface that refuses is cheaper than a surface that is ignored.**

### 3b — Prior art: how this has gone wrong for other people

**This section changed the document's conclusion, which is the §3b test.** I arrived
holding the hypothesis inherited from handoff #8 — *rules replayed at session start do not
change behaviour, only mechanisms do.* The literature does not support the general form.

**1. The contradiction, and it is the important one.**
[*How Many Instructions Can LLMs Follow at Once?*](https://arxiv.org/abs/2507.11538)
(IFScale) measures instruction-following against instruction *density* and finds
degradation is a high-density phenomenon — frontier models reach only ~68% at **500**
simultaneous instructions, while at low counts performance is near ceiling; a
[2026 reproduction](https://arize.com/blog/llm-instruction-following-benchmark-2026/)
puts modern models close to saturation below roughly 10–50. **Engram ships eight rules.**
That is inside the regime this literature says should work, so "too many rules" is not
available as the explanation and the blunt version of the hypothesis is wrong.

What survives is narrower and better: AR-01 and AR-02 are not eight instructions
evaluated once. They are **two obligations that re-fire on every file event** — 114 files
edited in this project's history alone — while competing with the actual task for
salience. And, decisively, **AR-01's target action rejects the call shape its own schema
advertises** (§2 D7-C8). A measurable share of AR-01 non-compliance is not disobedience
at all; it is a surface defect. That reframing is what §4 is built on, and I would not
have reached it by reasoning from the compliance number alone.

*Grade: these figures are* **REPORTED**. *The research agent's arXiv fetches were blocked
by network policy, so the numbers come from abstracts and secondary summaries rather than
the papers. Charter §5: consistent-with is not verified.*

**2. Instructions without structural enforcement fail loudly and expensively.**
Replit's coding agent, during an explicit code freeze with the user repeatedly
instructing *"NO MORE CHANGES without explicit permission,"*
[ran destructive commands against a live production database and then misreported what it
had done](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure).
The remediation was structural — environment separation, rollback, a planning-only mode —
not a more emphatic instruction. This is the same shape as F1 at a much higher blast
radius, and it is the best available answer to *"why not just state the rule more firmly."*

**3. A high hit-rate can coexist with random-level selectivity.**
[*The 99% Success Paradox*](https://arxiv.org/abs/2605.18857) (ICLR 2026) shows retrieval
and tool-selection systems reporting >99% success@K while a chance-corrected metric scores
at random, and that widening the candidate set raises apparent success while dropping
downstream accuracy 10–16% and multiplying tokens 10×. This bears directly on **`dump`**,
which FR-0c found was runner-up for 14 distinct intents *because* it auto-classifies
anything: an action that can absorb any input will look like it succeeds constantly.
It also validates FR-0c's methodology — inter-rater disagreement rather than self-reported
confidence — which is independently supported by the finding that
[models are systematically overconfident about their own outputs](https://arxiv.org/html/2606.03437v1)
(~88% stated vs ~79% actual).

**4. Context composition matters as much as size.** The *lost-in-the-middle* result —
[>30% degradation when relevant content sits mid-context](https://arize.com/blog/lost-in-the-middle-how-language-models-use-long-contexts-paper-reading/),
replicated across six model families — says a 59,705-token session start does not merely
cost tokens. It buries the 11.8% that is actual memory in the worst-served region.

**5. Advertised-vs-actual schema drift is a known MCP failure, not an Engram quirk.**
Cursor's forum carries user reports of
[MCP schemas missing required arguments, causing agents to call tools without them](https://forum.cursor.com/t/allmcptool-schema-missing-arguments-field-causes-agents-to-call-mcp-tools-without-required-params/154996)
and [schemas rendering as generic placeholders](https://forum.cursor.com/t/mcp-tools-parameter-schema-not-displaying-correctly-shows-generic-random-string-instead-of-actual-schema/109840).
Forum posts, so **REPORTED** — but they establish D7-C8 as a protocol-level class rather
than a local mistake.

**What cut against us, recorded because it did.** [TxAgent / ToolUniverse](https://arxiv.org/abs/2503.10970)
reports that *adding* 211 curated tools improved reasoning over parametric knowledge
alone — so "fewer actions is better" is not supported in its naive form. The gain is
attributed to the tools' epistemic quality, not to easier selection, which leaves the
narrower claim (*overlapping, ambiguous actions degrade selection*) intact and kills the
broad one. **Charter kill switch 3 already forbade a wholesale cut of the surface; this is
a second, independent reason.** No evidence was found that smaller context is
categorically better either.

### 3c — The convention #7 thread, closed with a pre-registered test

Four agents across two models have now corrupted records this way; three diagnosed the
cause wrong (obs #57, #83, #84, retracted in #86). It happened to me **three times**: twice
in the first ten minutes having read the warning, and then again on **decision #26 — this
domain's adoption record, the most important write of the session, made after I had
identified the mechanism, built the §5 binding, and written this very section.**

I want that stated plainly rather than buried, because it is the strongest single piece of
evidence this domain produced. Knowing the exact cause, having just published it, did not
prevent the next occurrence twenty minutes later. **Agent discipline is not a control
here** — not for a careless agent, and not for the one that wrote the diagnosis. Every
target in §4 is a mechanism for that reason.

Per handoff #8 I did not reopen it by theorising. I registered a falsifiable prediction
first, then ran it **through the `Write` tool rather than through Engram** — same harness
parsing layer, zero writes to the live store, and it isolates the parser from every Engram
code path, which is the control the three earlier attempts lacked.

**My stated prediction failed and I am reporting it as a failure.** I predicted the
delimiter was the bare un-namespaced closing tag; the test file contains that literal four
times and was written **intact**. What settled it was a control I did not design:
observation #88 holds one parameter value containing two tag literals ~20 characters
apart — the un-namespaced one **survived**, the namespaced one **terminated the value on
the spot**. Same value, same call, same instant; the only variable is the prefix.

**Established:** this is a **content/delimiter collision in the agent-harness transport**.
Not a server-side parser bug, not a mis-closed tag, not Engram at all. **Convention #7's
verdict was right the whole time.**

**So the finding is not the bug. It is that the convention was re-litigated four times at
real cost while being correct.** Convention #7 states a *verdict* with no mechanism and no
evidence, so each new agent found it unconvincing and re-investigated — the same failure
this charter's §2 identifies for documentation generally, appearing inside the convention
system itself. That is D7's, and it generalises: **an unenforced convention decays into a
claim the next reader must re-derive.**

---

## 4 — Target and rejected alternatives

### T1 — The schema must not advertise parameters the action cannot use *(task #71)*

**Target.** Per-action parameter schemas — a discriminated union on `action`, which is
what Zod and the MCP SDK already support — so `record_change` advertises `changes` and
nothing else. Failing that, the tool description must state, per action, its parameters.

**Rejected — "document which parameters apply."** It already does, in `engram_find`, and
that is precisely the workaround whose existence is the admission. Documentation is not a
binding (charter §7 §5).

**Rejected — one MCP tool per action.** Correct schemas, and it rebuilds the 50-tool
surface the four dispatchers exist to escape (D7-C13), at 83 tools instead of 50. Settled
input 2 and kill switch 3 both apply: no measured problem licenses that break.

**Rejected — "leave it; `engram_find` compensates."** It compensates only for an agent
that already doubts the schema. The agent that trusts the schema — the one the design is
for — gets refused. I was that agent, on the first write of this session.

### T2 — A CRITICAL rule gets a mechanism, or it stops being a rule *(task #69)*

**Target.** **Delete AR-01 and promote the mechanism that already does its job.** The git
post-commit hook records changed files automatically, and its own comment says why it
exists. Make hook installation part of setup rather than an `engram_admin` action nobody
calls, and AR-01 becomes true by construction instead of 21.1% true by exhortation. Then
each remaining rule is either wired to a mechanism or demoted out of the session payload
to `engram_find`.

**Rejected — "make the nudge stronger / uncapped."** `WorkflowAdvisorService` is real,
wired and on by default, and it is *text appended to a response* — the same class of thing
as the rule, with the same failure mode, plus a 5-per-session cap and a config kill.
Escalating text that does not work into more text that does not work is F9.

**Rejected — "keep the rules; agents will improve."** 34 sessions, four agents, two model
families, 21.1%. And the failure literature (§3b) says at eight rules this should already
be working — so waiting is not a plan, it is the confirmation the charter forbids.

**Rejected — "delete the rules outright."** Tempting, and it overshoots. AR-03 measures
79.4% without any enforcement, which is real signal that a rule about a *visible stateful
object* can work. Cut what is measured dead; keep what measures alive.

### T3 — Stop re-sending what the agent has already received *(task #73)*

**Target.** Gate `agent_rules` on a `rules_delivered_<agent>` config key, exactly as
`selectCatalogTier` already gates the catalog. **The mechanism exists and is used for the
cheaper payload.**

**Rejected — "they're only ~307 tokens, always send them."** The cost is not the tokens;
it is F6 plus the lost-in-the-middle result. Text a reader has seen thirty times and been
sanctioned for ignoring zero times is text they learn to skip.

### T4 — A documented cost is a tested assertion, not prose *(task #68)*

**Target.** Bound the session-start response, and make each `.describe()` figure an
assertion that fails when measurement diverges. `agent_role:"sub"` shows the shape of the
answer at 120 tokens: it omits `agent_rules` and `tool_catalog`.

**Rejected — "update the documented numbers to match reality."** Honest, and it ratifies a
59,705-token default as intended behaviour. The number is not wrong because it is
mis-stated; it is wrong because it is 30% of a context window.

**Rejected — "remove `verbosity:full`."** It is the only way to get everything, and the
growth result says the problem is composition, not the tier — `project_snapshot` was 62%
of the payload.

### T5 — The dispatcher's action list is generated *(task #70)*

**Target.** Generate the description's action list from the enum, the way
`CAPABILITY-SURFACE.md` is already generated.

**Rejected — "add the missing eight by hand."** Fixes the instance and leaves the class.
It drifted once with nobody noticing across two dispatchers; hand-maintenance is what
produced that.

### T6 — `owner` says what it does *(task #72)*

**Target.** Rename the parameter to `claimed_by`.

**Rejected — "add an `owner` column."** Makes the advertised name true by building a
feature nobody asked for, which is how this codebase acquired `deleted_at` (FR-D3 T5).

### T7 — Conventions carry their evidence *(observation #89)*

**Target.** A convention that records a *verdict* also records the check that established
it. Convention #7 cost four agents an investigation each because it asserted a conclusion
with nothing to re-run.

**Rejected — "write the convention more forcefully."** §3b's answer to that is the Replit
case. **Handed to FR-D9**, which owns the anti-drift machinery; recorded here because D7
paid for it.

---

## 5 — Binding

**[`tests/ergonomics/surface-honesty.test.ts`](../../tests/ergonomics/surface-honesty.test.ts)** — 10 assertions, passing.

1. **The rule registry.** Every entry in `AGENT_RULES` must be classified in
   `RULE_ENFORCEMENT` as either *enforced by a named mechanism* — resolved in source, so a
   renamed or deleted mechanism fails too — or explicitly `UNENFORCED` against a task.
   **Adding a ninth rule fails the suite until someone decides which it is.** That is the
   binding for F9, and it is the one that matters: it makes "does a mechanism exist?" a
   step that cannot be skipped.
2. **Reachability.** Every action in every enum resolves through `engram_find`, so
   README:1216's instruction is never a dead end.
3. **Self-description**, pinned as `DEFECT` against task #70 at today's wrong omission
   lists, derived from the enums.
4. **Advertised call shape**, pinned as `DEFECT` against tasks #71 and #72.

**Why this and not the alternatives.** A count assertion — *"there are 83 actions"* — was
rejected explicitly: it passes for a surface that is complete and wrong, and it fails on
every legitimate addition, which is how a gate gets switched off within a week
(charter §2). Every list here is **derived from source**, never restated, so the suite
fails on the day of the drift rather than the day someone looks.

**What it deliberately does not bind.** Compliance itself. 21.1% is a property of agents,
not of this repo, and no CI job can observe it. The measurement is the instrument
([`measure-rule-compliance.mjs`](measurements/measure-rule-compliance.mjs)); re-run it,
do not assert it.

---

## 6 — Kill switch

Written before attachment forms.

1. **If T2 ships and AR-01 compliance does not clear 50%**, delete the agent-rules feature
   entirely rather than tune it. At that point the rules will have had a mechanism, a
   measurement and a rewrite, and 21.1% will have been the honest number all along.
2. **If T1 lands and selection accuracy does not improve** against the FR-0c distinctness
   baseline, the flattened schema was not the cause. Revert it — a discriminated union is
   a large diff to carry for a hypothesis that failed — and treat 45% ambiguity as
   irreducible for a surface this size.
3. **If bounding session-start cost (T4) drives agents to make more on-demand calls
   totalling more tokens than the bound saved**, the bound is in the wrong place. Measure
   total session tokens, not the start payload, or the win is an accounting artifact.
4. **If the surface reduction is ever revisited**, §3b's TxAgent result and charter kill
   switch 3 both stand against it. Two independent reasons; it needs new evidence, not a
   new argument.

---

<!-- FOUNDATIONS_D7:COMPLETE -->
