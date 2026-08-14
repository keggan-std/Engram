# Engram Session Notes — Live Evidence for Finding N3

**Date:** 2026-08-02 · **Status:** Primary evidence, unprompted
**Finding:** [N3 — session identity is globally scoped](../engram-deep-audit-2026-08-02.md#n3--critical-multi-agent-state-corruption-is-broader-than-sub-agent-clobbers-primary)
**Fix task:** #2 (P0-1)

---

## Why this document exists

Finding N3 was originally demonstrated with a written proof-of-concept (`poc-session-clobber.mjs`). A PoC proves a bug is *possible*.

On 2026-08-02, during the project-management research task, **N3 occurred three times without anyone trying to trigger it** — in ordinary work, in the very session where multi-agent accountability was being designed. Three Sonnet subagents ran in parallel; each opened its own Engram session; each reported the corruption independently, in its own words, as an aside.

That makes this a different class of evidence: not "this can happen" but **"this happens the moment Engram is used the way it is marketed."**

These notes are reproduced verbatim, because paraphrase would weaken them.

---

## Incident 1 — Session opened as #10, closed as #12

**Agent:** `sonnet-prism-analysis` · **Task:** analyse the Prism skill

> Session started as #10, but `engram_session end` returned `session_id: 12` (a mismatch — this is the known-buggy behavior flagged in the task). It did report `observations_recorded: 9`, consistent with the 8 observations I recorded in this run (IDs 14–22) plus 1 pre-existing.

**What happened.** The agent opened session #10. By the time it called `end`, `getCurrentSessionId()` returned #12 — a *different agent's* session. It closed a session it never opened, and the summary describing Prism analysis was written onto session #12's record.

**Note the second-order damage:** the agent reasoned about its own `observations_recorded: 9` count and reconciled it against its 8 writes. That count came from the wrong session. **Any per-session statistic gathered during concurrent work is currently unreliable**, and an agent has no way to know it is being lied to.

---

## Incident 2 — Session auto-closed mid-work by a sibling

**Agent:** `sonnet-skills-analysis` · **Task:** analyse carto-src, tracer, ghostwriter

> Session start returned `session_id: 11`. All 9 observations were recorded successfully (ids 23, 24, 26, 27, 28, 29, 31, 33, 34, 35 … note id 25/30/32 belong to a concurrent session). When I called `engram_session(action:"end")`, it errored `"No active session"`. `get_history` revealed why: a **concurrent session (#12, agent `sonnet-pm-research`) auto-closed my session #11** at 14:01:14 (`"(auto-closed: new session started)"`) — Engram appears to track a single active-session pointer, and a parallel agent doing related analysis bumped mine. All observation writes happened successfully regardless; only the formal `end` call was blocked.

**What happened.** Session #11 was destroyed mid-work by session #12 starting. Its real summary was never recorded; the placeholder `"(auto-closed: new session started)"` is now permanent for that row.

This agent **diagnosed the bug correctly and unaided** by calling `get_history` — which is precisely the extra step the audit noted nothing instructs an agent to take. It also observed the non-contiguous observation IDs (23,24,26,27,28,29,31,33,34,35 vs. 25,30,32 belonging to a sibling), independently confirming interleaved concurrent writes.

---

## Incident 3 — `end` refused entirely

**Agent:** `sonnet-pm-research` · **Task:** research project-state tracking

> The Engram session end call returned an error both times: `"No active session. Start one first with engram_session(action:'start')."` — despite session #12 having started successfully and accepted all 7 `record_observation` calls (ids 36-42) without issue. This itself is a small data point relevant to the audit: session state didn't persist reliably through to the `end` call in this run.

**What happened.** Session #12 — the same session that destroyed #11 in Incident 2 — was itself destroyed before it could close. Its work is recorded; its summary is not.

---

## Incident 4 — the orchestrator was hit too

**Agent:** `opus5-pm-infra` (this session, the parent)

After the subagents completed, a `record_change` call from the orchestrator returned:

```
Recorded 1 change(s) in session #none
```

`getCurrentSessionId()` returned `null`. The parent's session #9 had been auto-closed by one of its own children. **The orchestrator was clobbered by the agents it spawned** — the exact scenario in the audit's Chain B, occurring unprompted.

---

## What this establishes

| Claim | Status |
|---|---|
| Session clobbering is reproducible | Was already proven by PoC |
| It occurs in ordinary use, unprompted | **Established here** — 4 incidents, ~20 minutes |
| It affects sub-agents *and* the orchestrator | **Established here** — Incident 4 |
| Session-scoped statistics are unreliable under concurrency | **Established here** — Incident 1 |
| Agents cannot detect it without an unprompted `get_history` | **Established here** — Incident 2 was the only one diagnosed at the time |
| Real session summaries are permanently lost | **Established here** — Incidents 2 and 3 |

**Severity re-rating.** The audit rated N3 CRITICAL on analysis. This evidence raises it to **blocking in practice**: three of three subagents plus the orchestrator were affected in a single ordinary task. Engram's marketed multi-agent capability currently corrupts its own bookkeeping on use.

The work itself survived — every `record_observation` and `set_file_notes` write landed. **What was lost was the narrative layer**: which agent did what, and how each run concluded. For a memory product, that is the layer that makes the rest interpretable.

---

## Regression test derived from this

```
Given three agents A, B, C
When each calls engram_session(start) then engram_session(end) with interleaved timing
Then each session row's summary must match the agent that wrote it
And no session may be auto-closed by an agent that did not open it
And each session's stats must count only its own records
```

Add to task **#2 (P0-1)**. This is the acceptance criterion; the PoC in the audit is the minimal case, and the four incidents above are the realistic one.

---

## A note on where this came from

None of these incidents were solicited. Each subagent was told only *"this is a known-buggy area; just call `end` and report what it returned."* Each independently noticed something wrong, investigated to varying depths, and reported it as an aside to its actual task.

That is worth recording for its own sake: **the bug is visible to a competent agent that bothers to look, and invisible to one that doesn't.** Nothing in Engram's current responses prompts anyone to look.

---

<!-- N3_LIVE_EVIDENCE:COMPLETE -->
