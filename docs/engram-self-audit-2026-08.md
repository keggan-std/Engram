# Engram Self-Audit — Architecture, Security, and Orchestration Review

**Date:** 2026-08-01
**Branch:** `review/engram-audit` (off `develop`, not merged)
**Scope:** Full-surface review of `engram-mcp-server` — architecture, security, maintainability, and fitness for (a) coding-agent memory, (b) general chat memory, (c) mobile, (d) main-agent/sub-agent orchestration.
**Method:** Dogfooding (Engram was used live, via its own tools, to record every finding below as it was made — see Appendix A), direct source review, live reproduction of suspected bugs, and external research (5 named repos + broader 2026 agent-memory/security landscape).
**Versions in play:** local checkout `package.json` = 1.11.0; the live MCP server actually answering tool calls during this audit (spawned via `npx -y engram-mcp-server` per `.mcp.json`) reported `server_version: 1.12.0`. Findings from live testing reflect 1.12.0 behavior; findings from source reading reflect this checkout (1.11.0-tagged, `develop`). Where this matters it's called out explicitly.

---

## 1. Executive Summary

Engram's core bet — structured, agent-curated SQLite memory instead of a vector store — is **not a naive architecture**. External research confirms it sits in the same design family as Anthropic's own first-party `memory_20250818` tool and Letta's "core memory" tier, and at least one direct competitor (`ai-memory-mcp`) markets the identical SQLite+FTS5 approach as a selling point. The tiered-verbosity/universal-mode work in v1.6–1.11 is a genuine, measured response to real token-overhead complaints, and the project's own internal experience logs (`docs/v1.11-dx-experience-log.md`, `docs/pm-feature-experience-log.md`) show an unusually disciplined habit of dogfooding and recording friction — better self-awareness than most projects this size.

That said, this audit found **two critical, live-reproduced bugs** that directly undermine the two features Engram leans on hardest in its own marketing: multi-agent orchestration and "no cloud, no telemetry" trust.

1. **Sub-agent sessions silently destroy the primary agent's session** (Finding 1, CRITICAL). This is not theoretical — it was reproduced end-to-end in this very audit session.
2. **"Binding" agent rules are fetched live from a mutable GitHub branch with no integrity verification**, and this data flow is undisclosed in `SECURITY.md` (Finding 2, CRITICAL).

Beyond those two, this audit found a token-budget bug that defeats Engram's own headline efficiency claim under the verbosity tier real orchestration work actually uses (Finding 3), a defense-in-depth gap in cross-instance sharing (Finding 4), stale internal documentation that could cause a future agent to re-fix an already-fixed bug (Finding 5), and an unresolved intermittent transport-level failure the project already knows about but hasn't closed (Finding 6).

**Bottom line for the user's original question** ("does Engram add weight and consume tokens instead of helping"): the philosophy is sound and the team clearly tries to fix exactly this complaint, but as currently shipped there are concrete, fixable defects that actively cause the two failure modes you're worried about — orchestration data loss, and a token-budget blowout in one of four verbosity tiers. None of this requires a redesign; every finding below has a scoped, concrete fix.

---

## 2. Methodology

This audit was itself run as an Engram-managed project, per the request to dogfood the tool while auditing it:

