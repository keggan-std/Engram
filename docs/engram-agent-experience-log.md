# Engram Agent Experience Log

Purpose: capture practical observations while working with Engram so improvements can be proposed with concrete context.

---

## 2026-03-02 — Session #47

### What worked well
- Session resume is strong: `start` returned active decisions, conventions, and open tasks with useful focus filtering.
- `record_change` batching is fast and reliable for large feature drops.
- `set_file_notes_batch` is highly effective for quickly making a large code drop navigable for future agents.

### Friction encountered
- Terminal cwd drift caused repeated build failures (`npm` executed outside repo root).
- Very large uncommitted feature drops require many manual note entries; this is error-prone without automation.
- There is no direct “sync git changed files -> notes skeletons” helper.

### Improvement ideas for Engram
1. Add action: `sync_changed_files`
   - Input: optional `mode` (`staged|unstaged|all`), optional `include_untracked`
   - Behavior: ingest git changed list and auto-create minimal file notes stubs + change records draft.

2. Add action: `record_build_result`
   - Input: command, cwd, exit_code, summary
   - Behavior: keep build/test outcomes attached to session timeline.

3. Add action: `recommend_next_steps`
   - Input: current session context
   - Behavior: suggest prioritized next actions from open tasks + pending changes + recent failures.

### Notes for future sessions
- Always use explicit absolute repo path for terminal build commands when switching between package and root contexts.
- After any broad scan of changed files, immediately run `record_change` and `set_file_notes_batch` before coding more.
