// ============================================================================
// Engram MCP Server — Config File Manipulation
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { IdeDefinition } from "./ide-configs.js";

/**
 * FLAW-15 FIX: Read version from package.json relative to the dist output,
 * but fall back to the SERVER_VERSION constant as the single source of truth.
 * This is resilient to build output structure changes.
 */
export function getInstallerVersion(): string {
    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        // Try dist/installer/ → ../../package.json (standard build layout)
        for (const rel of ["../../package.json", "../../../package.json", "../../../../package.json"]) {
            const pkgPath = path.resolve(__dirname, rel);
            if (fs.existsSync(pkgPath)) {
                const ver = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string | undefined;
                if (ver) return ver;
            }
        }
        return "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Generate the Engram server entry tailored to a specific IDE's requirements.
 * Includes _engram_version so the installer can detect upgrades and legacy installs.
 *
 * FLAW-4 FIX: When the IDE definition has a workspaceVar, it is injected as
 * `--project-root=<var>`. At runtime the IDE expands the variable to the actual
 * workspace path before spawning the server, so findProjectRoot() receives the
 * correct root with no heuristics needed.
 *
 * ideKey: when provided (global-only IDEs without workspaceVar), `--ide=<key>` is
 * injected so the server opens a per-IDE DB shard (memory-{key}.db), eliminating
 * write-lock contention between different IDEs concurrently open on the same project.
 *
 * @param ide        IDE definition (controls type, cmd wrapper, workspaceVar, etc.)
 * @param universal  When true, adds --mode=universal to args.
 * @param ideKey     When provided, adds --ide=<ideKey> to args.
 */
export function makeEngramEntry(ide: IdeDefinition, universal = false, ideKey?: string, projectRoot?: string): Record<string, any> {
    const entry: Record<string, any> = {};

    // Some IDEs require explicit "type": "stdio"
    if (ide.requiresType) {
        entry.type = "stdio";
    }

    // Build args.
    //
    // THE SPEC IS PINNED, and that is the fix for a defect PROVEN on 2026-08-07.
    //
    // This used to be the bare `["-y", "engram-mcp-server"]`. npx caches per
    // EXACT SPEC STRING, so the bare form resolves to whatever it first cached
    // for that string and never re-checks the registry. Measured on the author's
    // own machine the day after v1.13.0 shipped:
    //
    //   npx -y engram-mcp-server         --version  ->  v1.12.0   (cached 03/04)
    //   npx -y engram-mcp-server@latest  --version  ->  v1.13.0
    //
    // Both answered with the network disabled, so both are cache reads — the
    // bare spec is not "stale until it refreshes", it is pinned to an April
    // snapshot indefinitely.
    //
    // The consequence was the worst kind: `_engram_version` was stamped 1.13.0
    // into the config beside args that launched 1.12.0. The installer reported
    // "upgraded" truthfully about the config and falsely about the software,
    // and every status surface Engram has agreed with it. A version stamp that
    // does not describe the running process is worse than no stamp.
    //
    // Pinning makes the stamp true: what was installed is what runs.
    //
    // REJECTED — "@latest" in the entry. It loses on three counts. It is still
    // a cache read (proven above), so it does not actually guarantee freshness;
    // it lets the running version change with no config change, which destroys
    // both `_engram_version`'s meaning and any hope of a reproducible bug
    // report; and it puts a registry round-trip in the spawn path of a server
    // the IDE starts on every session.
    //
    // THE LIMIT, stated plainly: pinning means Engram does NOT self-upgrade.
    // A user moves to a new version by re-running the installer, which is why
    // `--check` compares the stamp against the registry and why README's
    // install commands all say `@latest` — that is what makes the INSTALLER
    // itself current. It also means a machine that has never fetched the pinned
    // version needs one online run before the server will start.
    const baseArgs = ["-y", `engram-mcp-server@${getInstallerVersion()}`];
    if (universal) {
        baseArgs.push("--mode=universal");
    }
    // FLAW-4 FIX: inject workspace root variable when the IDE supports it.
    // The IDE expands this variable at spawn time (e.g. ${workspaceFolder} →
    // /path/to/project) so the server always receives the correct project path.
    if (ide.workspaceVar) {
        baseArgs.push(`--project-root=${ide.workspaceVar}`);
    } else if (projectRoot) {
        // NO WORKSPACE VARIABLE, so the IDE cannot tell the server where it is.
        // Seven of the fourteen IDEs are in this position (Windsurf, Antigravity,
        // Claude Desktop, Cline, Roo Code, Gemini CLI, JetBrains), and until now
        // the server had to GUESS: findProjectRoot() (src/utils.ts:157) infers
        // from whatever cwd the IDE happened to spawn it in, and when every
        // marker fails it lands on ~/.engram/global — one database shared by
        // every project, which sessions.ts:227 already warns about in those
        // words. Inference was the whole strategy and the user was never shown
        // the answer.
        //
        // A literal absolute path is only correct because the caller only passes
        // one for a PROJECT-LOCAL install, whose config file already belongs to
        // exactly one project. Passing it on a global install would pin every
        // project to whichever one happened to be open at install time, so
        // performInstallationForIde passes undefined there and the runtime
        // inference stays — correctly, because that entry really is shared.
        baseArgs.push(`--project-root=${projectRoot}`);
    }

  // Per-IDE DB shard: global installs on IDEs without workspaceVar inject --ide=<key>
  // so each IDE type opens memory-{key}.db, preventing write-lock contention between
  // different IDEs open on the same project simultaneously.
  if (ideKey) {
    baseArgs.push(`--ide=${ideKey}`);
  }

    // Windows cmd /c wrapper for npx (npx is a .cmd on Windows)
    if (ide.requiresCmdWrapper) {
        entry.command = "cmd";
        entry.args = ["/c", "npx", ...baseArgs];
    } else {
        entry.command = "npx";
        entry.args = [...baseArgs];
    }

    // Env injection: only for IDEs that are confirmed to expand workspace-aware
    // variables in env values. The resolved value is picked up by the server's
    // Tier-2 (ENGRAM_PROJECT_ROOT env var) detection. This is intentionally
    // never set for Gemini CLI or Windsurf — those IDEs only expand real OS env
    // vars ($VAR syntax), not IDE-specific workspace placeholders.
    if (ide.envVar && !ide.workspaceVar) {
        entry.env = { ENGRAM_PROJECT_ROOT: ide.envVar };
    }

    // Version stamp — used by the installer to detect upgrades and legacy installs
    entry._engram_version = getInstallerVersion();
    if (universal) {
        entry._engram_mode = "universal";
    }

    // IDE-specific extra fields (e.g. Android Studio requires "enabled": true)
    if (ide.extraEntryFields) {
        Object.assign(entry, ide.extraEntryFields);
    }

    return entry;
}

/**
 * Read and parse a JSON config file.
 * FLAW-8 FIX: distinguish between "file not found" and "file has invalid JSON".
 * Returns:
 *   null    — file does not exist (safe to create fresh)
 *   object  — parsed successfully
 * Throws ParseError (with .isParseError = true) when the file exists but
 *   contains invalid JSON — callers should warn and bail rather than
 *   silently overwriting the user's config.
 */
export class ConfigParseError extends Error {
    constructor(public readonly filePath: string, public readonly cause: unknown) {
        super(`Failed to parse JSON config at ${filePath}: ${cause}`);
        this.name = "ConfigParseError";
    }
}

export function readJson(filePath: string): Record<string, any> | null {
    if (!fs.existsSync(filePath)) return null; // file not found — safe to create
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
        // File exists but is invalid JSON — signal this distinctly
        throw new ConfigParseError(filePath, e);
    }
}

