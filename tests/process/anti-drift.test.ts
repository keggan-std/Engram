// ============================================================================
// Anti-drift — FR-D9's §5 binding
//
// Domain 9 owns the machinery that keeps the record true: the generated
// capability surfaces, STATE.md, the domain-doc bindings themselves, and the
// conventions the product claims to enforce.
//
// THE FINDING THIS BINDS. The machinery is real and it works — in exactly one
// direction. It gates *structural* drift between source and generated doc, and
// it is blind in two others:
//
//   (a) THE PROSE. `scripts/generate-capability-surface.mjs` never reads Zod
//       per-parameter `.describe()` text. PROVEN this session: a deliberately
//       false parameter description, compiled into the shipped schema, passes
//       `--check` at exit 0; adding one optional parameter fails it at exit 1.
//       That matters because FR-D7's 21.1% compliance defect WAS a description
//       — `record_change` advertises three parameters it ignores. The gate that
//       exists to keep the agent-facing contract honest cannot read the part of
//       the contract that lied.
//
//   (b) THE RECORD ITSELF. 51 rows in this project's own store carry transport
//       corruption; 31 lost a field outright. Nothing looked, for months.
//
// WHY THESE ASSERTIONS AND NOT OTHERS.
//
// The temptation is to assert the findings ("descriptions are unread", "51 rows
// are corrupt"). Both are properties of a moment, not of this repo: the second
// lives in `.engram/`, which is gitignored and which CI therefore cannot see at
// all. Asserting either would produce a test that is green on someone else's
// machine for the wrong reason.
//
// So this suite binds the one thing that is genuinely checkable in CI and that
// the whole charter rests on: **that a claimed mechanism exists.** Charter §7.5
// says "'Be careful' is not a binding" and kill switch 1 says a domain doc with
// no §5 mechanism does not ship. Until now nothing enforced either — they were
// rules, replayed, which is precisely the failure FR-D7 measured at 21.1%.
//
//   1. THE GENERATED-ARTIFACT REGISTRY. Every file carrying a `:GENERATED`
//      banner must be classified here as GATED — naming a CI step that is
//      resolved by reading `.github/workflows/ci.yml` — or explicitly UNGATED
//      against a task. Adding a fourth generated artifact fails this suite
//      until someone decides which it is. This is the assertion that caught
//      STATE.md: its own generator names a binding ("a local git hook plus this
//      check") that does not exist, because the hook
//      `engram_admin(install_hooks)` installs only appends to a text log.
//
//   2. DOMAIN-DOC BINDINGS RESOLVE. Every `tests/**.test.ts` path named in a
//      domain doc's §5 must exist AND be matched by vitest's `include` glob.
//      A doc may not cite a binding that cannot run. This makes kill switch 1
//      mechanical for domains 8 and 10, which are not yet written.
//
//   3. CONVENTION ENFORCEABILITY. `sessions.ts` ships every packaged PM
//      convention to every agent with a hardcoded `enforced: true`. Nothing in
//      the codebase enforces any of them. Each must be classified here.
//
// A count assertion ("there are 3 generated artifacts") was rejected for the
// same reason FR-D7 rejected it: it passes for a set that is complete and
// wrong, and fails on every legitimate addition, which is how a gate gets
// switched off within a week (charter §2). Every list here is DERIVED from the
// repository, never restated.
//
// PINNED DEFECTS. Per the D3/D4/D6/D7 precedent, assertions marked `DEFECT:`
// assert TODAY'S WRONG VALUE against a named task. They do not describe
// intended behaviour. The suite must never sit green over a known bug, so
// fixing the bug BREAKS the test and forces the assertion to be edited in the
// same commit a human reviews.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PM_CONVENTIONS } from "../../src/knowledge/conventions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

// ─── 1. Generated-artifact registry ─────────────────────────────────────────

type Gated = { status: "GATED"; ciStep: string };
type Ungated = { status: "UNGATED"; task: string; why: string };

/**
 * Every file carrying a `<!-- NAME:GENERATED -->` banner, classified.
 *
 * `ciStep` must appear verbatim in .github/workflows/ci.yml — so deleting the
 * CI step, or renaming the script it runs, fails this test rather than silently
 * un-gating a document that still claims to be generated.
 */
const GENERATED_ARTIFACTS: Record<string, Gated | Ungated> = {
  "docs/CAPABILITY-SURFACE.md": {
    status: "GATED",
    ciStep: "node scripts/generate-capability-surface.mjs --check",
  },
  "docs/HTTP-SURFACE.md": {
    status: "GATED",
    ciStep: "node scripts/generate-http-surface.mjs --check",
  },
  "docs/STATE.md": {
    status: "UNGATED",
    task: "#74",
    why:
      "Generated from .engram/memory.db, which .gitignore excludes — CI cannot " +
      "see the source, so no CI gate is possible even in principle. The " +
      "generator's own header names the binding as 'a local git hook " +
      "(engram_admin install_hooks) plus this check'. VERIFIED FALSE: that hook " +
      "(dispatcher-admin.ts install_hooks) only appends to .engram/git-changes.log " +
      "and nothing anywhere invokes generate-state.mjs. The binding is imaginary. " +
      "This is why STATE.md was stale for three consecutive handovers while every " +
      "agent followed the process correctly.",
  },
};

