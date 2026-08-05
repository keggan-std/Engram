# Instrument 1 — Shadow Judgment, first and only run

**Date:** 2026-08-05 · **Run by:** FR-D10 · **Charter:** [`../00-CHARTER.md`](../00-CHARTER.md) §10.3
**Domain doc:** [`../10-public-surface.md`](../10-public-surface.md) §8

> Charter §10.3 names shadow judgment the **primary** instrument of the baseline
> experiment. It had produced **zero output across nine completed domains** — flagged in
> observation #90, and again by FR-D9 and FR-D8, neither of which ran it. D10 was the last
> domain; after it there is no more sample.

---

## 1. Method

**Unit.** The recall event (§10.2), not the session.

**Sample.** n = **14**, reconstructed from the nine completed domain documents' own
citations of stored Engram records (`decision #N`, `observation #N`, `task #N`,
`convention #N`, `handoff #N`).

**Why reconstructed.** Recall events were never logged at the time. `tool_call_log` records
that a recall action was *called* from `5ff7e2f` onward, but not what it returned or what
the agent did next. The documents' own citations are the only surviving evidence linking a
specific recalled item to a specific outcome. This is the run's binding limitation.

**Blinding.** Three agents, none of which saw another's output:

1. **Builder** — read the nine docs, extracted events, wrote each *neutrally* under an
   explicit instruction not to state, hint at, or evaluate usefulness. Recorded what was
   *also available at the time* (files, commands) per event.
2. **Judge A** — E-01…E-07. 3. **Judge B** — E-08…E-14. Disjoint halves, fresh context,
   each answering §10.3's single question and permitted to open the repository to check
   whether a fact was available elsewhere. Both did.

**Verdicts** per §10.3: REQUIRED · REPLACEABLE · IRRELEVANT · MISLEADING.

### 1.1 The sampling instruction that biased the result

The builder was told to include **at least two events where the recalled item turned out to
be wrong, stale, or was later corrected**, on the reasoning that a sample containing none
cannot evaluate the bucket §10.3 calls the one that matters. It found and included **five**.

**This makes the MISLEADING rate uninterpretable as a base rate.** It is stated here, in the
method section, rather than as a footnote to the result — see §4.

---

## 2. Coverage

