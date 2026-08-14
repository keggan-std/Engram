# Building This From Scratch — What I'd Do Differently

**Date:** 2026-08-10 · **Status:** Working advice, derived from a real project's scar tissue
**Scope:** For someone starting a project like Engram — a tool, largely agent-built, that other people will install.
**Sources:** Ten domain reviews, an external senior review, four remediation sessions, and one release.

> Not registered in Engram. Not a tool. Read it, apply it, edit it when you learn better.
>
> Written as plain prose rather than under the prism convention, deliberately. The closest
> analogue in this repo — [`orchestration-guide.md`](orchestration-guide.md) — is plain prose
> for the same reason: this is a document you argue with, not one you look things up in.

---

## The one-paragraph version

This project's founding insight is right: **a claim survives only if something executes it.**
It spent a year applying that to *structure* — generated files matching their generators, CI
steps mirrored, routers enumerating their own sets — and almost none of it to *content*. Every
expensive defect found in four sessions of review was a **true-sounding sentence that nothing
re-evaluated**: a README command nobody typed, a version claim nobody re-read, a config-scan that
reported absence when it meant absence-of-looking, an environment variable set in a test and read
by no code. If you start from scratch, point the machinery at sentences from day one, and accept
that most of your checking budget goes to the boring half.

---

## Part 1 — The four rules I'd write on day one

These are the ones that would have prevented the most damage, in order of how much they cost here.

### 1. Run the commands in your own README. On a schedule.

Four sessions of review, ten domain documents, and an external senior review all missed that the
headline install command had been serving a build from **April**. Nobody typed it.

The cause was not carelessness. `npx` caches per **exact spec string** and never re-checks, so
`npx -y engram-mcp-server` answers instantly, offline, forever, from whatever it fetched first.
The command *worked*. It just installed the wrong thing, and every review read it instead of
running it.

> **The rule:** every command in user-facing documentation is a claim. Extract them and execute
> them in CI against the published artifact — not the local build, which is the one thing that
> cannot reproduce this class of bug.

### 2. Bind the *closing* of a finding, not just the opening

This repo's grading table already says *anything CRITICAL gets an executable check.* It bound
opening a finding. It did not bind **closing** one.

The consequence was the worst bug in the project's history. A command-injection hole survived a
review because a call-site survey concluded *"every caller passes a literal."* Every caller did.
One literal was a template with a hole in it.

> **The rule:** a finding closed with an argument is not closed. It needs the same executable
> check its opening did. And when you fix it, **delete the shape rather than disarm the callers** —
> the fix here was removing `gitCommand`'s string signature entirely, so the hazard became
> unrepresentable instead of merely unused.

### 3. Never trust a green gate you have not seen red

Every gate added in the last two sessions was mutation-tested: reverted the fix, confirmed the
test failed, restored. It is cheap and it keeps finding things.

One *pre-existing* gate had been green for weeks while asserting a defect that no longer existed,
because it only ever inspected its own branch. Another passed a tampered document because it
required a noun to follow a digit directly, and the real sentence had two words in between.

And the practice pays a second dividend nobody plans for. While mutation-testing a new assertion
in this session, one gate went red for a reason I could not explain from the diff. Chasing that
instead of writing it off as "expected red" surfaced a **deterministic crash in a shipped
command** — `install --check` had been exiting 127 with a libuv assertion, printing its whole
report correctly and then dying, and no test or human had noticed.

> **The rule:** see every gate red before you believe it. And when a gate goes red for a reason
> you can't explain, that is the finding — not the noise.

### 4. Distinguish artifacts derived from *source* from artifacts derived from *runtime state*

They look identical and they need opposite treatment.

A file generated from committed source can be a CI gate: CI has the source, so it can regenerate
and diff. A file generated from a **live database** cannot be, even in principle — CI has no
database, and every session mutates the thing being compared against.

Engram's `STATE.md` freshness check learned this the expensive way. It could not reach exit 0 **by
construction**: committing the regenerated file created the commit that made it stale. A
permanently-on alarm carries no information, and the correct response is not to fix the alarm but
to notice it was the wrong instrument.

> **The rule:** before writing a gate, ask what its input is. If the input is not in the
> repository, the gate belongs in a pre-commit hook or a human ritual — not in `npm test`.

---

## Part 2 — Where the effort actually goes

### Audit by reachability, not by severity

`npm audit` reported 20 findings here, 4 critical, and offered to fix them all. Taking that offer
would have swapped the entire bundler — rollup and esbuild out, rolldown in, vite 7 → 8 — because
the test runner's own range pulls it. That is a toolchain migration wearing a security fix's
clothes.

The useful triage took three questions and about twenty minutes:

1. **What actually ships?** `package.json`'s `files` field is the answer, and `npm pack --dry-run`
   is how you check it rather than believe it. Every finding in the test toolchain reached no user.
2. **Of what ships, what is actually loaded?** Grep the import graph. Eight of nine production
   findings lived in HTTP-transport code inside a dependency that this project imports two
   subpaths of, neither of which touch it.
3. **What's left?** Exactly one — a WebSocket library that a live code path constructs at runtime.

That one was worth fixing immediately. And here is the part that generalises: **the other eight
needed no overrides and no forcing.** A plain `npm update` moved every one of them inside the
range the upstream package already declared. The advisories were not upstream refusing to patch.
They were **our lockfile being stale**. A triage driven by severity alone would have concluded the
opposite and reached for `overrides`, pinning versions upstream never tested, to protect code that
does not execute.

> Severity tells you how bad it would be. Reachability tells you whether it can happen. Only the
> second one is about your project.

### Coverage is not a number, it is a map of where bugs will be

