#!/usr/bin/env node
// ============================================================================
// Engram — Release Notes Injector
//
// Reads the latest version section from RELEASE_NOTES.md and injects it into
// package.json as the `releaseNotes` field before publishing.
// The npm registry then serves this field alongside the version metadata,
// allowing the update check service to fetch changelog in a single HTTP call.
//
// Usage (called automatically by the prepack script):
//   node scripts/inject-release-notes.js
//
// ─── IT MUST NOT LEAVE package.json MODIFIED ─────────────────────────────
//
// Senior review S5. This script wrote a ~5,000-char `releaseNotes` field into
// the working package.json and NOTHING PUT IT BACK, so `npm pack --dry-run` —
// a command whose name promises otherwise — left `M package.json` in the tree
// and turned the suite red against
// tests/public-surface/public-surface.test.ts, which asserts the field is
// undefined. It also cost a reviewer two full-suite runs misdiagnosed as a
// flaky durability test.
//
// The review attributed this to `--dry-run` skipping `postpack`. PROVEN
// otherwise on npm 11 with a probe package: postpack runs on BOTH
// `npm pack --dry-run` and `npm pack`. The actual cause was duller and worse —
// THERE WAS NO postpack SCRIPT. Nothing restored the file on any path.
//
// So: this writes a backup beside package.json, and scripts/restore-package-json.js
// runs as `postpack` and puts it back. Two extra safeguards, because a release
// script that corrupts the repository is not allowed a second chance:
//
//   1. If a backup is already present when this starts, a previous run died
//      between inject and restore. Restore from it FIRST, so the backup is
//      never taken from an already-injected file — that would make the
//      injected state permanent and undetectable.
//   2. `npm_config_dry_run` is set to "true" by npm on a dry run (verified on
//      npm 11). On a dry run the tarball is discarded, so there is nothing to
//      inject FOR; skip the mutation entirely and the working tree is provably
//      untouched rather than touched-and-restored.
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASE_NOTES_PATH = path.join(ROOT, "RELEASE_NOTES.md");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const BACKUP_PATH = path.join(ROOT, "package.json.prepack-backup");

// Safeguard 1 — recover from a prior run that died before restoring.
if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, PACKAGE_JSON_PATH);
    fs.rmSync(BACKUP_PATH);
    console.error("⚠️  inject-release-notes: found a leftover backup from an interrupted run and restored package.json before proceeding.");
}

// Safeguard 2 — a dry run produces no publishable artifact, so it gets no mutation.
if (process.env.npm_config_dry_run === "true") {
    console.error("ℹ️  inject-release-notes: dry run — package.json left untouched on purpose.");
    process.exit(0);
}

// ─── Read files ──────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
// Normalize CRLF → LF so the injected string is clean regardless of OS
const notes = fs.readFileSync(RELEASE_NOTES_PATH, "utf-8").replace(/\r\n/g, "\n");

// ─── Extract the latest version section ──────────────────────────────
// The file starts with the latest version heading (# vX.Y.Z — ...).
// We take everything up to the next top-level heading or the "## Fixes" block,
// so each publish only embeds the notes for that specific release.

const lines = notes.split("\n");
const sectionLines = [];
let inSection = false;

for (const line of lines) {
    // First top-level heading = the latest version section
    if (line.startsWith("# v") && !inSection) {
        inSection = true;
        sectionLines.push(line);
        continue;
    }

    // Stop at the next top-level version heading or a "---" section separator
    // that introduces historical patch notes (e.g. "## Fixes in v1.2.x")
    if (inSection) {
        if (line.startsWith("# v")) break; // Next version block
        sectionLines.push(line);
    }
}

const releaseNotes = sectionLines.join("\n").trim();

if (!releaseNotes) {
    console.error("❌ inject-release-notes: could not extract release notes from RELEASE_NOTES.md");
    process.exit(1);
}

// ─── Inject into package.json ─────────────────────────────────────────

// Back up the PRISTINE file before the first mutation. Safeguard 1 above
// guarantees we are not backing up an already-injected copy.
fs.copyFileSync(PACKAGE_JSON_PATH, BACKUP_PATH);

pkg.releaseNotes = releaseNotes;

fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

// stderr, not stdout: this script runs inside `prepack`, so anything it writes
// to stdout lands in the middle of `npm pack --json` / `npm publish --json`
// output and makes it unparseable (FR-D10 §2.7). Progress messages are
// diagnostics, and diagnostics go to stderr.
console.error(`✅ inject-release-notes: injected ${releaseNotes.length} chars into package.json (v${pkg.version})`);
