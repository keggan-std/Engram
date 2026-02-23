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
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASE_NOTES_PATH = path.join(ROOT, "RELEASE_NOTES.md");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");

// ─── Read files ──────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
const notes = fs.readFileSync(RELEASE_NOTES_PATH, "utf-8");

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

pkg.releaseNotes = releaseNotes;

fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

console.log(`✅ inject-release-notes: injected ${releaseNotes.length} chars into package.json (v${pkg.version})`);
