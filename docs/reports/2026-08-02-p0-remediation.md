# Session Report — P0 Remediation

**Date:** 2026-08-02 · **Engram session:** #15 · **Branch:** `review/engram-audit`
**Scope:** all four P0 findings from [`engram-deep-audit-2026-08-02.md`](../engram-deep-audit-2026-08-02.md) — tasks #2, #5, #4, #3
**Status:** COMPLETE. 603/603 tests pass. Five commits, tree clean.

**Companion documents:** [`DEFERRED-CHANGES.md`](../DEFERRED-CHANGES.md) — everything switched
off, narrowed, or left half-done on purpose, with the trigger that should switch it back on.
Read that before any release.

---

## 0. Evidence grading

Same scheme the audit uses, because the point of it is that a reader can tell what was
actually checked from what was merely believed.

| Grade | Meaning |
|---|---|
| **PROVEN** | An executable check was run and its output is quoted here |
| **VERIFIED** | Read in source personally, `file:symbol` cited |
| **REPORTED** | Someone else said so; not re-checked |

Nothing in this report is REPORTED. No sub-agents were used — see §6 for why.

---

## 1. What shipped

| Task | Audit finding | Commit | Tests added |
|---|---|---|---|
| #2 | N3a/N3b — session identity globally scoped | `f234052` | 13 |
| #5 | N3c/N3d — `pending_work` sweep, handoff scoping | `ea347e4` | 11 |
| #4 | N2 — `config` writes any key, no whitelist | `53eba90` | 12 |
| #3 | N1 — agent-rules cache poisoning | `87712f4` | 10 |
| — | dogfooding config | `783d902` | — |

Test count: **557 → 603**. No pre-existing test was modified or weakened.

---

## 2. Method — the one thing worth copying

**Every regression suite was written before the fix and confirmed to fail against
the unfixed code.** For task #2 that meant 11 of 13 tests red before a line of `src/`
changed. That ordering is what makes the suite meaningful rather than decorative: a test
written after a fix proves only that the code does what it does.

The task #2 mock deliberately reimplements the **unscoped** `getCurrentSessionId`, so the
dispatcher cannot pass by leaning on a friendlier mock than production.

---

## 3. Task #2 — session identity *(audit N3a/N3b)*

### 3.1 The constraint that ruled out two obvious fixes

Verified before writing anything: **the MCP server is one process with one database handle,
shared by the orchestrator and every sub-agent.** There is no per-connection identity.

That kills two designs that look right on paper:

- **Connection scoping** — unavailable; everyone shares one stdio connection.
- **A process-level "active session" pointer** — the last `start` still wins. That is the
  same bug one layer up, with the added downside of being invisible.

Caller-supplied identity is the only available signal. Everything below follows from that.

### 3.2 Three handoff claims, all confirmed in source

| Claim | Verdict |
|---|---|
| `sessions.parent_session_id` exists in the V1 baseline and `types.ts`, never written | **VERIFIED** — `migrations.ts` V1, `types.ts` `SessionRow`. No migration needed |
| `tool_call_log.agent_id` exists; `logToolCall` passes literal `null` | **VERIFIED** — `database.ts` |
| The global "current session" query is duplicated in two places | **VERIFIED** — `sessions.repo.ts:getOpenSessionId`, `database.ts:getCurrentSessionId` |

### 3.3 What changed

| Change | Where |
|---|---|
| `agent_name` **required** on `start`, with an error naming the remedy | `sessions.ts` start branch |
| `start` retires **only the calling agent's own** previous session | `sessions.ts`, via `getOpenSessionId(agentName)` |
| `getOpenSessionId(agentName?)` / `getCurrentSessionId(agentName?)` take an optional scope | `sessions.repo.ts`, `database.ts` |
| `close()` / `autoClose()` guard on `AND ended_at IS NULL` and return whether they acted | `sessions.repo.ts` |
| `resolveSession()` — `session_id` → caller's `agent_name` → newest-open, last rung reporting `session_resolution` | `sessions.ts` |
| `parent_session_id` written on sub-agent start; explicit param wins over inference | `sessions.repo.ts:create`, `sessions.ts` |

