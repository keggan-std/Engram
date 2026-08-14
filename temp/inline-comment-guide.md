<!-- PRISM:FM -->
---
prism: "1.0"
type: reference
audience:
  - agent
  - human
agent:
  skip:
    - H
  navigate:
    - prefix-quick-reference
    - language-syntax-reference
  directives:
    - "Jump to #prefix-quick-reference — find the right prefix for any comment situation"
    - "Jump to #language-syntax-reference — confirm comment syntax for the target language"
    - "Per-prefix worked examples are [H] — skip them; triggers and format rules are shared"
status: stable
updated: "2026-05-14"
---
<!-- PRISM:FM -->

<!-- [A] -->
<!-- WHAT: Inline comment convention reference — prefix table, syntax by language, anti-patterns -->
<!-- [A:gist] Two lookups: #prefix-quick-reference (what prefix + when) · #language-syntax-reference (syntax per language). Per-prefix code examples are [H]. Core rule and anti-patterns are shared. -->
<!-- [/A] -->

# inline-comment-guide.md — Comment Convention Reference
> **Extends:** AGENT.md §06 | **Role:** Reference only — do not copy, do not edit
> Use this file when writing or reviewing inline comments. Bad comments are worse than no comments.

---

## Core Rule

> Document the **why** — never the **what**.
> If a comment restates what the code already says, delete it.

<!-- [H] -->
```js
// ✗ Restates code — zero value
const total = price * qty; // multiply price by quantity

// ✓ Explains why — actual value
const total = price * qty; // WHY: qty can be 0; downstream tax calc breaks on null total
```
<!-- [/H] -->

---

## Prefix Quick-Reference

| Prefix | Purpose | Triggers |
|---|---|---|
| `WHY:` | Architectural intent, formula rationale, constraint origin | Non-obvious logic, business rules, edge-case decisions |
| `NOTE:` | Critical read-before-modify info | Load-bearing code, shared state, external API contracts |
| `FIX:` | Patch record — what broke, why this resolves it | Any bug fix, workaround, or hotpatch |
| `WARN:` | Danger zone — touching this has broad side effects | Shared utilities, auth flows, DB write paths |
| `TODO:` | Deferred work — must name owner + phase | Intentionally incomplete logic, known gaps |
| `AGENT:` | Agent-to-agent or agent-to-dev handoff context | Session boundaries, multi-agent scope notes |

---

## Per-Prefix Guide

<!-- [H] -->
<!-- WHY: Per-prefix examples are human learning aids — the prefix table above covers all agent decision-making -->

### `WHY:` — Architectural Intent
**Use when:** The code is correct but the reason is not obvious — formulas, business rules, API quirks, deliberate trade-offs.
**Skip when:** Logic is self-evident from variable names and structure.

```ts
// WHY: API paginates at 50 — requesting 51 triggers a 400; cap enforced here not at call site
const PAGE_LIMIT = 50;

// WHY: toFixed(2) returns a string; parseFloat re-casts for downstream arithmetic
const rounded = parseFloat(price.toFixed(2));
```

```python
# WHY: datetime.utcnow() deprecated in 3.12; datetime.now(UTC) is the forward-compatible form
timestamp = datetime.now(UTC)
```

```css
/* WHY: z-index 200 — sits above modal overlay (z:100) but below toast notifications (z:300) */
.dropdown-menu { z-index: 200; }
```

```yaml
# WHY: timeout set to 29s — ALB idle timeout is 30s; 1s buffer prevents 504s on slow queries
timeout: 29
```

---

### `NOTE:` — Critical Pre-Modification Warning
**Use when:** Modifying this section could silently break something elsewhere.
**Format:** State what it is + what breaks if it changes.

```ts
// NOTE: This store slice is shared across CheckoutFlow and OrderHistory —
//       mutations here affect both views. Test both before any change.
export const useCartStore = create<CartState>(...)
```

```python
# NOTE: Order of middleware matters — AuthMiddleware must run before RateLimitMiddleware
#       or unauthenticated requests bypass the rate limiter entirely.
```

```css
/* NOTE: These variables are consumed by 14 components via design-tokens.css.
   Renaming requires a full-codebase find-replace — do not alias without a plan. */
```

---

