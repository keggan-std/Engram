<!-- PRISM:FM -->
---
prism: "1.0"
type: spec
audience:
  - agent
  - human
agent:
  skip:
    - H
  navigate:
    - mode-toggle
  directives:
    - "Jump to #mode-toggle first — if mode: solo, stop reading (AGENT.md directives apply)"
    - "If mode: multi — read all sections below; they become active directives"
    - "Worked example (§⑦) is [H] — skip it"
status: stable
updated: "2026-05-14"
---
<!-- PRISM:FM -->

<!-- [A] -->
<!-- WHAT: Multi-agent contract template with solo toggle — default mode is solo -->
<!-- [A:gist] Navigate: #mode-toggle (solo = stop here · multi = all sections active). Roster → domain_owns = write boundary (strict). Shared state → written files only, never in-context. Gate: Owner approves every phase advance. Worked example is [H]. -->
<!-- [/A] -->

# agent-handoff.md — Agent Handoff Contract
> **Extends:** AGENT.md §14 | **Role:** Activate multi-agent mode + define inter-agent contracts
> **Default mode:** solo — all multi-agent sections are `[INACTIVE]` until mode is changed below.

---

## ① Mode Toggle

```yaml
# AGENT: Read this first. Mode controls which sections below are active.
# Change only with Owner Gate approval.

mode: solo          # solo | multi
activated_by: ~     # Owner name + date when switching to multi
```

> **If `mode: solo`** — stop here. AGENT.md directives apply. This file is informational only.
> **If `mode: multi`** — continue reading. All sections below become active directives.

---

## ② Agent Roster `[INACTIVE in solo mode]`

> One block per agent. Fill before any agent begins work.
> All agents inherit the full `AGENT.md` manifest in addition to their contract below.

```yaml
agents:

  - agent_id: planner
    role: Planner
    responsibilities:
      - Read requirements and Owner input
      - Create and maintain plan.md
      - Define phase boundaries and step sequences
      - Write ADRs for all architectural decisions
    domain_owns:
      - plan.md
      - docs/decisions/
    domain_reads:
      - All files (read-only audit access)
    receives_from: Owner
    outputs_to: builder
    gate_required: true

  - agent_id: builder
    role: Builder
    responsibilities:
      - Execute steps defined by Planner
      - Write all source code within scoped feature domain
      - Write unit tests per step (AGENT.md §12)
      - Log bugs to docs/bug-log.md
    domain_owns:
      - src/features/[assigned-feature]/
      - _wip/
    domain_reads:
      - plan.md
      - docs/
      - _checkpoints/
    receives_from: planner
    outputs_to: reviewer
    gate_required: true

  - agent_id: reviewer
    role: Reviewer
    responsibilities:
      - Audit Builder output against plan.md success criteria
      - Run Violation Checklist from code-standards.md
      - Flag issues in _wip/review/review-report.md
      - Approve or reject phase output before Owner Gate
    domain_owns:
      - _wip/review/
    domain_reads:
      - src/features/[assigned-feature]/
      - plan.md
      - docs/code-standards.md
      - docs/bug-log.md
    receives_from: builder
    outputs_to: Owner
    gate_required: true
```

---

## ③ Domain Boundary Rules `[INACTIVE in solo mode]`

> These rules are absolute. Violations trigger an immediate halt.

| Rule | Detail |
|---|---|
| **One domain per agent** | Each agent owns exactly the paths listed in `domain_owns` — no exceptions |
| **Read-only cross-domain access** | Agents may read outside their domain; they may never write outside it |
| **No silent restructuring** | An agent may not rename, move, or delete files outside its domain |
| **Conflict resolution** | If two agents need to write the same file, escalate to Owner before either writes |
| **Domain expansion** | Requires Owner Gate approval + update to this file before taking effect |

---

## ④ Shared State Protocol `[INACTIVE in solo mode]`

> All agents communicate through written state — never through memory or in-context assumptions.

```yaml
shared_state:
  plan_path: plan.md                        # Planner writes · Builder + Reviewer read
  bug_log_path: docs/bug-log.md             # Builder writes · All read
  review_report_path: _wip/review/          # Reviewer writes · Owner reads
  checkpoint_path: _checkpoints/            # Any agent writes · All read (write-once)
  session_log_section: "## Session Log"     # Each agent appends to plan.md on session end
```

**State rules:**
- Re-read `plan.md` at the start of every session before anything *(AGENT.md §09.2)*
- Write session snapshot to `plan.md → ## Session Log` before ending any session *(AGENT.md §09.1)*
- Never assume the state of another agent's work — always read from disk
- `_checkpoints/` entries are write-once — no agent may modify after creation *(AGENT.md §07.2)*

---

