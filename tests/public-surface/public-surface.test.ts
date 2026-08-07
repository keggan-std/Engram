// ============================================================================
// Public Surface — FR-D10's §5 binding
//
// Domain 10 owns "what a stranger sees": README, SECURITY.md, licence,
// contribution and advisory process, and what is public versus not.
//
// THE FINDING THIS BINDS. Nine domains built mechanisms against code. The
// public surface had none — PROVEN by absence. Every reference to a
// public-surface file anywhere in tests/, scripts/ or .github/workflows/ was:
//
//     tests/services/agent-rules.test.ts:60   a string literal of a URL
//     tests/tools/config-policy.test.ts:7     a comment
//     scripts/generate-state.mjs:312          a markdown link
//
// Zero assertions about content. Left ungated, it accumulated eight verified
// errors, of which one is not ordinary staleness: SECURITY.md as published on
// `main` states that the update check is the only outbound network call, while
// the version it describes — v1.12.0, current npm `latest`, public repo —
// also fetches agent rules from a GitHub README at session start and caches
// them to disk (audit N1, DEFERRED D3). The policy does not merely omit the
// vulnerability. It denies it, in the section a researcher reads to decide
// there is nothing to look for.
//
// This suite runs against the working tree, so it cannot fix `main` — task #84
// owns that. What it does is make the class of error fail loudly from here on.
//
// WHY REFERENTIAL INTEGRITY AND NOT COUNTS. FR-D9's suite rejected count
// assertions because "there are N of X" passes for a set that is complete and
// wrong, and fails on every legitimate addition. FR-D8 answered with ceilings.
// The analogous move for prose is to assert that a NAME IN A DOCUMENT RESOLVES
// TO A THING THAT EXISTS: every database path a doc names exists in src/, every
// package it tells you to install is published, every dependency shipped is
// attributed. These cannot fail on an improvement, and cannot sit green through
// the regression they exist to catch.
//
// TEST 1 EARNED ITS KEEP DURING ITS OWN WRITING. The review branch's
// SECURITY.md had already been corrected to drop the false agent-rules denial.
// It still said the only outbound calls "come from the update check
// (update.service.ts)" — and src/installer/index.ts:97 also calls fetch(). The
// corrected document was still wrong, by one file, and this test is what found
// it. That is the argument for binding prose at all.
//
// WHY NO NETWORK CALLS HERE. Test 3 asserts publication status against a
// committed list rather than querying the registry. A test that reaches the
// network is a test that fails on a plane, and a gate that fails for reasons
// unrelated to the defect is the mechanism by which knip stayed red from
// 307d2f2 through nine sessions without anyone acting on it.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const SECURITY = read("SECURITY.md");
const README = read("README.md");
const PKG = JSON.parse(read("package.json")) as {
  files: string[];
  license: string;
  dependencies: Record<string, string>;
  releaseNotes?: string;
};

/** Every .ts under src/, recursively. */
function srcFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...srcFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

// ─── 1. The security policy must name every outbound call ───────────────────

