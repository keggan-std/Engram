# Domain 8 — Codebase & Maintainability

**Date:** 2026-08-05 · **Status:** Complete · **Engram decision:** #28
**Charter:** [`00-CHARTER.md`](00-CHARTER.md) §6 domain 8 — *"Layering, dispatcher size,
dead code, conventions, human maintainability, what belongs in this repo at all.
Owns 'can a person still work on this'."*

> **This document does not carry status.** Progress lives in the Engram task board.

---

## 0 — The finding, in one paragraph

`ENGRAM_CONSTITUTION.md` states four architectural laws. **None of them has any
enforcement mechanism whatsoever** — there is no linter in this repository, of any
kind. Three of the four are obeyed anyway, across seven agents and the whole review.
The fourth is violated by the live product path at a **93% rate**, and it is the one
the constitution singles out with the words *"The one clean separation in the
codebase. Preserve it."*

That asymmetry is the whole domain. It is not a story about discipline failing. It
is a story about **which rules discipline can carry and which it cannot** — and the
answer is legible in advance from the shape of the rule, which means the mechanism
can be aimed rather than sprayed.

### 0.1 A note on this session's evidence

FR-D8 is one of the two **pre-registered suppression arms** (charter §10.4,
decision #25). The session opened with `intent:"quick_op", verbosity:"minimal"` and
**no Engram recall action was called at any point**. Every number below comes from
the source tree or an executable check.

That withholding was **partial, and the leak is recorded as observation #99** rather
than smoothed over: `docs/STATE.md` is generated *from Engram's memory* and delivered
the latest decision, the last three sessions, five gating tasks and eight prior
observations as prose. The arm suppressed the *channel*, not the *content*. Read
§10.4's comparison accordingly.

---

## 1 — Claims

What this project promises about its own maintainability. `D8-C1`…`D8-C9`.
Explicit claims are quoted; implied ones are marked **(implied)**.

| ID | Claim | Where |
|---|---|---|
| **D8-C1** | *"`repositories/` owns SQL. `services/` owns logic and I/O. `tools/` owns MCP dispatch."* — **"The one clean separation in the codebase. Preserve it."** | `ENGRAM_CONSTITUTION.md:58` |
| **D8-C2** | *"Never write to stdout."* Logging goes to `console.error` | `ENGRAM_CONSTITUTION.md:59` |
| **D8-C3** | *"All responses go through `src/response.ts`."* | `ENGRAM_CONSTITUTION.md:60`, `CONTRIBUTING.md:160` |
| **D8-C4** | *"Array/number params need `coerceStringArray()`/`coerceNumberArray()`."* | `ENGRAM_CONSTITUTION.md:61` |
| **D8-C5** | *"Add it to `find.ts`'s `MEMORY_CATALOG`/`ADMIN_CATALOG` too — otherwise it is unreachable in universal mode."* | `ENGRAM_CONSTITUTION.md:424` |
| **D8-C6** | CI detects dead code — *"Check for dead code"* runs `knip` | `.github/workflows/ci.yml:77-78` |
| **D8-C7** | The file census: **90 files, 17,560 lines, ~77% reachable** | `ENGRAM_CONSTITUTION.md:450` |
| **D8-C8** | *"There is no enforced coverage gate today"* | `CONTRIBUTING.md:257` |
| **D8-C9** | **(implied)** A contributor can determine whether their change complies with this project's rules before submitting it | the existence of `CONTRIBUTING.md` |

---

## 2 — Reality

### 2.1 D8-C1 — the one clean separation is the one that broke · **PROVEN**

Counted with `.prepare(` — better-sqlite3's only statement entry point.

> **Denominator note, stated because this project has been bitten twice.** My first
> count was 408 across 40 files, using `\.(prepare|exec)\s*\(`. `.exec()` is also
> `RegExp.prototype.exec`. The honest figure is **371**. Separately, `src/tools/`
> holds 19 files but **15 are unreachable dead code** (§2.3); counting them gives a
> tools-layer figure of 210 that measures nothing that ships. The live figure is 99.

| Live file | `getRepos()` | `.prepare(` | Bypass |
|---|---|---|---|
| `src/tools/dispatcher-memory.ts` | 2 | 66 | **97%** |
| `src/tools/dispatcher-admin.ts` | 1 | 22 | **96%** |
| `src/tools/sessions.ts` | 4 | 8 | 67% |
| `src/tools/find.ts` | 0 | 0 | — |
| **live total** | **7** | **99** | **93%** |

The repository layer is **13 repos, 14 files, 1,283 lines**, and it holds 101 raw
statements — it is real, tested, and has the only coverage threshold in the project.
Its consumers are `src/database.ts` and six files under `src/services/`. **The MCP
tool surface — the product — never uses it.** `dispatcher-memory.ts` imports
`getRepos` and calls it twice in 1,197 lines.

**PROVEN that nothing reports this.** On the clean tree at `038aea6`, containing all
91 dispatcher violations:

```
npm run build                                   exit 0
generate-capability-surface.mjs --check         exit 0
generate-http-surface.mjs --check               exit 0
npm test                                        714/714 pass
```

**VERIFIED by absence:** `.eslintrc*`, `eslint.config.*`, `.prettierrc*`,
`biome.json`, `.editorconfig` — **none exist**. `tsconfig.json` sets `strict: true`
but neither `noUnusedLocals` nor `noUnusedParameters`.

### 2.2 D8-C2, C3, C4 — the three laws discipline is carrying · **VERIFIED**

| Law | Mechanism | Obeyed? | Evidence |
|---|---|---|---|
| **C2** never stdout | none | **Yes, where it matters** | 96 `console.log` in `src/`, **all** in `installer/index.ts` (92) and `scripts/install-hooks.ts` (4). **Zero on the MCP stdio path.** |
| **C3** responses via `response.ts` | none | Yes | 208 `success`/`error` calls across the four live tool files |
| **C4** `coerce*` on arrays | none | Yes | 22 uses; **zero** occurrences of `z.array(z.string()).optional()` anywhere in `src/tools/` |

C2 deserves a correction rather than a finding. The rule says *"never"*; 96
violations exist; and **the code is fine**, because every one of them is in CLI-only
code that does not speak JSON-RPC. The rule is stated more broadly than the hazard it
protects. Reporting "96 violations of a stated law" would have been technically true
and substantively misleading — the confident wrong answer this review is organised
against, arriving from the direction of over-zeal rather than negligence.

### 2.3 D8-C6 — the dead-code gate was red from birth, in three independent ways · **PROVEN**

Inherited as task **#79**. Confirmed and extended:

1. **`npx -y knip@5 --no-progress` exits 1** on the clean tree — 15 unused files, 22
   unused exports, 28 unused types. Red since `307d2f2`, the commit that added it.
2. **No CI run has ever executed it.** The branch has never been pushed, so every
   "gates green" claim across nine sessions — including this one until now — has
   silently excluded `knip`.
3. **The documented local command did not work.** `package.json` had
   `"deadcode": "knip"`, invoking a binary that is **not a dependency**:
   `'knip' is not recognized as an internal or external command`, exit 1. CI used
   `npx -y knip@5`. Local and CI ran different things, and the one a developer would
   type was the broken one.

The 15 unused files are **exactly** the set `DEFERRED-CHANGES` D10 documents, at
**exactly** 4,057 lines — reproducible three days and three domains later.

### 2.4 D8-C5 — the catalog rule *is* enforced, and I was wrong about it · **PROVEN**

Pre-registered prediction P5 expected the `find.ts` catalog to be an ungated second
source of truth, on the reasoning that `generate-capability-surface.mjs` captures Zod
schemas and the catalog is a plain object. **That was wrong, and finding out cost one
experiment.**

Removing `get_milestones` from `MEMORY_CATALOG` (`find.ts:44`), rebuilding, then
running every gate:

```
npm run build                              exit 0
generate-capability-surface.mjs --check    exit 0     ← blind, as predicted
generate-http-surface.mjs --check          exit 0     ← blind, as predicted
npm test                                   exit 1     ← CAUGHT IT
```

```
FAIL tests/ergonomics/surface-honesty.test.ts
AssertionError: engram_memory action(s) get_milestones have no engram_find catalog
entry. The README instructs agents to "use engram_find when unsure which action to
call — never guess parameter names". For these actions that instruction is a dead end.
```

**FR-D7's binding already closes this.** The surface generator is indeed blind to the
catalog — that half was right — but the domain that owned the problem built a test
instead of extending the generator, and it works. This is the review's mechanism
working as designed across domains, and it is worth stating plainly because the
alternative was to assert a gap that a colleague had already closed.

### 2.5 D8-C7 — the census had drifted, six rows of ten · **PROVEN**

Re-measured every row. `ENGRAM_CONSTITUTION.md`'s appendix claimed **90 files /
17,560 lines / ~77% reachable**.

| Row | Claimed | Actual | |
|---|---|---|---|
| Core `src/*.ts` | 10 / ~2,900 | **12 / 3,630** | ✗ |
| `repositories/` | 14 / ~1,250 | 14 / **1,283** | ✗ |
| `services/` | **13** / ~2,700 | **12 / 2,494** | ✗ |
| `tools/` live | 4 / **2,709** | 4 / **2,970** | ✗ |
| `tools/` dead | 15 / 4,057 | 15 / 4,057 | ✓ |
| `modes/` | 1 / 253 | 1 / 253 | ✓ |
| `knowledge/` | 8 / ~750 | 8 / **734** | ✗ |
| `installer/` | 4 / **1,619** | 4 / **1,643** | ✗ |
| `http-routes/` + core | 20 / ~1,000 | 20 / **1,193** | ✗ |
| `scripts/` | 1 / 96 | 1 / 96 | ✓ |
| **Total** | **90 / 17,560 / ~77%** | **91 / 18,353 / ~78%** | ✗ |

The corrected rows reconcile exactly to the independently measured total. **The only
row that held is the dead-code row**, because that set has not changed — which is the
tell: hand-typed numbers survive precisely as long as the thing they describe stops
moving. Finding F5's exact shape, inside the document that defines the architectural
laws. Corrected in this commit and stamped; task **#81** makes it generated.

### 2.6 D8-C8 — a coverage gate that exists and has never run · **VERIFIED**

`CONTRIBUTING.md:257`: *"There is no enforced coverage gate today."*
`vitest.config.ts:21-28`: `thresholds` of 75/65/75/75 on `src/repositories/**`.

Both are defensible alone; together they are a contradiction. The resolution is worse
than either: **CI runs `npm test`, never `npm run test:coverage`** (`ci.yml:39-40`),
so the configured threshold **has never once executed**. The prose is accidentally
accurate and the config is decorative. Folded into task #81.

### 2.7 packages/* — a correction to DEFERRED D14 · **PROVEN**

D14 states knip *"flags them as unused entry points rather than as consumers — so the
one tool that might notice is the one that has already been configured to look away."*

The consequence is right; **the mechanism is wrong, and the mechanism changes the
fix.** `knip.json`'s `project` was `["src/**/*.ts"]`. `packages/` is not in `project`,
not in `entry`, and not in `ignore` — it is **outside the analysis entirely**. PROVEN:
no `packages/*` path appears in knip's output at any severity. `ci.yml:75-76` says the
scoping is because packages *"would drown the signal"* — describing suppression of a
noise that does not exist. Three shipped packages, 29 dashboard files, **zero
dead-code analysis, ever**. Task **#83**.

### 2.8 Scoring the pre-registration

Registered as observation **#97** before any measurement.

| | Prediction | Outcome |
|---|---|---|
| **P1** | The 15-files/4,057-lines figure has drifted | **FALSIFIED** — exact, three days on |
| **P2** | `packages/*` are outside analysis, not flagged | **CONFIRMED** (§2.7) |
| **P3** | Something bypasses `repositories/` with raw SQL, ungated | **CONFIRMED**, far larger than expected (§2.1) |
| **P4** | A documented convention is violated with nothing failing | **CONFIRMED** (§2.1) |
| **P5** | Adding an action needs 3+ edits; only the Zod part is gated | **FALSIFIED** — the catalog is gated, by FR-D7's test (§2.4) |

**Two of five failed — the same score as FR-D9.** P1's failure is the more useful: it
says the dead-code inventory is *stable*, which is what licenses freezing it in a test
(§5) rather than regenerating it. P5's failure prevented this document from claiming a
gap that a sibling domain had already closed.

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | New action added to a dispatcher; author writes SQL inline because it is one line and the repo call is two files | Layering erodes one query at a time; the repository layer becomes decorative | **Totally** — nothing reports it | Yes, but cost rises monotonically |
| **F2** | A 16th file goes dead; CI turns red; cheapest green is one more `knip.json` ignore line | The gate becomes a growing exception list that reports nothing | Semi — visible in diff, easy to wave through | Yes |
| **F3** | Someone deletes a "dead" file in `src/tools/` during cleanup | **Loss of the only record of validation the v1.6 consolidation dropped** (D10) | **Totally** — it compiles, tests pass | **No** — recoverable only from git history if anyone knows to look |
| **F4** | A number in `ENGRAM_CONSTITUTION.md` is quoted into a decision or release note | A confident wrong answer with the constitution's authority behind it | **Totally** | Yes, once noticed |
| **F5** | A red gate stays red long enough to become the expected state | Every subsequent red is discounted; new failures hide behind the old one | No — but *normalised*, which is worse | Yes |
| **F6** | An API change breaks the dashboard or a thin client | User-facing breakage in shipped packages | **Totally** — no analysis covers them | Yes |

**F3 is the one with no recovery path, and it is the one a well-meaning contributor
is most likely to trigger**, because 4,057 lines of unreferenced code in a 18,353-line
`src/` looks exactly like cleanup waiting to happen.

### 3b — Prior art: how this has gone wrong for other people

Searched for the **failure** literature. The instruction that mattered was the
charter's: *a search that returns only support for what we already planned was the
wrong search.* **Every load-bearing citation below contradicts an obvious move.**

**Deleting code believed dead — Knight Capital, 2012.**
[dougseven.com](https://dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/)
Power Peg was deprecated in 2003; its **tests were deleted in 2005 when they broke**;
the code was left in place. In 2012 an engineer reused the same feature-flag bit, a
partial deploy left the old path live on one of eight servers, and the firm lost
**$440M in 45 minutes**. *Contradicts:* "it's unreferenced, delete it." The
canonical case of retired-but-unaccounted-for code, and the closest published match to
this repo's F3. Grade: **REPORTED**, widely corroborated.

**Decomposition trades incident classes rather than reducing them — Carbon Health.**
[arXiv:2505.09813](https://arxiv.org/abs/2505.09813) — 107 incidents through a real
decomposition. Database incidents fell; **over-fetching, refactoring-induced and
eventual-consistency incidents rose.** The authors recommend **monolithic
modularisation as the safer first step**. *Contradicts:* "split the 1,197-line
dispatcher and things improve." This is the single citation that most changed §4.

**God-class decomposition measured as actively harmful on an external metric.**
[IEEE 6728938](https://ieeexplore.ieee.org/document/6728938/) — decomposing God
Classes **increased power consumption** while internal structure metrics improved.
*Contradicts:* "internal metrics improving means the system improved." Grade:
**REPORTED**, single study, different quality dimension — cited for the direction, not
the magnitude.

**Coding-standard compliance barely correlates with faults — Boogerd & Moonen.**
[TU Delft](https://research.tudelft.nl/en/publications/assessing-the-value-of-coding-standards-an-empirical-study/)
Industrial MISRA C study: compliance with most individual rules had **little to no
measurable effect on fault counts**; enforcing the wrong rules is *"wasted effort."*
*Contradicts:* "we have four unenforced laws, therefore enforce four laws." **Which
rule gets a mechanism matters more than whether a mechanism exists.** This is the
citation §4 T1 rests on.

**A knip gate left unattended becomes unactionable — rulesync #1763.**
[github.com/dyoshikawa/rulesync/issues/1763](https://github.com/dyoshikawa/rulesync/issues/1763)
A near-exact structural twin: knip run outside the gate, reporting 70 unused exports
and 217 unused types, explicitly *"too noisy to act on as-is"* and *"effectively left
unattended"* — and **some entries were config-gap false positives, not dead code.**
The remediation path is **triage-then-enforce**. *Contradicts:* both "turn it on and
obey it" and "it's noisy, delete it."

**Knip's own documented limits.**
[knip.dev/guides/handling-issues](https://knip.dev/guides/handling-issues) — false
positives *"usually come from dynamic imports, framework conventions, or generated
files."* This codebase routes 38 actions through a **string-keyed switch**, so a
fraction of the 50 export/type reports are expected to be wrong. Directly sizes the
risk in task #82.

**Where the literature is thin — stated, not padded.** No controlled study exists of
how teams behave toward a permanently-red CI check; the broken-windows/normalisation-
of-deviance framing for F5 rests on
[practitioner essays](https://isidoro.io/writing/tech-debt-broken-windows/) and on
Vaughan's Challenger work by analogy, **not measurement**. No case was found of a
monorepo deliberately excluding sub-packages from analysis and a defect shipping
through that exact gap; Equifax was offered as an analogy and is **rejected here as
too loose** — a scanner that missed a host is not a region never scanned. F6's
severity is therefore reasoned, not evidenced, and is graded accordingly.

---

## 4 — Target and rejected alternatives

### T1 — A ratchet on Law 1, not a rewrite and not a linter · task #80

**Target.** The raw-SQL count in each live dispatcher may fall freely and may never
rise. New queries go through `src/repositories/`; the existing 99 are paid down
opportunistically.

**Rejected — refactor all 91 call sites now.** The obvious move, and the one the
literature most directly warns against. Carbon Health's 107 incidents say
decomposition *relocates* failure classes and recommend in-place modularisation first;
the God-class study says internal metrics can improve while an external property gets
worse. Concretely: DEFERRED **D14** already forbids FR-D7's T1 from merging until
`packages/*` have a generated surface, so the tool contract is in flux — a 91-site
rewrite underneath a contract that is about to be reshaped is the change most likely
to produce a confident wrong answer. **Rejected on evidence, not on effort.**

**Rejected — adopt ESLint with an architectural boundary rule.** Superficially the
"real" fix. Boogerd & Moonen is the reason it loses: enforcing rules that do not
correlate with faults is measurably wasted effort, and **three of the four laws are
already obeyed without a linter.** Adding a linter to enforce all four buys compliance
theatre on C2–C4 and a large new dependency and config surface, to solve one problem
a nine-line test solves. If a linter arrives later for other reasons, this ratchet
retires into it.

**Rejected — do nothing, since nothing has broken yet.** The bypass is 93% and
monotonic; every session adds actions to the dispatcher. "Nothing has broken" is F1's
description, not a counter-argument.

### T2 — The dead set is frozen and named, not deleted and not ignored away · task #6 stands

**Target.** The 15 files stay. `knip.json` names each one explicitly, and a test
asserts every ignored path **still exists** and that the list **cannot grow**.

**Rejected — delete them.** Knight Capital. Also D10's own record: `stats.ts`'s
`KNOWN_CONFIG_KEYS` was recovered from this set for task #4 — **the files have already
paid for themselves once.**

**Rejected — a broad glob (`src/tools/*.ts` minus dispatchers).** Cheaper to write
and it silently absorbs the next file that goes dead — F2 exactly. Fifteen explicit
paths are more typing and they fail loudly when reality moves.

**Rejected — leave the gate red and rely on people reading output.** That is the
status quo, and it produced nine sessions in which "gates green" never included knip.

### T3 — Narrow the gate honestly, and book the debt · task #82

**Target.** `files` stays at `error`; `exports`, `types`, `enumMembers`,
`classMembers`, `duplicates` drop to `warn`. Still printed every run; no longer
fatal. The 50 items get triaged per-item, then the rules go back to `error`.

**Rejected — fix all 50 now.** knip's own docs predict false positives on
string-keyed dispatch, which this codebase uses for all 38 actions. Deleting on a
tool's say-so is Knight Capital with a linter. And at least one entry is a known trap:
`errorWithData` has 0 call sites **and is the one helper already returning the JSON
envelope shape DEFERRED D7 wants adopted** (task #55) — deleting it removes the fix.

**Rejected — keep them at `error` and let the gate stay red.** rulesync #1763 is what
that looks like after a while.

> **Stated plainly because it is the uncomfortable half:** T3 makes the gate do
> *less* than its name suggests. A gate quietly doing less than advertised is this
> domain's own failure mode. That is why it is a booked task with the full item list
> and a defined exit condition, rather than a config change and a shrug.

### T4 — `packages/*` get analysis, in their own run · task #83

**Target.** A separate knip config and a separate CI step, warnings first.

**Rejected — add `packages/**` to the existing `project` glob.** This is what
`ci.yml`'s comment feared, and the fear is legitimate even though its stated mechanism
was wrong: one combined run lets dashboard noise drown `src/` signal. Separate runs
keep the `src/` gate sharp.

**Rejected — leave them out because they are separately built.** Being separately
built is why they need their own analysis, not why they need none.

### T5 — The census becomes generated · task #81

**Target.** `scripts/generate-census.mjs` + `--check`, on the pattern already proven
three times here.

**Rejected — a test asserting exact line counts.** Considered seriously while writing
§5's suite and rejected: it fails on **every legitimate code change**, which is the
mechanism by which a gate becomes permanently red and then ignored — the exact path
that left knip red from `307d2f2` to this session. A generator fails only when the
committed table and the tree actually disagree.

**Rejected — delete the census.** It is genuinely useful; three domain docs cite it.
The problem is that it is typed, not that it exists.

---

## 5 — Binding

[`tests/codebase/maintainability.test.ts`](../../tests/codebase/maintainability.test.ts)
— **7 tests**, plus the repaired `knip` gate in CI.

| # | Asserts | Fails when |
|---|---|---|
| 1 | Per-file `.prepare(` ceiling in the four live dispatchers | Anyone adds raw SQL to a dispatcher |
| 2 | `repositories/` still holds ≥13 repos and >90 statements | The ceiling is "met" by gutting the repository layer |
| 3 | Every `knip.json`-ignored path exists on disk | A deliberately-retained dead file is deleted (**F3**) |
| 4 | The ignore list cannot exceed the documented 15 | New dead code is silenced by an ignore entry (**F2**) |
| 5 | `deadcode` script uses `npx`; `ci.yml` runs knip | Local and CI diverge again, or the gate is removed |
| 6 | No `console.log` in any file on the MCP stdio path | The JSON-RPC framing channel is corrupted |
| 7 | No raw `z.array(z.string()).optional()` in live dispatchers | Law 4 regresses |

**Why a ceiling is legitimate where FR-D9 rejected a count.** That suite rejected
count assertions because *"there are N of X"* passes for a set that is complete and
wrong and fails on every legitimate addition. That objection is about **equality**.
These are **maxima**: they cannot fail on an improvement, and cannot sit green through
the regression they exist to catch. Lowering a baseline is a one-line edit reviewed in
the same commit that earned it.

**PROVEN to fail, not merely to pass.** A green test proves nothing until it is shown
red:

| Probe | Result |
|---|---|
| Append one `getDb().prepare("SELECT 1")` to `dispatcher-memory.ts` | **1 failed** — *"New raw SQL was added to a dispatcher…"* |
| Push a 16th path into `knip.json`'s ignore array | **2 failed** — tests 3 and 4 |
| New unreferenced file `src/tools/__deadcode_probe.ts` | **`npm run deadcode` exit 1**, back to 0 on removal |

Both source probes were reverted; the tree was verified clean afterwards.

**The gate is now genuinely green rather than assumed green:**

```
npm run deadcode                            exit 0    (was exit 1 since 307d2f2)
npx vitest run tests/codebase/…             7 passed
```

---

## 6 — Kill switch

Written now, before attachment forms.

1. **If the ratchet is lowered by editing the ceiling upward more than twice**, it has
   become a formality. Delete it and either adopt a real boundary linter or record
   that Law 1 is abandoned — but do not keep a gate that is routinely raised to pass.
2. **If the 15 dead files are still dead at the master plan**, stop protecting them.
   Port the enums and bounds (task #6) or delete them with the recovery documented.
   Three years of "do not delete yet" is how Power Peg happened.
3. **If `packages/*` are cut from this repo** (a live question — charter §6 domain 8
   owns *"what belongs in this repo at all"*), tasks #83 and D14 both dissolve. Check
   that before building the second knip run.
4. **If knip's `files` rule ever produces a false positive on this codebase**, the
   whole T2/T3 structure is built on sand — re-verify the 15 by hand before trusting
   the ignore list again.

---

## 7 — Handed to other domains

| To | What |
|---|---|
| **FR-D10** | The suppression leak (observation #99) — `STATE.md` re-exports Engram memory into the tree, so "withhold recall" must mean more than "call no recall action" |
| **Master plan** | Charter **R1** says retirement means *"stop auto-loading memory at session start"* — but the `_advisor` field emits unsolicited *"use `get_decisions`"* prompts on write calls, so R1 as written would not achieve what it describes |
| **FR-D6 / D14** | §2.7 corrects D14's mechanism: `packages/*` are unanalysed, not mis-flagged |

---

<!-- FOUNDATIONS_D8:COMPLETE -->
