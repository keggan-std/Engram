// ============================================================================
// IDE detection — tasks #108 and #109
//
// Both bugs share a shape: a signal that is true about the MACHINE (an
// installed SDK, a VS Code extension present somewhere) was being read as a
// signal about the PROCESS (which specific IDE spawned this terminal).
//
// TASK #109. detectCurrentIde() had a second Android Studio branch that fired
// on TERMINAL_EMULATOR containing "JetBrains" plus ANDROID_HOME/ANDROID_SDK_ROOT
// — env vars set machine-wide by anyone doing command-line Android work, true
// in IntelliJ, WebStorm, PyCharm, GoLand and RubyMine alike. Removed; only the
// specific STUDIO_VM_OPTIONS signal (Android Studio's own JVM launcher) remains.
//
// TASK #108. Cline and Roo Code are VS Code extensions, not separate
// processes, so their terminal sets exactly the env vars VS Code itself sets
// and detectCurrentIde() cannot tell them apart. detectVscodeExtensionAmbiguity()
// is the honest half of the fix: it does not guess, it reports when Cline
// and/or Roo Code are even installed on the machine so the caller can ask
// instead of silently writing to VS Code's config.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectCurrentIde } from "../../src/installer/ide-detector.js";

// ─── detectCurrentIde: env-var mutation only, no module reload needed ─────

describe("detectCurrentIde", () => {
    const savedEnv: Record<string, string | undefined> = {};
    // PATH is included because this suite runs inside a real IDE session —
    // the host's actual PATH can itself contain a fork name (e.g. an
    // "antigravity" install directory) and would otherwise leak a false
    // signal into a test that means to assert "no fork signals at all".
    const TOUCHED = [
        "CLAUDE_CODE", "CLAUDE_CLI", "VSINSTALLDIR", "VisualStudioVersion",
        "STUDIO_VM_OPTIONS", "TERMINAL_EMULATOR", "ANDROID_HOME", "ANDROID_SDK_ROOT",
        "JETBRAINS_IDE", "TERM_PROGRAM", "VSCODE_IPC_HOOK", "VSCODE_CWD",
        "CURSOR_TRACE_ID", "ANTIGRAVITY_EDITOR_APP_ROOT", "WINDSURF_PROFILE", "PATH",
    ];

    beforeEach(() => {
        for (const key of TOUCHED) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
        process.env.PATH = "";
    });

    afterEach(() => {
        for (const key of TOUCHED) {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        }
    });

    it("TASK #109: a JetBrains terminal with ANDROID_HOME set is NOT Android Studio", () => {
        // This is the false-positive shape: any IntelliJ-family IDE, on a
        // machine where the developer also does command-line Android work.
        process.env.TERMINAL_EMULATOR = "JetBrains-JediTerm";
        process.env.ANDROID_HOME = "C:\\Users\\dev\\AppData\\Local\\Android\\Sdk";
        expect(detectCurrentIde()).toBe("jetbrains");
    });

    it("TASK #109: ANDROID_SDK_ROOT alone no longer triggers the false positive either", () => {
        process.env.TERMINAL_EMULATOR = "JetBrains-JediTerm";
        process.env.ANDROID_SDK_ROOT = "/home/dev/Android/Sdk";
        expect(detectCurrentIde()).toBe("jetbrains");
    });

    it("Android Studio's own launcher signal (STUDIO_VM_OPTIONS) still resolves correctly", () => {
        process.env.STUDIO_VM_OPTIONS = "C:\\Users\\dev\\AppData\\Roaming\\Google\\AndroidStudio2025.3\\studio64.vmoptions";
        expect(detectCurrentIde()).toBe("androidstudio");
    });

    it("STUDIO_VM_OPTIONS wins even when ANDROID_HOME and a JetBrains terminal are also present", () => {
        process.env.STUDIO_VM_OPTIONS = "C:\\studio.vmoptions";
        process.env.TERMINAL_EMULATOR = "JetBrains-JediTerm";
        process.env.ANDROID_HOME = "C:\\Sdk";
        expect(detectCurrentIde()).toBe("androidstudio");
    });

    it("a plain JetBrains terminal with no Android signal at all resolves to jetbrains", () => {
        process.env.JETBRAINS_IDE = "IntelliJIdea";
        expect(detectCurrentIde()).toBe("jetbrains");
    });

    it("falls through to vscode when only the generic VS Code family signal is set", () => {
        process.env.TERM_PROGRAM = "vscode";
        expect(detectCurrentIde()).toBe("vscode");
    });
});

// ─── detectVscodeExtensionAmbiguity: paths are captured at module load,
//     so each case reloads the module fresh against a scoped APPDATA. ───────

