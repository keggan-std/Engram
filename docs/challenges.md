# Engram v1.6 — Development Challenges & Resolve Plan

This file documents the technical challenges encountered during the v1.6 feature development session. Each challenge has a root cause, a workaround applied, and a proposed permanent fix for a future session.

---

## C1 — TypeScript Type Intersection for Extended Responses

**Encountered in:** `feature/v1.6-agent-safety`, `feature/v1.6-session-handoff`

**Problem:**
When adding new fields to the `start_session` response (e.g. `abandoned_work`, `handoff_pending`), TypeScript emits:
```
Object literal may only specify known properties, and 'abandoned_work' does not exist in type 'SessionContext & {...}'
```
This happens because `SessionContext` is a typed interface defined in `types.ts`, and TypeScript enforces structural typing on object literals.

**Workaround applied:**
Extend the inline type annotation on the `context` variable:
```typescript
const context: SessionContext & {
  abandoned_work?: Array<{ id: number; ... }>;
  handoff_pending?: { id: number; ... };
} = { ... };
```

**Proposed fix:**
Add optional fields directly to `SessionContext` in `src/types.ts` for any field that is a permanent part of the response contract. Reserve the inline extension pattern only for genuinely transient/branch-specific additions. Alternatively, use `as unknown as Record<string, unknown>` at the return site if the field is best-effort and never accessed by typed consumers.

---

## C2 — Duplicate Import After Multi-Step Editing

**Encountered in:** `feature/v1.6-knowledge-graph`

**Problem:**
While adding the `gitCommand` helper to `src/tools/file-notes.ts`, an `import type { FileNoteRow }` was accidentally added at the bottom of the file, duplicating the existing import at the top. TypeScript reported:
```
Duplicate identifier 'FileNoteRow'
```

**Workaround applied:**
Removed the duplicate import. Replaced the cast `(note as FileNoteRow & {...})` with `(note as unknown as Record<string, unknown>)` to avoid needing an extended type.

**Proposed fix:**
Before adding any import to a file, use Grep to check if the identifier is already imported. Adopt a convention of keeping all imports at the very top of the file and never adding imports mid-file during a patching session.

---

## C3 — `sed -i` Used on Windows

**Encountered in:** `feature/v1.6-knowledge-graph`

**Problem:**
A `sed -i 's/.../.../' src/tools/file-notes.ts` command was used to update an import line on a Windows machine. While Git Bash provides `sed` and the command worked, this approach is fragile: `sed -i` on Windows (even via Git Bash) can fail with line-ending issues or path problems depending on the environment.

**Workaround applied:**
The command happened to work in this instance via Git Bash.

**Proposed fix:**
Always use the `Edit` tool for all file modifications. Reserve `Bash` exclusively for git operations, builds, and other shell commands that have no dedicated tool equivalent. Never use `sed`, `awk`, `echo >`, or `cat <<EOF` for file edits.

---

## C4 — Module-Level Variable Assumption in `database.ts`

**Encountered in:** `feature/v1.6-diagnostics`

**Problem:**
When writing `logToolCall()`, the implementation initially referenced `_currentSessionId` as a module-level variable (following the pattern from other internal state like `_db` and `_repos`). However, `_currentSessionId` does not exist as a module-level variable in `database.ts` — the session ID is always queried live via `getCurrentSessionId()` which runs `SELECT id FROM sessions WHERE ended_at IS NULL`.

**Workaround applied:**
Changed the reference to `getCurrentSessionId()`.

**Proposed fix:**
Before writing any function that accesses internal database state, read `src/database.ts` to confirm the actual variable names and access patterns. Key pattern: module-level vars are `_db`, `_repos`, `_services`, `_projectRoot`. Session ID is always live-queried, never cached as a module-level variable.

---

## C5 — Parallel Branch DB Version Conflicts

**Encountered in:** Planning phase for `feature/v1.6-*`

**Problem:**
Multiple feature branches were created from the same `develop` base (DB_VERSION=6) and each needed to add a new migration. Without pre-coordination, two branches could claim the same version number, making sequential merging impossible without manual conflict resolution of migration logic.

**Workaround applied:**
Assigned non-overlapping version numbers at planning time before writing any code:
- V7 → agent-safety (F1/F2)
- V8 → context-pressure (F3)
- V9 → knowledge-graph (F4/F8)
- V10 → session-handoff (F6)
- V11 → diagnostics (F10)

**Proposed fix:**
Establish a formal "version reservation" step at the start of each multi-branch development session. Add a table to `ENGRAM_IMPROVEMENT_PLAN.md` or a `DB_VERSION_REGISTRY.md` that maps planned migrations to version numbers before branching. This ensures no conflicts during sequential merges.

---

## C6 — Import Scope Divergence Across Branches

**Encountered in:** `feature/v1.6-quick-wins`

**Problem:**
The `feature/v1.6-quick-wins` branch was created from `develop` (not from `feature/v1.6-session-handoff`). When Q4 required `getDb()` in `sessions.ts`, the import was not present — it had only been added on the session-handoff branch. The build failed with `Cannot find name 'getDb'`.

**Workaround applied:**
Added `getDb` to the import in `sessions.ts` on the quick-wins branch.

**Proposed fix:**
When creating a feature branch that modifies the same files as an already-developed branch, either:
1. Branch from the most advanced feature branch rather than from `develop` (accepting the dependency), or
2. Check each file's current imports on `develop` before writing code that assumes imports from other branches.

A pre-flight check — `grep -n "^import" src/tools/sessions.ts` before editing — would have caught this immediately.

---

---

## C7 — Merge Conflict: sessions.ts Duplicate Fields from Parallel Feature Branches

**Encountered in:** Merging `feature/v1.6-session-handoff` and `feature/v1.6-quick-wins` into `develop`