/**
 * Write a JSON config file, creating parent directories if needed.
 */
export function writeJson(filePath: string, data: any): void {
    // FR-D5 T2: atomic. These targets are files OTHER products own — ~/.claude.json
    // is Claude Code's entire user state (53 top-level keys, of which mcpServers is
    // one). A crash or full disk between open and close used to truncate it.
    // Mirrors atomicWriteJson in services/instance-registry.service.ts, which had
    // the right shape all along and was module-private, so the installer could not
    // call it. See docs/foundations/05-distribution.md F2.
    //
    // SENIOR REVIEW S11 — atomic-replace SILENTLY WIDENS PERMISSIONS.
    //
    // temp-file-plus-rename does not inherit the target's mode: the temp file
    // is created fresh under the process umask (typically 0644) and then
    // REPLACES the original inode. A config the user had deliberately chmod'd
    // to 0600 comes back world-readable, with no error and nothing in the
    // output to notice.
    //
    // That matters because of WHAT these targets are. ~/.claude.json is not
    // Engram's file — it is another product's entire user state, 53 top-level
    // keys including oauthAccount, userID and machineID, of which mcpServers is
    // one. Downgrading it to 0644 on a shared or multi-user machine exposes
    // another vendor's credentials as a side effect of installing Engram.
    //
    // The review could only grade this VERIFIED, not PROVEN, because it was
    // read on Windows where modes are a no-op — which is exactly the platform
    // blind spot task #101 raised, and exactly why CI now runs ubuntu and macos.
    //
    // Preserve the mode when there is one to preserve. chmod before rename, so
    // the file is never visible at the wrong mode even briefly.
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let existingMode: number | undefined;
    try {
        existingMode = fs.statSync(filePath).mode & 0o777;
    } catch {
        // No existing file — a fresh write, so there is no prior mode to keep
        // and the umask default is the correct answer.
    }

    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    if (existingMode !== undefined) {
        // No-op on Windows, which is why this cannot be proven there.
        try { fs.chmodSync(tmpPath, existingMode); } catch { /* best effort — never block the install */ }
    }
    fs.renameSync(tmpPath, filePath);
}