- Created branch `review/engram-audit` off `develop` (never touched `develop` directly).
- Started an Engram session (`engram_session start`) and used `engram_memory(record_observation)` to log every finding **at the moment it was discovered**, tagged `finding`/`concern`/`friction`, before writing any of this document — so the raw, timestamped record in Engram's own `observations` table (Appendix A) is the primary source of truth, and this document is the synthesis.
- Enabled PM-Full (`engram_admin(enable_pm)`) partway through, per the instruction to use it for a task of this size, and used it for the remainder (task creation, decision batching, `get_knowledge`, `pm_status`).
- Used `set_file_notes`/`set_file_notes_batch` on every source file read, both to test the feature and to leave the trail for a future session (per the user's mid-task request).
- Where a suspected defect could be reproduced live rather than only inferred from source, it was — most importantly Finding 1, which was actually triggered and its consequences observed via `get_history`, not just read in code.
- Delegated two research streams to background agents (external repos; broader landscape/security research) with full context of what was already found, so their work targeted gaps rather than restating this document. Their raw output is at `scratchpad/repo-research-findings.md` and `scratchpad/landscape-research-findings.md` (not committed — audit working notes); this document incorporates their verified conclusions inline.
- Every claim below is either (a) a direct source-code citation, (b) a live-reproduced behavior, or (c) an external citation from the research agents' sourced findings. Vendor-only benchmark claims from competitors are flagged as such, not presented as fact.

---

## 3. Findings, Ranked by Severity

### Finding 1 — CRITICAL: Sub-agent sessions silently destroy the orchestrator's session (live-reproduced)

**What:** `getCurrentSessionId()` (`src/database.ts:375`) and `SessionsRepo.getOpenSessionId()` (`src/repositories/sessions.repo.ts:30`) both define "the current session" as:

```sql
SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1
```

This is **global per-database, with no scoping by `agent_name`, `agent_role`, or connection.** `src/tools/sessions.ts` calls this and auto-closes whatever it finds — via `autoClose()`, which overwrites the session's `summary` with the literal string `"(auto-closed: new session started)"` — on **every** `engram_session(start)` call, whether `agent_role` is `"primary"` or `"sub"` (lines 147–149 and 187–188 of `sessions.ts`, identical logic in both branches).

**Reproduced live in this audit:**
1. Primary session #2 (`claude-audit-agent`) open, mid-work, 5 real observations recorded.
2. Called `engram_session({action:"start", agent_role:"sub", task_id:1})` — exactly the pattern documented in the README under "Sub-Agent Sessions (v1.7+)".
3. `get_history` immediately after showed session #2 closed with summary `"(auto-closed: new session started)"` — its real content discarded — and a new session #3 opened for the sub-agent.
4. Called `engram_session(end, summary:"<the primary's real summary>")` to simulate the primary trying to close out normally.
5. Result: `{"message":"Session #3 ended.","stats":{"changes_recorded":0,...}}` — **the primary's real summary was attached to the sub-agent's session record, reporting zero stats despite the summary describing substantial actual work.** The primary's real session (#2) is permanently closed with a useless placeholder and cannot be corrected after the fact.

**Why this matters:** this is precisely the orchestration pattern the user asked this audit to evaluate — "main agent... spawn sub agents... sub agent can go straight with delegated task." Engram's `agent_role:"sub"` context-scoping design (see Finding-adjacent note below) is actually a *good* answer to that ask in isolation. But the session-bookkeeping layer beneath it means using the documented feature as documented **corrupts the orchestrator's own record every time**, and there is no warning anywhere in the response that this happened — an agent has to separately call `get_history` to discover it, which nothing in the current instructions tells it to do.

**What's actually good here, for balance:** the *content* of the sub-agent slice itself (task, up to 5 relevant file notes by tag/path overlap, up to 5 relevant decisions, up to 5 relevant conventions, ~300-500 tokens) is a reasonable, working implementation of "give the sub-agent only what it needs." The bug is entirely in the session-lifecycle bookkeeping around it, not in the context-scoping idea.

**Fix (scoped, no redesign needed):**
- Stop keying "current session" on a single global "most recent open row." Scope it by `agent_name` (and ideally a `parent_session_id` link from sub → primary) so a sub-agent's session start/end never touches the primary's open session.
- `autoClose()` should never fire for a session belonging to a *different* agent than the one calling `start`. If Engram wants to keep single-open-session-per-agent semantics, key the lookup on `WHERE agent_name = ? AND ended_at IS NULL`, not a bare `ORDER BY id DESC LIMIT 1`.
- At minimum as a stopgap: sub-agent session start/end must never call `autoClose()`/`close()` against a session it didn't itself open, and `engram_session(end)` should refuse to close a session whose `agent_name` doesn't match the caller's declared `agent_name`, returning a clear error instead of silently closing the wrong record.
- Add a regression test that starts a primary session, starts a sub-agent session mid-work, and asserts the primary's session is still open and its summary field is untouched.

---

### Finding 2 — CRITICAL: "Binding" agent rules are fetched live from a mutable GitHub branch, undisclosed in SECURITY.md

**What:** `src/services/agent-rules.service.ts` fetches `https://raw.githubusercontent.com/keggan-std/Engram/main/README.md` over HTTPS at runtime, parses a hidden `<!-- AGENT_RULES_START/END -->` comment block, caches it 7 days at `.engram/agent_rules_cache.json`, and injects the result directly into every `engram_session(start)` response as `agent_rules` — a field the agent is told (both in the README and in the rules themselves) is **CRITICAL/HIGH-priority and binding**.

**Why this is a real risk, not a theoretical one:**
- The fetch target is a **mutable branch** (`main`), not a pinned commit SHA or signed release tag, and there is no integrity check (no hash pin, no signature) on the fetched content.
- `SECURITY.md`'s "Network Access" section states the *only* outbound call is the npm version-check ("version number only, no identifying information sent"). **This second call is not disclosed anywhere in that document** — a real accuracy gap in the project's own published threat model.
- Impact if the source repo/branch is ever compromised (maintainer account takeover, a malicious PR that edits the hidden comment block without a reviewer noticing markup that doesn't render in the normal README preview, or any GitHub-side tampering): every Engram install worldwide would begin receiving attacker-controlled "binding" instructions, labeled CRITICAL priority, within 7 days, fanning out across every project using Engram — with no version bump, no changelog entry, and no way for a user to know their agent's behavior changed. External research (Section 6) confirms this exact shape of attack — "session summarization" or "trusted content" pipelines turning untrusted remote content into persisted, later-authoritative agent instructions — is an active, named 2026 threat class (Unit 42's documented case against a production agent is structurally identical), not a hypothetical raised only in this audit.
- Compounding: `refreshInBackground()` swallows all fetch failures in an empty `catch`, so there's no way to tell — short of reading `agent_rules_source` on every single response — whether an install is running live-fetched or hardcoded fallback rules. In this audit's environment, the fetch has never once succeeded (no cache file exists), so `agent_rules_source` was `"fallback"` on every session start tested — itself confirmed as its own finding below (Finding 6b), but note it also means the CRITICAL risk described here is currently **dormant, not active, in this specific environment** — the design flaw exists regardless of whether the fetch is currently succeeding anywhere.

**Fix:**
- Simplest: stop calling remotely-fetched content "binding." Ship agent rules as part of the versioned npm package only (same trust boundary as the rest of the code, auditable at publish time), and drop the live-fetch mechanism entirely.
- If a live-refresh channel is wanted for iterating without a full release, pin to a specific commit SHA or signed tag that matches (or is explicitly newer than, with a visible diff) the installed package version, and verify integrity before use.
- Regardless of which fix is chosen: update `SECURITY.md`'s "Network Access" section to disclose this data flow accurately.

---

### Finding 3 — HIGH: `verbosity:"full"` session start ignores `focus` for the project file tree, defeating the token-budget the rest of the tiering system works hard to hit

**What:** `src/tools/sessions.ts` (full-verbosity branch, ~line 391) unconditionally calls `services.scan.getOrRefresh(projectRoot)` and returns the entire `project_snapshot.file_tree` — every file in the repo — regardless of whether a `focus` string was passed. `focus` filtering (confirmed in source and live) applies only to `decisions`, `tasks`, and `changes`; it was never wired into the file-tree path at all.

**Reproduced live:** `engram_session({action:"start", intent:"full_context", verbosity:"full", focus:"engram self-audit..."})` returned all 311 files in this repo's tree, unfiltered, despite the focus string.

**Why this matters:** v1.11's release notes tout a ~40% session-start token reduction, but that reduction applies to the `summary` tier's caps on decisions/conventions/changes — it says nothing about `full`, which is exactly the tier an orchestrator doing serious multi-file work is likely to reach for (and the tier PM-Full's `phase_work` intent layers on top of). On a repo with thousands of files rather than this project's 311, this would consume a large fraction of a context window on session start alone, for zero targeting value — the opposite of the "session continuity without re-reading everything" pitch.

**Fix — informed by external research, not invented from scratch (Section 6):** don't build a new mode. `codebase-memory-mcp`'s `get_architecture` (see Section 6.2) demonstrates the right shape — a curated digest (entry points, hotspots, most-referenced files), not a raw recursive walk — and Engram already has the signals to build a cheap version of this without a full graph engine: files with `change_type` history, files referenced by active decisions/conventions, files with attached notes, and files matching `focus` keywords. Concretely: apply the *same* `focus`-filtering mechanism already working for decisions/tasks/changes to the file tree, and cap it by relevance-ranking rather than returning the raw walk.

---

### Finding 4 — MEDIUM: Cross-instance `search_all_instances` has a whitelist gap that the equivalent single-instance query path doesn't

**What:** `src/services/cross-instance.service.ts`'s per-type query methods (`queryDecisions`, `queryConventions`, etc., used by `query_instance`) all route through `checkPermission()`, which validates the requested type against a hardcoded `QUERYABLE_TABLES` set before opening the foreign DB — correct defense in depth. `searchAll()` (used by `search_all_instances`), however, **does not call `checkPermission()`** — it reimplements the sharing checks inline, omitting the `QUERYABLE_TABLES` validation, and its generic fallback branch does:

```ts
db.prepare(`SELECT * FROM ${scope} ORDER BY id DESC LIMIT ?`)
```

with `scope` taken directly from the caller's param, gated only by whether the **target instance's own `sharing_types` array** happens to contain that string. Confirmed via `dispatcher-admin.ts`: `set_sharing`'s `types` param is accepted as a raw `z.array(z.string())` with **no enum constraint** — nothing stops a `sharing_types` array from ever containing something other than a real table name.

**Severity context:** `SECURITY.md`'s own threat model excludes issues requiring pre-existing local access, and this requires another local Engram instance with permissive sharing configured — so this is not remotely exploitable. It's flagged because it's exactly the class of bug `SECURITY.md` lists as explicitly in-scope ("SQL injection through user-controlled input reaching SQLite without parameterization"), and because the inconsistency itself (two permission implementations, only one complete) is the kind of drift that gets worse as more cross-instance actions are added.

**Fix:** make `searchAll()` call the same `checkPermission()` used everywhere else instead of re-implementing the check; constrain `types`/`sharing_types` with `z.enum([...QUERYABLE_TABLES])` at the schema boundary so it can never hold anything but a real table name.

---

### Finding 5 — MEDIUM: Stale internal documentation asserts a fixed bug is still open

**What:** `docs/cross-instance-sharing-bugs.md` (dated 2026-03-03) states "Status: Documented, not yet fixed" for cross-instance bugs #26–#29. `git log` shows commit `cb707d0` ("hotfix: fix cross-instance sharing bugs #26-#29") shipped in **v1.9.2** and is merged into both `develop` and `main`. Current version is 1.11.0/1.12.0 — the doc is stale by roughly 8 versions. Source review (Section on Finding 4, above) confirms the fix is real and largely correct (with the one residual gap noted in Finding 4).

**Why this matters beyond tidiness:** this is a concrete instance of the exact failure Engram itself is built to prevent — an agent (or a human) reading project memory and acting on stale information. A future agent told to "check cross-instance sharing bugs" would read this file, conclude the feature is broken, and potentially burn a session re-diagnosing or re-fixing something already resolved — the precise waste Engram's whole value proposition targets.

**Fix:** Either delete/archive resolved bug-tracking docs once their fix ships (move to a `docs/archive/` or delete outright now that git history retains it), or add a lightweight convention/lint: any doc under `docs/` with a "Status: not yet fixed" line gets checked against `git log --grep` for its own bug IDs before being trusted, or simply gets a "Resolved in vX.Y.Z" line added the moment the fix merges. This is a good, low-effort candidate for one of Engram's own `add_convention` entries.

---

### Finding 6 — MEDIUM / tracked-but-unresolved: intermittent `"must be object"` failures (~20% of complex calls, per project's own prior audit)

**What:** `docs/v1.11-dx-experience-log.md` documents ~20% of complex-shaped Engram calls (3+ mixed-type params) failing with `"must be object"` on VS Code Copilot, traced to the **MCP SDK's own pre-Zod input validation**, not Engram's Zod layer — meaning it may not be fully fixable inside Engram alone. v1.11 shipped `coerceStringArray()`/`coerceNumberArray()` coverage for 9 previously-uncoerced fields, which fixes a *related but distinct* class of array-serialization issues, not this one.

**This audit's attempt to reproduce it:** one `record_decisions_batch` call with nested arrays (tags + affected_files across 2 decision objects) succeeded on the first attempt. A single success does not confirm the bug is fixed — the project's own data showed it as *intermittent* (client/timing-dependent), so n=1 is inconclusive either way.

**Recommendation:** this needs a dedicated repro harness (many repeated calls of the documented failure shape, across at least VS Code Copilot and one other client) rather than relying on incidental testing, and — since the project's own analysis suggests the root cause may live in the `@modelcontextprotocol/sdk` package or client-side serialization — filing/checking for an upstream SDK issue, since no amount of Engram-side Zod work fixes a pre-Zod transport rejection.

---

### Finding 7 — LOW / design tension: per-IDE DB sharding contradicts the advertised multi-IDE continuity story

**What:** v1.8.1's per-IDE DB sharding (`memory-<ide>.db` naming) was the right fix for the write-contention bug it targeted, but it means an agent working in one IDE (e.g. Gemini CLI) and an agent working in another (e.g. VS Code/Claude Code) on the **same project** get two entirely disjoint memory stores by default — verified live in this very project, which has both `memory-geminicli.db` and `memory.db` in `.engram/`. The README advertises Engram operating "seamlessly" across Claude Code, Cursor, Windsurf, Cline, Trae, Antigravity, and Copilot in the same paragraph that pitches session continuity — the two claims are only simultaneously true if the user never switches IDEs on a project, or manually sets up cross-instance sharing (opt-in, not default).

**Recommendation:** not a code fix — a documentation-honesty fix. State plainly in the README that continuity is per-IDE-shard by default, and that multi-IDE continuity on one project requires enabling cross-instance sharing (and cross-reference Finding 4's fix, since that's the mechanism that would actually deliver the advertised behavior).

---

## 4. Security Assessment (Consolidated)

Beyond the specific findings above, external research (full detail in `scratchpad/landscape-research-findings.md`) puts Engram's design choices in useful context:

- **Memory poisoning is now an actively-studied 2026 threat class**, distinct from ordinary prompt injection specifically because "the attack only has to succeed once at write-time" (arXiv 2606.04329). A concrete, demonstrated case (Palo Alto Unit 42, against a production Bedrock-agent travel assistant) shows an attacker's webpage content being folded into persisted memory during automatic summarization, later treated as authoritative system instruction, leading to silent data exfiltration in later sessions. This is **structurally identical** to what Engram's `dump` action does: turning free-text (which could originate from pasted external/untrusted content) into auto-classified, later-authoritative decisions/conventions.
  - **Gap found:** `dump`'s output (confirmed live: classifying test text into a `convention` with `confidence: "high"`) carries no provenance marker distinguishing "auto-classified from pasted/external text" from "agent-authored from its own verified work." Recommendation: tag `dump`-sourced records distinctly (e.g., `source: "dump"` vs `source: "agent"` — note `record_observation` already has a `source` field for exactly this purpose; `record_decision`/`add_convention` do not), and consider not marking `dump`-classified decisions/conventions as immediately "active"/binding without a lightweight confirmation step.
- **MCP itself has a documented, large 2026 attack surface** — "tool poisoning" via malicious tool *descriptions* is described in current sources as "the highest-leverage attack on enterprise AI agents in 2026," with 40+ disclosed MCP-implementation CVEs and >30% of a sampled 1,800+ deployed MCP servers found to have at least one exploitable vulnerability. Engram's specific attack surface is narrower than most (local-only, no auth surface, per its own accurate framing in `SECURITY.md`) — but Finding 2 shows the "no network calls" framing itself has a gap.
- **Cross-instance/shared memory is explicitly named in the literature as an amplification vector**, not just a single-victim concern — relevant to Engram's cross-instance sharing feature (Finding 4) and worth keeping in mind if cross-instance sharing defaults or scope ever expand.
- **What Engram already gets right, for balance:** the sensitivity-marking + human-approval-gate model for cross-instance access (`mark_sensitive`/`request_access`/`approve_access`) is directionally exactly what the literature recommends ("principal-aware access control on cross-agent/cross-instance sharing"). The gap to close is symmetry — the audit did not find evidence this gate is enforced on *inbound* imported records the same way it's enforced on *outbound* queries; worth a follow-up check before relying on it as a full security boundary.

---

## 5. Competitive / Landscape Positioning

(Full detail and sources: `scratchpad/landscape-research-findings.md`, Section 1.)

Engram's SQLite+FTS5, schema-typed, agent-curated approach is **not an outlier** — it's architecturally closest to Anthropic's own `memory_20250818` tool and documented "multisession software development pattern" (a progress log + checklist + init script, read every session start, updated every session end — which is exactly what Engram's sessions/decisions/tasks tables formalize into a queryable store instead of flat files). At least one direct competitor (`ai-memory-mcp`) already ships the identical local SQLite+FTS5 model and markets it as a feature, not a limitation.

The field is genuinely crowded (mem0, Letta/MemGPT, Zep/Graphiti, Cognee, plus 5–6 other "memory MCP" servers found in a single search), and 2026-era critique of the space (arXiv 2606.24775) is notably skeptical that memory retrieval reliably improves task success rather than just adding overhead — the exact concern this audit was commissioned to test. Given that, **Engram's durable differentiators are not "structured memory" by itself** (several competitors already do that) — they are the pieces that are genuinely less common in the field: multi-agent coordination primitives (atomic task claiming, specialization routing, broadcast), the sensitivity/access-control model for cross-instance sharing, and PM-Full's phase-gate framework. Positioning and roadmap effort should concentrate there rather than on storage-architecture messaging.

---

## 6. What the Five Named Repos Actually Offer

(Full per-repo detail, maturity signals, and honest relevance verdicts: `scratchpad/repo-research-findings.md`.)

1. **Agent-Reach** (Panniantong) — **Medium-high relevance.** Its `doctor` command actively *probes* each backend and reports why one failed, rather than silently degrading — a near-literal template for fixing the `agent_rules_source:"fallback"` visibility gap (Finding 6b) and for a future "why is X falling back" diagnostic generally. Its single-prose-doc-instead-of-many-tool-schemas design is also a working existence proof for Engram's still-experimental "thin-client" (~0-token) mode.
2. **codebase-memory-mcp** (DeusData) — **High relevance; the most directly actionable of the five.** As it happens, this exact MCP server was active in this very session (per the harness's own code-discovery instructions) and can be treated as a live comparison, not just a README read. Its `get_architecture` (curated digest — entry points, hotspots, clusters — never a raw file dump) is the concrete model for fixing Finding 3. Its `detect_changes` (git-diff mapped to specific symbols with risk classification) is sharper than Engram's blanket content-hash staleness flag and worth studying for a future improvement (not an immediate finding). Importantly, its own docs don't claim a code graph replaces prose decision records — validating that Engram's decisions/conventions remain complementary to, not obsoleted by, a code-graph approach.
3. **defuddle** (kepano) — **Medium relevance.** Two concretely portable ideas: (a) a `--property <name>` single-field extraction mode as a second, narrower response tier — applicable to sub-agent slices wanting exactly one thing rather than a fixed bundle; (b) always reporting what was included/measured (word count, parse time) alongside content, never only in a debug mode — Engram should adopt the equivalent for every filtered/capped response ("6 of 18 conventions shown" is already done in the `summary` tier; extend this convention everywhere something is capped, including the fix for Finding 3).
4. **browser-harness** (browser-use) — **Medium relevance.** Its domain-scoped, agent-authored skill files (partitioned per site rather than one growing blob) is a concrete idea for scoping sub-agent slices by the task's actual file/module footprint, not just `task_id` — worth considering alongside the Finding-1 fix. No checkpointing/session-resumption mechanism is documented in it, so nothing to borrow there specifically.
5. **humanizer** (blader) — **Low/no relevance**, reported honestly rather than forced: it's a style/tone rewriting scrubber for AI-generated prose, solving a surface-level problem (removing "AI-tell" phrasing patterns) with essentially nothing in common with Engram's semantic classification (`dump`/`record_observation`) or PM nudging mechanisms.

---

## 7. Orchestration / Sub-Agent Deep Dive (the user's core question)

This was the most important question this audit was asked to answer, so it gets its own section synthesizing Findings 1–3 against the external research.

**Current state:** Engram's `agent_role:"sub"` + `task_id` mode is a genuinely reasonable *design* for the problem the user described — giving a spawned sub-agent a small, task-scoped slice (task details, up to 5 relevant file notes with their executive summaries, up to 5 tag/file-overlap-matched decisions, up to 5 matched conventions, ~300–500 tokens) instead of making it re-read everything the orchestrator already knows. That is the right shape.

**But it fails on exactly the axis the research says matters most.** The MAST taxonomy (Cemri et al., arXiv:2503.13657 — 1,600+ annotated multi-agent traces across 7 frameworks) finds that **specification issues (~42%) and inter-agent misalignment including context loss during handoff (~37%) account for ~79% of all multi-agent failures** — not model capability. Engram's Finding 1 bug is a severe, concrete instance of exactly this failure category: the handoff mechanism itself corrupts the orchestrator's state.

Two further gaps against the state of the art, found by comparing Engram's slice against Anthropic's own documented multi-agent research system and the MAST taxonomy:

- **No constraint propagation after spawn.** Anthropic's writeup stresses that a subagent needs "clear task boundaries," not just background facts — MAST's "specification issues" category includes "conflicting constraints" and ambiguous scope as leading failure causes. Engram's sub-agent slice hands over facts (files, decisions, conventions matched at spawn time) but has no mechanism to push an update into an *already-spawned* sub-agent's context if the orchestrator learns something new mid-flight (e.g., "that API is now deprecated, don't use it"). This is a known, real limitation to flag, not necessarily a bug to fix immediately — it should be validated against a concrete test case before prioritizing.
- **Findings flow back as free text, not references.** Anthropic's system explicitly moved *away* from subagents returning full findings through the conversation channel, to a filesystem-reference pattern (subagent writes full output to storage, returns a lightweight pointer) specifically to cut token overhead and information loss. Engram's sub-agent session ends the same way a primary session does — a free-text `summary` string — which is reasonable for short summaries but doesn't obviously scale if a sub-agent's findings are large; worth keeping in mind if sub-agent tasks grow more complex than the current design anticipates.

**Recommendation set for orchestration, in priority order:**
1. Fix Finding 1 first — nothing else about the sub-agent feature matters if using it corrupts the orchestrator's own bookkeeping.
2. Add a way to inspect "is a sub-agent session currently open under me" from the primary side (e.g., surface `open_sub_sessions` in the primary's session-start response) so an orchestrator can reason about in-flight delegation instead of it being invisible state.
3. Consider scoping sub-agent slices by file/module footprint in addition to `task_id` (per browser-harness's domain-scoping pattern, Section 6.4) for tasks that don't map cleanly to one task record.
4. Treat the MAST taxonomy as an ongoing audit checklist for this feature specifically, not just a one-time citation — it's the most rigorous, quantified failure-mode data available for exactly this mechanism.

---

## 8. Chat-Memory (Non-Coding) Fit

Engram's data model (decisions, conventions, tasks, file notes, change history) is fundamentally **project/codebase-shaped**. Mapped onto a general chat use case: `record_decision`/`get_decisions` and `record_observation`/`dump` generalize reasonably well (a "decision" or "observation" isn't inherently code-specific), but `file_notes`, `get_dependency_map`, `record_change`, and the git-integration pieces (git hook install, `what_changed`) have no equivalent in a non-coding chat and would sit unused. Session lifecycle (`start`/`end`/`handoff`) and search generalize cleanly.

**Assessment:** Engram is usable for chat-memory today in a degraded mode (ignore the file/code-specific actions, use sessions + decisions + observations + search), but it is not purpose-built for it, and — per Section 5 — Anthropic's own first-party consumer Memory feature (rolled out March 2026, on web/desktop/mobile) already commoditizes generic "remember things about me across chats" at the platform level. A chat-oriented variant of Engram would need to differentiate on the same axis its coding variant should: structured, queryable, multi-party coordination (e.g., shared project/decision memory across a team's chat threads) rather than competing with Claude's built-in memory on "remembers things about you."

---

## 9. Mobile Feasibility

External research updates a premise worth correcting explicitly: **local/stdio MCP servers (Engram's current architecture) genuinely cannot run on mobile** — confirmed correct — **but "MCP doesn't work on mobile at all" is now outdated.** Claude for iOS/Android has supported **remote** (HTTPS) MCP connectors since July 2025, configured via the claude.ai web UI and synced to mobile automatically. The real constraint is Engram's specific deployment model (a locally-spawned process reading a local SQLite file), not a platform-level impossibility.

There is a working precedent for exactly this gap: **Supermemory** runs a hosted remote-MCP endpoint (`mcp.supermemory.ai`) explicitly marketed for "the same memory across coding agents, chat apps, and IDEs," reachable from Claude mobile today because it's a hosted HTTPS endpoint rather than a spawned process.

**What a hosted Engram variant would require** (not a small lift, and should be scoped as a separate, optional track rather than a near-term feature):
- A hosted, internet-reachable server with its own auth (OAuth/API key) — a materially different security model than "local file, no auth surface, no network."
- A multi-tenancy story: either one hosted instance per user (closer to today's privacy posture) or a shared backend (which reopens every cross-instance-sharing security question in Section 4, at larger scale).
- This would trade away the "zero cloud dependencies" positioning that Engram (and at least one direct competitor) currently uses as a selling point — worth doing deliberately, not accidentally.

**Recommendation:** don't build this speculatively. If mobile/chat reach becomes a real goal, treat it as a distinct product surface (hosted variant) with its own security review, not a retrofit of the local-first server — and validate demand before investing, since Anthropic's own commoditized mobile memory feature reduces the generic-memory pitch's novelty.

---

## 10. Maintainability & Codebase Navigability

Overall: **good, above average for a project this size**, with one structural smell worth flagging before it compounds.

**Strengths:**
- `.github/copilot-instructions.md` is an excellent, concrete onboarding document — it states the exact file layout, the critical conventions (response helpers, logging via `console.error` only, Zod coercion rules, enum-not-raw-string discipline), and even documents known transport-level gotchas (`HandlerCapturer` bypassing Zod). A new contributor or a fresh agent session has a genuinely fast path to productive work here.
- The repository/service/tool-dispatcher layering (`repositories/` = SQL, `services/` = business logic, `tools/` = MCP-facing dispatch, `response.ts` = one shared response shape) is a clean, consistently-followed separation, and the project's own convention docs enforce it.
- The habit of writing dated experience logs after real sessions (`docs/*-experience-log.md`) is genuinely unusual and valuable — it's exactly the kind of self-observation this very audit is trying to encourage, and it should be *kept*, not replaced by this document.

**Gaps:**
- **`dispatcher-memory.ts` and `dispatcher-admin.ts` are large, single-file switch statements** covering 30+ and 25+ actions respectively. This is a legitimate near-term maintainability risk: as actions keep being added (this project added `record_observation` and `get_knowledge` in just the last two minor versions), these files will keep growing, and a switch-per-action-in-one-file pattern gets harder to navigate and safely modify at scale, even though each individual `case` block is currently readable. Consider splitting by domain (already partially mirrored in `src/tools/*.ts` — `decisions.ts`, `tasks.ts`, etc. — worth checking whether the dispatcher could delegate to those files' logic rather than reimplementing inline).
- **Documentation staleness (Finding 5) is a maintainability risk, not just a correctness one** — `docs/` has accumulated a lot of point-in-time audit/plan documents (this one included) with no visible convention for marking them resolved/superseded. Recommend a light process: any doc that reports a bug status gets a one-line "Resolved in vX.Y.Z" or is moved to an archive folder the moment its fix ships.
- Minor: `src/repositories/sessions.repo.ts:97` and several spots in `dispatcher-admin.ts`/`stats.ts`/`compaction.ts` interpolate a `table` variable directly into SQL. In every case checked, the value came from a hardcoded literal or a pre-validated whitelist (not raw user input) at the call site — not currently exploitable — but it's a repeated pattern that would benefit from a single shared `assertKnownTable(name)` helper so future call sites can't accidentally introduce Finding 4's class of bug by copy-pasting the interpolation without also copying the whitelist check.

---

## 11. Effectiveness, Efficiency, Effectualness — Direct Answer to the Original Question

The user's framing was: does Engram add weight and burn tokens instead of being a genuine "companion helper"? The honest answer, after this audit:

- **Effectiveness (does it do what it says):** Mostly yes, with two important exceptions. Session resume, decisions/conventions/search, file-note staleness detection, and PM-Full all worked exactly as documented when tested live. Sub-agent sessions (Finding 1) and full-verbosity session starts (Finding 3) do **not** do what they say — the first silently corrupts the exact continuity guarantee the whole product exists to provide, and the second silently blows the token budget the tiering system exists to enforce.
- **Efficiency:** Genuinely good in the tiers that work as designed (`nano`/`minimal`/`summary`, universal mode's ~80-token schema) — this is a real, measured engineering effort, not marketing. It falls apart specifically in `verbosity:"full"` (Finding 3), which is not a rare edge case — it's the tier `phase_work`/PM-Full and thorough orchestration work are likely to reach for.
- **Effectualness (does using it leave you better off than not using it):** For single-agent, single-IDE, moderate-verbosity sessions: yes, based on this audit's own experience — decisions, conventions, and search meaningfully avoided re-deriving context. For the specific orchestration pattern the user asked about (main agent delegating to sub-agents): **currently no, until Finding 1 is fixed** — as documented and used today, it actively destroys data rather than preserving it.

None of this requires rejecting the architecture. It requires fixing two concrete, scoped bugs (Findings 1 and 2) before the orchestration and security claims can be trusted, and one more (Finding 3) before the "full" tier can be trusted at scale.

---

## 12. Prioritized Recommendations

| # | Priority | Action | Effort | Ref |
|---|----------|--------|--------|-----|
| 1 | **P0** | Scope "current session" by `agent_name` (or explicit parent/child link); never auto-close a session belonging to a different agent | Small–Medium | Finding 1 |
| 2 | **P0** | Disclose the agent-rules GitHub fetch in `SECURITY.md`; pin to a verified commit/tag or stop treating fetched content as binding | Small | Finding 2 |
| 3 | **P1** | Apply existing `focus` filtering to `project_snapshot.file_tree`, or replace the raw file-tree dump with a curated/ranked digest | Medium | Finding 3 |
| 4 | **P1** | Route `search_all_instances` through `checkPermission()`; constrain `sharing_types` with a Zod enum | Small | Finding 4 |
| 5 | **P1** | Add provenance tagging to `dump`-classified records; don't auto-mark them "active"/binding without confirmation | Small–Medium | Section 4 |
| 6 | **P2** | Resolve or archive `docs/cross-instance-sharing-bugs.md`; adopt a "mark resolved on fix" convention for status-bearing docs | Small | Finding 5 |
| 7 | **P2** | Build a dedicated repro harness for the `"must be object"` transport bug across multiple MCP clients; escalate upstream if SDK-level | Medium | Finding 6 |
| 8 | **P2** | Add an Agent-Reach-style `doctor`/diagnostic surface for silent-fallback conditions (`agent_rules_source`, DB path resolution, etc.) | Medium | Section 6.1 |
| 9 | **P3** | Document the per-IDE DB sharding vs. multi-IDE-continuity tradeoff plainly in the README | Small | Finding 7 |
| 10 | **P3** | Consider splitting `dispatcher-memory.ts`/`dispatcher-admin.ts` by domain as action count keeps growing | Medium | Section 10 |
| 11 | **P4 (exploratory)** | Scope sub-agent slices by file/module footprint in addition to `task_id`; add "open sub-sessions" visibility to primary session start | Medium | Section 7 |
| 12 | **P4 (exploratory)** | If mobile/chat reach is ever pursued, scope it as a separate hosted-variant track with its own security review — don't retrofit the local server | Large | Section 9 |

---

## Appendix A — Raw Observations Recorded in Engram During This Audit

All seven observations below were written to Engram's own `observations` table live, via `engram_memory(record_observation)`, at the moment each finding was made — before this document was drafted. Retrievable via `engram_memory({action:"get_observations"})`.

| ID | Category | Tags | Summary |
|----|----------|------|---------|
| 1 | friction | session-start, token-overhead, file_tree, focus-param | Full-verbosity session start dumps entire file tree, ignoring `focus` |
| 2 | concern | agent-rules, silent-fallback, observability | `agent_rules_source: "fallback"` with no visible warning |
| 3 | finding | stale-docs, cross-instance, documentation-debt | Cross-instance bug doc says "not fixed" 8 versions after it was fixed |
| 4 | concern | security, cross-instance, sql-injection, whitelist-gap | `searchAll()` missing the `QUERYABLE_TABLES` check that `checkPermission()` enforces elsewhere |
| 5 | concern | critical, orchestration, sub-agent, session-concurrency, architecture | Global (non-agent-scoped) "current session" lookup; live-reproduced session clobbering |
| 6 | concern | critical, security, supply-chain, prompt-injection, agent-rules | Binding agent rules fetched live from mutable GitHub branch, undisclosed in SECURITY.md |
| 7 | finding | design-tension, multi-ide, db-sharding, continuity | Per-IDE DB sharding contradicts advertised multi-IDE continuity |

## Appendix C — One More Minor Catch, From Closing Out This Very Audit

While ending this audit's own session, `engram_session(end)` reported `"tasks_completed": 0` immediately after `update_task(id:1, status:"done")` had just succeeded in the same batch. Likely cause: `countDoneInSession(sessionId)` (used by session-end stats) filters on the task's `session_id` — set once at **creation** time — not on when the status transitioned to `done`. So "tasks completed this session" silently only counts tasks *created and finished* in the same session, undercounting the common case of finishing a task that was opened earlier. Low severity (cosmetic stat, not data loss), but the same class of issue as Finding 1: a session-boundary attribution bug in the stats layer. Worth a look alongside Finding 1's fix since both stem from how Engram associates records to sessions.

## Appendix B — Live Test Log (Selected)

- `engram_session(start)` × 3 (full/quick_op/default) across 4 sessions — confirmed tiering, focus filtering (partial), and the session-clobbering bug.
- `engram_session(start, agent_role:"sub", task_id:1)` → `engram_session(end)` → `get_history` — reproduced Finding 1 end-to-end.
- `engram_memory(create_task)`, `set_file_notes` / `set_file_notes_batch`, `record_decisions_batch` (2-item nested-array batch, succeeded), `record_observation` × 7, `dump` (correctly classified mixed text as `convention`, confidence `high`), `search(scope:"all")` (FTS5 ranking across sessions + observations, worked correctly).
- `engram_admin(stats)`, `health` (DB integrity OK, WAL mode, FTS available), `enable_pm` → `pm_status` (advisor nudges correctly fired: `missing_decision_lookup`, `unrecorded_decisions` — accurate given this session's own actions), `get_knowledge(principles)` (returned all 5 PM principles correctly).
- Source-verified: `src/services/cross-instance.service.ts`, `src/tools/sessions.ts`, `src/repositories/sessions.repo.ts`, `src/services/agent-rules.service.ts`, `src/tools/dispatcher-admin.ts` (cross-instance + `clear` + `stats` sections), `src/migrations.ts` (full table list), plus all `docs/*.md` self-audit history.

<!-- ENGRAM_AUDIT:COMPLETE -->
