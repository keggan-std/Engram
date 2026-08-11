// ============================================================================
// Engram MCP Server — Install Discovery
//
// WHERE IS ENGRAM, and WHERE WILL ITS MEMORY LAND. Both questions were answered
// implicitly by the installer and never shown to the user.
//
// Two things live here:
//
// 1. LOCAL-FIRST DISCOVERY. `resolveIdeInstallStatus` in index.ts checked every
//    GLOBAL config path first and only looked at the project when no global
//    config file existed at all — so a user standing in a project with a
//    project-local install was told about their home directory instead. This
//    module inverts that and adds the bounded walk upward that the old code did
//    not have: a config in the repo root is found from `src/`, which is where
//    people actually run commands.
//
// 2. THE INSTALL LEDGER. Nothing recorded that an install happened. Status was
//    re-derived every time by scanning the config paths of the 14 known IDEs,
//    which means an install to a custom directory — an option the installer
//    itself offers — was invisible the moment the command exited. The ledger at
//    ~/.engram/installs.json is the machine-wide record, and `--isolated` is the
//    opt-out for a user who does not want the install discoverable.
//
// The DB path rule is imported from constants and reproduced from
// database.ts:106-114 rather than guessed, because the installer showing a path
// the server does not use would be worse than showing nothing.
// ============================================================================

import fs from "fs";
import os from "os";
import path from "path";
import { DB_DIR_NAME, DB_FILE_NAME, INSTANCE_REGISTRY_DIR } from "../constants.js";
import { IDE_CONFIGS, type IdeDefinition } from "./ide-configs.js";
import { readJson, findEngramEntryKey, ConfigParseError } from "./config-writer.js";
import { resolveIdeGlobalPaths, resolveIdeLocalPaths } from "./ide-detector.js";

/** How many parent directories a local search climbs before giving up. */
export const DEFAULT_WALK_UP = 4;

// ─── Project root and database location ──────────────────────────────

export interface ProjectRootInfo {
    root: string;
    evidence: string;
    confidence: "high" | "medium" | "low";
}

/**
 * Markers in the order `findProjectRoot()` (src/utils.ts:157) trusts them.
 *
 * DELIBERATELY NOT THE SAME FUNCTION. `findProjectRoot` shells out to
 * `git rev-parse` and falls back to ~/.engram/global, both of which are correct
 * for a running server and wrong for an installer that must show the user a
 * path before anything is written. What matters is that the ANSWER agrees for
 * the cases users hit, and `.git` is first in both.
 */
const ROOT_MARKERS: Array<[string, string]> = [
    [".git", "git repository"],
    [".engram", "existing Engram database"],
    ["package.json", "package.json"],
    ["Cargo.toml", "Cargo.toml"],
    ["go.mod", "go.mod"],
    ["pyproject.toml", "pyproject.toml"],
    ["build.gradle", "Gradle project"],
    ["build.gradle.kts", "Gradle project"],
    ["pom.xml", "Maven project"],
];

