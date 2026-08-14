# Engram Memory — Decisions

> **Generated artifact.** Regenerate deliberately, review as a diff, never auto-import.
> Source: this project's own Engram store. Excludes `config` (machine identity/tokens),
> `changes` (git already has it), and raw session rows (absolute paths).
>
> **Last generated:** 2026-08-01 · **Count:** 14
>
> See [`agent-accountability-design.md`](../agent-accountability-design.md) §13 for why the
> SQLite database itself is not committed.

---

## D1 — Test decision A for must-be-object repro

**Why:** Testing complex batch params with nested arrays

**Affects:** `src/tools/decisions.ts`, `src/repositories/decisions.repo.ts`

<sub>active · audit-test · repro · 2026-08-01</sub>

---

## D2 — Test decision B for must-be-object repro

**Why:** Second entry in same batch call

**Affects:** `src/tools/decisions.ts`

<sub>active · audit-test · 2026-08-01</sub>

---

## D3 — Treat ALL file-sourced content as untrusted; never label it binding. Agent rules must ship in the versioned npm package, not be fetched or cached.

**Why:** Live-reproduced PoC: a hostile repo shipping .engram/agent_rules_cache.json injects attacker-controlled CRITICAL-priority binding rules on clone, with no GitHub compromise, no network, and permanent persistence via a forward-dated fetched_at. Structurally identical to CVE-2026-21852 (MemoryTrap), which Anthropic fixed in Claude Code v2.1.50 by removing memory from the system-prompt injection path entirely. Copying that fix deletes the whole attack class rather than narrowing it.

**Affects:** `src/services/agent-rules.service.ts`, `src/tools/sessions.ts`, `SECURITY.md`

<sub>active · security · p0 · agent-rules · cve · architecture · 2026-08-01</sub>

---

## D4 — Replace globally-derived session identity with a caller-bound session handle plus parent_session_id; make agent_name required.

**Why:** getOpenSessionId() and getCurrentSessionId() both select the newest open session with no scoping, so any agent's start/end destroys or misattributes any other agent's session, in BOTH directions - live-reproduced. Scoping by agent_name alone (the prior audit's proposal) is insufficient because agent_name defaults to the literal 'unknown'. Re-deriving 'current session' from a global query is the root cause; only a handle returned by start and verified on end removes it.

**Affects:** `src/repositories/sessions.repo.ts`, `src/database.ts`, `src/tools/sessions.ts`

<sub>active · orchestration · p0 · data-loss · concurrency · architecture · 2026-08-01</sub>

---

## D5 — Restore a config key whitelist and split it into user-tunable vs security/identity keys; write audit_log rows on every config mutation.

**Why:** engram_admin(config) currently writes ANY key with no whitelist, including http_token, sharing_mode, sharing_types and sensitive_keys - so one ordinary tool call disables cross-instance access control. This is a REGRESSION: src/tools/stats.ts:22-31 had exactly this guard (KNOWN_CONFIG_KEYS) before the v1.6 dispatcher consolidation dropped it. The audit_log table already exists from migration V20 and is unused on this path.

**Affects:** `src/tools/dispatcher-admin.ts`, `src/constants.ts`

<sub>active · security · p0 · privilege-escalation · regression · 2026-08-01</sub>

---

## D6 — Port the validation from the 15 dead tool files into the live dispatchers BEFORE deleting them.

**Why:** The dead files (4,057 lines, 23% of src/) are unreachable, but they are the only remaining record of guards the v1.6 consolidation silently dropped: a config whitelist, seven z.enum constraints, and every numeric/length bound. Deleting them first destroys that evidence. Coverage on the file that received the logic (dispatcher-admin.ts) is 0%, so nothing would have caught the loss and nothing will catch the next one.

**Affects:** `src/tools/dispatcher-memory.ts`, `src/tools/dispatcher-admin.ts`, `src/tools/stats.ts`, `src/tools/file-notes.ts`

<sub>active · maintainability · p1 · dead-code · validation · regression · 2026-08-01</sub>

---

## D7 — Adopt six Trellis mechanisms as a measurement discipline; do NOT build Trellis as a subsystem inside Engram.

**Why:** Trellis governs process, Engram governs state - merging would make Engram opinionated about workflow, which its positioning currently avoids. Engram also already has an unmeasured partial Trellis (PM-Lite/PM-Full + knowledge/ + workflow-advisor). Trellis's own evidence argues against wholesale adoption (self-generated skills average -1.3pp; harsh governance scored BELOW baseline). Adopt: action-catalog distinctness testing, structured records + quarantined free text + provenance, build-time cost accounting, the paired baseline arm, deviation capture, and written kill switches. Reject: the skill lifecycle, the 14-skill set, and §21.1 commit-everything (which reproduces the MemoryTrap vector at repo scope and contradicts Trellis's own §13 threat model).