/**
 * Discover, never restate: any docs file with a `:GENERATED` banner.
 *
 * A banner is a banner because it STANDS ALONE ON A LINE. The first version of
 * this matched the marker anywhere in the file, and 09-process.md — which
 * *describes* the marker in prose and shows it in a shell example — tripped it
 * immediately. That is the orchestration guide's own warning arriving in
 * practice: beware greps that match the vocabulary of a problem rather than the
 * problem. Requiring a standalone HTML comment costs nothing (all three real
 * banners are written that way) and removes the false-positive class entirely.
 */
const BANNER = /^<!--\s*[A-Z0-9_]+:GENERATED\b.*-->$/;

function discoverGeneratedArtifacts(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) {
        if (read(rel).split(/\r?\n/).some((line) => BANNER.test(line.trim()))) found.push(rel);
      }
    }
  };
  walk("docs");
  return found.sort();
}

describe("FR-D9 §5 — generated artifacts are classified", () => {
  it("every :GENERATED file is in the registry", () => {
    const discovered = discoverGeneratedArtifacts();
    const registered = Object.keys(GENERATED_ARTIFACTS).sort();

    // The load-bearing assertion of this entire suite. A new generated document
    // cannot ship without someone deciding, in review, whether a mechanism
    // keeps it true — which is charter §7.5 made mechanical.
    expect(discovered).toEqual(registered);
  });

  it("every GATED artifact names a CI step that actually exists", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const [file, entry] of Object.entries(GENERATED_ARTIFACTS)) {
      if (entry.status !== "GATED") continue;
      expect(ci, `${file} claims a CI gate that is not in ci.yml`).toContain(entry.ciStep);
    }
  });

  it("every UNGATED artifact names a task", () => {
    for (const [file, entry] of Object.entries(GENERATED_ARTIFACTS)) {
      if (entry.status !== "UNGATED") continue;
      expect(entry.task, `${file} is ungated but names no task`).toMatch(/^#\d+$/);
      expect(entry.why.length, `${file} must say why`).toBeGreaterThan(80);
    }
  });

  it("DEFECT: STATE.md is ungated — task #74", () => {
    // Pinned wrong on purpose. When #74 ships a mechanism, this assertion
    // fails and must be edited in the same commit.
    expect(GENERATED_ARTIFACTS["docs/STATE.md"].status).toBe("UNGATED");
    expect(read(".github/workflows/ci.yml")).not.toContain("state:check");
    expect(read(".github/workflows/ci.yml")).not.toContain("generate-state.mjs");
  });
});

// ─── 2. Domain-doc bindings resolve ─────────────────────────────────────────

/** The `include` globs vitest actually runs, read from the config, not assumed. */
function vitestIncludes(): string[] {
  const cfg = read("vitest.config.ts");
  const block = /include:\s*\[([^\]]*)\]/.exec(cfg);
  if (!block) throw new Error("vitest.config.ts: could not find an `include` array");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Minimal glob → RegExp for the shapes vitest configs actually use. */
function globToRe(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, "(?:.*/)?");
  return new RegExp(`^${re}$`);
}

