# Agent & Sub-Agent Accountability — Design Proposal

**Date:** 2026-08-02 · **Author:** Opus 5 · **Status:** Proposal for review
**Question addressed:** how do we make a multi-agent workforce traceable and maintainable — so nobody has to guess what agent X did, when, where, or re-open the files it already read — *without* turning Engram into a heavy tool?

**Related:** [`ENGRAM_CONSTITUTION.md`](ENGRAM_CONSTITUTION.md) · [`engram-deep-audit-2026-08-02.md`](engram-deep-audit-2026-08-02.md) · [`trellis-engram-integration-analysis.md`](trellis-engram-integration-analysis.md)

---

## 1. Verdict

**Your goal is right. Two parts of the proposed mechanism would backfire, and — the headline — roughly 70% of what you're asking for is already built into Engram and disconnected.**

Three things exist in the schema today, unused:

| Asset | State | What it was for |
|---|---|---|
| `sessions.parent_session_id` | **Declared in the V1 baseline migration and in `types.ts`. Never written, never read.** `SessionsRepo.create()` doesn't set it | Linking a sub-agent session to its orchestrator — the exact link whose absence causes audit finding N3 |
| `tool_call_log.agent_id` | Column exists; `logToolCall()` passes **literal `null`** every time (`database.ts:420`) | Attributing every tool call to an agent |
| `replay` action | **Fully implemented in `intelligence.ts` — dead code, zero references.** Its own description reads: *"reconstructing what sub-agents did, and auditing multi-agent sessions"* | Chronological reconstruction of everything a session did |

So the feature you're describing was designed, partially built, and then disconnected during the v1.6 dispatcher consolidation — the same refactor that dropped the validation in audit finding N4. **The cheapest path to your goal is reconnection, not construction.** That also answers your weight concern directly: the light version isn't a compromise, it's the actual work.

---

## 2. Where the instinct is right

Three parts of your framing I'd keep unchanged, because they're load-bearing:

1. **"Traceable, maintainable, no re-deriving."** This is the correct success criterion, and it is measurable — see §9. It is also the only justification Engram has for existing at all.
2. **"Even if it forgot something, there's hope to figure out what was left."** This is the sharpest idea in your message, and it's stronger than you framed it. See §7 — it inverts the whole design in a useful way.
3. **"Automation is good but needs to be wired wisely."** Correct, and the wiring detail matters more than the automation. See §6.

---

## 3. The two traps

### Trap 1 — "A note on every file read" produces slop, not memory

A mandatory per-file note is a compliance target, and agents satisfy compliance targets cheaply. You get 40 notes saying *"this file handles sessions."* That removes no work from the next agent, and it actively costs.

**Two pieces of published evidence make this concrete rather than a matter of taste:**

1. **Agents don't comply anyway.** *"Do AI Coding Agents Log Like Humans?"* (arXiv 2604.09409) studied 4,550 agentic PRs across 81 repos: agents **fail to follow explicit logging instructions 67% of the time**, and even where instructions were detailed, compliance was only **27%**. Humans performed 72.5% of the post-hoc repairs. The paper's own conclusion is that *"deterministic guardrails might be necessary."* A mandate is not a mechanism.

2. **Low-value notes actively degrade retrieval — they don't just take up space.** Chroma's *Context Rot* study (18 frontier models incl. Claude 4, GPT-4.1, Gemini 2.5) found that **even a single distractor reduces performance below baseline, and four distractors compound it** — and that topically-related-but-wrong items are the ones most often confused with the correct answer. In their LongMemEval test a focused 300-token prompt massively outperformed a 113K-token prompt *containing the same answer*.

Forty notes saying "this file handles sessions" are exactly the topically-related-but-wrong distractors that finding describes. They would make the two genuinely good notes **harder** to retrieve.

I also have direct evidence from this very audit. My subagents produced genuinely useful file mapping — but not because a rule required it. They produced it because they were given a **deliverable** (build the constitution) with a specified shape. Under a rule instead of a deliverable, the same models would have written 90 one-liners.

This is Trellis's Principle 1 applied: *structure earns its place by removing work, not describing it.*

**The fix is not to drop the goal — it's to split it.**

