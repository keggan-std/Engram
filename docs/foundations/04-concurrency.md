# Domain 4 — Concurrency & Multi-Agent

**Charter:** [`00-CHARTER.md`](00-CHARTER.md) · **Owns:** *"two agents at once"*
**Status lives in the Engram task board.** `FR-D4` tasks, not here.

> **The one-line finding.** Engram has exactly one correct coordination
> primitive — `claim_task` — and it is the only one the product does not
> depend on. Everything else that claims to keep agents apart either does not
> exist, cannot refuse, or credits the wrong agent. The headline promise,
> *"they never step on each other"*, is contradicted by a **13-line
> reproduction**: two agents write one file and the surviving row belongs to
> neither of them.

> **Method note.** This domain was reviewed **serially and un-delegated.**
> [`orchestration-guide.md`](../orchestration-guide.md) §5 says that when a
> known concurrency bug exists you fix it first or run serially, and this
> domain's own seed finding is such a bug. Every grade below is therefore
> **PROVEN** or **VERIFIED**; there is no REPORTED tier in this document.

---

## 1 — Claims

Inventoried from README, the tool descriptions, `ENGRAM_CONSTITUTION.md` and the
schema. Tool descriptions and README feature tables count as claims because an
agent reads them and changes its behaviour on them.

| ID | Claim | Source |
|---|---|---|
| D4-C1 | "multi-agent coordination across sessions" | README:7 |
| D4-C2 | Badge — **Multi-Agent: Ready** | README:12 |
| D4-C3 | "the only solution that is local-first, MCP-native, **multi-agent-ready**" | README:73 |
| D4-C4 | "`claim_task` is **atomic**: two parallel agents can never start the same work" | README:740 |
| D4-C5 | "`begin_work` declarations surface as `abandoned_work` in the next session — **nothing falls through the cracks**" | README:740 |
| D4-C6 | "Run multiple AI agents on the same codebase simultaneously. Engram provides the coordination layer **so they never step on each other**" | README:746 |
| D4-C7 | `lock_file` / `unlock_file` — prevents "Two agents editing the same file at once" | README:750 |
| D4-C8 | `broadcast` / `agent_sync` — prevents "Missed messages between agents" | README:752 |
| D4-C9 | `route_task` — prevents "Work going to the wrong specialization" | README:753 |
| D4-C10 | `handoff` / `acknowledge_handoff` — prevents "Context loss when switching agents" | README:754 |
| D4-C11 | "A session belongs to exactly one agent… **no agent can close or overwrite another's record**" | README:920 |
| D4-C12 | "With neither, the newest open session of any agent is used and **the response says so** in `session_resolution`" | README:930 |
| D4-C13 | "A sub-agent session records `parent_session_id`" | README:933 |
| D4-C14 | `get_file_notes` returns `lock_status` | README:953 |
| D4-C15 | "**Atomically** claim a task. Returns advisory `match_score`" | README:976 |
| D4-C16 | `context_pressure` events fire at **50%, 70%, 85%** | README:760 |
| D4-C17 | Every memory row carries the session that created it | `session_id` column on 7 tables *(implied)* |
| D4-C18 | A crashed agent's claim returns to the pool | dispatcher-memory.ts:1106 *(implied)* |
| D4-C19 | "`agent_name` … is what stops concurrent agents from closing each other's sessions" | README:1098 |
| D4-C20 | Two agents can run Engram against one project at all | the premise of the domain *(implied)* |

---

## 2 — Reality

Grades per charter §5. The executable check is
[`tests/e2e/multi-agent-wire.test.ts`](../../tests/e2e/multi-agent-wire.test.ts) —
two real `dist/index.js` processes against one project root — plus the
exploratory harness whose output is quoted below.

