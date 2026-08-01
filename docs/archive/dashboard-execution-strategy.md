# Dashboard Execution Strategy (System Plan)

Status: active execution plan for resuming and finishing dashboard work on `develop`.

---

## 1) Objective

Deliver a stable local dashboard workflow where:
- backend HTTP mode builds and runs reliably,
- dashboard frontend builds and serves correctly,
- progress is continuously captured in Engram (changes + file notes + checkpoints),
- pending work is explicit and sequenced.

---

## 2) Execution System

### A. Control Loop (repeat for each work slice)
1. **Sync context**: check session/task state and changed files.
2. **Execute one slice**: implement/fix/verify a narrow target.
3. **Record immediately**: `record_change`, `set_file_notes(_batch)`, `checkpoint`.
4. **Validate**: run focused build/test command for touched area.
5. **Decide next slice**: continue if green, otherwise capture blocker + retry plan.

### B. Recording Policy
- Never defer memory recording until end of session.
- Record at these moments:
  - after file edit batches,
  - after each build/test run,
  - after major discovery scans.

### C. Command Reliability Policy
- Use explicit absolute path when running root scripts.
- Do not chain unnecessary `Set-Location` hops across ambiguous shell state.
- Prefer single-command intent: one build goal per command.

---

## 3) Current Work Breakdown

### Phase A — Stabilize Build Path
1. Verify root `build:dashboard` script from repo root.
2. Verify direct dashboard package build.
3. Verify root backend TypeScript build.

### Phase B — Runtime Validation
1. Start HTTP mode (`--mode=http --no-open`).
2. Confirm `/health` and selected `/api/v1/*` endpoints respond.
3. Confirm dashboard static fallback serves built UI.

### Phase C — Gap Closure vs Plan
1. Compare implemented frontend pages/components against `dashboard-implementation-plan.md`.
2. Identify missing/partial Phase 1 requirements.
3. Prioritize fixes by unblock value (auth, API wiring, page reliability first).

### Phase D — Hardening
1. Add/adjust focused tests where practical for touched HTTP routes.
2. Re-run affected tests/build.
3. Update docs and Engram notes for final handoff quality.

---

## 4) Decision Rules

- If build fails due to environment/cwd: fix command path first, do not debug code yet.
- If type/API mismatch appears: align backend response shape before frontend workarounds.
- If requirement ambiguity appears: default to minimal implementation that matches plan language.

---

## 5) Definition of Progress

A work slice is complete only when all are true:
1. Code/doc change applied.
2. Change recorded in Engram.
3. File notes updated for touched files.
4. Validation command executed and outcome logged.
5. Next action identified.