| | **Coverage** | **Understanding** |
|---|---|---|
| Claim | "Agent X looked at these 40 files" | "This file does Z; the gotcha is W" |
| Value per unit | Near zero | High |
| Value in aggregate | **High — and mostly *negative*:** *"already examined, nothing recorded, so probably nothing there"* | High |
| Cost to produce | Zero (observable) | Real (requires comprehension) |
| Volume | 40/session | 2–5/session |
| Right mechanism | **Automatic, batched, one write** | **Deliberate, nudged, never mandated** |

Conflating these is the design error. **Coverage should be free and automatic; understanding should be rare and deliberate.** Mandating understanding at coverage volume gets you neither.

Worth noting: nothing in Engram currently records file *reads* at all. `changes` records writes only. So the coverage half — the cheap, automatable half that stops re-reading — is the piece genuinely missing, and it's the one you can get almost for free.

### Trap 2 — Engram cannot enforce anything, and designing as if it can is the failure

Engram is a tool the agent calls. It has no supervisor position. It cannot make a subagent write a note, cannot detect that a subagent read a file, and cannot stop one from exiting silently. Any design whose integrity depends on "the subagent must…" is depending on a promise nothing checks.

Enforcement, where it exists at all, lives in exactly two places — **the spawn prompt** (soft) and **a harness hook** (hard, and harness-specific).

But this constraint is a gift, because it forces the design onto better ground: **stop trying to guarantee the record exists; make its absence loud.**

An agent can lie in a summary. An agent that crashed, ran out of context, or was killed mid-task **cannot** produce a close-out at all — and that hole is queryable. The trustworthy signal isn't the self-report; it's the gap. See §7.

---

## 4. The minimum record

Per delegation, to never have to guess again, you need seven facts:

| # | Fact | Today |
|---|---|---|
| 1 | Who ran it | ✅ `sessions.agent_name` |
| 2 | Under whom | ⚠️ **`parent_session_id` exists, never written** |
| 3 | What was asked | ✅ `tasks` + `agent_role:"sub", task_id` |
| 4 | What was **written** | ✅ `changes` table |
| 5 | What was **read** | ❌ **nothing records this** |
| 6 | What was concluded | ✅ `decisions`, `observations`, `file_notes` |
| 7 | Did it finish, and what's left | ❌ **no outcome field**; free-text `summary` only |

Five of seven already work. The gap is rows 2, 5, 7 — and row 2 is a column that already exists.

**Two levels of resolution, not one.** This is what keeps it light:

- **Level 1 — the close-out.** Always present, one row, ~150 tokens. Answers "what did agent X do." This is what the orchestrator reads.
- **Level 2 — the replay.** On demand only, reconstructed from `tool_call_log` via the already-written `replay` action. Answers "what path did agent X take." Nobody pays for this until they need it.

You asked for both. You only need to *store* the first, because the second is already being logged and just isn't queryable.

---

## 5. Schema and surface deltas

Deliberately minimal. **Zero new tables. Zero new actions.**

| Change | Where | Why zero-cost |
|---|---|---|
| **Write `parent_session_id`** on sub-session create | `sessions.repo.ts`, `sessions.ts` | Column already exists — **no migration** |
| **Pass the real agent** to `logToolCall` | `database.ts:420` | Column already exists — replaces a hardcoded `null` |
| Add `outcome` + `files_examined` to sessions | one migration, two columns | Additive |
| Extend `engram_session(action:"end")` with `outcome` (enum: `completed`/`partial`/`blocked`/`failed`) and `files_examined: string[]` | `sessions.ts` | **Extends an existing action — adds no new routing decision.** Per the Trellis analysis, new *actions* are the expensive thing; new *params* are nearly free |
| Surface `sub_sessions[]` on primary session start | `sessions.ts` | One field, capped |
| Un-kill `replay` | move from dead `intelligence.ts` into `dispatcher-memory.ts` | Already written and tested-by-existence |

Two correctness fixes this depends on, both already in the audit:

- **N3 must be fixed first.** With sessions clobbering bidirectionally, `parent_session_id` would link to the wrong parent. Building accountability on that is building on sand.
- **`file_notes` upsert needs a degrade guard.** It's keyed on `file_path`, so two subagents examining the same file overwrite each other; `COALESCE` stops a `null` from blanking a field but does **not** stop a thin summary replacing a rich one. Rule: don't replace a non-empty `executive_summary` unless `content_hash` changed. Small, precise, and it becomes essential the moment subagents write concurrently.

---

## 6. Automation, wired wisely