| ID | Grade | Reality |
|---|---|---|
| **D4-C4** | **PROVEN — TRUE** | The single correct primitive in this domain. `dispatcher-memory.ts:1051` is a compare-and-swap: `UPDATE tasks SET claimed_by=? WHERE id=? AND claimed_by IS NULL AND status NOT IN ('done','cancelled')`, with `result.changes === 0` as the loss signal. Measured across two OS processes: **15/15 races produced exactly one winner, 0 double-claims.** |
| **D4-C15** | **VERIFIED — TRUE** | `match_score` is advisory and wrapped in a `try/catch` that can never hard-block the claim (`:1076`). Correct as described. |
| **D4-C16** | **VERIFIED — TRUE** | Thresholds are config-backed with exactly those defaults (`dispatcher-memory.ts:136-138`). |
| **D4-C13** | **VERIFIED — TRUE** | `parent_session_id` is written on sub-agent start. Confirmed in the live store: sessions #25-#29 all carry `parent_session_id: 24`. |
| **D4-C11** | **VERIFIED — TRUE for sessions** | `start` retires only the caller's own session; `close`/`autoClose` guard on `ended_at IS NULL`. This is the §12.1 fix and it holds. **But see D4-C17 — it is true of the session record and false of everything the session writes.** |
| **D4-C12** | **VERIFIED — TRUE** | `resolveSession()` reports its last-rung guess in `session_resolution` rather than guessing silently. |
| **D4-C7** | **PROVEN — FALSE** | `lock_file` / `unlock_file` **do not exist on the live surface.** Calling one is a Zod enum rejection: `MCP error -32602: Input validation error`. Absent from the catalog. The implementation survives only in dead `src/tools/file-notes.ts`, where — unlike anything live — it *checks ownership and returns `conflict: true`*. **The mutual-exclusion logic exists, is correct, and is unreachable.** |
| **D4-C6** | **PROVEN — FALSE** | See §3 F1. Two agents writing one file produce a row belonging to neither. |
| **D4-C14** | **PROVEN — TRUE but misleading** | `lock_status` is returned and can read `locked: true`. It reflects a soft lock that *cannot refuse anything* and is acquired **after** the write it nominally guards (`:369` upsert, `:382` lock). It reports a guarantee that does not exist. |
| **D4-C17** | **PROVEN — FALSE** | The domain's most consequential defect. `getCurrentSessionId()` (`database.ts:486`) is `WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`, unscoped at **16 call sites**. A parent session is always created *before* the children it spawns, so its id is always lower: **an orchestrator can never win attribution against its own live sub-agent.** Not a race — deterministic. Reproduced from a clean store, and observed live first: this project's decision #21 was written by session #24 (`fr-lead`) and stamped to #27 (`d6-logging-agent`). Session #24 — which produced the entire D6 domain doc — owns **zero rows** across decisions, observations, tasks, changes, conventions and milestones. |
| **D4-C18** | **PROVEN — FALSE** | The reclaim sweep (`:1106`) requires an `agents` row with `status='working'`. `claim_task` **never registers the claimer**, and `agent_sync` defaults `status` to `"idle"` (`:1101`). Both conditions fail by default, so the sweep matches nothing. A crashed agent's claim is recoverable only via `release_task force:true`. |
| **D4-C8** | **VERIFIED — FALSE in part** | `markRead` is a read-modify-write with no transaction, in **two** places: `broadcasts.repo.ts:34-47` and again inline at `dispatcher-memory.ts:1109-1113`. Concurrent readers lose each other's entries, so a broadcast is redelivered to an agent that already saw it. `AgentsRepo.releaseStale()` — the method named for recovery — **has zero callers.** |
| **D4-C5** | **VERIFIED — TRUE, narrowly** | `abandoned_work` is correctly scoped to the caller (§12.1b). It reports only work declared through `begin_work`, which nothing requires. "Nothing falls through the cracks" is true of declared work and silent about the rest. |
| **D4-C20** | **PROVEN — FALSE on a fresh project** | Two servers cold-starting on one fresh root race the migration chain. `runMigrations` (`migrations.ts:810`) reads the version, then runs each step in a **deferred** transaction; nothing serialises read-version→run-chain across processes. The loser hits V22's unconditional `ALTER TABLE file_notes ADD COLUMN git_branch` (`:437`) and dies. Quoted output: `[ERROR] Fatal error {"message":"duplicate column name: git_branch"}` · `exited: 1` · `initialize replied: false`. The store itself is fine (`integrity_check: ok`, version 25) — **the data survives and the process does not**, which is why this is D4's and not D1's. |
| **D4-C1/C2/C3** | **VERIFIED — overstated** | "Multi-agent ready" rests on five advertised mechanisms (D4-C7 to D4-C10 plus claiming). One works. |
| **D4-C9** | **VERIFIED — TRUE, inert** | `route_task` computes a real score, but nothing consumes it; routing is advice an agent may ignore. |
| **D4-C10** | **VERIFIED — TRUE** | Handoffs supersede correctly since `e2ec2b0`. |
| **D4-C19** | **VERIFIED — TRUE but load-bearing beyond its strength** | `agent_name` is required, and it does stop session clobbering. It is also **self-asserted, unvalidated and unenforced for uniqueness** — two agents may pass the same name, and `claim_task`'s `agent_id` defaults to the literal `"unknown"` (`:1049`). Identity is a convention, not a control. Handed to **FR-D2** as a provenance question, not solved here. |

