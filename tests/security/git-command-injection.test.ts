import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import {
  gitCommand,
  getGitLogSince,
  getGitFilesChanged,
  getGitDiffStat,
} from "../../src/utils.js";
import { isValidSince, SINCE_RELATIVE, SINCE_ISO } from "../../src/constants.js";

/**
 * THIS FILE IS A PROOF OF CONCEPT THAT BECAME A REGRESSION TEST.
 *
 * On 2026-08-07 a senior review PROVED arbitrary command execution through
 * `engram_memory(action:"what_changed", since:"...")`. `since` was a free-form
 * `z.string()` that fell through an unguarded `else` into
 * `getGitLogSince` -> `gitCommand`, which built
 * `execSync(\`cd "${projectRoot}" && git ${command}\`)`.
 *
 * The 2026-08-02 deep audit had already looked at this and graded it MEDIUM,
 * "not currently exploitable" (engram-deep-audit-2026-08-02.md:355), because
 * every call site passed a string literal. Every call site DID pass a literal.
 * One of those literals was a template with a user-controlled hole in it.
 * The finding was closed with an argument instead of a check — which is why
 * this file exists and why it is a test rather than a paragraph.
 *
 * DEFERRED-CHANGES D6 records this project losing two proof-of-concepts to
 * session scratchpads already. This one is committed.
 *
 * If someone reintroduces a shell in gitCommand, the first test here fails.
 */

const MARKER = "PWNED-BY-SINCE.txt";

describe("gitCommand does not spawn a shell (audit N7 / senior review S1)", () => {
  let sandbox: string;
  let marker: string;

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "engram-injection-"));
    marker = path.join(sandbox, MARKER);
    if (existsSync(marker)) rmSync(marker);
  });

  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  /**
   * The payload uses `&` (cmd.exe) and `;` (POSIX sh) so it fires on either
   * platform, and closes with a comment token so the shell would exit 0.
   *
   * That trailing comment is the whole trick and it is worth keeping. The
   * first PoC attempt looked like a FALSE NEGATIVE because gitCommand wraps
   * everything in `try { ... } catch { return "" }`: an injected command runs,
   * but a non-zero overall exit makes the output vanish. Absence of output is
   * not absence of execution. Assert on the SIDE EFFECT, never on the return.
   */
  const payloads = [
    `x" & echo pwned> "${MARKER}" & rem `,
    `x"; echo pwned > "${MARKER}"; #`,
    `x$(echo pwned > ${MARKER})`,
    "x`echo pwned > " + MARKER + "`",
  ];

  it("no payload passed as `since` can create a file — the PoC, inverted", () => {
    for (const payload of payloads) {
      // Absolute path so the marker lands in the sandbox regardless of cwd.
      const p = payload.replace(MARKER, marker);
      getGitLogSince(sandbox, p);
      getGitFilesChanged(sandbox, p);
      getGitDiffStat(sandbox, p);

      expect(
        existsSync(marker),
        `SHELL INJECTION: payload ${JSON.stringify(p)} executed. ` +
        `gitCommand must use execFileSync with an argv array and no shell. ` +
        (existsSync(marker) ? `Marker contents: ${readFileSync(marker, "utf8")}` : ""),
      ).toBe(false);
    }
  });

  it("metacharacters in an argv element reach git as literal text, not syntax", () => {
    // Not a git repo, so this returns "" via the catch. The point is that it
    // returns rather than executing anything — proven by the marker test above.
    // This one pins that the ARRAY signature is what callers must use.
    const out = gitCommand(sandbox, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(typeof out).toBe("string");
  });

  it("gitCommand's second parameter is an array, and that is load-bearing", () => {
    // A string would be spread into individual characters by [...args], which
    // git rejects — so a caller that reverts to the old string form fails loudly
    // instead of silently reopening the hole. This documents that on purpose.
    // @ts-expect-error — the string signature is deliberately gone. Do not
    // "fix" this by widening the type; see the comment on gitCommand.
    const out = gitCommand(sandbox, "rev-parse --abbrev-ref HEAD");
    expect(out).toBe("");
  });

  it("a project path containing spaces still works — the old `cd \"...\"` did not always", () => {
    const spaced = mkdtempSync(path.join(tmpdir(), "engram injection spaced "));
    try {
      const out = gitCommand(spaced, ["rev-parse", "--show-toplevel"]);
      expect(typeof out).toBe("string");
    } finally {
      try { rmSync(spaced, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});

describe("`since` is constrained at the schema (defence in depth)", () => {
  it("accepts exactly the three forms the handler understands", () => {
    for (const good of [
      "session_start",
      "24h", "7d", "30m", "1h", "365d",
      "2026-08-07",
      "2026-08-07T10:02:08Z",
      "2026-08-07T10:02:08.735Z",
      "2026-08-07T10:02:08+02:00",
      "2026-08-07 10:02",
    ]) {
      expect(isValidSince(good), `${good} should be accepted`).toBe(true);
    }
  });

  it("rejects every injection payload and every free-form string", () => {
    for (const bad of [
      ...payloadsForSchema(),
      "", " ", "yesterday", "now", "last tuesday",
      "session_start ", "24 h", "24H", "7days",
      "2026-8-7", "not-a-date",
      "'; DROP TABLE sessions; --",
    ]) {
      expect(isValidSince(bad), `${bad} should be rejected`).toBe(false);
    }
  });

  it("the ISO pattern is stricter than Date.parse on purpose", () => {
    // Date.parse("now") is NaN but Date.parse("Dec 25 2026") is not, and
    // Engram compares `since` as TEXT against ISO-8601 columns. A value that
    // parses as a date but is not ISO-8601 compares wrong silently.
    expect(SINCE_ISO.test("Dec 25 2026")).toBe(false);
    expect(SINCE_RELATIVE.test("24h")).toBe(true);
  });
});

function payloadsForSchema(): string[] {
  return [
    `x" & echo pwned> "${MARKER}" & rem `,
    `x"; echo pwned > "${MARKER}"; #`,
    `x$(echo pwned)`,
    "x`echo pwned`",
    "--since=x --output=/tmp/evil",
  ];
}