describe("FR-D10 §5 — SECURITY.md describes the network behaviour that exists", () => {
  it("every file in src/ that calls out to the network is named in SECURITY.md", () => {
    // THE central finding of this domain, generalised. `main`'s copy of this
    // file asserts a single outbound call while v1.12.0 makes an undisclosed
    // second one. Rather than assert the absence of one known lie, this binds
    // the pair: add a fetch anywhere in src/ and the security policy must say
    // so, in the same commit, or the suite goes red.
    const callers = srcFiles().filter((f) =>
      /\bfetch\s*\(|https?\.(get|request)\s*\(|\baxios\b/.test(read(f)),
    );

    // Sanity: if this ever reaches zero the detector has broken, not the code.
    expect(callers.length, "network-call detector found nothing — check the regex").toBeGreaterThan(0);

    const undisclosed = callers.filter((f) => !SECURITY.includes(f));
    expect(
      undisclosed,
      `SECURITY.md does not mention these files, and they make outbound network ` +
        `calls. A security policy that under-reports network access steers ` +
        `researchers away from exactly what they should look at — see ` +
        `docs/foundations/10-public-surface.md §2.1. Add them to the "Network ` +
        `Access" table, or remove the call.`,
    ).toEqual([]);
  });

  it("SECURITY.md does not claim there is no HTTP server while one ships", () => {
    // src/index.ts binds 127.0.0.1:7432 under --mode=dashboard, with token auth,
    // and express/cors/ws are runtime dependencies. The claim "no HTTP server"
    // was unhedged and false; "no port opened BY DEFAULT" is true and is what
    // the file should say. Guards the reassuring direction of error.
    const httpServerShips = /httpServer\.listen\s*\(/.test(read("src/index.ts"));
    if (!httpServerShips) return; // server genuinely removed — claim is free again
    expect(
      SECURITY,
      "src/index.ts still starts an HTTP server, so SECURITY.md must not deny one.",
    ).not.toMatch(/no HTTP server/i);
    expect(
      SECURITY,
      "SECURITY.md must not claim there is no authentication surface while " +
        "src/index.ts issues and validates a dashboard token.",
    ).not.toMatch(/no authentication surface/i);
  });
});

// ─── 2. Names in documents must resolve ─────────────────────────────────────

describe("FR-D10 §5 — every name in the public surface resolves to something real", () => {
  it("every ~/.engram database path named in the docs exists in src/", () => {
    // SECURITY.md named `~/.engram/memory.db` in two places. That path appears
    // nowhere in src/. The two real ones are ~/.engram/global.db (the KB,
    // src/global-db.ts:18) and ~/.engram/global/memory.db (the no-project-root
    // fallback, src/utils.ts:251) — different things, collapsed into a third
    // that does not exist. In a section headed "File System Access", whose
    // whole purpose is to tell a researcher what to audit.
    const sourceText = srcFiles().map(read).join("\n");
    const declared = new Set<string>();
    for (const doc of [SECURITY, README]) {
      for (const m of doc.matchAll(/~\/\.engram\/([\w./-]*\.db)\b/g)) declared.add(m[1]);
    }
    expect(declared.size, "no ~/.engram/*.db paths found in the docs — check the regex").toBeGreaterThan(0);

    const phantom = [...declared].filter((rel) => {
      // The source builds these with path.join, so match on the segments.
      const segs = rel.split("/");
      return !segs.every((s) => sourceText.includes(`"${s}"`));
    });
    expect(
      phantom,
      `A document names a database file that src/ never creates. Either the ` +
        `path is wrong or the code changed — fix whichever is stale.`,
    ).toEqual([]);
  });

  it("README does not advertise an npm package that has never been published", () => {
    // README documented `engram-universal-client` and `engram-thin-client` with
    // working config blocks; both return E404 on the registry and always have.
    // Same shape as incident #1 in project-state-tracking-design.md, where the
    // README advertised `lock_file` for versions after it was deleted — that
    // one pointed backwards, this one points forwards.
    const PUBLISHED = ["engram-mcp-server"];
    const KNOWN_UNPUBLISHED = ["engram-universal-client", "engram-thin-client"];
    // A third category, added by the senior review's S4. These are workspace
    // DIRECTORIES under packages/, not packages anyone can install — naming
    // one in the README is fine, but only alongside a statement that it does
    // not ship, which is asserted in (c) below. Without this distinction the
    // ratchet forces a choice between two wrong answers: claim it is published
    // or delete an accurate mention.
    const REPO_ONLY = ["engram-dashboard"];

    // (a) Every unpublished package that still appears must carry the warning.
    for (const p of KNOWN_UNPUBLISHED) {
      if (!README.includes(p)) continue;
      expect(
        README,
        `README mentions ${p}, which is not published. Keep the "never been ` +
          `published to npm" note next to it, or remove the mention.`,
      ).toMatch(/never been published to npm/);
    }

    // (b) The ratchet: no NEW engram-* package may appear unaccounted for.
    // The lookbehind matters: `\b` alone matches inside "how-engram-works",
    // because "-" is a non-word character. That produced a phantom package
    // named `engram-works` from the table-of-contents anchor on the first run.
    const named = new Set(
      [...README.matchAll(/(?<![\w-])engram-[a-z][a-z0-9-]*/g)].map((m) => m[0]),
    );
    const unaccounted = [...named].filter(
      (n) =>
        !PUBLISHED.includes(n) &&
        !KNOWN_UNPUBLISHED.includes(n) &&
        !REPO_ONLY.includes(n),
    );
    expect(
      unaccounted,
      `README names an engram-* package that is neither known-published, ` +
        `known-unpublished, nor known repo-only. If it is real, add it to ` +
        `PUBLISHED here; if it only exists under packages/, add it to ` +
        `REPO_ONLY; if it is aspirational, say so in the README.`,
    ).toEqual([]);

    // (c) A repo-only name may appear, but never without saying it does not
    // ship. This is the assertion that keeps S4 from recurring: the README
    // claimed for two releases that the dashboard "is included in the package"
    // while `npm pack` carried none of it.
    for (const p of REPO_ONLY) {
      if (!README.includes(p)) continue;
      expect(
        README,
        `README mentions ${p}, which lives under packages/ and is NOT in ` +
          `package.json's files[]. State plainly that it does not ship to ` +
          `npm, or the reader will reasonably assume installing Engram gets ` +
          `them it — which is exactly what happened through v1.13.0.`,
      ).toMatch(/does not ship to npm|not part of the npm package|repository-only/i);
    }
  });
});

// ─── 3. The licence must survive being read by a machine ────────────────────

describe("FR-D10 §5 — the licence says the same thing on every channel", () => {
  it("LICENSE is an unmodified MIT template, so GitHub still detects it", () => {
    // A `## Third-Party Dependencies` section appended below the MIT text made
    // GitHub's detector report NOASSERTION — no licence at all — through the
    // sidebar and the API, while package.json kept saying MIT. Notices moved to
    // THIRD-PARTY-NOTICES.md so both channels agree.
    const license = read("LICENSE");
    expect(license.trimStart()).toMatch(/^MIT License/);
    expect(license).toMatch(/Copyright \(c\) \d{4}/);
    expect(
      license,
      "Nothing may follow the MIT warranty clause in LICENSE — appended " +
        "sections break GitHub's licence detection (FR-D10 §2.5). Put it in " +
        "THIRD-PARTY-NOTICES.md instead.",
    ).not.toMatch(/^##\s/m);
  });

  it("package.json's license field matches the LICENSE file", () => {
    expect(PKG.license).toBe("MIT");
    expect(read("LICENSE")).toMatch(/^MIT License/);
  });

  it("every runtime dependency is attributed in THIRD-PARTY-NOTICES.md", () => {
    // MIT requires a redistributor to carry the copyright notice. The old table
    // listed three of seven; cors, express, open and ws were bundled with no
    // notice at all.
    const notices = read("THIRD-PARTY-NOTICES.md");
    const missing = Object.keys(PKG.dependencies).filter((d) => !notices.includes(d));
    expect(
      missing,
      `A runtime dependency ships with no attribution. MIT requires the ` +
        `copyright notice be included in redistributions — add a row to ` +
        `THIRD-PARTY-NOTICES.md.`,
    ).toEqual([]);
  });
});

// ─── 4. What is published must match what is documented ─────────────────────

describe("FR-D10 §5 — the tarball carries the policy it promises", () => {
  it("SECURITY.md ships in the npm package", () => {
    // files was ["dist/"], so SECURITY.md was a GitHub-only artifact. A user who
    // installs from npm and never visits the repo had no reporting channel at
    // all — while the GitHub copy, the only one that existed, was the one that
    // was wrong (§2.1). Compounding, not merely parallel, failures.
    expect(
      PKG.files,
      "SECURITY.md must be in package.json's files[] so it reaches users who " +
        "install from npm rather than reading the repository.",
    ).toContain("SECURITY.md");
    expect(existsSync(path.join(ROOT, "SECURITY.md"))).toBe(true);
  });

  it("package.json commits no releaseNotes value for prepack to overwrite", () => {
    // The committed value was a 3,194-char stale copy of RELEASE_NOTES.md;
    // prepack regenerates 4,966 chars at publish time and silently overwrites
    // it. The drift was real on a clean tree and structurally unobservable,
    // because the only moment it mattered was the moment it was overwritten.
    expect(
      PKG.releaseNotes,
      "Do not commit a releaseNotes value — scripts/inject-release-notes.js " +
        "generates it during prepack. A committed copy can only drift.",
    ).toBeUndefined();
  });

  // ── Senior review S4 — the README advertised a dashboard the tarball has ──
  //
  // README said "Engram **ships with** a built-in visual dashboard" and "the
  // dashboard **is included in the package**". PROVEN false by `npm pack
  // --dry-run --json`: 377 files, 1,668 KB, zero dashboard entries, because
  // `files` does not list `packages/`. The entire Dashboard section documented
  // a workflow available only from a git clone, and `http-server.ts` resolves
  // `../packages/engram-dashboard/dist` relative to `dist/`, so an installed
  // package silently serves an API-only stub instead.
  //
  // The fix is a claim assertion, which is what this whole domain exists for:
  // the README and package.json are no longer allowed to disagree about this,
  // in EITHER direction. Ship the dashboard and the README may say so; do not
  // ship it and the README must not.
  it("README's dashboard claim matches what package.json actually ships", () => {
    const readme = read("README.md");
    const shipsDashboard = (PKG.files as string[]).some((f) =>
      f.startsWith("packages/") || f === "packages",
    );

    const claimsItShips = [
      /ships with a built-in \*\*visual dashboard\*\*/i,
      /dashboard \*\*is included in the package\*\*/i,
      /dashboard is included in the package/i,
    ].filter((re) => re.test(readme));

    if (!shipsDashboard) {
      expect(
        claimsItShips,
        "package.json's files[] does not include packages/, so `npm pack` " +
          "carries no dashboard — but README claims it ships. Either add " +
          "packages/ to files[] or correct the README. This exact pair was " +
          "false through v1.13.0.",
      ).toEqual([]);
      expect(
        readme,
        "When the dashboard does not ship, the README must say so plainly " +
          "where a user will see it.",
      ).toMatch(/does not ship to npm|not part of the npm package|repository-only/i);
    }
  });

  // ── Senior review, install path — `npx` caches per exact spec string ──────
  //
  // PROVEN 2026-08-07, the day after v1.13.0 published:
  //     npx -y engram-mcp-server        --version -> v1.12.0  (cached in April)
  //     npx -y engram-mcp-server@latest --version -> v1.13.0
  // Both answered offline, so both are cache reads. A README telling users to
  // run the bare spec tells them to reinstall the version they first cached,
  // forever, while the installer reports success.
  it("every README install command pins @latest", () => {
    const readme = read("README.md");

    // Only lines inside a fenced code block are commands a user will COPY.
    // Prose may name the bare spec — the Upgrading section has to, in order to
    // explain the hazard — and flagging that would push the next author to
    // delete the explanation to get the build green.
    const bare: string[] = [];
    let fenced = false;
    readme.split("\n").forEach((line, i) => {
      if (/^\s*```/.test(line)) { fenced = !fenced; return; }
      if (!fenced) return;
      if (
        /\bnpx\s+(-y\s+)?engram-mcp-server(?!@)/.test(line) ||
        /\bnpm\s+install\s+-g\s+engram-mcp-server(?!@)/.test(line)
      ) {
        bare.push(`${i + 1}: ${line.trim()}`);
      }
    });

    expect(
      bare,
      "These README lines run an unpinned spec. npx will serve whatever it " +
        "cached for that exact string and never re-check the registry. Use " +
        "engram-mcp-server@latest.",
    ).toEqual([]);
  });

  it("the installer writes a PINNED spec into IDE configs", () => {
    // The config used to launch `npx -y engram-mcp-server`, so `_engram_version`
    // could read 1.13.0 beside args that started 1.12.0 — a version stamp that
    // does not describe the running process. Pinning is what makes it true.
    const writer = read("src/installer/config-writer.ts");
    expect(
      writer,
      "makeEngramEntry must pin the npm spec to the installer's own version. " +
        "A bare or @latest spec lets npx decide what runs, which makes " +
        "_engram_version a lie and bug reports irreproducible.",
    ).toMatch(/engram-mcp-server@\$\{getInstallerVersion\(\)\}/);
  });

  it("the declared Node floor matches what the dependencies actually require", () => {
    // engines said >=18.0.0 through v1.13.0 while better-sqlite3@12 declares
    // "20.x || 22.x || …" and open@11 declares ">=20" — so a user on Node 18
    // followed the support statement into EBADENGINE and a native build
    // failure in the dependency that IS the database. CI cannot catch it: the
    // matrix is 20.x and 22.x.
    const floor = (PKG.engines as { node: string }).node;
    const major = Number(/(\d+)/.exec(floor)?.[1]);
    expect(
      major,
      `engines.node is "${floor}". better-sqlite3 and open both require Node ` +
        `20 or newer, so anything below 20 advertises support this package ` +
        `cannot deliver.`,
    ).toBeGreaterThanOrEqual(20);

    const readme = read("README.md");
    expect(
      readme,
      "README must not advertise a Node floor below the one package.json " +
        "declares — that is the pair that sent users to a build failure.",
    ).not.toMatch(/Node\.js\s*\(?v?18\+?\)?\s*(and|is|or)/i);
  });

  it("the prepack script writes diagnostics to stderr, not stdout", () => {
    // inject-release-notes.js ran inside prepack and console.log'd a progress
    // line, so `npm pack --json` returned "✅ inject-release-notes: …" ahead of
    // its JSON and could not be parsed. It broke this domain's own tarball
    // measurement twice before being worked around.
    const script = read("scripts/inject-release-notes.js");
    expect(
      script,
      "prepack output lands in the middle of `npm pack --json` / " +
        "`npm publish --json`. Use console.error for progress messages.",
    ).not.toMatch(/console\.log\s*\(/);
  });
});