**Affects:** `docs/trellis-engram-integration-analysis.md`

<sub>active · architecture · trellis · measurement · roadmap · 2026-08-01</sub>

---

## D8 — Engram's token-reduction work optimised the wrong variable; prioritise action-selection accuracy over context overhead.

**Why:** Published results (38 task-model pairs, ~2,545 trajectories) show expanding a capability library degrades pass rates 8% at 52 / 14% at 102 / 21% at 202, with up to 68% of the loss from SHADOWING (wrong capability selected) while context overhead was statistically insignificant at every size. Engram exposes 75 actions - inside that range - and spent v1.6 through v1.11 optimising tokens. universal.ts makes it worse: fuzzyResolveAction() silently lexically guesses between 75 actions at a 0.5 threshold, and HandlerCapturer discards the Zod schemas so a mis-routed call also skips enum validation. Nothing measures selection accuracy. The distinctness test (~40 phrases x 1 model call) is the highest-expected-value experiment available.

**Affects:** `src/modes/universal.ts`, `src/tools/find.ts`, `src/tools/dispatcher-memory.ts`, `src/tools/dispatcher-admin.ts`

<sub>active · architecture · p1 · shadowing · tool-surface · measurement · 2026-08-01</sub>

---

## D9 — For sub-agent accountability: separate COVERAGE (automatic, batched, one write per session) from UNDERSTANDING (deliberate, nudged, never mandated). Do NOT mandate a file note per file read.

**Why:** A mandatory per-file note is a compliance target and agents satisfy those cheaply - producing 40 notes saying 'this file handles sessions', which removes no work and adds retrieval noise that competes with the few high-value notes. Direct evidence from this audit: the subagents produced genuinely useful file mapping because they were given a DELIVERABLE with a specified shape, not a rule; under a rule they would have written one-liners. Coverage ('agent X looked at these 40 files') is valuable in aggregate and mainly NEGATIVELY - it tells the next agent where not to look again - and is free to capture. Understanding is expensive and rare. Conflating them at coverage volume gets neither. Note that nothing in Engram records file READS today (changes records writes only), so the cheap automatable half is exactly the piece missing.

**Affects:** `docs/agent-accountability-design.md`, `src/tools/sessions.ts`, `src/repositories/file-notes.repo.ts`

<sub>active · architecture · orchestration · accountability · design-principle · 2026-08-01</sub>

---

## D10 — Engram cannot enforce agent behavior; design for DETECTABLE ABSENCE instead of guaranteed presence. Derive the sub-agent obligation tier from observed behavior rather than a spawn-time parameter.

**Why:** Two-part. (a) Engram is a tool the agent calls, with no supervisor position - it cannot force a write, cannot see Read/Edit calls, cannot stop a silent exit. Any design whose integrity rests on 'the subagent must...' rests on an unchecked promise. But a self-report can be gamed while a MISSING record cannot: an agent that crashed or ran out of context leaves the same hole whether it meant to or not. So put the integrity on absence detection (unclosed sub-sessions, missing outcome, orphaned task claims, stale pending_work) surfaced as one unfinished[] array on the orchestrator's session start. That directly satisfies 'even if it forgot, there is hope to figure out what was left'. (b) A spawn-time tier parameter would add a routing decision, and per the Trellis shadowing evidence routing decisions are where up to 68% of degradation originates. The tier is derivable from data Engram already has - did the session write files, examine files, or neither - so the obligation shape self-adapts with zero new decisions for the orchestrator, using the workflow-advisor nudge engine that already ships.

**Affects:** `docs/agent-accountability-design.md`, `src/tools/sessions.ts`, `src/services/workflow-advisor.service.ts`