**Quoted output — attribution, from a clean store:**

```
session A = 1   session B = 2
=== E3  attribution: A records while B's session is newer ===
  decision #1 "A DECIDED THIS"
  stamped session_id = 2 (agent "agent-B")  <- should be 1 (agent-A)
  VERDICT: MISATTRIBUTED to another agent
```

**Quoted output — file coordination:**

```
  lock_file present in catalog?  false
  A set_file_notes -> File notes saved for src/shared.ts.
  B set_file_notes -> File notes saved for src/shared.ts.  (refused? false)
  resulting purpose : B drive-by
  resulting exec_sum: A wrote a thorough note.
  lock_status       : {"locked":true,"agent_id":"session-2", ...}
```

---

## 3 — Failure modes

| # | Trigger | Blast radius | Silent? | Recoverable? |
|---|---|---|---|---|
| **F1** | Two agents call `set_file_notes` on one file | The row becomes a **chimera** — B's `purpose` beside A's `executive_summary`, because `upsert` uses `COALESCE(?, col)`. Neither agent's view exists; the composite is then served to every future agent as fact | **Totally.** Both writes report success | No. The prior value is not retained anywhere |
| **F2** | Any record written while a sub-agent session is open | Wrong `session_id` on decisions, tasks, observations, changes, file notes, conventions, milestones. `replay`, per-agent accounting and the D5 audit trail all read from this column | **Totally** | Only by reconstructing from timestamps by hand |
| **F3** | An agent crashes holding a claim | The task is permanently unclaimable. `claim_task` refuses it forever; the sweep cannot see it | Loud on the next claim attempt, silent otherwise | Only `release_task force:true`, which requires a human to notice |
| **F4** | Two servers cold-start on a fresh project | One MCP server dies at `initialize`. From the IDE's side, Engram is simply absent | **Loud in stderr, invisible in the IDE** — and IDE hosts discard stderr (FR-D6 T6) | Yes — restart, since the chain is complete by then. First-run only |
| **F5** | Two agents `agent_sync` concurrently on one broadcast | Lost update on `read_by`; the broadcast is redelivered | Yes | Self-correcting, harmless |
| **F6** | Soft lock expires mid-edit (30 min) | `lock_status` flips to unlocked while the agent is still working | Yes | n/a — the lock never protected anything |
| **F7** | Two agents pass the same `agent_name` | They share a session lineage and silently retire each other's sessions — the §12.1 fix keyed on a value nothing validates | Yes | No |

**Silence scoring.** Six of seven are silent. The domain's characteristic failure
is not a crash: it is **two agents proceeding confidently on state that has
already been overwritten by the other** — the charter's framing question, in its
purest form.

### 3b — Prior art

Searched for failure literature, not how-to material.