### 3.4 The judgment call

**Requiring `agent_name` is breaking.** The alternative — generating a fallback like
`unknown-<pid>` — was rejected because it preserves the exact defect: agents that omit the
name still land in an indistinguishable bucket, and the fix would be cosmetic. The audit
called this out in advance (N3b: *"breaking change, but the alternative is a fix that
doesn't fix anything"*).

The chosen failure mode is the cheapest possible one: a loud error on the very first call,
naming the parameter and giving an example. Tracked for release handling as
[D2](../DEFERRED-CHANGES.md).

### 3.5 Live proof — PROVEN

Not just unit tests. A harness spawned the compiled `dist/index.js` as a **real MCP stdio
process** and replayed the audit's exact sequence over JSON-RPC:

```
0. start WITHOUT agent_name -> REFUSED: agent_name is required for engram_session...
1. orchestrator start            -> session #1
2. sub-agent start (task #1)     -> session #2, parent_session_id=1
3. orchestrator start again      -> session #3
4. sub-agent-2 start             -> session #4, parent_session_id=3
5. sub-agent-1 end               -> closed session #2
6. sub-agent-2 end (by handle)   -> closed session #4
7. re-end sub-agent-2's session  -> REFUSED

id | agent_name    | parent | open | summary
---+---------------+--------+------+------------------------------------------
1  | orchestrator  | -      | no   | (auto-closed: new session started)
2  | sub-agent-1   | 1      | no   | SUB-AGENT-1 RESULT: refactored auth module...
3  | orchestrator  | -      | yes  | (null)
4  | sub-agent-2   | 3      | no   | SUB-AGENT-2 RESULT: wrote migration test

PASS  agent_name required on start
PASS  orchestrator's live session survived both sub-agent starts
PASS  sub-agent-1 linked to an orchestrator session
PASS  sub-agent-2 linked to an orchestrator session
PASS  sub-agent-1's summary is on sub-agent-1's row
PASS  sub-agent-2's summary is on sub-agent-2's row
PASS  no summary was overwritten by the re-end
PASS  orchestrator's first session retired by its OWN restart

N3a/N3b: NOT REPRODUCIBLE against the fixed build.
```

Compare the audit's pre-fix table, where the sub-agent's summary landed on the
orchestrator's row and both earlier sessions read `(auto-closed: new session started)`.

**The first run of this harness reported 2 of 8 FAIL.** Both were the harness misreading
the response envelope, not defects — see §5.2. The sessions table was correct in both runs,
which is why *verifying by consequence* rather than by return value mattered.

---

## 4. Tasks #5, #4, #3 — summary of substance

### 4.1 Task #5 — `pending_work` and handoffs *(N3c/N3d)*

**This one was made worse by task #2 and had to follow immediately.** Before the session
fix, only one session was ever open, so the unscoped abandonment sweep was *bounded by
accident*. Making concurrent sessions the intended state removed that accidental bound.

- The abandonment `UPDATE` is scoped to `agent_id = <caller>` **and** requires the owning
  session to be closed. Another agent's work, and the caller's own live work, are untouched.
- `begin_work` wrote `agent_id` as the literal `"unknown"` when the param was omitted —
  one bucket, which makes the scoping above match nothing. It now falls back to the owning
  session's `agent_name`. **Without this the fix would have been inert**, which is the kind
  of thing that only shows up when you write the test first.
- `record_change`'s auto-close swept **every** agent's pending rows on a file-path overlap.
  Scoped to the session's own agent.
- Handoffs: all pending are surfaced. `handoff_pending` prefers one authored by a *different*
  agent; `other_handoffs_pending[]` carries the rest.
- `acknowledge_handoff` requires an active session, records the real agent instead of
  `"unknown"`, refuses a handoff created by that same session, and reports who acknowledged
  first on a double-ack.

**Deliberately not restricted:** a *later* session of the same agent may still acknowledge.
A handoff is addressed to whoever comes next and there is no `to_agent` column to address it
more precisely. Restricting it would have broken the legitimate resume case.

### 4.2 Task #4 — config key whitelist *(N2)*

The policy lives in `constants.ts`, **not** in a dispatcher, because the same gap existed on
the HTTP surface: `PUT /api/v1/settings/:key` blocked only `http_token`, leaving
`sharing_mode`, `sensitive_keys`, `instance_id` and `machine_id` writable over the API. One
list, both doors.

- `TUNABLE_CONFIG_KEYS` — user preferences. Writable.
- `PROTECTED_CONFIG_KEYS` — a **Map from key to the action that owns it**, so the rejection
  names the right door (`set_sharing`, `set_visibility`, `mark_sensitive`, …) rather than
  just refusing. Chosen over a confirm token because it keeps validation in one place instead
  of duplicating it behind a prompt.
- `SECRET_CONFIG_KEYS` — `http_token` and `machine_id` are redacted on read.
- Unknown keys are rejected rather than silently written.
- Every accepted mutation writes an `audit_log` row. **That table has existed since migration
  V20 and this path never used it.** Refusals write none.

**Verified that nothing legitimate broke:** every protected key is already written by its own
service or action straight through `ConfigRepo`, bypassing the tool surface entirely. Checked
all 29 `config.set` call sites.

**Found while fixing, not in the audit:** `config` with no key returned the **whole table** —
dashboard bearer token and machine GUID included — to any agent that asked.

### 4.3 Task #3 — agent-rules trust boundary *(N1)*

The fetch, the cache write and the cache read are **deleted**, not hardened. `getRules()`
returns the `AGENT_RULES` that ship in the package; nothing on disk or on the network can
influence them, and `source` has exactly one possible value: `"packaged"`.

The old field could report `"cache"`, which reads as *more* trustworthy than the legitimate
`"fallback"` — the one observability signal available pointed the wrong way.

**Why deletion beat validation.** This is the fix Anthropic shipped for the structurally
identical CVE-2026-21852 ("MemoryTrap") in Claude Code v2.1.50: remove memory from the
injection path entirely. Validating untrusted instructions harder still leaves you loading
untrusted instructions.

A leftover cache file is **detected and reported** — `security_notice` on session start plus
a stderr warning — but deliberately **not deleted**. Silently removing files from a user's
working tree is the same class of surprise as the destructive corruption-recovery path
(constitution §12.9).

**Doc side effect worth stating plainly:** `SECURITY.md`'s claim that the update check is the
only outbound network call was **false when written** (audit §7 graded it so). Removing the
fetch made it true. The section now also names the `api.github.com` releases fallback it had
always omitted.

---

## 5. Found while fixing — recorded, not absorbed

The master plan's method note asks that new discoveries be recorded rather than fixed ad hoc.
Four surfaced.

### 5.1 `.mcp.json` and `npx` — **this finding was wrong, and is corrected here**

**Originally claimed:** `.mcp.json` ran `npx -y engram-mcp-server`, i.e. the *published*
package, so the dogfooded server was never the code being changed — and that was how N3
stayed observable across four incidents while a fix sat in `dist/`.

**That claim is false.** It rested on one circumstantial observation — the `engram_session`
schema showed no `session_id` — which had a much duller explanation: at that moment
`session_id` had not been written yet. Circumstantial evidence was written down as if
VERIFIED.

**What is actually true — PROVEN.** Spawning the exact command and reading `tools/list`:

```
$ npx -y engram-mcp-server --project-root <tmp>     # cwd = repo root
serverInfo: {"name":"engram-mcp-server","version":"1.11.0"}
HAS session_id: true | HAS parent_session_id: true      ← the local fix
```

Because this repo's `package.json` is *named* `engram-mcp-server`, npm resolves the bare
name against the current project and caches it as a **`file:` install — a symlink back to
the repo**:

```
_npx/73f929d9ee25ebc0/  spec={"engram-mcp-server":"file:d:/Projects/Engram Production/Engram"}
  node_modules/engram-mcp-server -> /d/Projects/Engram Production/Engram   (symlink)
```

So `npx` had been running the local build all along.

**`783d902` still stands, on a different rationale.** The npx form worked only by accident
of the working directory — spawn it from anywhere else and it fetches the published package.
`node ./dist/index.js` is deterministic. Keep the change; discard the reasoning.
See [D1](../DEFERRED-CHANGES.md) for the corrected entry and the `@latest` trick needed to
genuinely test against the registry.

**Why this is left in the report rather than quietly edited out.** A wrong claim, graded as
though verified, propagated into a commit message, this report, and Engram observation #48
before anything checked it. That is the *"claims work that never happened"* half of
[`project-state-tracking-design.md`](../project-state-tracking-design.md) §1 — reproduced
inside the session documenting it. Engram observation #50 supersedes #48.

### 5.1b The real reason the server reported 1.11.0 while npm published 1.12.0

Not a stale install. **A version-label gap in this branch.**

`review/engram-audit` was cut from `develop@804a8d7` — **one commit before `main`'s version
bump.** `main` is ahead by exactly two commits (`91526f7` merge, `1afe18f` docs + bump),
and the three-dot diff is:

```
README.md        | 29 +++++++++++++++--
RELEASE_NOTES.md | 95 +++++++++++++++++++++++++++++++++++++++++++++++++++++++
llms.txt         |  2 +-
package.json     |  4 +--        -  "version": "1.11.0",
                                 +  "version": "1.12.0",
```

**Zero difference under `src/` or `tests/`.** This branch already contains 100% of v1.12.0's
code — Android Studio support, the installer UX redesign, all of it. Only the version string
and the release documentation are missing, so `SERVER_VERSION` (read from `package.json` at
import) reports 1.11.0.

Two consequences that outlive this session:

1. **The dogfooded server will nag about an update to 1.12.0 while running code that is
   strictly newer than 1.12.0.** Cosmetic, but actively misleading during a security fix.
2. **Whatever these P0 fixes are released as must be branched or rebased onto `main`**, or
   the release will regress `package.json`, `README.md`, `llms.txt` and drop the v1.12.0
   release notes. Tracked as [D11](../DEFERRED-CHANGES.md).

**And the fact that matters most to users:** published **v1.12.0 is the vulnerable build.**
Its release notes say *"557 tests pass"* and *"Zero breaking changes"* — written before N1,
N2 and N3 were found. Every current installation has all four P0s live.

### 5.2 Nothing tests Engram over MCP stdio *(Engram observation #49)*

All 603 tests call dispatcher handlers directly against a mocked database module. The **wire
path** — tool registration, Zod parsing of real MCP arguments, the response envelope, and the
compiled `dist/` artifact — has zero coverage.

The live harness found in its first run what the unit tests structurally could not:
`error()` returns `isError: true` with **plain-text** content, not JSON. A consumer parsing
the content as JSON gets nothing. It cost two false FAILs in the harness and one false
failure in a test assertion before being understood.

Behaviour left unchanged — the envelope shape affects the dashboard and both thin clients, so
it is a master-plan decision. Tracked as [D7](../DEFERRED-CHANGES.md). The harness itself has
no committed home yet: [D6](../DEFERRED-CHANGES.md).

### 5.3 Record attribution is narrowed, not closed *(Engram task #12)*

Because sessions are no longer force-closed, several can be open at once, so the ~40 unscoped
`getCurrentSessionId()` call sites in `dispatcher-memory.ts` now stamp records with *newest
open* rather than *the caller's session*.

**Stated precisely so it is neither over- nor under-sold:** nothing is destroyed, no write is
lost, only the `session_id` foreign key on a row can name the wrong session. It is an
attribution defect, not data loss.

**This was not folded into the "fixed" claim.** Tracked as task #12 and
[D5](../DEFERRED-CHANGES.md), with the fix shape written down: lift `resolveSession()` into a
shared module, add an optional `session_id` to `engram_memory`'s single flat Zod schema, and
do it together with wiring the real agent into `logToolCall`.

### 5.4 `config` leaked secrets on read

Covered in §4.2. Not in the audit; found by reading the handler while fixing the write path.

---

## 6. Why no sub-agents were used

The Orchestration Guide's own test is *"delegate breadth, keep judgment."* All four P0 items
are security judgment on files whose failure modes are already mapped — the breadth work
(reading 90 files, building the constitution) was done in a previous session and its output
is exactly what made these fixes fast.

Delegating would also have been actively harmful until `783d902` + an MCP reload: sub-agents
inherit the MCP server, so they would have hit the **broken published 1.11.0** and clobbered
session #15 — reproducing N3 a fifth time while ostensibly testing its fix. The guide's §5
rule ("if a known concurrency bug exists, either fix it first or run serially") applied to
its own author.

Delegation is now unblocked and is the right instrument for task #6's validation-porting
sweep, which is mechanical, wide, and format-driven.

---

## 7. State at end of session

**Branch `review/engram-audit`**, 5 commits ahead, no upstream configured — **nothing has been
pushed.**

```
87712f4 fix(security)!: delete the agent-rules fetch and cache — audit N1
53eba90 fix(admin): restore the config key whitelist, both doors — audit N2
783d902 chore: dogfood the local build, not the published package
ea347e4 fix(sessions): scope pending_work and handoff ownership — audit N3c/N3d
f234052 fix(sessions)!: scope session identity by agent — audit N3a/N3b
```

**Engram memory:** decision #15 recorded and #4 superseded; tasks #2, #4, #5 closed; task #12
created; observations #48 and #49 recorded; 20 file-change records; file notes refreshed for
every file touched.

**Docs reconciled** — deliberately, because leaving a status-bearing doc claiming a state that
is no longer true is finding F5 itself:

| Doc | Change |
|---|---|
| `ENGRAM_CONSTITUTION.md` | §12.1, §12.1b, §12.2, §12.3 all rewritten from CRITICAL to **FIXED** with was/now tables; service, repository, on-disk and test-posture tables updated |
| `engram-deep-audit-2026-08-02.md` | STATUS banner under N3. Original finding text left **unedited** as the dated record |
| `SECURITY.md` | Network Access corrected; new "Agent Rules Are Packaged" section |
| `README.md` | Session-ownership section; `engram_session` action table; embedded agent instructions |
| `.github/copilot-instructions.md` | `agent_name` required, `session_id` on end, `parent_session_id` on sub start |

---

## 8. Recommended next steps

Ordered by value ÷ effort, with the reasoning rather than just the order.

1. **Reload the MCP server**, then delegate task #6's validation port as a live concurrency
   test. Two things at once: real breadth work, and the first genuine multi-agent exercise of
   the N3 fix against a running server.
2. **Task #9 — the generated capability surface.** All three design docs converge on it:
   catches 6 of the 10 silent-drop incidents, is a *build script* rather than an Engram
   feature (so it costs nothing against the weight constraint), and it is the only mechanism
   in the whole corpus that satisfies the survival criterion. It would also let
   [`DEFERRED-CHANGES.md`](../DEFERRED-CHANGES.md) start shrinking instead of growing.
3. **Task #11 — the master plan**, now informed by four closed P0s rather than four open ones.
4. **Task #8 — the distinctness test.** The Trellis analysis calls it *"the highest
   expected-value work identified in this entire audit cycle"*: ~40 phrases, one model call
   each, and it produces Engram's first real measurement of routing accuracy across 75 actions.

---

<!-- P0_REMEDIATION_REPORT:COMPLETE -->
