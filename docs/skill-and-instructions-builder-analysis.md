# Professional Analysis: Skill-and-Instructions-Builder Framework on Engram

**Date:** 2026-03-03  
**Author:** GitHub Copilot (Claude Sonnet 4.6) — Independent Analysis  
**Subject:** Viability, token-efficiency, and implementation architecture for encoding the S&IB project execution framework into Engram as a live operational standard

---

## 1. Executive Verdict

**The framework is conceptually sound, professionally grade, and structurally compatible with Engram's persistence model.** It is not over-engineered relative to the scope it targets. However, as currently encoded in the S&IB Engram instance, it carries a measurable token-overhead risk and a maintainability concern that will compound over time if left unaddressed.

The core problem is not the framework itself — it is *how* frameworks designed for human practitioners get encoded for agent consumption. Humans read reference docs once and internalize them. Agents need instruction re-delivered every session. If the encoding strategy does not account for that, a 15-convention framework that looks lightweight on paper becomes a ~1,500-token tax on every single session start.

The fix is architectural, not procedural, and it sits partly in how the framework is stored and partly in a gap in Engram's current delivery logic.

---

## 2. What Is the Skill-and-Instructions-Builder Framework?

The S&IB Engram instance (instance_id: `3f7189b4-9f95-45aa-95b8-15c1c3aa5123`) encodes a **6-phase project execution lifecycle** as Engram memory records:

| Record Type | Count | Purpose in Framework |
|---|---|---|
| Decisions | 9 | Architectural principles, methodology choices, canonical references |
| Conventions | 15 | Behavioral rules agents must enforce session-by-session |
| File Notes | 22 | Phase documents, templates, instruction guides |
| Sessions | 5 | Historic context of how the framework was built |

The 6 phases are: Initiation → Planning → Design/Architecture → Execution → Testing/Validation → Closure. Each phase has a gate — documented criteria an agent must verify before proceeding.

