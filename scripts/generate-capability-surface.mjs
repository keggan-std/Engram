#!/usr/bin/env node
// ============================================================================
// Capability surface generator  —  Engram task #9 / Foundations Review FR-0d
//
// Emits docs/CAPABILITY-SURFACE.md from the Zod schemas the dispatchers
// actually register: every tool, every action, every parameter, its type, its
// enum values, and its min/max bounds.
//
// WHY THIS EXISTS
// ---------------
// Ten features were silently dropped from this codebase without anyone
// noticing. One mechanism would have caught six of them. The v1.6 consolidation
// removed a config whitelist, seven z.enums and every numeric bound while
// copy-pasting logic between files, and nothing failed — because nothing was
// watching the shape of the surface.
//
// Generated, so it cannot rot. Committed, so a change to it is a diff. Checked
// in CI, so a change nobody wrote down blocks the merge. That is the survival
// criterion from docs/project-state-tracking-design.md §3, and this file is the
// binding most Foundations Review domain docs reuse.
//
//   node scripts/generate-capability-surface.mjs          # write the file
//   node scripts/generate-capability-surface.mjs --check   # exit 1 on drift
//
// Runs against dist/, so `npm run build` first.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "CAPABILITY-SURFACE.md");
const CHECK = process.argv.includes("--check");

// ─── Capture what the dispatchers register ───────────────────────────────────

/** Stands in for McpServer, keeping the schema instead of discarding it. */
class SchemaCapturer {
  constructor() { this.tools = []; }
  registerTool(name, config, _handler) {
    this.tools.push({ name, description: config?.description ?? "", schema: config?.inputSchema ?? {} });
  }
}

// ─── Zod introspection ───────────────────────────────────────────────────────

/** Peel ZodOptional / ZodDefault / ZodEffects until a concrete type remains. */
function unwrap(schema) {
  let s = schema;
  const flags = { optional: false, hasDefault: false, defaultValue: undefined, preprocessed: false };
  // Bounded: a pathological schema should not hang the build.
  for (let i = 0; i < 20 && s?._def; i++) {
    const t = s._def.typeName;
    if (t === "ZodOptional") { flags.optional = true; s = s._def.innerType; continue; }
    if (t === "ZodDefault") {
      flags.hasDefault = true;
      try { flags.defaultValue = s._def.defaultValue(); } catch { /* not statically knowable */ }
      s = s._def.innerType; continue;
    }
    if (t === "ZodEffects") { flags.preprocessed = true; s = s._def.schema; continue; }
    if (t === "ZodNullable") { s = s._def.innerType; continue; }
    break;
  }
  return { inner: s, flags };
}

/** Human-readable type plus the constraints that matter for drift detection. */
function describeType(schema) {
  const { inner, flags } = unwrap(schema);
  const def = inner?._def;
  const t = def?.typeName;
  let type = "unknown";
  let constraints = [];

  const readChecks = (checks) => {
    for (const c of checks ?? []) {
      if (c.kind === "min") constraints.push(`min ${c.value}`);
      else if (c.kind === "max") constraints.push(`max ${c.value}`);
      else if (c.kind === "int") constraints.push("int");
      else if (c.kind === "length") constraints.push(`length ${c.value}`);
      else if (c.kind === "regex") constraints.push("regex");
    }
  };

  switch (t) {
    case "ZodString": type = "string"; readChecks(def.checks); break;
    case "ZodNumber": type = "number"; readChecks(def.checks); break;
    case "ZodBoolean": type = "boolean"; break;
    case "ZodEnum": type = "enum"; constraints.push(`values: ${def.values.join(", ")}`); break;
    case "ZodNativeEnum": type = "enum"; break;
    case "ZodArray": {
      const el = unwrap(def.type);
      const elT = el.inner?._def?.typeName ?? "";
      type = `array<${elT.replace(/^Zod/, "").toLowerCase() || "any"}>`;
      if (el.inner?._def?.typeName === "ZodEnum") constraints.push(`values: ${el.inner._def.values.join(", ")}`);
      readChecks(def.exactLength ? [] : []);
      if (def.minLength) constraints.push(`min items ${def.minLength.value}`);
      if (def.maxLength) constraints.push(`max items ${def.maxLength.value}`);
      break;
    }
    case "ZodObject": type = "object"; break;
    case "ZodUnion": type = "union"; break;
    case "ZodAny": type = "any"; break;
    case "ZodUnknown": type = "unknown"; break;
    default: type = String(t ?? "unknown").replace(/^Zod/, "").toLowerCase();
  }

  if (flags.preprocessed) constraints.push("coerced");
  if (flags.hasDefault) constraints.push(`default ${JSON.stringify(flags.defaultValue)}`);

  return { type, required: !flags.optional && !flags.hasDefault, constraints };
}

/** Pull the action list out of a tool's `action` parameter, if it has one. */
function extractActions(schema) {
  const a = schema?.action;
  if (!a) return [];
  const { inner } = unwrap(a);
  return inner?._def?.typeName === "ZodEnum" ? [...inner._def.values] : [];
}

// ─── Build ───────────────────────────────────────────────────────────────────

