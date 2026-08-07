# The Master Plan, in plain English

**Date:** 2026-08-06 · **Status:** Companion explainer — **not** the authority
**Explains:** [`ENGRAM-MASTER-PLAN.md`](../ENGRAM-MASTER-PLAN.md), as it stood after the 2026-08-06 staleness sweep

> **If this file and the plan ever disagree, the plan wins.** This is a retelling, not a
> record. It contains no facts the plan does not contain, and no numbers at all — numbers
> are exactly what went stale in the original. Nothing here is a decision.

---

## First, what is Engram?

Imagine a very forgetful but very fast assistant. Every morning they arrive with no memory
of yesterday. So you give them a **notebook**. They write down what they did, what they
decided, and what they learned. Tomorrow they read the notebook and carry on.

Engram is that notebook — for AI coding assistants. That is the whole product.

And now the important part, because everything else follows from it:

> **A notebook that is empty is annoying. A notebook that is confidently *wrong* is
> dangerous.** If it says "the back door is locked" and the back door is open, you are
> worse off than if the notebook had said nothing, because now you won't go and check.

---

## A — What ten inspections found *(plan §1)*

Ten separate reviews were done, each looking at a different part of the product. They all
found the **same shape of problem**. Not ten different bugs — one bug wearing ten costumes:

> **A button that is on the menu, is described correctly in the manual, and is not
> connected to anything.**

Think of a restaurant. The menu lists twenty dishes. The photos are accurate. The
descriptions are lovely. But for eight of them, **the kitchen has no recipe** — order one
and the waiter brings you an empty plate and says "enjoy".

Real examples, in plain words:

- The **"restore my backup"** button said *"Restored!"* and restored nothing. A fire
  extinguisher that goes *pssht* and sprays air.
- A **"mark this as private"** feature. You mark things private. Nothing anywhere checks
  the mark. Like putting a "Do Not Enter" sign on a door with no lock — and then behaving
  as if the room is safe.
- **"Export all my data"** gave you five drawers out of twenty-four, and called it
  everything.
- A **search box** for the notes that could never find any of them, and never said so.
- Rules marked **CRITICAL** that the assistants were told to follow — and which were
  measured as being followed about one time in five, with nothing anywhere counting.

**And the punchline:** the ten inspection teams each built an alarm to stop their problem
coming back — and **not one of the alarms was switched on.** The people investigating the
problem walked straight into it. That is not embarrassing; it is the strongest evidence
that the problem is real and structural, not carelessness.

---

## B — The one fix that makes the other ten real *(plan §2)*

The alarms were built. They were installed in the **spare house**.

The project has two versions of itself: the **public one** everybody downloads, and the
**workshop one** where the repairs are happening. All ten alarms were wired into the
workshop. The public house has none of them — and the workshop has never been shown to
anyone.

Worse, the alarm that was supposed to check *"are the alarms switched on?"* could only ever
look at **the house it was standing in**. Standing in the workshop, it saw ten working
alarms and reported all clear. It was structurally unable to notice the other house.

**So the very first job is not fixing anything new — it is making the alarms actually
ring.** Half of that is done: the checks now run automatically every time anyone tests the
code, anywhere. The other half needs the workshop to be shown to the public, and that is a
human decision (see section I).

---

## C — What Engram is *for*, now *(plan §3)*

The original goal was: **remember things**. The new goal is bigger:

> **Remember things — and be answerable for them.**

From that, one rule replaces all arguments about whether a feature is nice:

> **Every advertised feature must actually work, and something must break loudly if it
> stops working. If it can't do both, delete the feature — or delete the claim.**

Not "write down that it's limited". **Delete.** Because a note saying "this is a bit
limited" quietly turns, over a year, into everyone assuming it works.

There is also a thing the plan says **not** to do, firmly, because the temptation keeps
coming back: *"there are too many commands, let's cut them down to twenty."* Three separate
pieces of evidence say the number of commands is not the problem. The real problem is that
each command **advertises a huge pile of settings**, most of which don't apply to it, with
nothing saying which is which. Like a microwave with eighty buttons where only four do
anything for the thing you're heating, and the manual doesn't say which four.

---

## D — What is broken on people's machines *right now* *(plan §4.1)*

Four problems are in the version people have already downloaded. **Three of them need no
attacker at all** — they just happen.

| | In plain words |
|---|---|
| **The worst one** | During installation, Engram opens a settings file belonging to **a different program**. If it can't read that file, it **throws it away and writes a blank one**. Imagine a repair man who can't read your neighbour's address book, so he replaces it with an empty notebook and leaves. Nobody attacked anything. A slightly odd file is enough |
| **The fake restore** | The recovery button that recovers nothing — and it fails at the exact moment you needed it |
| **The borrowed rules** | The assistant fetched its house rules from a public web page and treated them as instructions. Anyone who controlled that page could write the rules |
| **The partial backup** | "Export everything" that quietly exports a fraction, while looking like a complete backup file |

**Why the first one matters more than it sounds.** The earlier reasoning went: *"this
project is small, nobody's watching, so the risk is low."* That reasoning is about
**attackers**. The worst bug does not involve an attacker. Popularity is irrelevant to it.
It fires on a malformed file.

*(And on the "we're too small to be a target" idea: the first malicious package of this
kind ever found in the wild was a small one — it went unnoticed for fifteen versions
**precisely because** small things get less scrutiny. Being obscure is the normal state of
almost every package. It is not a shield.)*

---