The command-injection hole lived in the largest file at the lowest coverage. That is a mechanism,
not a coincidence, and the two remaining sub-9% files in this repo are where I would look next
without needing any other evidence.

---

## Part 3 — Writing tests that can actually fail

### A test written to be robust against behaviour it doesn't model will pass over a defect in it

This is the subtlest lesson here and the one I'd tattoo on a new project.

An end-to-end installer test needed to find the config file the installer had written. Predicting
the path would re-implement the resolver and could agree with a bug — sound reasoning, and the
author wrote it down. So the test accepted **either** the project-local path or the global one.

The defect was *which one it chose*. The non-interactive install silently wrote to the user's home
directory while the interactive prompt labelled the project-local path "(recommended)". The test
could not see it, because it had been carefully built not to care.

> **The rule:** when you make a test tolerant, write down what you made it blind to. That comment
> is where the next defect lives.

### Derive the subject list from the tree, not from the bug report

Every binding written in the strongest session of this project derived its subject list by reading
the tree — all FTS tables, all domain docs, all fetch call sites — rather than naming the reported
defect. One of them immediately found a table that appeared in no task, no document, and no
observation.

But derive from what is genuinely invariant. A first attempt keyed on a *naming convention* and
would have recorded a false claim. The one table that broke the convention was the one with the bug.

### A gate that can't tell code from a comment about code will fail whenever you document it

A structural gate written this session — "no `process.exit()` may follow a `fetch()`" — went red
against the *fixed* source. The comments explaining the defect contain the string `process.exit(`.

Strip comments before scanning source. And for documents, the analogous rule: text inside
strikethrough or quotation marks is a **preserved record**, not an assertion. A gate that matches
there forces the next author to delete history to get the build green, which is precisely
backwards.

---

## Part 4 — Documents that stay true

The single most expensive documentation failure in this project is preserved on purpose:
[`archive/cross-instance-sharing-bugs.md`](archive/cross-instance-sharing-bugs.md) asserted "not
yet fixed" for **eight versions** after the fix shipped. A reader who trusted it burned a session
re-fixing a solved bug.

That produced a convention — when a doc's subject ships, banner it, move it, log why — and the
convention was then violated by the very entry designed to prevent version drift, twice.

Three things that actually help:

- **Status and date in the first five lines.** A document with no date is one nobody can trust,
  and nobody *should* trust.
- **Route, don't restate.** Any number a document quotes about something living elsewhere is a
  copy you now maintain by hand. Name the owner instead. This repo's router quotes no live counts
  and a test enforces it.
- **Strike, don't delete.** Correcting a false claim by removing it destroys the evidence of how
  it got there. Strike it and put what superseded it beside it — then teach your gates to skip
  struck text, or they will fight the convention.

---

## Part 5 — If your project is built by agents

Most of the above is ordinary engineering. This part is not.

- **A sub-agent's report is a set of leads, not a set of facts.** A delegated review of this
  project's installer returned all-CLEAN. It graded a real finding clean and missed the most
  user-visible defect in the codebase while answering the very question that defect was the
  answer to. Re-doing it by hand found a shipped command that crashed every time it ran.
  [`orchestration-guide.md`](orchestration-guide.md) §3 has the full discipline.

- **Delegate breadth, keep judgment.** The test that works: if you'd accept the answer without
  checking it, delegate. If you'd check it anyway, do it yourself — otherwise you pay twice.

- **Check the tree before sizing work from a task row.** Rows in this project have repeatedly read
  `backlog` for work that had already shipped: the artifact gets fixed and the row does not. A
  file note in this session flagged a destructive bug that had been fixed days earlier. `git log`
  before you plan.

- **A row can overstate work as easily as it understates status.** One task sat `critical` /
  `backlog` describing a major dependency migration. The actual fix was a minor version bump
  already inside the declared range. It was closed, not deferred.

- **Sandbox anything that writes to a real machine before you probe it.** A proof-of-concept in
  this session wrote to, and then removed from, the maintainer's live IDE config — because the
  non-interactive install defaults to *global* scope, which was the very defect being
  investigated. Redirect `HOME` first. The reflex to reach for is: *if this tool writes files
  other products own, I do not run it outside a sandbox, ever.*

- **The same bug bites twice in one session if you let it.** A test written an hour after fixing a
  shell-injection hole hit `cmd.exe` eating a `^` out of a git argument — the identical
  shell-eats-your-argument class. The lesson does not generalise on its own. The fix has to be
  structural, not local.

---

## Part 6 — What I could not verify, and where this is thin

An empty "what I could not verify" section is a claim of total confidence, and it is rarely true.

- **Most of this is one project, one maintainer, one platform.** Windows shaped at least three of
  the findings above (the `cmd.exe` escape, the libuv exit assertion, the config paths). How much
  transfers to a Linux-first project is untested.
- **The "run your README in CI" rule is advice, not practice here.** It is the right conclusion
  from the npx-cache defect. Nothing in this repository implements it yet, and I have not paid
  the cost of maintaining such a check over time.
- **The reachability-first audit triage worked once.** It is not validated against a case where
  the unreachable code later became reachable, which is the obvious way it fails.
- **Nothing here is measured against a counterfactual.** These practices found real defects, but
  no one ran the alternative and compared. Treat the ordering as informed judgment, not evidence.
- **The distribution problem this project just discovered is unsolved.** Publishing a fix did not
  reach machines that already had the vulnerable build; see [`DEFERRED-CHANGES.md`](DEFERRED-CHANGES.md)
  D11. I can state the problem. I have no advice on it yet.

---

<!-- BUILDING_FROM_SCRATCH:COMPLETE -->