export type InstallResult = "added" | "upgraded" | "exists" | "legacy-upgraded" | "repaired" | "adopted";

/**
 * Find the key under which an Engram server entry lives in an MCP server map,
 * whatever it is called.
 *
 * OBSERVATION #127. This predicate existed three times, hand-copied, in
 * index.ts at the status, list and check sites — and `addToConfig` did not use
 * it at all, testing only `config[key].engram`. The two disagreed, so a config
 * holding a differently-named entry (`engram-memory`, `memory`, anything the
 * user typed) reported "installed" from status and then got a SECOND entry from
 * install. Two entries mean two servers launched against one database, which is
 * the exact write-lock contention the `--ide=` shard flag exists to prevent, and
 * `--remove` deleted only the one called `engram` and left the other live.
 *
 * Third recurrence of the shape FR-D5 found in the installer's filename rule and
 * #127 found again here: a rule copied to N sites with nothing that can find
 * site N+1. One definition, every caller derives from it.
 */
export function findEngramEntryKey(
    serverMap: Record<string, Record<string, unknown>> | undefined | null,
): string | undefined {
    if (!serverMap) return undefined;
    // Exact key wins, so a canonical entry is never passed over for a
    // coincidental match elsewhere in the map.
    if (serverMap.engram) return "engram";
    return Object.keys(serverMap).find(k => {
        const en = serverMap[k];
        return String(en?.command ?? "").includes("engram")
            || (Array.isArray(en?.args) && (en.args as string[]).some(a => String(a).includes("engram")));
    });
}

/**
 * Compare an installed entry against the one this version would write.
 *
 * OBSERVATION #127. `addToConfig` decided "already installed" on the
 * `_engram_version` stamp alone and compared neither command nor args, so an
 * entry that was corrupt but carried the current version made a reinstall a
 * no-op that reported success. Running the installer again is the first thing
 * anyone does when a server will not start; it was the one action guaranteed
 * not to help.
 *
 * Only fields Engram writes are compared. Anything a user added by hand is
 * ignored here and preserved by the caller.
 */
function entryMatches(existing: Record<string, unknown>, expected: Record<string, unknown>): boolean {
    const fields = new Set([...Object.keys(expected), "command", "args", "env"]);
    for (const f of fields) {
        if (JSON.stringify(existing?.[f]) !== JSON.stringify(expected[f])) return false;
    }
    return true;
}

/**
 * Add or update the Engram entry in a config file.
 *
 * FR-D5 T2: THROWS ConfigParseError if the file exists but does not parse.
 * It never overwrites a config it could not read. The FLAW-8 behaviour this
 * replaces — back up best-effort, then write a file containing only the Engram
 * entry — is what made a single trailing comma in ~/.claude.json cost the user
 * 52 unrelated keys. installToPath (index.ts:897) catches per-IDE, prints the
 * manual entry, and continues with the other IDEs, so one unreadable config no
 * longer stops an install and no longer destroys anything.
 *
 * Returns:
 *   "added"           — fresh install, no prior entry
 *   "exists"          — already installed at the same version, no changes made
 *   "upgraded"        — updated from an older tracked version to the current one
 *   "legacy-upgraded" — entry existed but had no _engram_version (pre-tracking era)
 */