describe("detectVscodeExtensionAmbiguity", () => {
    let tmpDir: string;
    let originalAppdata: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-ambig-"));
        originalAppdata = process.env.APPDATA;
        process.env.APPDATA = path.join(tmpDir, "AppData", "Roaming");
        vi.resetModules();
    });

    afterEach(() => {
        if (originalAppdata === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = originalAppdata;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.resetModules();
    });

    it("returns [] when neither Cline nor Roo Code is installed", async () => {
        const { detectVscodeExtensionAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeExtensionAmbiguity()).toEqual([]);
    });

    it("flags Cline when its extension's globalStorage directory exists, even with no MCP settings file written yet", async () => {
        fs.mkdirSync(
            path.join(process.env.APPDATA!, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
            { recursive: true },
        );
        const { detectVscodeExtensionAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeExtensionAmbiguity()).toEqual(["cline"]);
    });

    it("flags Roo Code when its extension's globalStorage directory exists", async () => {
        fs.mkdirSync(
            path.join(process.env.APPDATA!, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline"),
            { recursive: true },
        );
        const { detectVscodeExtensionAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeExtensionAmbiguity()).toEqual(["roocode"]);
    });

    it("flags both when both extensions are installed", async () => {
        const base = path.join(process.env.APPDATA!, "Code", "User", "globalStorage");
        fs.mkdirSync(path.join(base, "saoudrizwan.claude-dev"), { recursive: true });
        fs.mkdirSync(path.join(base, "rooveterinaryinc.roo-cline"), { recursive: true });
        const { detectVscodeExtensionAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeExtensionAmbiguity()).toEqual(["cline", "roocode"]);
    });

    it("is not fooled by the settings FILE existing without the extension directory pre-existing independently", async () => {
        // Sanity check on the mechanism itself: creating the exact settings
        // file (not just its parent) must also be detected, since the
        // directory check walks up FROM that path.
        const settingsDir = path.join(process.env.APPDATA!, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings");
        fs.mkdirSync(settingsDir, { recursive: true });
        fs.writeFileSync(path.join(settingsDir, "cline_mcp_settings.json"), "{}");
        const { detectVscodeExtensionAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeExtensionAmbiguity()).toEqual(["cline"]);
    });
});

// ─── Fork disambiguation: PATH is machine evidence, VSCODE_CWD is not ─────
//
// PROVEN 2026-08-12 on the maintainer's machine by running the real
// `engram install --universal` from a VS Code terminal:
//
//   Detected IDE  : Antigravity IDE (Gemini)
//   Config file   : C:\Users\El-Roi\.gemini\antigravity\mcp_config.json
//
// VSCODE_CWD read `...\Programs\Microsoft VS Code` — the running editor, named
// unambiguously — and detectCurrentIde() consulted it, found no fork name in
// it, and then FELL THROUGH to PATH, where two Antigravity install directories
// were sitting because Antigravity is installed on that machine. The installer
// stated the wrong product as fact and was one confirmation away from writing
// there.
//
// Same shape as #109 one file over: machine evidence read as process evidence.

describe("VS Code fork disambiguation (the Antigravity false positive)", () => {
    const TOUCHED = [
        "CLAUDE_CODE", "CLAUDE_CLI", "VSINSTALLDIR", "VisualStudioVersion",
        "STUDIO_VM_OPTIONS", "TERMINAL_EMULATOR", "JETBRAINS_IDE",
        "TERM_PROGRAM", "VSCODE_IPC_HOOK", "VSCODE_CWD",
        "CURSOR_TRACE_ID", "ANTIGRAVITY_EDITOR_APP_ROOT", "WINDSURF_PROFILE", "PATH",
    ];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of TOUCHED) { saved[k] = process.env[k]; delete process.env[k]; }
    });
    afterEach(() => {
        for (const k of TOUCHED) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it("does not call VS Code 'Antigravity' just because Antigravity is on PATH", () => {
        // The exact reproduction, with the real strings from that machine.
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.VSCODE_CWD = "C:\Users\El-Roi\AppData\Local\Programs\Microsoft VS Code";
        process.env.PATH = "C:\Users\El-Roi\AppData\Local\Programs\Antigravity\bin;D:\apps data\Antigravity IDE\bin";
        expect(detectCurrentIde()).toBe("vscode");
    });

    it("still identifies a fork when VSCODE_CWD actually names one", () => {
        // The fix must not buy correctness by making detection useless.
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.VSCODE_CWD = "C:\Users\El-Roi\AppData\Local\Programs\Antigravity";
        expect(detectCurrentIde()).toBe("antigravity");
    });

    it("prefers an explicit fork env var over everything", () => {
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.VSCODE_CWD = "C:\Users\El-Roi\AppData\Local\Programs\Microsoft VS Code";
        process.env.CURSOR_TRACE_ID = "abc";
        expect(detectCurrentIde()).toBe("cursor");
    });

    it("reports PATH forks as an ambiguity to ask about, not an answer", async () => {
        // No VSCODE_CWD: nothing authoritative is available, so PATH is the
        // only signal left. It must produce a QUESTION, never an assertion.
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.PATH = "C:\Programs\Antigravity\bin;C:\Programs\Windsurf\bin";
        const { detectVscodeForkAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectCurrentIde()).toBe("vscode");
        expect(detectVscodeForkAmbiguity()).toEqual(["antigravity", "windsurf"]);
    });

    it("asks nothing when VSCODE_CWD already answered", async () => {
        // PATH must not get a second vote against a signal that is genuinely
        // about this process — that second vote WAS the bug.
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.VSCODE_CWD = "C:\Programs\Microsoft VS Code";
        process.env.PATH = "C:\Programs\Antigravity\bin";
        const { detectVscodeForkAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeForkAmbiguity()).toEqual([]);
    });

    it("asks nothing on a machine with no fork installed at all", async () => {
        process.env.VSCODE_IPC_HOOK = "/tmp/vscode.sock";
        process.env.PATH = "C:\Windows\System32;C:\Program Files\nodejs";
        const { detectVscodeForkAmbiguity } = await import("../../src/installer/ide-detector.js");
        expect(detectVscodeForkAmbiguity()).toEqual([]);
    });
});
