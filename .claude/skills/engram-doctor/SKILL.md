---
name: engram-doctor
description: >
  Use at the start of a session, or when the user asks "where is this project",
  "what's the state", "is anything stale", "what should I work on", "catch me up",
  or before planning work from docs/STATE.md, the task board, or any status
  document. Also use when the user mentions stale docs, drift, or asks whether a
  document can be trusted. Checks whether this project's generated registers are
  telling the truth before you plan from them.
allowed-tools: Bash, Read
---

# Is this project's state actually what the documents say?

**Run the check before you trust the register. It takes one command.**

```bash
node scripts/check-state-freshness.mjs
```

## Why this skill exists rather than a rule

This project measured what happens to rules: agent rule AR-01 is priority CRITICAL,
is replayed into every session, and sits at **21.1% compliance**. AR-02 was called by
**3 of 19** sessions. Nothing detects, blocks or counts a violation of either.

So this is not a rule asking you to remember something. It is a command that answers a
question you cannot answer by reading, and the answer changes what you do next.

## What the check tells you

| Exit | Meaning | What to do |
|---|---|---|
| `0` | `docs/STATE.md` was generated at the current HEAD, on this branch | Trust it. Read it and proceed. |
| `1` | It is behind, on the wrong branch, or older than its own generator | **Do not plan from it.** Regenerate with `npm run state`, then read it. |

The output names how many commits have landed since it was generated and whether any
of them touched `src/`. A documentation-only drift is usually harmless; a drift that
includes source changes means the register describes a tree that no longer exists.

## The finding this encodes

Charter finding **F5** — a status-bearing claim that is quietly no longer true.
`docs/STATE.md` is the sharpest instance, because `CLAUDE.md` tells every agent to read
it **first**, and nothing regenerates it. Tasks **#57** and **#74** found that gap
independently: STATE.md's own generator names a binding that does not exist.

`docs/archive/cross-instance-sharing-bugs.md` is the preserved evidence of the cost —
it asserted "not yet fixed" for eight versions after the fix shipped.

## After the check — the rest of the orientation

Once the register is current, the read order in `CLAUDE.md` applies:

1. `docs/STATE.md` — where the project actually is
2. `docs/README.md` — the router; it names the active document set
3. `docs/foundations/00-CHARTER.md` — the spec this work executes from

And before opening any source file, call `engram_memory(action:"get_file_notes")` —
every file under `src/` is already noted, and re-reading the codebase to rediscover what
is already recorded is the most expensive habit in this repository.

## What this skill deliberately does not do

- **It does not regenerate anything on your behalf.** Regeneration writes a tracked file;
  that is your call and it should appear in a diff someone approves.
- **It does not check whether STATE.md's *contents* are correct** — only whether it was
  generated from the current tree. A register generated from a correct store at the wrong
  commit is stale; a register generated at the right commit from a wrong store is a
  different defect, and this check cannot see it. Say so if you rely on it.