The hard constraint: **Engram cannot see the agent's `Read`/`Edit`/`Bash` calls.** It only sees calls made to *itself*. So "automate it based on what tools the subagent interacted with" is not implementable inside Engram. It requires a **harness hook**.

That means the honest shape is: **Engram ships the hook script; the wiring is per-harness.** Engram already ships a git `post-commit` hook, so the pattern and the installer surface exist — this is the same idea applied to tool events.

### 6.1 Verified: the mechanism exists, and for Claude Code it is better than needed

Claude Code documents **31 hook events**. Three facts settle the design:

- **`PostToolUse` payload carries the file path.** For `Read`/`Edit`/`Write`/`MultiEdit`, `tool_input` contains `file_path`. Coverage capture requires **zero agent effort**.
- **Hooks fire *inside* subagents, and the payload identifies which.** When a subagent calls a tool, the payload includes **`agent_id` and `agent_type`**. This is the single fact the whole design depended on, and it is explicitly documented rather than inferred.
- **`SubagentStart` / `SubagentStop` exist.** `SubagentStart` carries `agent_type`, `agent_id`, `prompt`; `SubagentStop` carries `last_assistant_message` and can even *block* the subagent from stopping.

`SubagentStop` is a better flush point than session end — it fires exactly once per subagent, at the boundary, with the agent's own final message in hand. A hook can shell out, POST, or **call an MCP tool directly** — so it can invoke Engram itself.

### 6.2 Harness coverage — plan for degradation

| Harness | Tool hooks | Session start/end | Sees file paths | **Fires for subagents?** |
|---|---|---|---|---|
| **Claude Code** | `PreToolUse`/`PostToolUse`/`PostToolBatch` | `SessionStart`/`SessionEnd` | ✅ `tool_input.file_path` | ✅ **documented**, with `agent_id`/`agent_type` |
| **GitHub Copilot** | `preToolUse`/`postToolUse` | `sessionStart`/`sessionEnd` | presumed via `toolArgs` | ✅ documented — **but the built-in `general-purpose` agent emits no `subagentStart`/`Stop`** |
| **OpenAI Codex CLI** | `PreToolUse`/`PostToolUse` | `SessionStart`/`SessionEnd` | presumed | ⚠️ partial — subagent hooks use the parent session id, but `SessionEnd` explicitly does not run for subagents |
| **Cursor** | `beforeReadFile`, `afterFileEdit`, … | `stop` | ✅ per-file | ⚠️ `subagentStart`/`Stop` reported, primary docs unreachable |
| **Windsurf** | `pre/post_read_code`, … | ❌ turn-level only | ✅ `file_path` | ❓ undocumented |
| **Cline** | `beforeTool`/`afterTool` | `beforeRun`/`afterRun` | presumed | ❓ undocumented · **macOS/Linux only — no Windows support** |
| **Gemini CLI** | `BeforeTool`/`AfterTool` | `SessionStart`/`SessionEnd` | unconfirmed | ❓ undocumented |

**Design consequence:** build for Claude Code first, where the capability is complete and confirmed. Everywhere else the same field is filled by the `files_examined` param, so the feature degrades to prompt-driven rather than breaking. Cline's lack of Windows support is worth noting given this project's own dev platform.

**The wiring detail that matters most — and the one that would sink a naive implementation:**

> **Never write to SQLite per tool call.**

A `PostToolUse` hook writing a row per file read, across N concurrent subagents, is write amplification against a single WAL database. Engram already has 15s `busy_timeout` and per-IDE sharding *because* contention has bitten this project before.

Correct wiring:

```
PostToolUse hook  →  append one line to .engram/reads-<session>.log   (append-only, no lock, no DB)
                          ↓
engram_session(end)  →  ingest, dedupe, cap, write ONCE to sessions.files_examined
                          ↓
                     delete the scratch file
```

One DB write per subagent session instead of one per file. Append-only files are the one thing that survives concurrent writers without coordination. If the hook can't be installed, the same field is filled from the `files_examined` param — so **the automatic and manual paths write to the identical place**, and nothing downstream cares which produced it. That's the property that makes the automation optional rather than load-bearing.

---

## 7. Making absence visible — the safety net

This is where your "even if forgot, still hope to figure out what was left" idea becomes the strongest part of the design — and the research promotes it from *safety net* to **primary mechanism.**

The 67% non-compliance figure (§3) is decisive. If roughly two thirds of instructed self-reports never happen, then a design whose main path is "the agent writes a close-out" has a main path that fails most of the time. So the ordering inverts:

| | Mechanism | Reliability |
|---|---|---|
| **Primary** | Hook-captured coverage + `SubagentStop` (§6) | Mechanical — no agent cooperation required |
| **Secondary** | Absence detection (below) | Cannot be skipped, because it detects *not doing* |
| **Tertiary** | Agent-authored `outcome` / `summary` | ~33% expected compliance; treat as a bonus, never a dependency |

Every self-reported field can be gamed or skipped. **The absence of a record cannot be** — an agent that died mid-task leaves exactly the same hole whether it meant to or not. So put the integrity there:

| Detectable state | What it means | Cost to detect |
|---|---|---|
| Sub-session with `ended_at IS NULL` and no heartbeat | Agent died or was killed mid-task | A query |
| Sub-session ended, `outcome` absent | Exited without closing out | A query |
| `outcome = 'partial'` or `'blocked'` | Self-declared incompleteness — trustworthy, since claiming it is against the agent's interest | A query |
| Task `claimed_by` set, claimer's session closed | Orphaned claim | Already partly detected at session end |
| `pending_work` still `pending`, owning session closed | Declared work never completed | A query |

Surface these as one `unfinished[]` array on the orchestrator's session start. That single field answers *"what was left?"* without anyone having written anything down — which is precisely the case you're worried about.

**Design consequence worth stating plainly:** the value of `outcome` is not that agents report honestly. It's that `completed` is a *claim on the record* — one that `replay` and `changes` can be checked against. A claimed `completed` with zero recorded changes is now a visible contradiction. Self-report plus a cross-checkable trail beats either alone.

---

## 8. Tiering — right instinct, wrong mechanism

You're right that a pure executor shouldn't carry the same obligation as an explorer. But **don't make it a spawn-time parameter.**

Per the Trellis analysis (§2 of that document): every declared mode is a routing decision, and routing decisions are where the measured 68% of degradation comes from. A four-tier subagent system means the orchestrator picks a tier on every spawn, and picks wrong sometimes — for a distinction the data already contains.

**Derive it instead:**

| Observed | Obligation | Enforced by |
|---|---|---|
| Session had **no** Engram writes and examined no files | Close-out only (`outcome`) | Nothing — it's already satisfied |
| Session **wrote** to files | Close-out + `record_change` | Already an agent rule (AR-01) |
| Session **examined** files without writing | Close-out + a nudge to leave `executive_summary` on the 2–3 files it spent longest in | `workflow-advisor.service.ts` — the nudge engine already exists |
| Session ended `partial`/`blocked` | Close-out + open items become tasks | Nudge |

Same behaviour you wanted, **zero new decisions for the orchestrator**, and it uses the advisor that's already shipping. The shape self-adapts from what actually happened rather than from what someone predicted at spawn time.

If a harder gate is ever wanted, it belongs in the **spawn prompt**, not in Engram — because that's the only place with the authority to impose it.

---

## 9. Weight budget

You were explicit that Engram must not get heavy. Holding the design to a stated budget, and putting a kill switch on it (Trellis §17):

| Dimension | Cost | Notes |
|---|---|---|
| New tables | **0** | |
| New actions | **0** | Extends `end`; `replay` is a *move*, not an addition |
| New params | 2 on `end` | `outcome`, `files_examined` |
| Migration | 1, two additive columns | `parent_session_id` needs none |
| DB writes per subagent | **1** | Not one per file |
| Tokens on sub-agent slice | **0** | Unchanged |
| Tokens on orchestrator start | **≤120**, capped | `sub_sessions[]` + `unfinished[]` |
| Lines of code | ~200 est. | Plus deleting the dead copy of `replay` |