### `FIX:` — Patch Record
**Use when:** A fix was applied to resolve a specific bug.
**Format:** What broke + why this resolves it + bug-log reference.

```ts
// FIX: [bug-log #3] Race condition — concurrent saves overwrote each other.
//      Mutex added; only one save operation runs at a time.
await mutex.runExclusive(() => saveUserProfile(data));
```

```python
# FIX: [bug-log #7] pandas .fillna() mutates original df in-place when copy=False (default).
#      Explicit copy() prevents upstream data corruption.
clean_df = raw_df.copy().fillna(0)
```

```css
/* FIX: [bug-log #2] iOS Safari renders 100vh including browser chrome — content clips.
   -webkit-fill-available is the correct cross-browser fix here. */
.full-screen { height: 100vh; height: -webkit-fill-available; }
```

---

### `WARN:` — Danger Zone
**Use when:** This code has broad, non-obvious side effects.
**Format:** State the danger + what it affects.

```ts
// WARN: Called by AuthProvider, SessionManager, AND the analytics pipeline.
//       Changes to the return shape break all three consumers silently.
export function getCurrentUser(): User | null { ... }
```

```python
# WARN: Direct DB write — bypasses ORM validation and signal handlers.
#       Only acceptable here for bulk imports; do NOT use for user-facing mutations.
```

```yaml
# WARN: This key is read at cold-start only — changes require a full service restart.
#       Hot-reload does NOT pick this up.
```

---

### `TODO:` — Deferred Work
**Use when:** Something is intentionally incomplete and must be finished later.
**Format:** What needs doing + phase reference. **A TODO without a phase reference is invalid.**

```ts
// TODO: [Phase 3 / Step 3.2] Replace mock data with live /api/products endpoint
//       Mock is intentional during Phase 2 UI build — do not remove early.
```

```python
# TODO: [Phase 4] Add retry logic with exponential backoff — current impl fails hard on 503
```

```css
/* TODO: [Phase 3 / A11y step] Replace hardcoded #767676 with --color-text-muted token
   after design-tokens.css is finalized in Phase 2-C */
```

---

### `AGENT:` — Agent Handoff Context
**Use when:** Leaving context for the next agent session or passing scope notes in multi-agent mode.
**Format:** What was done + what is in-progress + what next session needs to know.

```ts
// AGENT: Session ended mid-step 2.2. Debounce hook written but not yet wired to SearchBar.
//        Next: import useDebounce into SearchBar.jsx and connect to onInputChange handler.
//        Known issue: clearTimeout on unmount not yet implemented — add in same step.
```

```python
# AGENT: This module is owned by the DataPipeline agent (multi-agent mode).
#        Do not modify transform logic here — raise a handoff request via agent-handoff.md.
```
<!-- [/H] -->

---

## Language Syntax Reference

| Language | Single-line | Block | Docstring / JSDoc |
|---|---|---|---|
| JavaScript | `// comment` | `/* comment */` | `/** @param ... */` |
| TypeScript | `// comment` | `/* comment */` | `/** @param ... */` |
| Python | `# comment` | *(no block)* | `"""docstring"""` |
| CSS / SCSS | *(none)* | `/* comment */` | *(none)* |
| YAML | `# comment` | *(none)* | *(none)* |
| Markdown | *(inline none)* | `<!-- comment -->` | *(none)* |

> **Python note:** Use `#` for all inline/architectural comments. Reserve `"""docstrings"""` for public API documentation only.
> **CSS note:** All prefixes work inside `/* */` blocks — `/* WHY: ... */` is valid.

---

## Anti-Patterns — Never Do These

```ts
// ✗ Restates the code
i++; // increment i

// ✗ Commit message disguised as a comment
// Fixed the bug with the thing

// ✗ TODO with no owner or phase
// TODO: fix this later

// ✗ WARN with no specifics
// WARN: be careful here

// ✗ Commented-out code with no explanation
// const oldMethod = () => { ... }
```

**Commented-out code rule:** Must have a `// WHY:` explaining why it's kept AND a `// TODO:` with a phase reference. Otherwise, delete it.

---

*inline-comment-guide.md v1.0.0 — Reference only. Extends AGENT.md §06. Covers JS/TS, Python, CSS/SCSS, YAML, Markdown.*

<!-- ✓ AGENT:COMPLETE -->
