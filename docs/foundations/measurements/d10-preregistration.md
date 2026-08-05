# FR-D10 pre-registration

Written 2026-08-05 BEFORE opening README.md, SECURITY.md, LICENSE, CONTRIBUTING.md,
CODE_OF_CONDUCT.md, llms.txt, package.json, or .github/ — and before any delegation.

Basis available at time of writing: docs/STATE.md, 00-CHARTER.md, orchestration-guide.md,
DEFERRED-CHANGES.md, 08-codebase.md, and `ls` of the repo root only.

Suppression arm: no Engram recall action called. STATE.md was read (leaked channel, see below).

---

**P1 — The published README makes a security-relevant claim that is false for the
published build.** The audit found an undisclosed GitHub fetch behind the claim
"the only outbound network call is the npm update check" (charter §4.1). That fetch was
deleted on this branch (D3) but is LIVE in published v1.12.0. I predict README (or
llms.txt) still asserts something about network/local-only behaviour that is untrue of
the artifact a stranger installs today.

**P2 — SECURITY.md names a reporting channel that has never been exercised and may not
work**, and there is no published advisory for the four P0 findings. Prediction:
the process exists on paper with no mechanism confirming the channel is live.

**P3 — README's embedded ENGRAM_INSTRUCTIONS block is a second, ungated source of truth
for the tool surface** and has drifted from CAPABILITY-SURFACE.md. No gate covers README
prose. (D2 records the block was hand-edited on 2026-08-02.)

**P4 — The IDE count is stated as a number somewhere on the public surface and that
number is wrong or inconsistent across README / llms.txt / package.json.** Charter §11b.1
says "14 IDE integrations"; D11 shows Android Studio was added to README and llms.txt
independently.

**P5 — `package.json`'s `files`/`exports` publish something unintended, or omit something
the README tells users to use.** What lands in the npm tarball is the truest definition
of "what is public", and nothing in this repo has ever checked it.

---

## Scoring rule, fixed now

CONFIRMED / FALSIFIED only. "Partially" is not a verdict. A prediction that cannot be
wrong was not a prediction.