**Kill switches — write these down before building:**
1. If orchestrator session-start cost exceeds 120 tokens for these fields and the proposed fix is "raise the cap," cut the fields instead.
2. If `files_examined` is never read by any subsequent session over a meaningful sample, delete it. (Measurable: it's a query.)
3. If `outcome` is `completed` >95% of the time *including* sessions with zero recorded changes, the field is being rubber-stamped — stop trusting it and rely on §7's absence detection alone.

---

## 10. What I'd reject, and why

| Idea | Verdict | Reason |
|---|---|---|
| Mandatory note per file read | **Reject** | §3 Trap 1. Produces slop, adds retrieval noise, and the volume makes the good notes harder to find |
| Per-tool-call DB write | **Reject** | Write amplification against one WAL file with N concurrent subagents; this project has already been bitten by contention |
| A new `engram_handoff` tool or a subagent-specific action set | **Reject** | Adds routing surface for a job existing actions do. Engram is already at 75 actions with unmeasured selection accuracy |
| Spawn-time tier parameter | **Reject** | §8 — derive it; don't add a decision |
| Free-text handoff docs as the primary record | **Reject as primary, keep as optional** | Free text is the injection vector (audit N1) and isn't queryable. Structured fields first; prose as an attachment |
| A new `agent_runs` table | **Reject** | `sessions` + `parent_session_id` *is* that table. It was designed for this |

---

## 11. Sequence

| Phase | Work | Depends on | Effort |
|---|---|---|---|
| **0** | Fix N3 (session identity, `parent_session_id` wired, never auto-close another agent's session) | — | M |
| **1** | Pass the real agent to `logToolCall`; move `replay` into the live dispatcher | 0 | **S** |
| **2** | `outcome` + `files_examined` on `end`; `file_notes` degrade guard | 0 | S |
| **3** | `sub_sessions[]` + `unfinished[]` on orchestrator session start (§7) | 1, 2 | S |
| **4** | Derived nudges in `workflow-advisor` (§8) | 2 | S |
| **5** | Optional harness hook for automatic coverage capture (§6) | 2 | M |

**Phases 1–3 are where nearly all the value is, and they are mostly reconnection.** Phase 5 is the only genuinely new machinery, and it's optional by construction — the manual path writes to the same field.

---

## 12. Open risks

1. **This is only as good as N3's fix.** Everything here assumes a session belongs to exactly one agent and links to exactly one parent. That is not true today.

2. **The strongest counter-argument: a note is the wrong unit of handoff.** Cognition's *Don't Build Multi-Agents* argues that summarized handoffs are the failure mode, not the fix — two subagents given the "same" stated task make silent conflicting assumptions because a note cannot carry the tool-call history and interim decisions that actually caused the divergence. Their prescription is the opposite of structured notes: *"share context, and share full agent traces, not just individual messages."*

   **Response, and it strengthens the design rather than undermining it:** this is precisely why §4 specifies **two levels of resolution**. The close-out is for routine "what did X do." The **replay** — reconstructed from `tool_call_log` once `agent_id` is populated — *is* the full trace, available on demand when reconciliation is actually needed. Cognition's critique lands hard against a note-only design; it does not land against note-plus-trace. It does, though, mean **wiring `agent_id` into `logToolCall` is not a nice-to-have** — it is what makes the answer to their objection real. That moves it up the priority list.

3. **Investing in multi-agent tracing can encourage more multi-agent use than is warranted.** Anthropic's own multi-agent post concedes ~**15x** the tokens of a single chat interaction, with token usage explaining ~80% of eval variance; independent 2026 estimates put orchestrator-pattern overhead at up to ~285% plus ~4.8s added latency. Good tracing must not be read as a reason to fan out more. It also sets the bar for this design's own budget: tracing overhead has to be rounding-error against a 15x baseline, which the §9 budget (≤120 tokens, one write per subagent) satisfies.

4. **`files_examined` must not become a retrievable memory.** Per the Chroma distractor finding (§3), the danger is not storage but *competition at retrieval time*. Coverage data is therefore specified as a **session-scoped column, deliberately excluded from FTS5 and from `search`** — it is answerable by "what did session #12 look at," never surfaced as a search hit competing with an actual conclusion. If it ever gets indexed, it becomes the exact distractor class the research warns about.

5. **No surveyed system has "files touched" as a first-class handoff field** — not LangGraph, CrewAI, AutoGen/AG2, the OpenAI Agents SDK, nor Anthropic's own multi-agent system. That is either a genuine gap worth filling or a sign nobody needs it. Kill switch #2 in §9 is the test.

6. **Align field names to OpenTelemetry GenAI semconv rather than inventing a vocabulary.** The standard already defines `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.conversation.id` (→ session id), `gen_ai.operation.name`, and `gen_ai.tool.name`/`tool.input`, and its native **parent-span relationship already expresses orchestrator→subagent nesting** — which is exactly what `parent_session_id` does. It defines **no** `trust_tier` or `confidence` attribute, so those remain legitimately domain-specific inventions. Borrowing the names costs nothing now and buys interoperability later.

---

## 13. Should Engram memory be committed and pushed?

**Yes to sharing the value. No to committing the database.** The distinction is the whole answer.

### 13.1 The case for is real

90 file notes, 13 observations and 10 decisions are genuine work. If they stay on one machine, the next contributor — human or agent — re-reads and re-derives, which is the exact amnesia Engram exists to prevent. Trellis §21.1 states it bluntly: *"uncommitted memory is amnesia."*

### 13.2 Three reasons not to commit `.engram/memory.db`

**1. It is a binary, and version control cannot help you with it.** No reviewable diff, so nobody can see *what* a commit changed about the agent's beliefs. **No merge**: two contributors who both worked with Engram produce two `.db` files that cannot be reconciled — `.gitattributes merge=union` works on append-only text, not SQLite pages. And it churns constantly: 584 KB today, rewritten on every session start, growing unbounded.

**2. It re-opens audit finding N1.** Committed agent memory that is auto-loaded into agent context **is** the MemoryTrap vector (CVE-2026-21852). Commit the DB and anyone who can open a pull request can write to the agent's authoritative memory, and every clone carries it. Engram's `.engram/.gitignore = *` is a deliberate security control, not an oversight. This is also the flaw I identified in Trellis §21.1 — it mandates committing state while its own §13 threat model forbids exactly that trust relationship.

**3. Secrets and machine identity.** The `config` table holds `machine_id` (on Windows, the registry `MachineGuid`), `instance_id`, and `http_token`. Committing the raw DB publishes your machine's GUID and the dashboard bearer token.

That third problem is already solved for the *export* path: **`engram_admin(action:"export")` dumps eight tables — `sessions, changes, decisions, file_notes, conventions, tasks, milestones, scheduled_events` — and `config` is not among them.** Verified in source. The export is safe where the database is not.

### 13.3 What to share, and in what form

Ranked by value per unit of risk and churn:

| Content | Share? | Form |
|---|---|---|
| **File notes** | ✅ highest value | **Already done** — see below |
| **Decisions** | ✅ high value, low churn | Text export, reviewed as a diff |
| **Conventions** | ✅ | Text export |
| **Observations** | ⚠️ selectively | Free text = injection surface (audit N1). Export, but import non-binding |
| **Tasks** | ⚠️ open ones only | Closed tasks are noise |
| **Sessions** | ⚠️ summaries only | Rows carry `project_root` absolute paths — strip |
| **Changes** | ❌ | High volume, and **git already has this** |
| **Config** | ❌❌ **never** | `machine_id`, `http_token`, `instance_id` |
| **The `.db` itself** | ❌ | §13.2 |

**The most useful realisation: the highest-value memory is already shared.** [`ENGRAM_CONSTITUTION.md`](ENGRAM_CONSTITUTION.md) contains essentially all 90 file notes as reviewable markdown, and it is committed. That is a *better* artifact than a JSON export — diffable, human-readable, reviewable in a PR, and useful to someone who has never installed Engram. Markdown export > JSON export > binary DB, and the markdown one is done.

So the remaining gap is small: decisions and conventions, which the constitution does not carry.

### 13.4 The rule

> **The repository is canonical for the *export*. The database is a local working copy, and is regenerable from the export.**

Which is the same rule already applied to skills packaging, and the correct resolution of Trellis §21.1.

Two constraints on the import side, both non-negotiable, and both already specified by the audit's provenance recommendation:

1. **Import is never automatic.** A cloned or pulled export must not load itself. Explicit action only.
2. **Imported records are provenance-tagged and non-binding** — `source: "imported"`, lower trust tier, never auto-marked `active`, excluded from auto-loaded session context until a human or agent promotes them. This is what stops a hostile PR from doing via the export what N1 does via the cache.

With those two, sharing memory is safe. Without them, committing memory *is* the vulnerability — which is why the sequencing matters: **provenance columns (audit rec #12) ship before, or with, any committed export.**

### 13.5 Concretely

1. Keep `.engram/` gitignored. No change.
2. Commit a regenerated `docs/engram-memory/decisions.md` + `conventions.md` — deliberate, reviewed, text.
3. Add provenance columns before wiring any import path.
4. Treat regeneration as a release step, not a per-session write, so churn stays low.

---

*Sections 3, 6, 7, 12 revised and §13 added 2026-08-02 against verified harness documentation and published evidence.*

<!-- AGENT_ACCOUNTABILITY_DESIGN:DRAFT -->
