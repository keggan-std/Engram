// ============================================================================
// Engram MCP Server — Git Service
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import {
    isGitRepo, getGitLogSince, getGitBranch, getGitHead,
    getGitDiffStat, getGitFilesChanged, gitCommand,
} from "../utils.js";
import { DB_DIR_NAME } from "../constants.js";

/**
 * Consolidates all git-related operations including hook log parsing.
 */
export class GitService {
    constructor(private projectRoot: string) { }

    isRepo(): boolean {
        return isGitRepo(this.projectRoot);
    }

    getBranch(): string | null {
        return this.isRepo() ? getGitBranch(this.projectRoot) || null : null;
    }

    getHead(): string | null {
        return this.isRepo() ? getGitHead(this.projectRoot) || null : null;
    }

    getLogSince(since: string, limit?: number): string {
        return getGitLogSince(this.projectRoot, since, limit);
    }

    getDiffStat(since: string): string {
        return getGitDiffStat(this.projectRoot, since);
    }

    getFilesChanged(since: string): string[] {
        return getGitFilesChanged(this.projectRoot, since);
    }

    runGitCommand(command: string): string {
        return gitCommand(this.projectRoot, command);
    }

    /**
     * Parse the git hook log file (.engram/git-changes.log) and extract
     * entries since the last session end time.
     */
    parseHookLog(lastSessionEndedAt?: string | null): string {
        try {
            const hookLogPath = path.join(this.projectRoot, DB_DIR_NAME, "git-changes.log");
            if (!fs.existsSync(hookLogPath)) return "";

            const raw = fs.readFileSync(hookLogPath, "utf-8");

            if (!lastSessionEndedAt) {
                // First session — include last 20 lines as a hint
                return raw.split("\n").slice(-20).join("\n");
            }

            const cutoffDate = new Date(lastSessionEndedAt);
            const lines = raw.split("\n");
            const relevantBlocks: string[] = [];
            let inBlock = false;
            let blockLines: string[] = [];
            let blockDate: Date | null = null;

            for (const line of lines) {
                if (line.startsWith("--- COMMIT")) {
                    if (inBlock && blockDate && blockDate > cutoffDate) {
                        relevantBlocks.push(blockLines.join("\n"));
                    }
                    inBlock = true;
                    blockLines = [line];
                    blockDate = null;
                } else if (inBlock && line.startsWith("date:")) {
                    blockLines.push(line);
                    try { blockDate = new Date(line.replace("date:", "").trim()); } catch { /* skip */ }
                } else if (inBlock) {
                    blockLines.push(line);
                }
            }

            // Flush last block
            if (inBlock && blockDate && blockDate > cutoffDate) {
                relevantBlocks.push(blockLines.join("\n"));
            }

            return relevantBlocks.join("\n\n");
        } catch {
            return ""; // git-changes.log is optional
        }
    }
}