**Problem:**
When two branches independently add fields to the same object literal in `sessions.ts` (the `start_session` response), git produces merge conflicts with both versions of the field side-by-side. A naive conflict resolution script (based on keeping both HEAD and THEIR blocks) can produce **duplicate keys** in the same object literal:
```typescript
// Both blocks kept verbatim → TypeScript TS1005 "':' expected"
update_available: ...,  // from F2's HEAD block
message: `...F2 message...`  // missing trailing comma — TS parse error
handoff_pending: ...,   // F6's THEIR block
update_available: ...,  // DUPLICATE
message: `...F6 message...`, // second message
```
TypeScript reports `TS1005: ':' expected` at the second key, because the first `message` value is missing a trailing comma.

**Root cause:**
Each feature branch (F2, F6, Q5) independently wrote the full `message` string and `update_available` field for each verbosity mode. When merged, these fields appear multiple times. The regex-based merge script matched the outer conflict markers but inserted both sides' content without removing the redundant keys.

**Workaround applied:**
After identifying the duplicate keys from the TypeScript build errors, manually merged the three message strings into a single template literal that contains all three notifications (⚠️ abandoned_work, 🤝 handoff_pending, 💡 suggested_focus) separated by conditional clauses. Removed the redundant `update_available` and `message` entries.

**Proposed fix:**
When resolving merge conflicts in object literals, always check for duplicate keys after applying the resolution. A simple `grep -n "update_available:\|message:" src/tools/sessions.ts` would reveal the duplicates instantly. Additionally, consider factoring the `message` string into a helper function so that branches only modify the helper call, not the message value inline.

---

## C8 — Merge Conflict: migrations.ts V10 Missing Closing Syntax

**Encountered in:** Merging `feature/v1.6-diagnostics` into `develop`

**Problem:**
When git creates a conflict between HEAD (which ends with V10 migration's last SQL line) and THEIRS (which starts with the V11 migration), the `=======` divider falls mid-way through V10's template literal. The closing lines of V10 (`\`);`, `},`, `},`) end up as the shared "after conflict" section — which git assigns to closing whichever block "wins". The result is that the HEAD side of the conflict is syntactically incomplete: V10 is missing its template literal closing backtick and function/object closing braces.

**Root cause:**
The conflict region in `migrations.ts` is the "last entry in the migrations array". Both HEAD and THEIRS modify the same trailing portion of the array. Git marks everything from the first diverging line (beginning of V7 in this case, because HEAD accumulated V7-V10 while the diagnostics branch only had V1-V6+V11) through to just before the common closing syntax.

**Pattern (recurring across all branch merges):**
- `context-pressure` merge: `=======` mid-V7, shared closers close V8
- `knowledge-graph` merge: `=======` mid-V8, shared closers close V9
- `session-handoff` merge: `=======` mid-V9, shared closers close V10
- `diagnostics` merge: `=======` mid-V10, shared closers close V11

**Workaround applied:**
For each merge, manually completed the HEAD migration's closing syntax (`\`);`, `},`, `},`), then appended the THEIRS migration in full, leaving the shared closing section to close THEIRS' new migration.

**Proposed fix:**
Add a sentinel comment at the very end of each migration entry:
```typescript
  {
    version: 10,
    up: (db) => { db.exec(`...`); },
  }, // END_V10
```
The `// END_V10` comment gives git a unique anchor point, ensuring the conflict boundary falls cleanly between migration objects rather than mid-object. Alternatively, add a trailing no-op migration placeholder at the end of the array that all branches leave untouched.

---

## C9 — Regex-Based Conflict Resolution Script Fails on Template Literals

**Encountered in:** Automated conflict resolution for `feature/v1.6-quick-wins` merge

**Problem:**
A Node.js script using regex to find-and-replace conflict markers failed to match 3 of 5 conflict regions in `sessions.ts`. The patterns matched in testing but not against the actual file. Root cause was likely: (1) template literal backticks and `${...}` expressions requiring complex regex escaping, (2) possible CRLF vs LF line-ending differences within the conflict region.

The script ran with `Remaining conflicts: 3` after processing.

**Workaround applied:**
Used the `Edit` tool with exact verbatim `old_string` matches for the 3 remaining conflict blocks. This was reliable because the Edit tool does exact string matching without regex.

**Proposed fix:**
For merge conflict resolution, prefer the `Edit` tool with exact multi-line `old_string` matches over regex-based scripts. Only fall back to Node.js scripts for conflicts where the content cannot be matched verbatim (e.g., CRLF/LF mixed files). When writing scripts, use `split()` and `indexOf()` on exact strings rather than regex patterns containing backticks or template literal syntax.

---

## Summary Table

| ID | Category | File(s) Affected | Severity | Status |
|----|----------|-----------------|----------|--------|
| C1 | TypeScript typing | `src/types.ts`, `src/tools/sessions.ts` | Medium | Workaround in place |
| C2 | Import hygiene | `src/tools/file-notes.ts` | Low | Fixed inline |
| C3 | Tool usage (Windows) | Any edited file | Low | Process improvement needed |
| C4 | database.ts internals | `src/database.ts` | Low | Fixed inline |
| C5 | Migration versioning | `src/migrations.ts`, `src/constants.ts` | High | Prevented by pre-planning |
| C6 | Import scope | `src/tools/sessions.ts` | Low | Fixed inline |
| C7 | Duplicate keys from multi-branch merge | `src/tools/sessions.ts` | High | Fixed manually |
| C8 | Migration closing syntax mid-conflict | `src/migrations.ts` | High | Fixed manually each merge |
| C9 | Regex fails on template literals | `src/tools/sessions.ts` | Medium | Edit tool used instead |

---

*Recorded: 2026-02-24 — Engram v1.6 development session*
