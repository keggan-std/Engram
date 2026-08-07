// ============================================================================
// Engram git post-commit hook — one contract, shared by both installers
//
// WHY THIS FILE EXISTS. Engram installs a post-commit hook from TWO places:
// the CLI (`engram install --install-hooks`) and the MCP action
// (`engram_admin(action:"install_hooks")`). They had drifted into writing
// different content with different marker strings, and PROVEN 2026-08-07:
// NEITHER REMOVER RECOGNISED THE OTHER'S HOOK. Each reported "the post-commit
// hook was not installed by Engram" about a hook Engram had installed.
//
// Worse, the CLI wrote its hook with an unconditional writeFileSync, so a
// pre-existing husky / lint-staged / deploy hook was destroyed with no backup —
// the same defect class as the installer config clobber (H1), on a path the
// user reaches deliberately. The MCP action already appended safely; the CLI
// was the odd one out.
//
// Recognition is deliberately UNION-shaped: a hook written by any historical
// version of either path must still be removable by the current one, or the
// fix strands the very users it is meant to protect.
// ============================================================================

/** The canonical marker. Written by every path from now on. */
export const ENGRAM_HOOK_MARKER = "Engram Post-Commit Hook";

/**
 * Markers written by earlier versions. Recognition only — never written.
 * Removing an entry here orphans hooks on real machines.
 */
const LEGACY_HOOK_MARKERS = [
    "engram-mcp-server record-commit",          // CLI, <= v1.13.0
    "Engram auto-recording hook",               // CLI, <= v1.13.0
] as const;

/** True if this post-commit hook contains a block Engram wrote, by any path,
 *  in any version. */
export function isEngramHook(content: string): boolean {
    if (content.includes(ENGRAM_HOOK_MARKER)) return true;
    return LEGACY_HOOK_MARKERS.some(m => content.includes(m));
}

/**
 * Remove Engram's block and leave everything else intact.
 *
 * Deleting the whole file is only safe when Engram wrote the whole file, which
 * is exactly what the caller must decide from the result — a co-resident hook
 * must survive. Returns the content with Engram's lines removed; the caller
 * deletes the file only if what remains is nothing but a shebang.
 */
export function stripEngramHookBlock(content: string): string {
    const isEngramLine = (line: string) =>
        line.includes(ENGRAM_HOOK_MARKER) ||
        LEGACY_HOOK_MARKERS.some(m => line.includes(m)) ||
        /^#\s*(Automatically records changed files|Remove with: engram)/.test(line.trim()) ||
        /^ENGRAM_DIR=/.test(line.trim()) ||
        /^CHANGE_LOG=/.test(line.trim());

    const kept = content.split(/\r?\n/).filter(line => !isEngramLine(line));

    // Collapse the blank runs left behind, without touching interior spacing
    // of whatever else lives in the file.
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
