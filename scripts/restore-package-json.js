#!/usr/bin/env node
// ============================================================================
// Engram — package.json restorer (postpack)
//
// The other half of scripts/inject-release-notes.js. That script injects a
// ~5,000-char `releaseNotes` field into package.json during `prepack` so the
// npm registry serves the changelog with the version metadata; this puts the
// file back the moment the tarball exists.
//
// WHY THIS FILE EXISTS. Senior review S5: `npm pack --dry-run` left
// `M package.json` in the working tree and turned the suite red, because the
// injector had no counterpart. The review blamed `--dry-run` for skipping
// `postpack`; PROVEN otherwise on npm 11 — postpack runs on both dry and real
// packs. There simply was no postpack script. This is it.
//
// Restoring from a byte-for-byte backup rather than deleting the key on purpose:
// a re-serialised JSON round-trip would silently reformat the file (key order
// is preserved by V8, but indentation, trailing newline and any comment-style
// "_key" ordering are not guaranteed across future edits). The invariant we
// want is "the working tree is exactly as it was", and only a copy gives that.
//
// Usage (called automatically by the postpack script):
//   node scripts/restore-package-json.js
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const BACKUP_PATH = path.join(ROOT, "package.json.prepack-backup");

// stderr, not stdout — this runs inside `postpack`, and stdout lands in the
// middle of `npm pack --json` / `npm publish --json` output. Same reason as
// the injector's own note (FR-D10 §2.7).
if (!fs.existsSync(BACKUP_PATH)) {
    // Not an error. A dry run skips the injection entirely, so there is
    // nothing to restore and nothing was harmed.
    console.error("ℹ️  restore-package-json: no backup present — package.json was never modified.");
    process.exit(0);
}

fs.copyFileSync(BACKUP_PATH, PACKAGE_JSON_PATH);
fs.rmSync(BACKUP_PATH);

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
if (pkg.releaseNotes !== undefined) {
    // Loud, because the whole point of this script is that this cannot happen.
    console.error("❌ restore-package-json: package.json still carries a releaseNotes field after restore. The backup was taken from an already-injected file. Fix before publishing.");
    process.exit(1);
}

console.error("✅ restore-package-json: package.json restored to its committed state.");