export function addToConfig(configPath: string, ide: IdeDefinition, universal = false, ideKey?: string, projectRoot?: string): InstallResult {
    // FR-D5 T2. This used to back up best-effort, set `config = {}`, and carry on —
    // writing a file containing ONLY the Engram entry. Measured blast radius:
    // ~/.claude.json is 40.5 KB with 53 top-level keys (oauthAccount, userID,
    // machineID, projects, onboarding state); mcpServers is one of them. Same for
    // ~/.gemini/settings.json and ~/.mcp.json. The backup was
    // `try { copyFileSync } catch {}` and the overwrite ran regardless, so a failed
    // backup still lost the file — the same defect as the restore path fixed in
    // FR-D1 T1.
    //
    // readJson's own docstring, twelve lines above, already specified the correct
    // behaviour: "callers should warn and bail rather than silently overwriting the
    // user's config." This is that caller, now doing what it says.
    //
    // Prior art for the old behaviour, in another product: microsoft/vscode#125970,
    // where an extension wrote a small block and replaced a 600-line settings file.
    let config: Record<string, any>;
    try {
        config = readJson(configPath) ?? {};
    } catch (e) {
        if (e instanceof ConfigParseError) {
            console.error(`[Engram] Refusing to write ${configPath} — it exists but is not valid JSON.`);
            console.error(`         Engram will not overwrite a config it cannot read: this file may`);
            console.error(`         belong to another tool and contain settings unrelated to Engram.`);
            console.error(`         Fix the JSON (or move the file aside) and run install again.`);
        }
        throw e;
    }

    const key = ide.configKey;
    if (!config[key]) config[key] = {};

    const newEntry = makeEngramEntry(ide, universal, ideKey, projectRoot);
    const currentVersion = newEntry._engram_version as string;

    // Locate an existing entry under ANY key, not just "engram" — see
    // findEngramEntryKey. Writing to the key we found it under preserves a name
    // the user chose; writing to a fixed "engram" would leave theirs behind and
    // launch two servers on one database.
    const existingKey = findEngramEntryKey(config[key]);

    if (existingKey) {
        const existing = config[key][existingKey] as Record<string, unknown>;
        const existingVersion = existing._engram_version as string | undefined;

        if (existingVersion === currentVersion) {
            // Same version — but is it the same ENTRY? A corrupted command or a
            // stale --ide shard carries the current stamp perfectly well.
            if (entryMatches(existing, newEntry)) return "exists";
            config[key][existingKey] = { ...existing, ...newEntry };
            writeJson(configPath, config);
            return "repaired";
        }

        // Merge rather than replace so hand-added fields on the entry survive an
        // upgrade; every field Engram owns is overwritten by newEntry.
        config[key][existingKey] = { ...existing, ...newEntry };
        writeJson(configPath, config);
        if (existingKey !== "engram") return "adopted";
        return existingVersion ? "upgraded" : "legacy-upgraded";
    }

    // No prior entry at all — fresh install
    config[key].engram = newEntry;
    writeJson(configPath, config);
    return "added";
}

/**
 * Remove the Engram entry from a config file.
 * Returns true if the entry was found and removed, false if not present.
 */
export function removeFromConfig(configPath: string, ide: IdeDefinition): boolean {
    const config = readJson(configPath);
    if (!config) return false;

    const key = ide.configKey;
    // Same finder as install and status. This used to delete only the entry
    // literally named "engram", so an install that had adopted a differently
    // named entry could not be uninstalled — `--remove` reported success having
    // left a live server behind. Observation #127.
    const existingKey = findEngramEntryKey(config[key]);
    if (!existingKey) return false;

    delete config[key][existingKey];

    // Clean up empty wrapper key
    if (Object.keys(config[key]).length === 0) {
        delete config[key];
    }

    writeJson(configPath, config);
    return true;
}