## E — How the fix ships *(plan §4.3)*

**Two releases, not one.**

- **Release A** — small, urgent, fixes those four things. **It is already built, tested and
  sitting on the shelf.** Nothing is left to make. Someone has to press *publish*.
- **Release B** — the big one, later. It contains changes that will break things for
  existing users, which is fine, but only if announced properly.

Three tempting alternatives were considered and rejected, and the reasons are worth
knowing:

- *"Just do one big release with everything."* → The dangerous bugs stay on people's
  machines for however long the big job takes. Not acceptable when one of them damages a
  different program's files.
- *"Wait until all the repairs are done."* → That finish line moves every time. There is a
  name for it in the plan: **a receding horizon**.
- *"Fix it quietly, don't tell anyone."* → When a big security company silently patched a
  hole that was actively being exploited, the only people left in the dark were **the
  defenders**. A fix whose notes hide the reason is a second lie, one week after removing
  the first.

---

## F — The clock *(plan §4.4)*

There is one date in this entire project: **2026-09-16**.

On that day, one of two things must happen: either the security notice is **published**, or
the reason for waiting longer is **written down as a decision**.

The point is not to force anyone to announce anything. The point is:

> **Silence should be a choice somebody made, not a thing that happened because nobody
> looked at the calendar.**

Forty-five days is the same window a well-known security institution uses, and it publishes
at forty-five days whether or not a fix exists — while also warning that shouting about
holes for no reason can make people less safe. Both halves matter.

> **This date had quietly fallen off the list.** The plan pointed at a to-do item that had
> already been ticked off for other reasons, so the one dated promise in the whole project
> had nothing tracking it. Fixed on 2026-08-06 — it now has its own item and an alarm set
> for the date.

---

## G — What gets thrown away, and what deliberately stays *(plan §5)*

**Thrown away:** the disconnected buttons. The "private" marking that marks nothing. Error
messages nobody ever shows. A rule the assistants ignore four times out of five. Files
bloating the download that nobody needs.

**Deliberately kept**, and this is the interesting half:

- **All the commands.** Nobody may delete one until there is a working report showing it is
  genuinely never used. *"I think this is unused"* is not evidence.
- **A big pile of unused-looking old code.** It looks like junk. It is actually **the only
  surviving record of safety checks that were accidentally deleted once before** — and one
  of those checks has already had to be rescued from it. The cautionary tale attached is a
  trading firm that lost hundreds of millions of dollars in forty-five minutes by deleting
  old code on a schedule.
- **A published promise about response times**, even though it may be too ambitious.
  Quietly deleting a public promise is the same move as the false claim just corrected.
  Change it **visibly**, or make it true.

---

## H — The order of work *(plan §7)*

Roughly, and the ordering rule is *"what is on a stranger's computer right now?"*:

1. ✅ Make the alarms ring — *half done*
2. ✅ Build the urgent release — *done, waiting on a human*
3. ⏳ The clock decision — *now tracked*
4. → Stop the notebook accepting damaged entries
5. → Make every entry record **who actually wrote it**
6. → Stop automatically believing every note just because it is in the notebook
7. → …then the rest

**One honest note added on 2026-08-06:** items 4 onwards have **not been started**. Recent
work went into the front door instead — the instructions an assistant reads before it does
anything. That is not drift, but a reader of the list would not have known, so the list now
says so.

---

## I — The four things nobody but the owner can decide *(plan §9)*

The plan is deliberate about this. It decides a lot. It refuses to decide these:

1. **Whether to publish the security notice, and when.** That is a judgement about people,
   not about code.
2. **Whether to make the workshop version public at all.** Showing it *is* the announcement
   — you cannot do one without the other.
3. **Whether some side-projects stay in this repository.**
4. **Whether the published promise about response times is one person can actually keep.**
   The plan calls this the only problem it found that **cannot be taken back**, because the
   promise is already public.

---

## J — When to stop *(plan §10)*

The best thing in the plan, and the easiest to miss. Before anyone got attached to it, the
plan wrote down **the conditions under which it should be abandoned**. For example: *if a
repair is made and its own alarm is quietly adjusted to stop complaining, undo the whole
thing and start again.*

That is a person writing down, in advance, how they would want to be told they were wrong —
while they still have no reason to argue.

---

## The whole thing in six sentences

1. A notebook for forgetful AI assistants. Being **wrong** is worse than being **empty**.
2. Ten inspections found one problem ten times: **features that are advertised and don't
   actually run.**
3. The inspectors then did it too — they built ten alarms and left every one switched off.
4. So the first job is making the alarms ring; that is half done.
5. Four real problems are on people's machines today; the fix is **built and waiting for
   someone to press publish**.
6. Everything else is queued behind that, and four decisions belong to the owner alone.

---

## What changed in the plan on 2026-08-06

Nine statements in it were wrong. Five were **counts written into a sentence** — how many
tests, how many jobs on the list — and they had all drifted within a day of being written.
Those were **deleted, not corrected**, because correcting a number in a hand-written
sentence buys you exactly one day. The sentence now points at the thing that knows the real
answer.

The other four were genuine mistakes: a pointer to the wrong to-do item, a count that was
wrong on the day it was typed, a claim that one side-project had been published when none
had, and a section that didn't mention a problem had since been fixed.

**Every edit says, in the document itself, what it used to say and why it was wrong.**
Which is the whole idea, really: the plan is about things that quietly stop being true, so
it would be a poor plan if fixing it happened quietly.