The companion artifact (Decision #24 in this Engram instance) is 22 standalone Markdown documents at `C:/Users/~ RG/Documents/project management/` covering:
- 10 core methodology documents (00-09)
- 6 phase-specific instruction guides (PI-01 to PI-06)
- 6 operational templates (T-01 to T-06)

The two pieces are meant to work together: Engram provides *live runtime enforcement*, the Markdown docs provide *reference depth*.

---

## 3. Honest Strengths

### 3.1 The Methodology Is Real
The 9 decisions reflect genuine PM discipline: Intentionality, Traceability, Incremental Proof, Risk-First Planning, PERT estimation with M + σ buffers. These are not cargo cult. They are field-tested principles that prevent the most common failure modes in software projects (scope creep, unverified assumptions, late integration pain).

### 3.2 Encoding Intent Is Correct
The central insight — that agent behavior needs *persistent institutional memory*, not per-session prompting — is exactly the problem Engram is designed to solve. Using decisions for strategic principles and conventions for operational rules is structurally right. The model is correct.

### 3.3 Cross-Instance Sharing Is the Right Vector
Setting `sharing_mode=full` and `sharing_types=["decisions","conventions"]` on the S&IB instance means any project can pull the framework in read-only mode without duplicating it. This is the right architecture: single source of truth, federated access. The hotfixes shipped in v1.9.2 unblocked exactly this flow.

### 3.4 File Notes as Phase Capsules
Encoding the 22 Markdown docs as file_notes is useful: agents can retrieve a specific phase's full instruction set on demand via `get_file_notes` without it being injected at session start. This is already the efficient pattern.

---

## 4. Honest Weaknesses and Risks

### 4.1 Token Budget Math — This Is the Central Risk

Engram's `engram_session start` with `verbosity: "summary"` delivers:

```
activeConventions.slice(0, 10).map(c => ({
  id, category, rule: truncate(c.rule, 100), enforced
}))
```

**Cap:** 10 conventions, each rule truncated to **100 characters**.

With 15 active conventions:
- 5 conventions are invisible at session start (they require a manual `get_conventions` call)
- The 10 that ARE shown get their rule text cut to 100 chars — typically 12–18 words
- An average verbose convention in the S&IB instance runs 60–120 words = 80–160 tokens full length

**Session start token math (summary verbosity):**

| Block | Tokens (approximate) |
|---|---|
| Session metadata, git log, message | ~120 t |
| 5 decisions (120-char truncated) | ~180 t |
| 10 conventions (100-char truncated) | ~250 t |
| 5 open tasks | ~100 t |
| Tool catalog (Tier 0, names only) | ~80 t |
| **Total (steady-state session start)** | **~730 t** |

That is not alarming on its own. The problem emerges at `verbosity: "full"` and in the `get_conventions` call if an agent dutifully fetches the 5 hidden ones:

| Scenario | Tokens |
|---|---|
| verbosity: "full" session start | ~4,000–6,000 t (15 full-text conventions + all decisions untruncated) |
| `get_conventions` (all 15 full text) | ~1,500–2,500 t |
| Convention import from S&IB via `query_instance` | ~1,500–2,500 t |

**Risk verdict:** The 100-char truncation at summary verbosity saves you, but only until someone calls `get_conventions` without filtering. At full verbosity, the framework becomes a token bomb. The 22 file_notes are safe because they are on-demand. Conventions are the exposure vector.

### 4.2 Convention Verbosity Reduces Usefulness Under Truncation

A rule like:
> "Phase gates are mandatory. Before advancing from Planning to Design, the agent must verify: (1) requirements documented, (2) risks assessed, (3) stakeholders confirmed, (4) WBS complete, (5) resources identified."

Truncated to 100 chars becomes:
> "Phase gates are mandatory. Before advancing from Planning to Design, the agent must verify: (1) re"

The agent receives a fragment that ends mid-sentence. That is worse than a compact rule would be, because the agent now has partial information it cannot act on reliably.

**Root cause:** The conventions were authored for full-text reading, not for truncation tolerance. This is a format mismatch, not a content problem.

### 4.3 No Focus-Based Convention Filtering

Decisions are filtered at session start by FTS5 semantic ranking against the `focus` param. Conventions are not — they use a hard `slice(0, 10)` cap. This means:

- During a Planning session, Testing conventions surface
- During a Closure session, Initiation conventions surface
- There is no way to surface only the phase-relevant subset without a code change to Engram

This is a **gap in Engram**, not a gap in the framework. But the framework suffers from it.

### 4.4 Enforced=0 Is Underused

The `enforced` flag suppresses a convention from session delivery when set to 0. The S&IB instance currently has all conventions marked `enforced=1` by default. That means all 15 try to surface every session. For a healthy, well-understood framework that has been running for weeks, most conventions should be demoted to `enforced=0` and surfaced only when explicitly relevant.

### 4.5 Cross-Project Contamination Risk

If a developer uses `query_instance` to pull the S&IB conventions into a new project's Engram DB as their own records, they inherit all 15 at full weight permanently. There is no current "read-only overlay" mode — imported conventions become native records indistinguishable from project-specific ones. This will cause convention set inflation across instances.

---

## 5. How to Implement This Without Token Burn

### 5.1 Convention Tier Architecture

Split the 15 conventions into two operational tiers:

**Tier A — Always Enforced (max 5):** The highest-signal rules that apply to every single session regardless of phase. Should be compact: one declarative sentence each, max 80 characters.

| Candidate | Sample compact form |
|---|---|
| Phase gates mandatory | "Never advance a phase without documenting exit criteria met." |
| Traceability | "Every decision must have a rationale. No undocumented architectural choices." |
| Incremental proof | "Ship working increments. Never propose designs that cannot be partially proven." |
| Risk-first | "Identify and score risks before committing to estimates or approach." |
| Commit discipline | "One logical change per commit. WIP commits must be explicitly labeled." |

**Tier B — On-Demand Reference (10+):** All estimation formulas, detailed phase gate checklists, template usage rules, extensive code standards. Set `enforced=0`. Agents retrieve these via `get_file_notes` on the relevant phase document or via a targeted `get_conventions(category="...")` call at the start of the relevant phase.

**Practical action:** Run `update_convention(id, enforced=0)` on any convention whose full text exceeds 80 characters or that is phase-specific. You should end up with 4–6 always-enforced conventions.

### 5.2 Convention Text Rewrite for Truncation Tolerance

Each always-enforced convention should survive the 100-char truncation intact. The rule text should front-load the imperative. Examples:

| Before | After |
|---|---|
| "All phases require exit criteria to be documented before advancing. The criteria for each phase are defined in the phase instruction guides PI-01 through PI-06." | "Document and verify exit criteria before any phase advance. See PI-01–PI-06 for per-phase details." |
| "Effort estimation uses PERT formula: E = (O + 4M + P) / 6 with σ = (P - O) / 6. Always add M + σ to estimates as the committed figure." | "Estimate with PERT: E=(O+4M+P)/6, commit M+σ. Never commit O or E alone." |

### 5.3 Phase-Scoped Convention Delivery via Sub-Agents

Use Engram's sub-agent session system (v1.7+) for phase-specific work:

```js
// At the start of a Planning session
engram_session({
  action: "start",
  agent_name: "planning-agent",
  agent_role: "sub",
  task_id: <planning_task_id>,  // task tagged with phase=planning
})
```

The sub-agent session returns only the task, its file notes, matching decisions, and up to 5 conventions. Tag planning-specific conventions with `category: "planning"` and let the sub-agent's task context pull them naturally.

### 5.4 Events as Phase Gate Triggers

Rather than loading all phase documentation at session start, use Engram's scheduled events to surface phase-gate checklists at the right moment:

```js
// When closing Planning phase, trigger a gate review
engram_memory({
  action: "schedule_event",
  title: "Planning Phase Gate Review",
  trigger_type: "manual",
  payload: {
    checklist: ["requirements complete", "risks scored", "WBS done", "estimates approved"],
    escalate_if_failed: true,
    reference_doc: "PI-02-planning-phase-instructions.md"
  }
})
```

Fire the event with `trigger_event(id)` when the phase ends. The event payload surfaces in the next session's `triggered_events` block — focused, timely, and zero overhead when not triggered.

### 5.5 File Notes as the Knowledge Base

The 22 Markdown documents belong in file_notes. Already done in the S&IB instance. Operational pattern:

1. Session start receives compact enforced conventions only (~250 tokens)
2. Agent identifies current phase from open tasks
3. Agent calls `get_file_notes("phase-instructions/PI-03-execution.md")` — receives full instruction set for execution phase only (~500 tokens, on-demand)
4. Agent executes work
5. Agent calls `trigger_event(<phase_gate_id>)` when phase work is complete
6. Next session start includes the gate checklist in `triggered_events`

Total overhead per working session: ~250t (conventions) + 500t (phase doc, on demand) = **750 tokens** — versus 2,000–4,000t if everything is active-enforced.

### 5.6 Cross-Instance Overlay Without Import

Instead of importing S&IB conventions into project instances (which inflates their native convention sets), implement a two-step lookup pattern:

1. Project's own Engram DB holds only project-specific conventions and decisions
2. Agent opens a session on the project, gets project context
3. Agent explicitly queries S&IB for framework conventions when starting a new phase: `query_instance(instance_id="3f7189b4...", type="conventions", category="execution")`
4. Agent treats returned conventions as read-only session context, not persistent records

This keeps each project DB clean. The S&IB instance remains the authoritative source.

---

## 6. What Engram Is Missing to Support This Natively

These are feature gaps — not bugs, not workarounds — that would make the S&IB framework (and any institutional knowledge pattern) dramatically more efficient:

### Gap 1: Convention Tag-Based Filtering at Session Start
**Current behavior:** `active_conventions: capConventions(10)` — hard slice, no `focus` awareness.  
**Needed:** Apply the same FTS5 tag-matching currently used for decisions to conventions. Surface conventions whose `tags` overlap with the `focus` param at session start. Fallback to sorted cap if no focus given.  
**Impact:** Reduces irrelevant convention noise by 60–80% for focused sessions.

### Gap 2: Convention Compact/Full Format Toggle
**Current behavior:** `rule: truncate(c.rule, 100)` — single truncation length for all conventions.  
**Needed:** Conventions should have a `summary` field (1–2 sentence compact form) and a `rule` field (full detail). Session start delivers `summary`. `get_conventions` delivers `rule`. This mirrors how decisions can have short and long forms.  
**Impact:** Eliminates the mid-sentence truncation problem entirely.

### Gap 3: Read-Only Overlay Mode for Cross-Instance Conventions
**Current behavior:** `query_instance` returns data you read but do not save. There is no "activate overlay" that temporarily treats another instance's conventions as in-scope for the current session without importing them.  
**Needed:** An `overlay_instance(instance_id)` operation that appends another instance's conventions to the current session's active set, flagged as `source: "external"`, never written to the local DB.  
**Impact:** Enables the single-source-of-truth framework model without DB inflation.

### Gap 4: Convention Phase-Tagging and Phase-Aware Delivery
**Current behavior:** Conventions have a `category` but it is freeform. Session start does not know the current project phase.  
**Needed:** If the active task (highest-priority open task) carries a `phase` field, session start should boost conventions tagged with that phase. Low implementation cost given task records already exist.  
**Impact:** Makes phase-gate conventions automatically relevant without manual lookup.

---

## 7. What the Framework Gets Right About Engram's Model

The S&IB framework was designed, consciously or not, in alignment with how Engram's information hierarchy is intended to work:

| Framework concept | Engram primitive | Correctness |
|---|---|---|
| Strategic principles (Intentionality, Traceability) | Decisions | ✅ Right primitive |
| Behavioral rules (standards, gates, commit discipline) | Conventions | ✅ Right primitive |
| Phase documentation, instruction guides | File notes | ✅ Right primitive |
| WBS decomposition | Tasks with parent/child | ✅ Right primitive |
| Phase gate checkpoints | Events (schedule + trigger) | ✅ Right primitive |
| Cross-project framework inheritance | Cross-instance query | ✅ Right primitive (post v1.9.2) |
| Actual project artifacts (code, diagrams) | Recorded changes | ✅ Right alignment |

The mapping is coherent. This is not accidental. It reflects a mental model of Engram as an agent's institutional memory layer, which is exactly what it is designed to be.

---

## 8. Summary: Practical Implementation Checklist

For any project that wants to run under the S&IB framework via Engram, the sequence is:

- [ ] **Import framework foundations** via `query_instance` on S&IB — store as project decisions
- [ ] **Do not bulk-import all 15 conventions** — use cross-instance overlay pattern instead
- [ ] **Add 4–5 always-enforced project conventions** (compact, ≤80 chars, front-loaded imperative)
- [ ] **Create tasks for each project phase** with `priority` and a `phase` tag
- [ ] **Register file notes** for the phase instruction docs (PI-01 through PI-06) referencing filesystem paths
- [ ] **Schedule phase gate events** upfront — one per phase transition
- [ ] **Set the project's opening focus** to the current phase name at every session start
- [ ] **Demote reference conventions** (estimation formulas, detailed checklists) to `enforced=0` after first 2–3 sessions

---

## 9. Recommended Engram Feature Backlog Items

Based on this analysis, the following features would directly improve framework usability — in priority order:

1. **convention.summary field** — compact form for session delivery, full rule on demand
2. **Session-start convention tag-filtering** — match against `focus` param like decisions do
3. **overlay_instance() action** — temporary cross-instance convention injection without import
4. **Auto phase-detection** — read highest-priority open task's `phase` field; boost matching conventions

None of these require schema-breaking migrations. Items 1–2 are low-risk incremental improvements to existing flows. Items 3–4 add new capabilities.

---

## 10. Final Assessment

| Dimension | Rating | Rationale |
|---|---|---|
| Framework quality | High | Professionally structured, correct PM principles, domain-agnostic design |
| Engram encoding correctness | Medium-High | Right primitives used throughout; convention verbosity is the one structural issue |
| Token efficiency (as currently stored) | Medium | Safe at summary verbosity; risky if `get_conventions` or full verbosity used |
| Token efficiency (with recommended changes) | High | Tier A/B split + compact convention text + phase-scope delivery = sustainable |
| Cross-project reuse potential | High | Single-source-of-truth via cross-instance query is the right model |
| Maintainability | Medium | 22 Markdown docs + 15 conventions need discipline to stay in sync |
| Implementation effort | Low-Medium | No Engram code changes needed for immediate deployment; 4 Engram features needed for ideal deployment |

**Bottom line:** This is worth doing, and it is doable today with the infrastructure that exists. The risk is not in the framework — it is in undisciplined convention encoding. Write compact, truncation-tolerant convention summaries, split enforced from reference conventions, use events for phase gates, and the framework runs efficiently inside Engram's existing token budget. The four Engram feature gaps identified above are real but not blockers.