<sub>active · architecture · orchestration · accountability · design-principle · trellis · 2026-08-01</sub>

---

## D11 — Do NOT build a hand-maintained ledger/register for project state. Build mechanical reconciliation instead: every tracked claim must have a cheap automatic check against reality, and claims that cannot be checked are not tracked.

**Why:** Engram already had a register and it became the disinformation source - docs/cross-instance-sharing-bugs.md asserted 'not yet fixed' for 8 versions after the fix shipped. The user's own ghostwriter skill has the mirror failure: versions.md claims bug B7 was fixed by adding a prism chain to deviations.md, and that section was never written. So a hand-maintained register lies in BOTH directions and neither error is visible from inside it. Reinforced by arXiv 2604.09409 (agents ignore explicit logging instructions 67% of the time) and by the strongest counter-evidence found: 'a register you built carefully and then froze isn't neutral - it's worse than nothing, because it looks authoritative'.

**Affects:** `docs/project-state-tracking-design.md`

<sub>active · project-management · design-principle · ledger-rot · decisive · 2026-08-01</sub>

---

## D12 — Adopt the survival criterion: never ship a register whose accuracy depends on someone remembering. Either couple it to CI so staleness breaks a build or blocks a merge, or generate it from code.

**Why:** Research across every project-tracking mechanism found exactly one shared trait among survivors. Survivors: Rust RFCs (status lives in an auto-created tracking ISSUE, not the proposal doc), Kubernetes KEPs (dedicated subteam verifies each release), CI-enforced feature-flag expiry (deploy blocked if a deprecated flag is referenced), api-extractor .api.md (generated golden file, PR review required on any diff), Keep a Changelog (no tooling, updated as a side effect of a release that was happening anyway). Rotters: ADRs, traceability matrices outside regulated industries, hand-maintained capability manifests. The differentiator is never discipline - it is coupling to something that fails loudly.

**Affects:** `docs/project-state-tracking-design.md`

<sub>active · project-management · design-principle · ci · research · 2026-08-01</sub>

---

## D13 — Root cause of silent feature drop in Engram is missing VERTICAL traceability. Fix with three nullable FK columns (tasks.milestone_id, changes.task_id, decisions.task_id) plus one reconcile action - not a new subsystem.

**Why:** Schema check confirmed every table links to session_id and nothing else. Engram therefore has horizontal memory (what happened) but cannot answer the three questions that catch a drop: what did we promise and did it ship, which changes implemented task N, is decision D still reflected in code. Intent and outcome sit in the same database unconnected, which is exactly why a feature can vanish unnoticed. Note decisions already has supersedes/superseded_by/depends_on, so the decision level already HAS vertical linkage - it was simply never extended to milestone/task/change. Same pattern as parent_session_id and replay: designed, partially built, left disconnected.

**Affects:** `src/migrations.ts`, `src/tools/dispatcher-admin.ts`, `docs/project-state-tracking-design.md`

<sub>active · architecture · traceability · project-management · root-cause · 2026-08-01</sub>

---

## D14 — Highest-value fix is a GENERATED capability surface committed to the repo with a CI diff gate - and it is a build script, not an Engram feature.

**Why:** Re-classifying the 10 silent-drop incidents against the correct detector shows no single tool catches them all: knip catches 2 (proven by running it - it found all 15 dead tool files with zero config), mutation testing catches the dropped Zod enums and the config whitelist, contract tests catch the import narrowing, orphaned-column detection catches parent_session_id. BUT one mechanism covers 6 of 10: emit docs/CAPABILITY-SURFACE.md from the dispatchers' Zod schemas (every action, param, type, enum, min/max), commit it, and fail CI if regenerating produces an uncommitted diff. Every removed action, dropped enum, loosened bound and narrowed contract then appears as a red line in code review. It satisfies the survival criterion completely - generated so it cannot rot, coupled to the PR so it blocks merge, and cheap. Keeping it outside Engram also respects the do-not-make-it-heavy constraint.

**Affects:** `scripts/`, `docs/project-state-tracking-design.md`

<sub>active · project-management · drift-detection · ci · highest-value · capability-surface · 2026-08-01</sub>

---

<!-- ENGRAM_MEMORY_DECISIONS:COMPLETE -->