describe("FR-D9 §5 — every domain doc's binding can actually run", () => {
  const docs = readdirSync(path.join(ROOT, "docs/foundations"))
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .sort();

  it("there is at least one domain doc to check", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  for (const doc of docs) {
    it(`${doc} — every test path it names exists and is matched by vitest`, () => {
      const body = read(`docs/foundations/${doc}`);
      const cited = new Set(
        [...body.matchAll(/(tests\/[A-Za-z0-9._\-/]+\.test\.ts)/g)].map((m) => m[1]),
      );

      // A doc citing no test path is not automatically a failure — a domain may
      // bind a CI job or a schema constraint instead. Charter kill switch 1 is
      // about naming a mechanism, not specifically a test.
      const includes = vitestIncludes().map(globToRe);

      for (const rel of cited) {
        expect(existsSync(path.join(ROOT, rel)), `${doc} cites ${rel}, which does not exist`).toBe(
          true,
        );
        const matched = includes.some((re) => re.test(rel));
        expect(matched, `${doc} cites ${rel}, which no vitest include glob matches — it never runs`).toBe(
          true,
        );
      }
    });
  }
});

// ─── 3. Convention enforceability ───────────────────────────────────────────

/**
 * `src/tools/sessions.ts` maps every packaged PM convention to `enforced: true`
 * on its way to the agent. VERIFIED: every use of the `enforced` column
 * elsewhere is a `WHERE enforced = 1` retrieval filter, a sort key, or the
 * toggle that sets it. No code path rejects anything. So `enforced` selects
 * what is DISPLAYED, and the word is a claim the product does not keep.
 *
 * Each convention is classified here as UNENFORCED against a task, exactly as
 * FR-D7's rule registry does for AGENT_RULES. When one gains a mechanism, its
 * entry names the symbol and this suite resolves it in source.
 */
const CONVENTION_ENFORCEMENT: Record<string, { mechanism: string | null; task: string }> = {
  "pmconv-phase-gates": { mechanism: null, task: "#76" },
  "pmconv-traceability": { mechanism: null, task: "#76" },
  "pmconv-incremental-proof": { mechanism: null, task: "#76" },
  "pmconv-risk-first": { mechanism: null, task: "#76" },
  "pmconv-scope-control": { mechanism: null, task: "#76" },
};

describe("FR-D9 §5 — conventions shipped as `enforced` are classified", () => {
  it("every packaged PM convention is in the enforcement registry", () => {
    const shipped = PM_CONVENTIONS.map((c) => c.id).sort();
    expect(shipped).toEqual(Object.keys(CONVENTION_ENFORCEMENT).sort());
  });

  it("a named mechanism must resolve in source", () => {
    for (const [id, entry] of Object.entries(CONVENTION_ENFORCEMENT)) {
      if (!entry.mechanism) continue;
      const hit = ["src/tools", "src/services", "src/repositories"].some((dir) =>
        readdirSync(path.join(ROOT, dir)).some(
          (f) => f.endsWith(".ts") && read(`${dir}/${f}`).includes(entry.mechanism!),
        ),
      );
      expect(hit, `${id} names mechanism ${entry.mechanism}, which is not in source`).toBe(true);
    }
  });

  it("DEFECT: sessions.ts hardcodes `enforced: true` for all of them — task #76", () => {
    // Pinned wrong on purpose. The claim is false today: nothing enforces these.
    expect(read("src/tools/sessions.ts")).toContain("enforced: true");
    for (const entry of Object.values(CONVENTION_ENFORCEMENT)) {
      expect(entry.mechanism).toBeNull();
    }
  });
});

// ─── 4. The capability surface's blind spot ─────────────────────────────────

describe("FR-D9 §5 — the surface gate can read the part of the contract that lies", () => {
  // FIXED, task #75. Both assertions below were pinned to the DEFECT and are
  // inverted here, in the commit that shipped the fix.
  //
  // The gate caught structural drift exactly as designed — adding one optional
  // parameter failed it at exit 1 — and was COMPLETELY BLIND to semantic
  // drift: a deliberately false `.describe()` string, compiled into the
  // shipped schema, passed `--check` at exit 0.
  //
  // That mattered because FR-D7 traced AR-01's 21.1% compliance to
  // record_change advertising file_path, change_type and description while
  // ignoring all three — a defect that IS a description telling an agent
  // something false. The gate built to keep the agent-facing contract honest
  // could not read the half that lied, and would not have caught its return.
  //
  // Ceiling, stated: this makes a changed description a DIFF IN REVIEW. It
  // cannot make a description TRUE from inside the same source. Rejected — a
  // lint rule requiring every parameter to have one, which enforces presence
  // and not truth, and FR-D7's defect was a description that was present and
  // wrong. Task #77 is the other half.

  it("the generated surface carries per-parameter descriptions", () => {
    // Derived, not restated: take a description that demonstrably exists in
    // the schema source and assert the generated doc now carries it. Asserting
    // a hand-copied string would be a register kept by discipline — the thing
    // charter §2 rejects, and the thing this whole suite exists to replace.
    const src = read("src/tools/sessions.ts");
    const sample = /\.describe\("([^"]{25,80})"\)/.exec(src);
    expect(sample, "no sample .describe() found — schema shape changed").not.toBeNull();

    const surface = read("docs/CAPABILITY-SURFACE.md");
    expect(
      surface,
      `The surface no longer renders parameter descriptions. Task #75 shipped that ` +
      `column precisely so a changed description becomes a red line in review; ` +
      `dropping it restores the blind spot without restoring the pin that named it.`,
    ).toContain(sample![1]);
  });

  it("the surface has a Description column at all", () => {
    // The cheap structural half. A generator that emitted the column header
    // and then an em-dash for every row would satisfy the test above only by
    // accident of one description surviving; this fails loudly instead.
    const surface = read("docs/CAPABILITY-SURFACE.md");
    expect(surface).toContain("| Parameter | Type | Required | Constraints | Description |");
  });

  it("parameters WITHOUT a description are named, not silently blank", () => {
    // 73 of engram_memory's 78 parameters have no description. Rendering that
    // as 73 em-dashes hides it; naming the count puts it in front of a
    // reviewer. This is the finding the fix exposed, and it is why the
    // generator reports it rather than leaving the column half-empty.
    const surface = read("docs/CAPABILITY-SURFACE.md");
    expect(surface).toMatch(/> \*\*No description\*\* \(\d+ of \d+\):/);
  });
});
