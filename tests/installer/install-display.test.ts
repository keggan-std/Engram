// ============================================================================
// How the installer DESCRIBES what it found
//
// THE COMPLAINT THIS SUITE BINDS, reported from a real machine, session 50:
//
//  1. "the install command dont show the installed version of the detected
//     instances — it shows installed but no version." It did show one: the
//     literal string "v?", because "?" is what discovery stores for an entry
//     written before Engram stamped versions. Honest, and unreadable — a user
//     reads "v?" as a broken installer, not as "older than every release".
//
//  2. The same machine has FOUR Android Studio channels, each with its own
//     config. The interactive installer asked resolveIdeInstallStatus for one
//     status per IDE and got the first path that matched, so three real
//     installs were invisible from the installer that had written them.
//     `--check` had always listed all four; the install menu never did.
//
//  3. Those four paths differ ONLY in their second-to-last segment
//     (AndroidStudio2025.3.2 … AndroidStudio2026.1.3). Any path shortener that
//     truncates the tail renders them identical, which is worse than printing
//     nothing: four indistinguishable rows read as a rendering bug.
//
// These are unit tests over the pure display/grouping functions. The end-to-end
// behaviour of --check lives in install-remove-e2e.test.ts; what is pinned here
// is the formatting contract those screens depend on.
// ============================================================================

import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { formatVersion, abbreviatePath, groupByIde, type DiscoveredInstall } from "../../src/installer/discovery.js";

function install(over: Partial<DiscoveredInstall>): DiscoveredInstall {
    return {
        ideKey: "androidstudio",
        ideName: "Android Studio (Gemini)",
        scope: "global",
        configPath: "C:\\x\\mcp.json",
        version: "1.12.0",
        mode: "universal",
        distanceUp: 0,
        ...over,
    };
}

describe("formatVersion", () => {
    it("never renders the raw sentinel as a version number", () => {
        // The exact defect: "v?" reached the screen. Whatever the wording
        // becomes, it must not be the sentinel with a "v" glued to the front.
        expect(formatVersion("?")).not.toBe("v?");
        expect(formatVersion("?")).not.toMatch(/^v\?/);
    });

    it("says what an unstamped entry actually means, not that it is unknown", () => {
        // "unknown" would be a second way of saying "?". The useful fact is
        // that it predates stamping, and is therefore older than any release.
        expect(formatVersion("?")).toContain("pre-1.9");
    });

    it("treats a missing version the same as the sentinel", () => {
        // resolveIdeInstallStatus leaves installedVersion undefined for every
        // state except "installed", and one caller interpolated it directly —
        // "vundefined" is one refactor away at all times.
        expect(formatVersion(undefined)).toBe(formatVersion("?"));
        expect(formatVersion(undefined)).not.toContain("undefined");
    });

    it("renders a real version unchanged, with the v prefix", () => {
        expect(formatVersion("1.13.0")).toBe("v1.13.0");
    });
});

describe("abbreviatePath", () => {
    const home = os.homedir();

    it("keeps four sibling configs distinguishable", () => {
        // The whole reason a tail-truncating shortener is wrong.
        const channels = ["2025.3.2", "2025.3.4", "2026.1.2", "2026.1.3"].map(v =>
            path.join(home, "AppData", "Roaming", "Google", `AndroidStudio${v}`, "mcp.json"));
        const shown = channels.map(p => abbreviatePath(p));
        expect(new Set(shown).size).toBe(4);
        for (const [i, v] of ["2025.3.2", "2025.3.4", "2026.1.2", "2026.1.3"].entries()) {
            expect(shown[i]).toContain(v);
        }
    });

    it("collapses the home directory to ~", () => {
        const p = path.join(home, ".gemini", "settings.json");
        const shown = abbreviatePath(p);
        expect(shown.startsWith("~")).toBe(true);
        expect(shown).not.toContain(home);
    });

    it("shortens a long path but keeps the last two segments", () => {
        const p = path.join(home, "AppData", "Roaming", "Google", "AndroidStudio2026.1.3", "mcp.json");
        const shown = abbreviatePath(p);
        expect(shown.length).toBeLessThan(p.length);
        expect(shown).toContain("AndroidStudio2026.1.3");
        expect(shown).toContain("mcp.json");
    });

    it("prefers a project-relative path when the config is inside the project", () => {
        const cwd = process.cwd();
        expect(abbreviatePath(path.join(cwd, ".mcp.json"), cwd)).toBe(`.${path.sep}.mcp.json`);
    });

    it("does not produce a ..\\..\\ chain when the config is outside the project", () => {
        // "relative" is only an improvement when it is genuinely shorter and
        // genuinely local. Climbing out of the project is neither.
        const shown = abbreviatePath(path.join(home, ".gemini", "settings.json"), path.join(home, "some", "deep", "project"));
        expect(shown.startsWith("..")).toBe(false);
    });

    it("leaves a short absolute path alone", () => {
        expect(abbreviatePath("C:\\x\\mcp.json")).toBe(path.resolve("C:\\x\\mcp.json"));
    });
});

describe("groupByIde", () => {
    it("returns every install for an IDE, not the first one found", () => {
        // The defect: one IDE was assumed to mean one install.
        const four = ["2025.3.2", "2025.3.4", "2026.1.2", "2026.1.3"].map(v =>
            install({ configPath: `C:\\AS${v}\\mcp.json` }));
        const grouped = groupByIde(four);
        expect(grouped.get("androidstudio")).toHaveLength(4);
    });

    it("orders local before global so the nearest install is read first", () => {
        const grouped = groupByIde([
            install({ ideKey: "vscode", scope: "global", configPath: "C:\\g\\mcp.json" }),
            install({ ideKey: "vscode", scope: "local", configPath: "C:\\p\\.mcp.json" }),
        ]);
        expect(grouped.get("vscode")!.map(e => e.scope)).toEqual(["local", "global"]);
    });

    it("keeps a stable order across runs for the same input set", () => {
        const mk = () => [
            install({ configPath: "C:\\b\\mcp.json" }),
            install({ configPath: "C:\\a\\mcp.json" }),
        ];
        const first = groupByIde(mk()).get("androidstudio")!.map(e => e.configPath);
        const second = groupByIde(mk().reverse()).get("androidstudio")!.map(e => e.configPath);
        expect(first).toEqual(second);
    });

    it("separates two IDEs rather than merging them", () => {
        const grouped = groupByIde([install({}), install({ ideKey: "vscode", ideName: "VS Code" })]);
        expect([...grouped.keys()].sort()).toEqual(["androidstudio", "vscode"]);
    });
});
