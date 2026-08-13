# DRAFT — Security advisory for v1.12.0 and earlier

**Status:** **DRAFT. NOT PUBLISHED. NOT AN ADVISORY UNTIL THE MAINTAINER PUBLISHES IT.**
**Prepared:** 2026-08-13 by `claude-opus-5-session-51` · **For:** Engram task **#98**, master plan §7 item 3
**Clock:** 45 days from 2026-08-02 → **expires 2026-09-16**

> **Why this is a draft and not a publication.** Master plan §9 item 1 and task #98
> both state that whether to publish an advisory, and when, is *"a judgement about
> users, not about code"* and is **the maintainer's alone**. What an agent may do is
> prepare the draft. That is all this is.
>
> **Two things must be checked before this is published**, and an agent cannot
> settle either: whether the wording is right for your users, and whether the
> `1.14.0` release referenced below has actually shipped.

---

## What this covers

Four hazards present in **v1.12.0 and earlier**, all fixed in **v1.13.0**
(published 2026-08-05). Three of the four **require no attacker** — they fire
during ordinary use.

| # | What could happen | Attacker needed? | Fixed in |
|---|---|---|---|
| **H1** | The installer could replace **another product's** user-level config file with a stub | **No** | v1.13.0 |
| **H2** | `restore` reported success and restored nothing | **No** | v1.13.0 |
| **H3** | Agent rules were fetched from a GitHub README and cached to disk, then read back with an unchecked cast | Yes — a crafted repo | v1.13.0 |
| **H4** | `export` claimed "all data" and shipped 5 of 24 tables | **No** | v1.13.0 |

---

## H1 — Installer could destroy another product's configuration *(most serious)*

**What happened.** When writing an MCP entry, the installer parsed the target
config file. If that file was not valid JSON, `addToConfig` took a **best-effort**
backup — `try { … } catch { /* best-effort */ }` — and then started from an empty
object. If the backup threw, the original content was gone with no undo.

**Why it is the most serious of the four.** It needs **no attacker and no unusual
setup**. It fires when a config file is malformed, which happens on its own — a
half-written file after a crash, a trailing comma, an editor writing concurrently.
The blast radius is another product's entire user state: `~/.claude.json` was
measured at **40.5 KB across 53 top-level keys**, none of it Engram's.

**Fix.** The parse error is rethrown instead of swallowed, the backup is blocking
rather than best-effort, and the installer refuses to write to a config it cannot
parse. `install --check` reports such files under an `UNREADABLE` heading and
exits non-zero.

**If you may have been affected.** Look for a `.backup` file beside your IDE's MCP
config with a timestamp matching when you last ran the installer. If your config
is a stub containing only an Engram entry, that backup is your restore point.

## H2 — `restore` reported success and restored nothing

The command returned success without having replaced the database. The failure
mode is the worst available for a recovery tool: it is discovered at the moment
the user needs it, having already believed themselves protected. Fixed in v1.13.0;
restore now verifies the restored file and fails loudly.

## H3 — Remote agent rules cached and read back with an unchecked cast

Agent rules were fetched from a GitHub README at session start, cached to disk,
and read back with a type assertion rather than validation. A crafted repository
could place attacker-authored text into an agent's context labelled **CRITICAL**.
This is the only one of the four that requires an attacker. The remote path is
removed; rules are packaged with the server.

## H4 — `export` claimed "all data" and shipped 5 of 24 tables

Users taking a backup before an upgrade or a migration received a **silent partial
export they believed was complete**. Fixed in v1.13.0; export is now derived from
`sqlite_master`, so a new table is included the day it is added. Credentials are
redacted, with a test that greps the raw export for the token value.

---

## What to do

**Upgrade to the latest version.**

```bash
npx -y engram-mcp-server@latest --install
npx -y engram-mcp-server@latest --check     # confirm the version that is actually installed
```

> **The `@latest` matters and is not decoration.** `npx` caches by *package name*.
> A bare `npx -y engram-mcp-server` re-runs whatever copy npx downloaded the first
> time you ran it — possibly months old — and reports that version as current.
> **Verify with `--check` rather than assuming the upgrade took effect.**
>
> On Windows, `--check` itself crashed with a libuv assertion in v1.13.0 and
> earlier. It is fixed in **v1.14.0**.

---

## Timeline

| Date | |
|---|---|
| 2026-08-02 | Hazards recorded during an internal review. 45-day clock starts |
| 2026-08-05 | **v1.13.0 published** with all four fixes |
| 2026-08-13 | **v1.14.0** prepared — fixes `--check`, the command used to verify the upgrade |
| 2026-09-16 | Advisory clock expires: publish, or record the extension as a decision |

**No exploitation is known.** These were found by an internal review, not by a
report. Engram is local-first: it stores nothing remotely and has no
authentication surface, so H1, H2 and H4 are data-integrity hazards on the user's
own machine rather than remote-attack surface.

---

## Notes for the maintainer — delete before publishing

1. **Check `1.14.0` shipped** before publishing this. The "what to do" section
   tells users to verify with `--check`, and on Windows that command is broken in
   every version this advisory asks them to upgrade *from*.
2. **The H1 recovery paragraph is the part to review hardest.** It tells users to
   look for a specific file. Confirm that matches what v1.12.0 actually wrote.
3. **CERT/CC's 45-day norm publishes regardless of patch status**, while warning
   that gratuitous announcement may not serve public safety. The clock's purpose
   per master plan §4.4 is to make continued silence *a decision rather than a
   default* — not to force disclosure.
4. **If you extend instead of publishing**, record it with
   `engram_memory(action:"record_decision")` naming the reason. That is what #98
   asks for as the alternative, and an unrecorded extension is the drift the kill
   switch is meant to catch.
5. **Channel:** `SECURITY.md` directs reports to GitHub Security Advisories
   ([new draft](https://github.com/keggan-std/Engram/security/advisories/new)) or
   the maintainer's email. Publishing there also populates the GitHub Advisory
   Database.

<!-- SECURITY_ADVISORY:DRAFT_NOT_PUBLISHED -->
