# Deferred Changes — Things That Must Not Be Forgotten

**Started:** 2026-08-02 · **Status:** ACTIVE — read before every release
**Owner:** whoever is shipping next

> **What this file is for.** Anything switched off, worked around, narrowed, or
> left half-done *on purpose*, with the exact condition that should switch it
> back on. Not a task list — [Engram's task board](#) holds those. This holds
> the things that have no natural reminder: a config pointed somewhere
> temporary, a claim that is true only until release, a guard removed under an
> assumption that expires.
>
> **Why it exists at all, given the project's own findings.** `project-state-tracking-design.md`
> §1 is explicit that a hand-maintained register lies in both directions and that
> the fix is *reconciliation*, not a better register. That is right, and this file
> is deliberately the narrow exception it warns is still needed in the interim:
> every entry below names a **mechanical trigger** — a release, a command, a
> grep — rather than relying on anyone remembering. It is a stopgap until task
> #10's `engram_admin(reconcile)` and task #9's capability surface can carry
> these mechanically. **When they can, migrate these entries and delete this file.**

**Rules for entries.** Every entry states, without exception:
1. **What was changed** and where (`file:symbol`).
2. **Why** it was done that way.
3. **The trigger** — the observable condition that means "act now."
4. **The action** — precisely what to do, so nobody re-derives the decision.
5. **How it would be caught** if this file were never read. If the answer is
   "it wouldn't," that is the strongest argument for the entry existing.

Entries are removed only when done, and the removal is noted in [`DONE`](#done).

---

## D1 — `.mcp.json` points at the local build explicitly, not via `npx`

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `783d902`
**Revised:** 2026-08-02 — **the original justification for this entry was wrong. See below.**

**What.** `.mcp.json` runs `node ./dist/index.js` instead of
`npx -y engram-mcp-server`.

**Why — corrected.** The original claim was that `npx` ran the *published*
package, so the dogfooded server was never the code being changed. **That was
wrong, and it was asserted on bad evidence** (a tool schema that lacked
`session_id` — which at that moment simply had not been written yet).

What actually happens, PROVEN by spawning the command and reading `tools/list`:

```
$ npx -y engram-mcp-server --project-root <tmp>     # cwd = repo root
serverInfo: {"name":"engram-mcp-server","version":"1.11.0"}
HAS session_id: true | HAS parent_session_id: true      ← local code
```

Because this repo's own `package.json` is *named* `engram-mcp-server`, npm
resolves the bare name against the current project and caches it as a
**`file:` install — a symlink back to the repo**:

```
_npx/73f929d9ee25ebc0/  spec={"engram-mcp-server":"file:d:/Projects/Engram Production/Engram"}
  node_modules/engram-mcp-server -> /d/Projects/Engram Production/Engram   (symlink)
```

So `npx` *was* running the local build all along — but **only by accident of the
working directory.** Spawn it from anywhere else and it fetches the published
package instead. That fragility, not a wrong-server bug, is the real reason to
keep this entry: `node ./dist/index.js` is deterministic; `npx <own-name>` is
CWD-dependent.

**Trigger.** Verifying a release, or anyone reporting "the fix isn't working"
against a published version.

**Action.** Temporarily switch `command`/`args` back to
`cmd /c npx -y engram-mcp-server@latest --project-root <path>` — note the
explicit `@latest`, which defeats the local `file:` resolution and genuinely
fetches from the registry. Switch back afterwards.

Longer term the master plan should decide whether this file belongs in the repo
at all — it hardcodes an absolute Windows path
(`d:\Projects\Engram Production\Engram`) and is useless to any other
contributor.

**Would it be caught otherwise?** Partly. A CWD change would silently swap the
server, and nothing would report it. But the failure this entry originally
claimed was never occurring.

**Lesson worth keeping.** The bad claim survived into a commit message, a
session report, and an Engram observation before anything checked it. It was
graded as though verified when the underlying evidence was circumstantial. That
is precisely the failure mode [`project-state-tracking-design.md`](project-state-tracking-design.md)
§1 describes — a register that lies in the *"claims work that never happened"*
direction — reproduced here inside the very session that was documenting it.

**Also: `dist/` must be rebuilt (`npm run build`) after any `src/` change, and
the MCP server reloaded, or the running server is stale.** There is no
mechanism that does this for you.

---

## D2 — `agent_name` is now REQUIRED on `engram_session(action:"start")` — BREAKING

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `f234052`

**What.** `start` returns an error if `agent_name` is absent or blank. It used
to default to the literal string `"unknown"`.

**Why.** Audit N3b: scoping sessions on `agent_name` is useless while every
agent that omits it lands in one bucket. A generated fallback would have
preserved the exact defect the fix targets.

**Trigger.** The next version bump / publish.

**Action.** Three things, none optional:
1. **Version it as a breaking change.** Under semver this is a **major**; if
   the project ships it as a minor, that decision must be written down here and
   in the release notes, not left implicit.
2. **Release notes must lead with it**, with the migration line: *"pass a
   stable `agent_name` on every `engram_session(action:'start')` call."*
   `RELEASE_NOTES.md` is currently still the v1.11.0 document and has no
   Unreleased section — see **D8**.
3. ~~Update the embedded agent instructions~~ — **done 2026-08-02.** Both
   `README.md` (between the `ENGRAM_INSTRUCTIONS` markers) and
   `.github/copilot-instructions.md` now state that `agent_name` is required,
   and show `session_id` on `end` and `parent_session_id` on sub-agent start.

**Would it be caught otherwise?** Partially — users would hit a loud error with
an actionable message, which is the best available failure. But shipping a
breaking change in a patch release would still be wrong, and nothing in CI
detects that.

---

## D3 — Agent rules no longer fetched or cached; the remote path is GONE, not disabled

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `87712f4`

**What.** The GitHub README fetch, the cache write and the cache read were
deleted from `agent-rules.service.ts`. `getRules()` serves packaged rules only.

**Why.** Audit N1. Deleting the mechanism deletes the attack class; hardening
it would only narrow it. Same fix Anthropic shipped for CVE-2026-21852.

**Trigger.** Anyone proposing to update agent rules without a release, or
asking "why did the rules stop updating?"

**Action.** **Do not restore the fetch as it was.** Rules are now versioned with
the package: to change them, edit `AGENT_RULES` in `src/tools/find.ts` and
ship a release. If remote rules are ever genuinely wanted, the audit's fix list
items 3–4 are the minimum bar — pin to a commit SHA, verify a content hash, cap
the response body, **and** HMAC-bind any cache to a per-install secret so a
cache arriving by `git clone` is recognised as foreign. Nothing less.

**Related, still open:** the `AGENT_RULES` array itself fails Trellis Principle
1 — ~330 tokens on *every* session start that tell the agent to "be careful"
rather than telling it anything it did not know. `trellis-engram-integration-analysis.md`
§7 recommends dropping it (and the tier-0 catalog) from repeat sessions, reusing
the `selectCatalogTier` signal that already tracks per-agent delivery. That is a
real ~660-token-per-session win and it is **not** done. It belongs in the master
plan, not here — but it is noted so the connection is not lost.

**Would it be caught otherwise?** No. Silence is the expected behaviour.

---

## D4 — `security_notice` fires on a leftover `agent_rules_cache.json`, which is NOT deleted

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `87712f4`

**What.** If `.engram/agent_rules_cache.json` exists, session start returns a
`security_notice` and stderr gets a warning. The file is left in place.

**Why.** Deleting files from a user's working tree without asking is the same
class of surprise as the destructive corruption-recovery path (§12.9). Surfacing
it is the job; removing it is the user's call.

**Trigger.** A user reports a persistent `security_notice`, **or** this repo's
own `.engram/` still contains the file.

**Action.** Inspect the file's contents before deleting — if it was not written
by an old Engram, it is evidence of an injection attempt and worth keeping.
Then delete it. Consider adding a `engram_admin` action to do this with
confirmation rather than asking users to hand-delete.

**Checked 2026-08-02:** this repo has no `.engram/agent_rules_cache.json`. The
check itself stays in this entry because it is the right first move whenever the
notice is reported.

---

## D5 — Session record attribution is narrowed, not closed *(Engram task #12)*

**Status:** ACTIVE — **now PROVEN, reclassified CRITICAL** · **Raised:** 2026-08-02 · **Commit:** `f234052`

> **FR-D4 update, 2026-08-04.** Three things changed, and the wording above is
> now too soft.
>
> 1. **It is not a race — it is deterministic.** A parent session is always
>    created *before* the sub-agents it spawns, so its id is always lower.
>    Under `ORDER BY id DESC` on open sessions, **an orchestrator can never win
>    attribution against its own live child.** It loses 100% of the time.
> 2. **Measured, not theorised.** Session #24 (`fr-lead`) produced the whole of
>    [`foundations/06-observability.md`](foundations/06-observability.md) and
>    owns **zero rows** across decisions, observations, tasks, changes,
>    conventions and milestones. Decision #21 is stamped to #27, a sub-agent.
>    Reproduced from a clean store in
>    [`tests/e2e/multi-agent-wire.test.ts`](../tests/e2e/multi-agent-wire.test.ts)
>    test 4. The real count is **16** unscoped call sites, not ~40.
> 3. **The severity was wrong because the literature was not consulted.** MAST
>    ([arXiv:2503.13657](https://arxiv.org/abs/2503.13657)) puts inter-agent
>    misalignment — agents acting on inconsistent views of shared state — at
>    **36.9% of all multi-agent failures**, the largest structural class. This
>    is not bookkeeping.
>
> Tracked as Engram task **#58**, superseding task #12's framing. The shape is
> now pinned by a test whose assertion names the *wrong* agent deliberately, so
> the fix must edit it in the same commit.

**What.** ~40 call sites in `dispatcher-memory.ts` still call the **unscoped**
`getCurrentSessionId()` to stamp `session_id` on records
(`record_change`, `record_decision`, `set_file_notes`, `create_task`,
`checkpoint`, `record_observation`, `schedule_event`, …).

**Why.** Before the N3a fix, `start` force-closed every open session, so exactly
one was ever open and the global query was *accidentally* unambiguous. Now that
orchestrator and sub-agents stay open concurrently **by design**, those call
sites resolve to "newest open session" rather than "the caller's session."

**Impact, stated precisely so it is not over- or under-sold.** Nothing is
destroyed and no write is lost. Only the `session_id` foreign key on a row can
name the wrong session. It is a reporting/attribution defect, not data loss.

**Trigger.** Any work on multi-agent attribution, `replay`, or the accountability
design — all three depend on `session_id` being correct.

**Action.** Lift `resolveSession()` out of `src/tools/sessions.ts` into a shared
module and give `engram_memory` an optional `session_id` (and/or `agent_name`)
param threaded into the `session_id` column. `dispatcher-memory.ts` has **one
flat Zod schema**, so this is one param plus a resolver, not 38 changes. Do it
together with wiring the real agent into `logToolCall` (`database.ts`, currently
hardcoded `null`) — both need the same "who is calling" plumbing.

**Would it be caught otherwise?** No. Wrong attribution looks exactly like right
attribution until someone queries it.

---

## D6 — The MCP-stdio verification harness lives in a scratchpad and will be lost

**Status:** ✅ **CLOSED 2026-08-04 by FR-D6** · **Raised:** 2026-08-02

> **Resolved.** The wire path now has a permanent home:
> [`tests/e2e/mcp-wire.test.ts`](../tests/e2e/mcp-wire.test.ts) — 9 tests that
> spawn `node dist/index.js` and speak real JSON-RPC. It covers what the
> scratchpad harness covered and more: stdout purity, the envelope shape, the
> flat error taxonomy, `compact` checked against row counts, and a health check
> proven to fail under an injected fault. CI runs it (`npm ci` → `npm run build`
> → `npm test`), so it cannot rot unnoticed. See
> [`foundations/06-observability.md`](foundations/06-observability.md) §5.
>
> **Two claims below were wrong and are corrected here rather than edited out,
> because the record is the point.**
> 1. *"All 603 tests call dispatcher handlers directly with a mocked database"* —
>    overstated. Only **8** of 34 test files mock `src/database`; the rest use
>    real temporary databases. The accurate claim is narrower and was still
>    damning: no test crossed the **transport**.
> 2. *"[the audit's two PoCs] were never committed and no longer exist"* — they
>    still exist, in session scratchpads (`poc-cache-poison.mjs`,
>    `poc-session-clobber.mjs`), as does `live-n3-check.mjs`. They are
>    uncommitted and ephemeral, which was the real point, but "no longer exist"
>    was not checked before it was written.

**Original entry, preserved unedited:**

**What.** `live-n3-check.mjs` — spawns `node dist/index.js` as a real MCP stdio
process, replays the audit's N3 sequence over JSON-RPC, and asserts 8 properties
against the resulting `sessions` table. Currently in the session scratchpad
(`…/scratchpad/live-n3-check.mjs`). **Not committed.**

**Why it matters more than a normal scratch file.** All 603 tests call
dispatcher handlers directly with a mocked database. **Nothing tests Engram over
actual MCP stdio.** The wire path — tool registration, Zod parsing of real MCP
arguments, the response envelope, and the compiled `dist/` artifact — has zero
coverage. This harness is the only thing that has ever exercised it, and it
immediately found something the unit tests structurally could not: `error()`
returns `isError: true` with **plain-text** content, not JSON, so a consumer
parsing the content as JSON gets nothing.

**Trigger.** Before this session's scratchpad is cleaned up. Effectively: now.

**Action.** Decide where it lives (`tests/e2e/`? `scripts/verify/`?) and commit
it. The audit's §9 "Reproduction" section already references PoC files
(`scratchpad/poc-cache-poison.mjs`, `scratchpad/poc-session-clobber.mjs`) that
**were never committed and no longer exist** — the same mistake, already made
once. Note that the durable regression coverage for both now lives in
`tests/tools/session-identity.test.ts` and `tests/services/agent-rules.test.ts`,
which is a *better* home; the gap this harness fills is specifically the
**wire/artifact** level.

**Would it be caught otherwise?** No — it would simply vanish, exactly as the
audit's two PoCs did.

---

## D7 — Response envelope is inconsistent: `error()` returns plain text, not JSON

**Status:** ACTIVE — **behaviour unchanged, decision deferred, now EVIDENCED** · **Raised:** 2026-08-02

> **FR-D6 update, 2026-08-04.** Still deferred, deliberately — it changes the
> dashboard and both thin clients. Three things changed about the *decision*:
> 1. **A second half of the asymmetry was found.** Success does not set
>    `isError: false` — it omits the field entirely, so a consumer branching on
>    `isError === false` gets `undefined` and takes the error path.
> 2. **The obvious fix is disqualified.** `outputSchema` + `structuredContent` is
>    the spec-sanctioned route and
>    [claude-code#80094](https://github.com/anthropics/claude-code/issues/80094)
>    shows Claude Desktop refuses to dispatch such tools at all. The envelope must
>    stay inside `content[0].text`.
> 3. **The shape is now pinned by a test**, `tests/e2e/mcp-wire.test.ts`, whose
>    error-envelope assertion is inverted on purpose. Unifying the envelope must
>    edit that file in the same commit.
>
> Tracked as Engram task **#52**. `errorWithData()` — the one helper that already
> returns the right shape — has **0 call sites**; see task #55.

**What.** `src/response.ts`: `success()` and `errorWithData()` return JSON in
`content[0].text`; `error()` returns a **bare string**. Nothing was changed —
this is recorded because it caused two false readings during this session's own
verification work (a PoC harness and a test assertion both misread a correct
refusal as a failure).

**Why deferred.** Changing the envelope shape affects every consumer including
the dashboard and both thin clients. It is a master-plan decision, not a
drive-by fix.

**Trigger.** The master plan's "capability surface" work (task #9), which has to
describe the envelope anyway.

**Action.** Decide: either make `error()` use `errorWithData`'s JSON shape
uniformly, or document the asymmetry prominently so consumers stop guessing.
Whichever is chosen, add it to the generated capability surface so it cannot
drift again.

---

## D8 — `RELEASE_NOTES.md` has no Unreleased section; four P0 fixes are unrecorded

**Status:** ACTIVE — **the recommended format is now in question** · **Raised:** 2026-08-02

> **FR-D9 update, 2026-08-05.** §3b changed this entry's recommendation, which is
> the point of §3b. **Do not adopt Keep a Changelog unexamined.**
>
> 1. **Its own maintainers say the generated form is insufficient** — *"a generated
>    changelog is raw material at best… machines can draft, but humans curate"*
>    ([keepachangelog.com 1.1.0](https://keepachangelog.com/en/1.1.0/), read
>    directly). This project's whole strategy is generation plus a diff gate, so
>    that caveat lands squarely on it.
> 2. **A rival spec exists specifically because of a failure mode we would
>    inherit.** [Common Changelog](https://common-changelog.org/) was created in
>    part because Keep a Changelog's `[Unreleased]` section creates merge-conflict
>    friction that discourages upkeep. That friction is the exact mechanism by
>    which this project's other hand-maintained registers died — finding F5, and
>    `project-state-tracking-design.md` §1.
>
> **Action added:** evaluate Common Changelog against Keep a Changelog in the
> master plan. Whichever wins **must** record removals — the `lock_file` incident
> is why the `Removed` section matters here. Not decided by FR-D9; flagged so the
> master plan does not inherit an unexamined choice. See
> [`foundations/09-process.md`](foundations/09-process.md) §4 T6.

**What.** `RELEASE_NOTES.md` is a single-release document, currently v1.11.0. It
has no `[Unreleased]` section, so the four P0 fixes on this branch — two of them
**breaking** — are recorded only in commit messages, the constitution, and
Engram.

**Why deferred.** `project-state-tracking-design.md` §5 Tier 0.4 recommends
adopting Keep a Changelog *with its `Removed` section used honestly*, calling it
"the cheapest mechanism in this entire document." Adopting a changelog format is
a project convention, and imposing one mid-P0-fix was out of scope.

**Trigger.** The next release, or the master plan (whichever comes first).

**Action.** Adopt `CHANGELOG.md` in Keep a Changelog format with an
`[Unreleased]` section, and backfill from this branch's commits. The `Removed`
section must record: the agent-rules GitHub fetch and cache (D3), and the
`config` action's ability to write security keys (task #4). Incident #1 in the
design doc — `lock_file` advertised in the README for versions after it was
deleted — would never have happened had removals been one line under `Removed`.

---

## D9 — Constitution and audit metadata are now stale in three specific places

**Status:** ACTIVE · **Raised:** 2026-08-02

**What.** All three are *known* staleness, listed so they are fixed deliberately
rather than discovered:

| Where | Stale claim | Correct action |
|---|---|---|
| `ENGRAM_CONSTITUTION.md` header | "Version 1.0 · Covers 1.11.0, schema V24" | Bump when the fixes ship. Schema V24 is still accurate — none of the four P0 fixes needed a migration |
| `ENGRAM_CONSTITUTION.md` §13 | Coverage "28.7% stmt / 20.2% branch" | Measured at 557 tests; the suite is now 603 and `sessions.ts`, `dispatcher-admin.ts` and `agent-rules.service.ts` all gained real coverage. **Re-run `npm run test:coverage` and update.** Not guessed at in the meantime |
| `docs/engram-memory/` | Generated export of decisions/conventions | Decision #4 was superseded and #15 added this session. **Regenerate with `node scripts/export-memory-docs.mjs`** |

**Trigger.** Release, or any agent citing those numbers.

**Would it be caught otherwise?** The coverage number, no. This is finding F5's
exact shape — a status-bearing claim that is quietly no longer true — which is
why it is written down rather than left.

---

## D10 — Guards knowingly left in place, to be removed only in a specific order

**Status:** ACTIVE · **Raised:** 2026-08-02

These are **not** bugs introduced; they are pre-existing items the P0 work
deliberately did not touch, recorded so "we already looked at that file" never
becomes "so it must be fine."

| Item | Where | Why left | Remove when |
|---|---|---|---|
| `countBySession(sessionId, table)` interpolates the table name into SQL | `src/repositories/sessions.repo.ts` | Only ever called with the literal `"decisions"`; fixing it belongs with the other validation work | Task #6 — add `assertKnownTable()` |
| `AGENT_RULES` imported and unused | `src/tools/sessions.ts` | Pre-existing dead import; removing it in a P0 commit would have muddied the diff | Task #6 |
| 15 dead files in `src/tools/` (4,057 lines) | `src/tools/` | **They are the only record of validation the v1.6 consolidation silently dropped.** `stats.ts`'s `KNOWN_CONFIG_KEYS` was recovered from there for task #4 — the file paid for itself | Task #6, and **only after** porting the enums/bounds, fixing `import`, and resolving `lock_file` |
| `dispatcher-smoke.test.ts` mocks `database.js` without `getServices` | `tests/tools/` | Every test in it throws inside `pmSafe` and passes anyway — it tests error isolation, not what it names | Any test-quality pass |

---

## D11 — ~~This branch is one commit behind `main`'s version bump~~ · ~~the release hold~~ · the deployment gap

**Status:** **RESOLVED as written, 2026-08-07 — and replaced by a different problem.** See the banner.
**Raised:** 2026-08-02 · **Closed:** 2026-08-07 · **Re-scoped:** 2026-08-10

> ### ✅ THE HOLD IS OVER. THE RELEASE SHIPPED. *(added 2026-08-10)*
>
> **PROVEN 2026-08-10:**
>
> ```
> npm view engram-mcp-server version dist-tags
>   → 1.13.0 · { "latest": "1.13.0" }
> git tag -l v1.13.0        → v1.13.0
> git log main --oneline -1 → f47df04
> node -p require('./package.json').version  → 1.13.0
> ```
>
> **Three claims in the body below are now false and are corrected here rather
> than deleted, because the reasoning is the record:**
>
> | Where | Says | Actually |
> |---|---|---|
> | §📦, "The release is assembled" | `release/1.13.0` is *"not pushed and not published"* | **Published 2026-08-07** as `latest` |
> | **Action**, below | *"the next version must be a **major** — so `2.0.0`, not `1.13.0`"* | **`1.13.0` shipped.** The major is still owed for D2/D3, but it was never the next version |
> | **Action**, below | *"Rebase onto `main` (or merge `main` in) before release work"* | Done. `git merge-base --is-ancestor main HEAD` → true, at `dbeac30` |
>
> ### ⚠️ AND THE HAZARD DID NOT CLEAR WHEN THE RELEASE DID
>
> The entry's most urgent claim — *"published v1.12.0 is the vulnerable build …
> every installation on 1.12.0 currently has all four P0s live"* — was true about
> **the published line**, and publishing fixed that half. It said nothing about
> **installed** copies, and that is the half that survived.
>
> **PROVEN on the maintainer's own machine, 2026-08-10, via `engram install --check`:**
> **seven config entries across four products still launch v1.12.0** (Visual
> Studio, Gemini CLI, JetBrains, and all four Android Studio config directories),
> plus three more stamped `v?` — the pre-tracking era, so older still. Every one
> of them has all four P0s live *today*, three days after the fix was published.
>
> Two mechanisms, both recorded, neither previously joined up:
>
> 1. **`npx` caches per exact spec string and never re-checks.** The README's
>    bare `npx -y engram-mcp-server` had been serving an April build. Fixed at
>    both ends in `d354172`.
> 2. **The installer now writes a pinned exact version** — the correct fix for
>    (1), and it means **Engram no longer self-upgrades.** A machine that
>    installed 1.12.0 stays on 1.12.0 until someone re-runs the installer.
>
> **So D11's successor question is not "should we publish?" — it is "how does a
> published fix reach a machine that already has the vulnerable build?"** That is
> a distribution problem, and nothing in this document or the master plan owns it.
> The tripwire and the 45-day advisory clock below are still live and still
> unresolved; an advisory is now the *only* mechanism that reaches those seven
> entries, which strengthens rather than weakens the case for one.
>
> Filed as Engram task **#107**. `--check` now exits non-zero on an unreadable
> config (`2f42643`), so this state is at least machine-detectable going forward.

> **✅ The version-regression half is resolved.** PROVEN 2026-08-05:
> `git merge-base --is-ancestor main HEAD` → true (`main` is fully merged into
> `v2-foundations`), and `package.json` on this branch reads **1.12.0**. The stated
> Action below — *"Rebase onto `main` (or merge `main` in)"* — **has already been
> done**, at merge commit `d420c10`. Everything in the "What" and "Two
> consequences" sections below is therefore historical; it is preserved unedited
> because the record is the point. Engram task **#87**. Noted in [`DONE`](#done).
>
> **What is NOT resolved, and is now the whole entry:** the release hold
> (decision #19), the tripwire, and *"published v1.12.0 is the vulnerable build."*
> See the two additions at the end of this entry — the risk argument below has
> been **contradicted by evidence**, and the tripwire has **no clock**.

**What.** `review/engram-audit` was cut from `develop@804a8d7`, one commit before
`main`'s v1.12.0 version bump. `package.json` here says **1.11.0**; `main` says
**1.12.0**. `main` is ahead by exactly two commits (`91526f7`, `1afe18f`).

**The delta is documentation and a version string — nothing else:**

| File | Δ |
|---|---|
| `package.json` | `"version": "1.11.0"` → `"1.12.0"` |
| `RELEASE_NOTES.md` | +95 lines — the entire v1.12.0 release notes |
| `README.md` | +29 — Android Studio section |
| `llms.txt` | 1 line — Android Studio in the IDE list |

**`git diff review/engram-audit...main -- src/ tests/` is empty.** This branch
already contains all of v1.12.0's code. Only the label is stale.

**Two consequences.**

1. **Cosmetic but misleading:** the dogfooded server reports 1.11.0 and offers an
   "update" to 1.12.0 while running code strictly newer than 1.12.0. During a
   security fix that reads as though the fix isn't installed.
2. **Release-blocking:** merging or releasing this branch as-is would regress
   `package.json` to 1.11.0, revert the README and `llms.txt`, and **delete the
   v1.12.0 release notes.**

**Decided, not merely deferred.** 2026-08-03, Engram decision **#19**: *no release
until the master plan is drafted and solidified.* This is a considered position,
not drift — see the tripwire below, which is what separates the two.

**Why holding is correct.** Phase 1 is likely to produce breaking changes in at
least four domains — D7 may cut the action surface, D2 adds provenance columns to
every memory table, D6 may make the response envelope uniform (breaking the
dashboard and both thin clients), D3 may reshape storage. Releasing 2.0.0 now
means 3.0.0 within weeks and the same users migrated twice, for no benefit.

**Why the exposure is smaller than it first looked.** N1 requires cloning a
*specifically crafted* hostile repo — a targeted attack on a package with 26
downloads/week, 0 stars, 0 watchers. N2 requires an **already prompt-injected**
agent, so it is escalation, not entry. N3 is a data-integrity bug, not
exploitable. And decisively: **nothing is disclosed while the branch is
unpushed.** The residual risk is independent discovery on an unwatched repo.

> ### ⛔ The paragraph above is contradicted by evidence and should not be relied on
>
> **Added 2026-08-05.** FR-D10 §3b searched the failure literature and every
> load-bearing citation cuts against it:
>
> | This entry assumed | The evidence says |
> |---|---|
> | *"a targeted attack on a package with 26 downloads/week"* | [postmark-mcp](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html) — the **first malicious MCP server found in the wild** — had ~1,500 weekly downloads and ran unscrutinised for 15 versions **because** low counts draw less scrutiny |
> | *"too small to be worth attacking"* | [arXiv:2003.03471](https://arxiv.org/pdf/2003.03471): **93.9%** of npm packages get under 350 weekly downloads. Obscurity is the ecosystem's default state, not a defence |
> | *"exposure is low because it is undisclosed"* | [Arora et al. 2006](https://link.springer.com/article/10.1007/s10796-006-9012-5): undisclosed vulnerabilities are attacked at slowly **increasing** rates without ever being published. The silent case is not the zero case |
>
> **And the calculus was aimed at the wrong hazard.** Every line of it reasons
> about *disclosure* and therefore about attackers. The largest live hazard on
> published v1.12.0 needs no attacker at all: the installer replaces another
> product's user-level config with a stub when that file fails to parse, backing
> it up only best-effort (`try{…}catch{/* best-effort */}`). `~/.claude.json` was
> measured at **40.5 KB / 53 top-level keys**. Download counts, stars and
> watchers are irrelevant to a bug that fires on a malformed file. Engram task
> **#46**; [`ENGRAM-MASTER-PLAN.md`](ENGRAM-MASTER-PLAN.md) §4.1 hazard **H1**.

> ### 💰 And the hold's cost is now measured, not estimated *(added 2026-08-05)*
>
> The entry above argues the hazard is larger than D11 assumed. This adds the
> other half of the trade: **the fix already exists and shipping it is small.**
> VERIFIED by reading both trees:
>
> | | |
> |---|---|
> | `v2-foundations` | `src/installer/config-writer.ts:186-197` rethrows `ConfigParseError` and **writes nothing**; `writeJson` is temp-file-plus-rename |
> | `main` | `copyFileSync` inside `try{…}catch{/* best-effort */}`, then `config = {}`, then writes. **Unchanged** |
>
> Commit **`dd3841d`** — four files: the D5 domain doc, `docs/STATE.md`, the fix,
> and 9 tests that all assert *safe* behaviour with none pinning the defect. Its
> only cherry-pick friction is the same docs-only `DU` shape
> [`foundations/tripwire-patch-runbook.md`](foundations/tripwire-patch-runbook.md) §3
> already documents.
>
> **This changes the shape of the decision, not the decision itself.** The hold
> was reasoned as *"releasing costs a migration users pay twice for."* That
> argument is about **Release B**. For H1 the cost is one cherry-pick onto a
> branch that is already releasable, and the thing being held is a data-loss fix
> for a bug in someone else's product's config file. Whether to ship remains the
> maintainer's call — but it should be made against the measured cost, not an
> assumed one.

> The earlier framing of this as urgent applied settled input 1 (*public product,
> wide adoption*) as a **current** state. It is the **target** state. The threat
> model has to be calibrated to actual exposure.

> ### 📦 The release is assembled. The hold is now a publish decision, not a build one *(added 2026-08-05; OVERTAKEN 2026-08-07 — it was published)*
>
> Branch **`release/1.13.0`** (`c4fac06`), cut from `main`, ~~**not pushed and not
> published.**~~ **published 2026-08-07 as `latest`; `main` @ `f47df04`, tag
> `v1.13.0`.** It carries all four hazards fixed — `53eba90`, `87712f4`,
> `e310269`, `dd3841d`, `19e9274` — plus the gates the published line has never
> run. VERIFIED on that tree: build exit 0, **617/617 across 31 files**, all
> three gates exit 0.
>
> It is **`1.13.0`, not the planned `1.12.1`**: H4's commit also turns
> `POST /api/v1/import` from a `200 {"ok":true}` that wrote nothing into a
> `501`, which is a response-shape change. Calling that a patch would be a
> second false claim in the release that removes the first.
>
> **What this changes about D11.** Every argument in this entry — the risk
> calculus, the tripwire, "residual risk is independent discovery" — was
> written when shipping meant *doing the work under time pressure*. The work is
> done and verified. What remains is `npm publish` and a push. **Continued
> holding is now a decision to leave a verified fix unshipped**, which is a
> different decision from the one this entry was written to justify, and it
> should be recorded as one rather than inherited.

### 🚨 Tripwire — overrides the hold

**The mechanics are verified and written down:**
[`foundations/tripwire-patch-runbook.md`](foundations/tripwire-patch-runbook.md).
All four commits cherry-pick onto `main` with zero code conflicts; the result
builds and passes 603/603. **Use Recipe B** (N1 + N2 only) — `f234052` requires
`agent_name` on session start, so the full set is a **minor, not a patch**, and
"patch release" below is wrong for it.

**If any of these fire, cut a release that week, wherever the review has got to:**

- A GitHub issue or discussion matching an N1 / N2 / N3 signature
- A sustained rise in npm downloads (baseline: ~193/month, ~26/week, 2026-08-02)
- Any third-party activity on the repo's Security tab, or a fork/star spike
- Any decision to push the branch publicly — **pushing IS disclosure**, and it
  inverts this entire calculus

**⏱ And a clock, added 2026-08-05 — the tripwire had none.** Every trigger above
is an *event*. If no event fires, this entry permits silence forever, and
indefinite silence is the failure mode institutional policy exists to prevent.
[CERT/CC](https://certcc.github.io/certcc_disclosure_policy/) publishes at **45
days regardless of patch status**, while warning that *"gratuitously announcing
vulnerabilities may not be in the best interest of public safety"* — both poles
are failure modes, which is why the deadline is a deadline and not a rule about
content.

> **45 days from 2026-08-02, when the P0 findings were recorded → `2026-09-16`.**
> On that date, either the advisory is published, or the reason for extending is
> written down as an Engram decision. **The clock does not force disclosure. It
> forces continued silence to be a decision rather than a default** — which is
> exactly what "guard against 'solidified' becoming never" below asks for and
> did not supply a mechanism for.

**Accepted consequence.** The branch accumulates breaking changes, so the eventual
migration chain is longer and riskier than an incremental path. That makes the
migration upgrade-path test (task #7, FR-D1's binding) **more** important, not
less, and is why D1 stays first in risk order.

**Guard against "solidified" becoming never.** Charter kill switch 2: if two
consecutive domains produce no target that changes anything, stop the review and
write the master plan from what exists. And the master plan must **explicitly own
the release strategy** — version, migration path, advisory, first-release contents
— or the release becomes a receding horizon.

**Trigger.** Before opening a PR, merging, or publishing. Also the moment anyone
asks "why does it say 1.11.0?"

**Action.** ~~Rebase onto `main` (or merge `main` in) *before* release work.
Then the next version must be a **major** — see [D2](#d2) and [D3](#d3), two
breaking changes — so `2.0.0`, not `1.13.0`.~~
**Both halves done or superseded — see the banner.** The merge landed at
`dbeac30`; `1.13.0` shipped on 2026-08-07. A major is still owed for D2 and D3
when they land, but it was never the *next* version, and asserting it was is
what made this line wrong for five days.

**Related, and the more urgent half:** ~~**published v1.12.0 is the vulnerable
build.**~~ **The published line is v1.13.0 and is not vulnerable.** Its notes
claim *"557 tests pass"* and *"Zero breaking changes"* — written
before N1, N2 and N3 existed as findings. ~~Every installation on 1.12.0 currently
has all four P0s live.~~ **Installations still ON 1.12.0 do — measured at seven
config entries on the maintainer's machine three days after the fix shipped, and
the installer no longer self-upgrades them.** The master plan still needs to
decide whether that warrants an advisory rather than a quiet patch release, and
the answer is now less optional than when this line was written: publishing has
already happened and did not reach them.

**Would it be caught otherwise?** The version regression, yes — a diff review
would show it. The *published build is vulnerable* half, no: nothing in the repo
states it, and the release notes actively assert the opposite.

---

## D12 — The unused-action report needs elapsed time before it means anything

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `5ff7e2f`

**What.** Every action now logs to `tool_call_log` (it previously logged 3 of 83).
The measurement that motivated the fix — *which actions has nobody ever called* —
**still cannot be run**, because "ever" now starts at this commit.

**Why it matters.** This is the only evidence that can license **deleting** an
action. Without it the surface can only grow, which is the asymmetry Trellis
names: *a loop that learns only from failure can only add.* Settled input 2
(*break only where evidence demands*) means no action gets removed until this
report exists.

**Trigger.** After a release plus a meaningful period of real usage — not just
this project's own dogfooding, which exercises an unrepresentative slice.
Concretely: **when `SELECT COUNT(DISTINCT tool_name) FROM tool_call_log` stops
climbing between checks.**

**Action.** Run the report, then decide deletions against it. Feeds FR-D7
(ergonomics, task #22) and FR-D9 (traceability, task #23).

**Also gated on this:** `replay` is still hollow for every session recorded
before `5ff7e2f`. No amount of new logging recovers what was never written, so
historical sessions are permanently unreplayable. Worth stating plainly rather
than discovering later.

**Would it be caught otherwise?** No. Nothing surfaces "this report is not ready
yet", and the table now looks populated — which is exactly the condition under
which someone concludes an action is unused when it is merely new.

---

## D13 — Distinctness was measured with three samples of one model

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `517d2e6`

**What.** FR-0c/1 routed 40 phrases through three "blind raters" that were the
**same model with the same prompt**. It measured **routing stability**, not
inter-model agreement.

**Why it matters.** The result — 97.5% unanimous, 55% genuinely distinct — is
being used to decide what may be cut. The 97.5% is the weaker half of that
finding and the easier one to over-read. **A different model may route the same
catalog differently**, and the 42.5% unanimous-but-low-confidence band is exactly
where that would show up.

**Trigger.** Before any decision that *keeps* an action on the grounds that
routing is fine. The 55% figure is safe to act on; the 97.5% is not safe to rely
on.

**Action.** Re-run [`analyse-distinctness.mjs`](foundations/measurements/analyse-distinctness.mjs)
with raters on at least two different model families, against the **same
committed phrase set** — which is why that set was committed before results
existed. Compare the ambiguous band, not the headline.

**Would it be caught otherwise?** Partly. The limitation is stated at the top of
both the raw data and the report, so a careful reader sees it. But a summary
quoting "97.5% unanimous" without it would be actively misleading, and summaries
are what get quoted.

---

## D14 — FR-D7's T1 reshapes the advertised MCP schema, and no gate reports what that breaks

**Status:** ACTIVE · **Raised:** 2026-08-05 · **Owner:** FR-D7 target T1, task #71

**What.** `engram_memory` advertises **79 optional top-level parameters** for 38
actions, and `engram_admin` 32 for 37, with nothing marking which apply to the
action being called. T1 replaces that with per-action schemas. That is the right
fix and it is a **consumer-visible change to the tool contract.**

**Why it matters.** Charter §11b.1 already names this gap and it is still open:
`CAPABILITY-SURFACE.md` covers the MCP tool contract, but **the HTTP API and
`packages/*` have no equivalent**, so a schema reshape can break the dashboard
and both thin clients with nothing reporting it. This is the same hazard that
section flagged for FR-D6's response envelope, arriving from a second direction —
which is itself the argument that the gap is structural rather than specific to
D6.

Note what is *not* deferred: nothing here licenses **cutting actions**. Charter
kill switch 3 forbade that on the FR-0c distinctness result, and FR-D7 §3b added
a second independent reason ([TxAgent](https://arxiv.org/abs/2503.10970): adding
211 curated tools *improved* reasoning). T1 changes how parameters are
*advertised*, not how many actions exist.

**Trigger.** When `packages/*` and the HTTP API have a generated surface with a
CI diff gate, the way the MCP contract already does. Owned by **FR-D6**, flagged
to **FR-D8**. Until then T1 can be designed and tested but must not merge.

**Would it be caught otherwise?** **No.** That is precisely the finding: the
dashboard and thin clients are built separately, and `knip`'s zero-config run
flags them as unused entry points rather than as consumers — so the one tool that
might notice is the one that has already been configured to look away.

> **FR-D8 correction, 2026-08-05.** The conclusion above is right and **the
> mechanism it rests on is wrong** — which matters, because the mechanism
> determines the fix.
>
> `knip` does **not** flag `packages/*` as unused entry points. VERIFIED:
> `knip.json` sets `project` to `["src/**/*.ts"]`; `packages/` appears in
> `project`, `entry` and `ignore` **nowhere**. PROVEN by running the gate — no
> `packages/*` path appears in knip's output at any severity, in any category.
> They are not suppressed, not ignored, and not "looked away from": they are
> **outside the analysis entirely**. Three shipped packages and 29 dashboard
> files have never been subject to dead-code analysis of any kind.
>
> `.github/workflows/ci.yml:75-76` states the scoping is because `packages/*`
> *"would drown the signal"* — describing the suppression of a noise that has
> never been generated. The concern is still legitimate (see
> [`foundations/08-codebase.md`](foundations/08-codebase.md) §4 T4, which rejects
> merging them into the existing glob for exactly that reason), but it was being
> offered as a description of current behaviour and it is not one.
>
> **Consequence for the action:** this entry's trigger is unchanged, but the work
> is *adding* an analysis rather than *reconfiguring* one. Engram task **#83**.

---

## DONE

*(Entries move here when resolved, with the commit that closed them.)*

- **[D6](#d6--the-mcp-stdio-verification-harness-lives-in-a-scratchpad-and-will-be-lost)** — closed 2026-08-04 by FR-D6. The wire path has a permanent home at
  `tests/e2e/mcp-wire.test.ts` (9 tests). Entry kept in place above because it
  carries two corrections worth preserving.
- **[D11](#d11--this-branch-is-one-commit-behind-mains-version-bump--the-release-hold), first half only** — closed 2026-08-05 at merge `d420c10`, verified
  2026-08-05 by task #87. `main` is fully merged into `v2-foundations` and
  `package.json` reads 1.12.0, so the version regression and the "rebase before
  release" action are both resolved. **The rest of D11 — the hold, the tripwire
  and the vulnerable published build — remains ACTIVE and is now the entire
  entry.**

---

<!-- DEFERRED_CHANGES:ACTIVE -->
