// ============================================================================
// Git hook safety — Engram must never destroy a hook it did not write
//
// FOUND 2026-08-07 by the installer audit, VERIFIED at source, and this suite
// is the binding.
//
// THE DEFECT. `engram install --install-hooks` did:
//     fs.writeFileSync(hookPath, hookScript, ...)
// unconditionally, after checking only that .git/hooks EXISTS. A user with a
// husky, lint-staged or deploy post-commit hook lost it — no backup, no
// warning, no undo. That is the installer config clobber (hazard H1) a second
// time, on a path the user reaches on purpose.
//
// It sat TWELVE LINES above `--remove-hooks`, which already refused to delete a
// hook it did not recognise. Engram would not delete a stranger's hook, but
// would overwrite one.
//
// THE SECOND DEFECT, PROVEN by execution before the fix: Engram installs hooks
// from two places — the CLI and engram_admin(install_hooks) — and they wrote
// DIFFERENT marker strings. Each remover recognised only its own:
//
//   CLI remover     looked for "engram-mcp-server"     -> missed MCP's hook
//   MCP remover     looked for "Engram Post-Commit Hook" -> missed the CLI's hook
//
// So each reported "the post-commit hook was not installed by Engram" about a
// hook Engram installed, and neither could remove it.
//
// src/git-hook.ts is now the single contract. These tests pin BOTH halves:
// never clobber, and always recognise our own work — including hooks written by
// versions that predate the fix, which still exist on real machines.
// ============================================================================

import { describe, it, expect } from "vitest";
import { ENGRAM_HOOK_MARKER, isEngramHook, stripEngramHookBlock } from "../../src/git-hook.js";

// Verbatim content as each historical path actually wrote it. Composed examples
// are what observation #125 warns against — a gate tampered with text the author
// invented proves only that it catches what the author had in mind.
const CLI_HOOK_PRE_FIX = [
    "#!/bin/bash",
    "# Engram auto-recording hook — installed by engram install --install-hooks",
    "# Automatically records changed files to Engram memory after each commit.",
    "npx -y engram-mcp-server record-commit 2>/dev/null || true",
    "",
].join("\n");

const MCP_HOOK = `#!/bin/bash\n# Engram Post-Commit Hook\nENGRAM_DIR=".engram"\nCHANGE_LOG="$ENGRAM_DIR/git-changes.log"\nmkdir -p "$ENGRAM_DIR"\n`;

const FOREIGN_HOOK = [
    "#!/bin/sh",
    "# husky",
    '. "$(dirname -- "$0")/_/husky.sh"',
    "npx lint-staged",
    "",
].join("\n");

describe("Engram recognises its own hook, whoever installed it", () => {
    it("recognises a hook written by the CLI before the fix", () => {
        expect(isEngramHook(CLI_HOOK_PRE_FIX)).toBe(true);
    });

    it("recognises a hook written by engram_admin(install_hooks)", () => {
        expect(isEngramHook(MCP_HOOK)).toBe(true);
    });

    it("recognises the current canonical marker", () => {
        expect(isEngramHook(`#!/bin/bash\n# ${ENGRAM_HOOK_MARKER}\n`)).toBe(true);
    });

    // The regression that started this. Before src/git-hook.ts, each remover saw
    // only its own marker, so one of these two was always false.
    it("recognises BOTH historical hooks with the SAME predicate", () => {
        expect([isEngramHook(CLI_HOOK_PRE_FIX), isEngramHook(MCP_HOOK)]).toEqual([true, true]);
    });

    it("does NOT claim a hook Engram never wrote", () => {
        expect(isEngramHook(FOREIGN_HOOK)).toBe(false);
    });
});

describe("removal takes Engram's lines and nothing else", () => {
    it("leaves a co-resident husky hook completely intact", () => {
        const combined = FOREIGN_HOOK + "\n" + CLI_HOOK_PRE_FIX;
        const cleaned = stripEngramHookBlock(combined);

        // Every non-Engram line must survive, byte for byte.
        for (const line of FOREIGN_HOOK.split("\n").filter(l => l.trim())) {
            expect(cleaned, `removal destroyed a line it did not own: ${line}`).toContain(line);
        }
        expect(isEngramHook(cleaned), "Engram's own block survived removal").toBe(false);
    });

    it("reduces an Engram-only hook to nothing but its shebang", () => {
        const cleaned = stripEngramHookBlock(CLI_HOOK_PRE_FIX);
        expect(cleaned.replace(/^#!.*$/m, "").trim()).toBe("");
    });

    it("removes the MCP-written block too, using the same function", () => {
        const cleaned = stripEngramHookBlock(FOREIGN_HOOK + "\n" + MCP_HOOK);
        expect(isEngramHook(cleaned)).toBe(false);
        expect(cleaned).toContain("npx lint-staged");
    });

    it("is a no-op on a hook Engram does not own", () => {
        // Idempotence in the direction that matters: running removal against a
        // stranger's hook must change nothing at all.
        expect(stripEngramHookBlock(FOREIGN_HOOK).trim()).toBe(FOREIGN_HOOK.trim());
    });
});

describe("the installer source itself", () => {
    it("no longer writes a post-commit hook unconditionally", async () => {
        // Source-level assertion on purpose: the CLI branch calls process.exit()
        // and cannot be invoked in-process. What is pinned is the ABSENCE of the
        // unguarded write — an existsSync check must precede any writeFileSync
        // to the hook path.
        const { readFileSync } = await import("node:fs");
        const src = readFileSync(new URL("../../src/installer/index.ts", import.meta.url), "utf-8");
        const installBlock = src.slice(
            src.indexOf('args.includes("--install-hooks")'),
            src.indexOf('args.includes("--remove-hooks")')
        );
        expect(installBlock.length, "could not locate the --install-hooks block").toBeGreaterThan(200);
        expect(installBlock, "--install-hooks writes without checking for an existing hook")
            .toMatch(/fs\.existsSync\(hookPath\)/);
        expect(installBlock, "--install-hooks must append, not overwrite, a foreign hook")
            .toMatch(/appendFileSync/);
    });

    it("both install paths write the same canonical marker", async () => {
        const { readFileSync } = await import("node:fs");
        const cli = readFileSync(new URL("../../src/installer/index.ts", import.meta.url), "utf-8");
        const mcp = readFileSync(new URL("../../src/tools/dispatcher-admin.ts", import.meta.url), "utf-8");
        // Neither may hardcode a marker string of its own again.
        expect(cli).toContain("ENGRAM_HOOK_MARKER");
        expect(mcp).toContain("ENGRAM_HOOK_MARKER");
    });
});
