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

## D1 — `.mcp.json` points at the local build, not the published package

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `783d902`

**What.** `.mcp.json` runs `node ./dist/index.js` instead of
`npx -y engram-mcp-server`.

**Why.** It ran the *published* package, so the Engram server this repo develops
against was never the code being changed. That is how audit N3 stayed
observable across four unprompted incidents while a fix sat in `dist/`.

**Trigger.** Verifying a release, or anyone reporting "the fix isn't working"
against a published version.

**Action.** Temporarily switch `command`/`args` back to
`cmd /c npx -y engram-mcp-server --project-root <path>` to reproduce against
the shipped artifact, then switch back. **Do not leave it on `npx` while
developing.** Longer term the master plan should decide whether this file
belongs in the repo at all — it hardcodes an absolute Windows path
(`d:\Projects\Engram Production\Engram`) and is useless to any other
contributor.

**Would it be caught otherwise?** No. It fails silently and invisibly — the
server works perfectly, it is just the wrong server. This is exactly the entry
this file exists for.

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

**Status:** ACTIVE · **Raised:** 2026-08-02 · **Commit:** `f234052`

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

**Status:** ACTIVE · **Raised:** 2026-08-02

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

**Status:** ACTIVE — **behaviour unchanged, decision deferred** · **Raised:** 2026-08-02

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

**Status:** ACTIVE · **Raised:** 2026-08-02

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

## DONE

*(Entries move here when resolved, with the commit that closed them. Nothing yet.)*

---

<!-- DEFERRED_CHANGES:ACTIVE -->