async function build() {
  const distTools = path.join(root, "dist", "tools");
  if (!existsSync(distTools)) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(2);
  }

  const capturer = new SchemaCapturer();
  const mods = [
    ["sessions.js", "registerSessionDispatcher"],
    ["dispatcher-memory.js", "registerMemoryDispatcher"],
    ["dispatcher-admin.js", "registerAdminDispatcher"],
    ["find.js", "registerFindTool"],
  ];
  for (const [file, fn] of mods) {
    const mod = await import(pathToFileURL(path.join(distTools, file)).href);
    if (typeof mod[fn] !== "function") {
      console.error(`${file} does not export ${fn} — the tool registration surface changed.`);
      process.exit(2);
    }
    mod[fn](capturer);
  }

  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  const lines = [];
  lines.push("# Engram Capability Surface");
  lines.push("");
  lines.push("<!-- GENERATED FILE — DO NOT EDIT BY HAND -->");
  lines.push("");
  lines.push("**Generated by** `scripts/generate-capability-surface.mjs` from the Zod schemas the");
  lines.push("dispatchers register. **Do not edit.** Regenerate with:");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build && node scripts/generate-capability-surface.mjs");
  lines.push("```");
  lines.push("");
  lines.push("This file exists so that **removing an action, dropping an enum, or loosening a");
  lines.push("bound shows up as a red line in code review.** The v1.6 consolidation silently");
  lines.push("removed a config whitelist, seven enums and every numeric bound, and nothing");
  lines.push("caught it. CI regenerates this file and fails if the result differs from what is");
  lines.push("committed — so a surface change nobody wrote down blocks the merge.");
  lines.push("");
  lines.push("Deliberately **excludes the package version**, so a version bump alone never");
  lines.push("produces a diff. The surface is the contract; the version is not part of it.");
  lines.push("");

  // Summary
  const totalActions = capturer.tools.reduce((n, t) => n + extractActions(t.schema).length, 0);
  lines.push("## Summary");
  lines.push("");
  lines.push("| Tool | Actions | Parameters |");
  lines.push("|---|---|---|");
  for (const t of capturer.tools) {
    lines.push(`| \`${t.name}\` | ${extractActions(t.schema).length} | ${Object.keys(t.schema).length} |`);
  }
  lines.push(`| **total** | **${totalActions}** | **${capturer.tools.reduce((n, t) => n + Object.keys(t.schema).length, 0)}** |`);
  lines.push("");

  for (const tool of capturer.tools.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`## \`${tool.name}\``);
    lines.push("");

    const actions = extractActions(tool.schema);
    if (actions.length) {
      lines.push(`**Actions (${actions.length}):**`);
      lines.push("");
      lines.push(actions.map((a) => `\`${a}\``).join(" · "));
      lines.push("");
    }

    lines.push("| Parameter | Type | Required | Constraints |");
    lines.push("|---|---|---|---|");
    // Pipes inside a cell would break the table; escape rather than drop them.
    const cell = (s) => String(s).replace(/\|/g, "\\|");
    for (const key of Object.keys(tool.schema).sort()) {
      const { type, required, constraints } = describeType(tool.schema[key]);
      const c = constraints.length ? cell(constraints.join("; ")) : "—";
      lines.push(`| \`${key}\` | ${cell(type)} | ${required ? "**yes**" : "no"} | ${c} |`);
    }
    lines.push("");

    // The thing this file is really for: params that accept anything.
    const unbounded = Object.keys(tool.schema).filter((k) => {
      const { type, constraints } = describeType(tool.schema[k]);
      const isBoundable = type === "string" || type === "number";
      return isBoundable && !constraints.some((c) => c.startsWith("min") || c.startsWith("max"));
    });
    if (unbounded.length) {
      lines.push(`> **Unbounded** (no min/max, accepts any value of its type): ${unbounded.map((u) => `\`${u}\``).join(", ")}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`<!-- CAPABILITY_SURFACE:GENERATED schema_of=${pkg.name} -->`);
  lines.push("");
  return lines.join("\n");
}

const generated = await build();

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`MISSING: ${path.relative(root, OUT)} has never been generated.`);
    console.error("Run: node scripts/generate-capability-surface.mjs");
    process.exit(1);
  }
  const committed = readFileSync(OUT, "utf8");
  const norm = (s) => s.replace(/\r\n/g, "\n").trimEnd();
  if (norm(committed) !== norm(generated)) {
    console.error("CAPABILITY SURFACE DRIFT");
    console.error("");
    console.error("The tool surface changed but docs/CAPABILITY-SURFACE.md was not regenerated.");
    console.error("An action, a parameter, an enum or a bound is different from what is committed.");
    console.error("");
    console.error("  npm run build && node scripts/generate-capability-surface.mjs");
    console.error("");
    console.error("Then review the diff. If it is unintended, that is the bug this check exists");
    console.error("to catch. If it is intended, commit it — the diff IS the changelog entry.");
    process.exit(1);
  }
  console.log("Capability surface matches the committed file.");
} else {
  writeFileSync(OUT, generated);
  console.log(`Wrote ${path.relative(root, OUT)}`);
}