## ⑤ Inter-Agent Gate Protocol `[INACTIVE in solo mode]`

> The Owner Gate (AGENT.md §03.1) applies globally. In multi-agent mode, agents also gate each other.

```
Planner  ──[phase plan ready]──►  Owner Gate  ──[approved]──►  Builder starts
Builder  ──[phase output ready]──► Reviewer   ──[approved]──►  Owner Gate  ──[approved]──►  Next phase
Reviewer ──[issues found]────────► Builder (fix, re-submit)
Reviewer ──[issues found, 3+]────► Owner Gate (escalate)
```

**Gate rules:**
- Builder may not start a phase until Planner's output for that phase is Owner-approved
- Reviewer must complete review before Owner Gate is requested for any phase
- Owner Gate is the only entity that can advance the pipeline past a phase
- A Reviewer rejection sends work back to Builder — never directly to Planner unless scope changes

---

## ⑥ Conflict & Escalation Protocol `[INACTIVE in solo mode]`

| Situation | Action |
|---|---|
| Two agents disagree on approach | Both write their position to `_wip/review/` — Owner decides |
| Builder receives conflicting instructions from Planner vs. code-standards | code-standards.md wins; flag to Owner |
| Reviewer finds a bug the Builder marked as Fixed | Increment Occurrences in bug-log.md; treat as new occurrence per §08 protocol |
| Any agent is blocked for more than one session | Write block reason to plan.md → Status: Blocked; notify Owner |
| A domain boundary dispute arises | Halt both agents; Owner resolves and updates this file |

---

<!-- [H] -->
<!-- WHY: Worked example is human learning reference — gate protocol diagrams and roster above are the agent-actionable content -->
## ⑦ Worked Example — 3-Agent Pipeline `[INACTIVE in solo mode]`

> **Feature:** Real-Time Search (matches the filled example in `plan-template.md`)
> **Agents:** Planner · Builder · Reviewer

### Step-by-step flow:

**① Planner receives Owner brief:**
> "Add real-time search to the product catalog. Mobile-first. Results under 400ms."

**② Planner writes `plan.md`:**
- Selects track: UI Feature *(AGENT.md §03.3)*
- Defines 3 phases: UI Shell → State + API → Edge Cases + Tests
- Documents watch-outs: existing pagination, auth interceptor
- Writes ADR-001: "Isolated Zustand slice over extending useProductStore"
- Outputs to: Owner Gate

**③ Owner approves Phase 1. Builder receives handoff:**
```yaml
# AGENT: Handoff from Planner → Builder
# Phase 1 approved. Scope: UI Shell only.
# Domain: src/features/search/
# Do not touch: src/features/products/ (Planner watch-out)
# Checkpoint before starting: v0.1.0-pre-search-shell
```

**④ Builder executes Phase 1:**
- Creates `_checkpoints/v0.1.0-pre-search-shell/`
- Writes `SearchBar.jsx`, `SearchResults.jsx`
- Wires into `ProductsPage.jsx` — layout only
- Logs session snapshot to `plan.md → ## Session Log`
- Outputs to: Reviewer

**⑤ Reviewer audits Phase 1 output:**
```markdown
## Review — Phase 1 / UI Shell
**Checklist:** code-standards.md Violation Checklist — PASS
**Issues found:**
- SearchBar.jsx missing ARIA label on input — deferred to Phase 3 per plan (ACCEPTABLE)
- `className="text-gray-500"` hardcoded — should use design token (LOW severity)
**Decision:** APPROVED with note — hardcoded color flagged as bug-log #1
```

**⑥ Reviewer writes bug-log entry:**

| # | Severity | Bug | File:Line | Root Cause | Fix Applied | Occurrences | Status |
|---|---|---|---|---|---|---|---|
| 1 | Low | Hardcoded color `#gray-500` | SearchBar.jsx:14 | Design token not yet available in Phase 1 | Deferred to Phase 3 | 1 | Open |

**⑦ Owner Gate approves Phase 1. Pipeline advances to Phase 2.**
<!-- [/H] -->

---

## ⑧ Activation Checklist

```
□ Owner Gate approval received for multi-agent activation?
□ Agent Roster (§②) fully filled — all agents, domains, and paths defined?
□ Shared state paths (§④) confirmed to exist or planned?
□ All agents have read AGENT.md in full?
□ All agents have read this file in full?
□ Domain boundaries communicated to all agents?
□ First checkpoint created before any agent begins work?
□ plan.md status set to In Progress with current phase noted?
```

---

*agent-handoff.md v1.0.0 — Extends AGENT.md §14. Default: solo mode. Multi-agent activation requires Owner Gate.*

<!-- ✓ AGENT:COMPLETE -->