export function detectProjectRoot(startDir: string): ProjectRootInfo {
    let dir = path.resolve(startDir);
    for (let i = 0; i < 10; i++) {
        for (const [marker, evidence] of ROOT_MARKERS) {
            if (fs.existsSync(path.join(dir, marker))) return { root: dir, evidence, confidence: "high" };
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return {
        root: path.resolve(startDir),
        evidence: "current directory — no project markers found",
        confidence: "low",
    };
}

/**
 * Where the server will actually open its database for this project.
 *
 * Mirrors database.ts:106-114. `ideKey` is passed only for global installs on
 * IDEs without a workspace variable, which open a per-IDE shard so two IDEs on
 * one project do not contend for the same write lock (F7).
 */
export function resolveDbPath(projectRoot: string, ideKey?: string): string {
    return path.join(projectRoot, DB_DIR_NAME, ideKey ? `memory-${ideKey}.db` : DB_FILE_NAME);
}

/** The tier-6 fallback in findProjectRoot(): one shared DB for everything. */
export function globalFallbackDbPath(): string {
    return path.join(os.homedir(), DB_DIR_NAME, "global", DB_FILE_NAME);
}

// ─── Discovery ───────────────────────────────────────────────────────

export interface DiscoveredInstall {
    ideKey: string;
    ideName: string;
    scope: "local" | "global";
    configPath: string;
    /** "?" when the entry predates version stamping. */
    version: string;
    mode: "universal" | "classic" | "unknown";
    /** Directories climbed from the search start. 0 = the directory searched. */
    distanceUp: number;
    /** Present for local installs: the project this config belongs to. */
    projectRoot?: string;
    dbPath?: string;
}

export interface DiscoveryProblem {
    configPath: string;
    ideName: string;
    reason: string;
}

export interface DiscoveryResult {
    installs: DiscoveredInstall[];
    /** Config files that exist but could not be parsed. Never silently dropped. */
    problems: DiscoveryProblem[];
    /** Every path looked at, so "not found" can be shown as a search, not a claim. */
    searched: string[];
}

function readEntry(configPath: string, ide: IdeDefinition): { version: string; mode: DiscoveredInstall["mode"] } | null | "unparseable" {
    if (!fs.existsSync(configPath)) return null;
    let config: Record<string, unknown>;
    try {
        config = readJson(configPath) as Record<string, unknown>;
    } catch (e) {
        if (e instanceof ConfigParseError) return "unparseable";
        throw e;
    }
    const serverMap = (config?.[ide.configKey] ?? {}) as Record<string, Record<string, unknown>>;
    const key = findEngramEntryKey(serverMap);
    if (!key) return null;
    const entry = serverMap[key] ?? {};
    const stampedMode = entry._engram_mode;
    // The stamp is only written for universal installs, so its absence is
    // ambiguous on old entries. Fall back to reading the args the IDE will
    // actually run — that is the ground truth either way.
    const args = Array.isArray(entry.args) ? (entry.args as unknown[]).map(String) : [];
    const mode: DiscoveredInstall["mode"] =
        stampedMode === "universal" || args.some(a => a.includes("--mode=universal"))
            ? "universal"
            : args.length ? "classic" : "unknown";
    return { version: String(entry._engram_version ?? "?"), mode };
}

/**
 * Search for project-local installs from `startDir` upward.
 *
 * Stops at `maxUp` parents OR at the detected project root, whichever comes
 * first — climbing past the repo root reaches other people's projects and, on a
 * shallow directory, the home directory. Bounded on purpose.
 */
export function discoverLocal(startDir: string, maxUp = DEFAULT_WALK_UP): DiscoveryResult {
    const installs: DiscoveredInstall[] = [];
    const problems: DiscoveryProblem[] = [];
    const searched: string[] = [];

    const start = path.resolve(startDir);
    const stopAt = detectProjectRoot(start).root;

    let dir = start;
    for (let up = 0; up <= maxUp; up++) {
        for (const [ideKey, ide] of Object.entries(IDE_CONFIGS)) {
            for (const configPath of resolveIdeLocalPaths(ide, dir)) {
                searched.push(configPath);
                const found = readEntry(configPath, ide);
                if (found === "unparseable") {
                    // "invalid JSON" verbatim: install-remove-e2e.test.ts greps
                    // for that exact phrase, and so may anything else reading
                    // this output. The wording is part of the contract.
                    problems.push({ configPath, ideName: ide.name, reason: "invalid JSON" });
                    continue;
                }
                if (!found) continue;
                installs.push({
                    ideKey, ideName: ide.name, scope: "local", configPath,
                    version: found.version, mode: found.mode, distanceUp: up,
                    projectRoot: dir, dbPath: resolveDbPath(dir),
                });
            }
        }
        // Reaching the project root is a reason to stop, not a reason to skip
        // it — the config usually IS at the root, so the check comes after.
        if (path.resolve(dir) === path.resolve(stopAt)) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return { installs, problems, searched };
}

/** Search every known IDE's user-level config. This is the machine-wide sweep. */
export function discoverGlobal(): DiscoveryResult {
    const installs: DiscoveredInstall[] = [];
    const problems: DiscoveryProblem[] = [];
    const searched: string[] = [];

    for (const [ideKey, ide] of Object.entries(IDE_CONFIGS)) {
        for (const configPath of resolveIdeGlobalPaths(ide)) {
            searched.push(configPath);
            const found = readEntry(configPath, ide);
            if (found === "unparseable") {
                problems.push({ configPath, ideName: ide.name, reason: "invalid JSON" });
                continue;
            }
            if (!found) continue;
            installs.push({
                ideKey, ideName: ide.name, scope: "global", configPath,
                version: found.version, mode: found.mode, distanceUp: 0,
            });
        }
    }

    return { installs, problems, searched };
}

// ─── The install ledger ──────────────────────────────────────────────

export interface LedgerEntry {
    configPath: string;
    ideKey: string;
    ideName: string;
    scope: "local" | "global";
    mode: "universal" | "classic";
    version: string;
    projectRoot?: string;
    dbPath?: string;
    installedAt: string;
}

export function ledgerPath(): string {
    return path.join(os.homedir(), INSTANCE_REGISTRY_DIR, "installs.json");
}

/**
 * Atomic write: temp file then rename.
 *
 * The same three lines exist at instance-registry.service.ts:59-65 and are
 * module-private there, which domain 5 handed to domain 8 as the fourth
 * instance of "the correct implementation living where the live path cannot
 * reach it". Duplicating it is the smaller wrong: exporting from a service
 * would make the installer — which must run with no database open — import the
 * database layer. The comment is the pointer that keeps the two in view.
 */
function atomicWriteJson(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
}

export function readLedger(): LedgerEntry[] {
    const p = ledgerPath();
    if (!fs.existsSync(p)) return [];
    try {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        return Array.isArray(raw?.installs) ? raw.installs as LedgerEntry[] : [];
    } catch {
        // A corrupt ledger must never block an install. It is a convenience
        // index over facts that live in the config files themselves, so the
        // worst case of ignoring it is a slower search.
        return [];
    }
}

/** Upsert by configPath. Returns false if the write failed — never throws. */
export function recordInstall(entry: LedgerEntry): boolean {
    try {
        const installs = readLedger().filter(e => path.resolve(e.configPath) !== path.resolve(entry.configPath));
        installs.push(entry);
        atomicWriteJson(ledgerPath(), { version: 1, installs });
        return true;
    } catch {
        return false;
    }
}

export function forgetInstall(configPath: string): boolean {
    try {
        const before = readLedger();
        const after = before.filter(e => path.resolve(e.configPath) !== path.resolve(configPath));
        if (after.length === before.length) return false;
        atomicWriteJson(ledgerPath(), { version: 1, installs: after });
        return true;
    } catch {
        return false;
    }
}

/**
 * Ledger entries whose config file no longer contains an Engram entry.
 *
 * The ledger records an intent; the config file is the fact. They diverge when
 * a user edits the config by hand or the host application rewrites it (D5 F11),
 * and reporting a stale ledger row as an install would be the register-kept-by-
 * discipline failure this project has already paid for twice.
 */
export function pruneLedger(): { kept: LedgerEntry[]; dropped: LedgerEntry[] } {
    const kept: LedgerEntry[] = [];
    const dropped: LedgerEntry[] = [];
    for (const e of readLedger()) {
        const ide = IDE_CONFIGS[e.ideKey];
        const stillThere = ide ? readEntry(e.configPath, ide) : null;
        if (stillThere && stillThere !== "unparseable") kept.push(e);
        else dropped.push(e);
    }
    return { kept, dropped };
}