| Domain | Events | Note |
|---|---|---|
| D1 durability | 2 | |
| D2 trust & safety | 2 | |
| D3 storage | 2 | |
| D4 concurrency | 1 | only one usable citation |
| D5 distribution | **0** | **cites no stored record with content** — bare task IDs (#43, #34), no reproduced text, no shown influence on a conclusion |
| D6 observability | 1 | only one usable citation |
| D7 ergonomics | 2 | |
| D8 codebase | 2 | |
| D9 process | 2 | |

**Record kinds:** decision 5 · observation 5 · task 2 · handoff 2 · convention 1.
**No numbered file-note or session-summary citation appears in any of the nine documents** —
noted rather than invented. Both are auto-delivered categories under §10.1, and neither has
ever been cited by a domain doc.

---

## 3. Verdicts

| Event | Domain | Kind | Verdict | Judge |
|---|---|---|---|---|
| E-01 | D1 | observation #58 | REPLACEABLE | A |
| E-02 | D1 | decision #19 | REPLACEABLE | A |
| E-03 | D2 | observation #65 | **MISLEADING** | A |
| E-04 | D2 | task #37 | REPLACEABLE | A |
| E-05 | D3 | task #35 | REPLACEABLE | A |
| E-06 | D3 | handoff #7 | REPLACEABLE | A |
| E-07 | D4 | decision #21 | REPLACEABLE | A |
| E-08 | D6 | observation #49 | REPLACEABLE | B |
| E-09 | D7 | handoff #8 | REPLACEABLE | B |
| E-10 | D7 | **convention #7** | **REQUIRED** | B |
| E-11 | D8 | decision #25 | REPLACEABLE | B |
| E-12 | D8 | observation #99 | REPLACEABLE | B |
| E-13 | D9 | observation #91 | **MISLEADING** | B |
| E-14 | D9 | decision #26 | **MISLEADING** | B |

```
Judge A (E-01..E-07):  REQUIRED=0  REPLACEABLE=6  IRRELEVANT=0  MISLEADING=1
Judge B (E-08..E-14):  REQUIRED=1  REPLACEABLE=4  IRRELEVANT=0  MISLEADING=2
TOTAL      (n = 14):   REQUIRED=1  REPLACEABLE=10 IRRELEVANT=0  MISLEADING=3
                            7%           71%            0%            21%
```

### 3.1 The one REQUIRED

**E-10 — convention #7.** The task was whether to accept a prior stored verdict or
re-investigate. Judge B's reason: three earlier attempts to diagnose the same defect from
the codebase alone (observations #57, #83, #84) had been wrong and retracted, so *"just read
the code" was demonstrably not reliable here.* Confidence: high.

### 3.2 The three MISLEADING

- **E-03** — observation #65 graded a claim FALSE on an incomplete check (only
  `http-server.ts` examined). `src/index.ts:218-219` does validate the WebSocket token. The
  grade had to be corrected to PARTLY TRUE. Confidence: high.
- **E-13** — observation #91 framed `STATE.md` staleness as a sequencing problem. The
  sequencing fact was real; the conclusion was reversed, because the actual cause was that
  no gate existed at all. Three agents trusted the ordering fix and still handed over a
  misdirecting file. Confidence: medium.
- **E-14** — a prior domain's conclusion that decision #26's *"content is intact, nothing
  was lost"* is false on its own terms: the `rationale` column is NULL, so anything reading
  that column structurally gets nothing. Confidence: medium.

**All three fall inside the five events deliberately selected as corrections.**

---

## 4. Reading against the §10.5 retirement criteria

| # | Criterion | Result |
|---|---|---|
| **R1** | MISLEADING ≥ 10% → stop auto-loading at session start | **NOT EVALUABLE.** Observed 21%, but the sample was enriched for corrections by instruction (§1.1). All 3 MISLEADING came from the 5 selected events; the unselected 9 produced 0. **Do not report R1 as fired.** |
| **R2** | REQUIRED + REPLACEABLE < 50% over ≥30 events | **Does not fire** — 79%. Also below the 30-event minimum, so this is indicative only. |
| **R3** | Suppression shows no detectable difference | **UNEVALUABLE.** Both arms (FR-D8, FR-D10) leaked the same generated channel — `STATE.md` re-exports Engram memory into the tree. See 10-public-surface §0.1 and §4 T5. |
| **R4** | Any category scores 0 REQUIRED over the full sample | **Fires for 4 of 5 categories present** — decision (0/5), observation (0/5), task (0/2), handoff (0/2). The only REQUIRED was a convention. Enrichment does not explain this: the instruction biased inclusion, not verdict assignment. |

### 4.1 Why so much was REPLACEABLE

The substitute the judges named was, repeatedly, **a committed document in this repository**:

| Event | Named substitute |
|---|---|
| E-01 | `scripts/make-golden-fixture.mjs:84-91` — its own comments |
| E-02 | `DEFERRED-CHANGES.md:458-460` |
| E-05 | `STATE.md:50` |
| E-06 | `src/repositories/observations.repo.ts`, `dispatcher-memory.ts:1029-1044` |
| E-11 | `00-CHARTER.md` §10.4 |
| E-12 | `STATE.md` + `scripts/generate-state.mjs` |

**Engram's recall is replaceable in this project largely because this project writes
everything into git as well.** Charter §10.6 already warns the result cannot distinguish
"Engram helps" from "Engram helps *this project*". This run gives that warning a mechanism
instead of only a caveat — and the documentary discipline responsible is itself a product of
the review that recall was supporting.

---

## 5. Honest limits

- **n = 14** against a planned 50–150.
- **Reconstructed, not logged.** Only recalls a document *cited* are visible; a recall that
  quietly changed a direction and was never mentioned cannot appear. This biases toward
  events that mattered — which makes REQUIRED = 1 the more surprising number, not less.
- **Enriched by construction** (§1.1). The MISLEADING rate is an artefact of the sampling
  instruction and must not be quoted bare.
- **Both judges are the same model family**, judging another model's work. §10.6 flags
  shared blind spots; two judges over disjoint halves does not address it.
- **Half-level effects are unmeasured.** Judge A returned 0 REQUIRED and Judge B returned 1;
  with disjoint halves there is no inter-rater agreement statistic at all. Overlapping
  assignment would have cost one more round and should be the design next time.

## 6. What would make the next run better

Recorded as Engram task **#90**: log recall events at the time they occur — action, what was
returned, and the session — so the sample is drawn rather than reconstructed. Without it, a
future run repeats this one's limitations exactly. **Charter §10.2 assumes a sample of
recall events exists. It never did.** That, more than any verdict above, is why the primary
instrument went nine domains without running.

---

<!-- INSTRUMENT_1:RUN_ONCE -->