- **[MAST — *Why Do Multi-Agent LLM Systems Fail?*](https://arxiv.org/abs/2503.13657)** — 1,600+ annotated traces across 7 frameworks; 14 failure modes. **Inter-agent misalignment is 36.9% of failures**, characterised as agents acting on *inconsistent views of shared state, where one agent's completed work doesn't register in another agent's context*. F1 and F2 are that category exactly. This **changed the ranking**: attribution had been filed as a bookkeeping nicety (DEFERRED-CHANGES D5 calls it "narrowed, not closed"). MAST says inconsistent shared state is the single largest structural failure class in multi-agent systems, which promotes F2 from tidiness to the domain's main event.
- **[rails/rails#22092](https://github.com/rails/rails/issues/22092)** — "Running multiple migrations simultaneously can cause race conditions." Rails' migrator took no exclusive lock; concurrent boots collided. F4 is the same defect with a different DDL statement. The accepted fix is an **advisory lock around the whole chain**, which is what §4 T5 adopts — mature ecosystems converged on it, so we are not inventing.
- **[Kleppmann, *How to do distributed locking*](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)** — a lock whose holder can be preempted without knowing needs a **fencing token**; an advisory lock that cannot refuse is not mutual exclusion at all. Our soft lock is weaker than his worst case: it is acquired *after* the write and has no refusal path.
- **Advisory-lock literature generally** — POSIX advisory locks only bind callers that check them. Our `set_file_notes` never checks; it only writes. This is the documented way advisory locking fails, and we implemented it by accident rather than by choice.

**Where prior art was thin:** nobody has published on *attribution* correctness in
agent memory stores — who a stored record is credited to when several agents
share one. Per charter §7, that lowers confidence and means we are the ones who
will be cited. It is also the finding this project produced by living it.

---

## 4 — Target and rejected alternatives

Per charter §9 this section was written by the lead and not delegated.

### T1 — Attribution comes from the caller, not from a global cursor ⏳ *proposed*

Every write path takes the acting agent's session explicitly. `getCurrentSessionId()`
loses its unscoped form; the 16 call sites in `dispatcher-memory.ts` resolve
identity the way `sessions.ts` already does via `resolveSession()`.

- **Rejected: scope the existing query by `agent_name`.** The minimal change, and
  it fails on the exact case that matters — the dispatcher does not know who is
  calling. `agent_name` is a session-start parameter that `engram_memory` never
  receives. Scoping a lookup by a value you do not have is not a fix.
- **Rejected: infer the caller from `parent_session_id`.** Attractive because the
  column is now populated. Lost because it inverts on the real topology: a lead
  with three live children has three candidate sessions and no way to choose, and
  it silently does the wrong thing rather than refusing.
- **Rejected: accept it and document the column as "approximate".** This is D5's
  status quo, held for a year. MAST's 36.9% is the argument against; so is the
  fact that this project's own lead lost every record it wrote for an entire
  domain review and nobody noticed until it was looked for.

### T2 — File coordination either refuses or is deleted ⏳ *proposed*

Restore `lock_file` / `unlock_file` from the dead `file-notes.ts` — which already
returns `conflict: true` with the owner and expiry — **or** delete `lock_status`,
the `file_locks` table and README:750 outright.

- **Rejected: keep the soft lock and make it refuse.** Sounds like the smallest
  step. Lost because a refusal on `set_file_notes` breaks the one thing agents
  actually do, to protect an annotation nobody requested. Locking must be a
  deliberate call, which is what the dead implementation already got right.
- **Rejected: last-writer-wins, documented.** Honest and cheap, and **still wrong
  because of `COALESCE`**: the outcome is not last-writer-wins, it is a chimera.
  If we choose this, the `COALESCE` must go first, or the documentation is a
  second false claim replacing the first.
- **Rejected: merge the two notes.** No, and worth saying why: merging two agents'
  prose without either agent present is the confident-wrong-answer machine this
  review exists to dismantle.

### T3 — A claim has an owner that can be found, or it is not a claim ⏳ *proposed*

`claim_task` registers its claimer in `agents` in the same transaction. The sweep
keys on last-seen age alone, not on a `status` string that defaults to the one
value that disables it.

- **Rejected: make `agent_sync` default to `status:"working"`.** A one-word fix
  that makes the sweep fire — and makes it fire on *idle agents that are alive*,
  releasing claims out from under working agents. It converts a dead safety net
  into an active hazard.
- **Rejected: expire claims on a timer.** Kleppmann's objection applies directly:
  a timer preempts a holder that has no idea it was preempted, and without a
  fencing token the preempted agent keeps writing.

### T4 — `agent_name` is validated, or the guarantee is restated ⏳ *proposed*

Two agents can pass the same `agent_name` today, which silently collapses the
§12.1 guarantee. Either the server rejects a name already held by a live session,
or README:1098 stops describing it as what "stops concurrent agents from closing
each other's sessions". **Handed to FR-D2** — self-asserted identity is a
provenance question and D2 owns the adversary; D4 owns only the concurrency
consequence.

### T5 — One migrator at a time ✅ *this is §5's second half*

Serialise the migration chain across processes with a `BEGIN IMMEDIATE` around
read-version→run-chain, so the loser waits and then finds nothing to do.

- **Rejected: make every migration idempotent.** The obvious fix, and the one the
  constitution already gestures at by flagging V23. Lost because it is 25
  migrations of retrofit, each a chance to introduce the bug being fixed, and it
  must be remembered by every future author forever. The lock is one place.
- **Rejected: shard the database per process.** `--ide=<key>` already does this
  and it is why the collision is rare in practice. Lost because it solves cold
  start by abandoning the domain: two agents in one IDE are the *supported*
  topology, and sharding them apart means they share no memory at all.

---

## 5 — Binding

**[`tests/e2e/multi-agent-wire.test.ts`](../../tests/e2e/multi-agent-wire.test.ts) — 6 tests.**
Two real `dist/index.js` processes against one project root. Full-suite result
with it added: **675 passing, 36 files.**

What it makes impossible to break quietly:

1. **`claim_task` atomicity is protected** — 10 two-process races, each asserted
   to yield exactly one winner. This is the one property that currently works;
   the test exists so a refactor cannot turn the compare-and-swap into a
   read-then-write without a red build.
2. **Three defects are pinned as defects** — `expect(row.session_id).toBe(sessionB)`
   asserts the *wrong* agent, deliberately. Fixing attribution, file locking or
   stale reclaim must edit those assertions in the same commit, where a human
   reads them. This is the D6/D7 precedent applied.
3. **The session-ordering invariant is asserted** — `sessionB > sessionA` in
   `beforeAll`. It is the root cause of T1, and stating it as a test makes the
   causal chain executable rather than narrative.
4. **The cold-start race asserts only the safe invariant** — the store's
   `integrity_check` must be `ok` and at least one server must answer. Whether a
   given process dies is genuinely racy, and per FR-D6 kill switch 1 a flaky gate
   is worse than none, so the outcome is *reported* to stderr as evidence
   (`servers answering: 1/2, killed by migration race: 1/2`) rather than asserted.

**What this does not catch,** stated rather than glossed: three or more agents;
cross-instance concurrency (`instances.json` is machine-global and untested here);
and any failure that needs real elapsed time, such as the 30-minute lock expiry
(F6) and the 30-minute stale threshold. Those are review, not mechanism.

---

## 6 — Kill switch

1. **If `multi-agent-wire.test.ts` becomes flaky, delete test 6 first — not the
   file.** The cold-start race is the only test here with genuine timing
   nondeterminism. Losing it costs one finding; losing the file costs the whole
   domain's coverage.
2. **If the pinned defects are ever "fixed" by loosening the assertion** — a
   `toBeDefined()` where a specific session id used to be — the pin has become a
   permission slip and the test should be deleted outright. Same rule as
   `KNOWN_INERT` and the D6 swallow ratchet.
3. **If T1 ships and record attribution is still wrong under three or more
   agents**, the per-call-site approach has failed and the answer is a single
   caller-supplied handle on every `engram_memory` call — a breaking change this
   domain deliberately did not propose, because evidence for it does not exist yet.
4. **If `claim_task` atomicity is ever measured to fail**, stop. Every
   coordination target above assumes it holds; it is the foundation the rest of
   the domain would be rebuilt on, and a cracked foundation changes the whole plan.

---

<!-- FOUNDATIONS_D4:COMPLETE -->
