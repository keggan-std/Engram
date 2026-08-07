# `temp/` — not temporary. The name is wrong and the contents are not.

**Added 2026-08-07** · Senior review S11

> **Do not delete this directory because of its name.** That is the whole
> reason this file exists.

The review flagged it exactly right: *"A tracked directory named `temp` is one
nobody will dare delete."* It has been tracked in git the entire time, it holds
authored assets, and nothing about the name says so. The two failure modes are
symmetrical — someone clears it as scratch space and loses work, or everyone
avoids it forever and it accretes.

## What is actually in here

| File | What it is |
|---|---|
| `carto-src.skill` | Packaged Claude skill (binary `.skill` bundle) |
| `ghostwriter.skill` | Packaged Claude skill |
| `prism.skill` | Packaged Claude skill — the dual-audience document convention this repo's docs use |
| `tracer.skill` | Packaged Claude skill |
| `CHANGELOG.md` | Authoring notes |
| `agent-handoff.md` | Authoring notes |
| `file-architecture.md` | Authoring notes |
| `inline-comment-guide.md` | Authoring notes |
| `project-structure.md` | Authoring notes |
| `write-manifest.md` | Authoring notes |

None of it is generated. None of it is reproducible by running a command.

## What should happen to it

**This is a decision for the repository owner, not for a review pass**, which
is why the contents have been left exactly where they are. The options, in the
order they seem sensible:

1. **Rename the directory** to what it is — `authoring/`, `skills/`, or split
   the `.skill` bundles from the prose. Renaming is the cheap fix and it
   removes the hazard entirely.
2. **Move it out of the repository** if these assets belong to the author
   rather than to Engram. Several are general-purpose skills with no Engram
   dependency.
3. **Keep the name** and keep this file. That is the status quo plus a label,
   and it is the only option that leaves the trap partly set.

Nothing here is referenced by `src/`, `tests/`, `scripts/` or the build, so any
of the three is safe with respect to the build. Verified 2026-08-07.
