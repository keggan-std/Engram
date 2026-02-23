// ============================================================================
// Engram MCP Server — Update Check Service
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import {
    NPM_REGISTRY_URL,
    GITHUB_RELEASES_API_URL,
    GITHUB_RELEASES_URL,
    CFG_AUTO_UPDATE_CHECK,
    CFG_AUTO_UPDATE_LAST_CHECK,
    CFG_AUTO_UPDATE_AVAILABLE,
    CFG_AUTO_UPDATE_CHANGELOG,
    CFG_AUTO_UPDATE_SKIP_VERSION,
    CFG_AUTO_UPDATE_REMIND_AFTER,
    CFG_AUTO_UPDATE_NOTIFY_LEVEL,
} from "../constants.js";

export interface UpdateNotification {
    installed_version: string;
    available_version: string;
    changelog: string;
    releases_url: string;
}

// ─── Semver helpers ───────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
    const parts = v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns positive if a > b, negative if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
}

/** Returns the bump category between two versions. */
function semverBumpType(newer: string, older: string): "major" | "minor" | "patch" | "none" {
    const pn = parseSemver(newer);
    const po = parseSemver(older);
    if ((pn[0] ?? 0) > (po[0] ?? 0)) return "major";
    if ((pn[1] ?? 0) > (po[1] ?? 0)) return "minor";
    if ((pn[2] ?? 0) > (po[2] ?? 0)) return "patch";
    return "none";
}

// Rank: patch=0, minor=1, major=2
const BUMP_RANK: Record<string, number> = { patch: 0, minor: 1, major: 2 };

/**
 * Returns true if the given bump type meets or exceeds the configured notify level.
 * e.g. notifyLevel="minor" → notifies for minor and major, but not patch.
 */
function notifyLevelAllows(notifyLevel: string, bumpType: string): boolean {
    const threshold = BUMP_RANK[notifyLevel] ?? 1; // default: minor
    const actual = BUMP_RANK[bumpType] ?? -1;
    return actual >= threshold;
}

// ─── Fetch helper ─────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "engram-mcp-server" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ─── UpdateService ────────────────────────────────────────────────────

export class UpdateService {
    /** Ensures we only surface the notification once per server process. */
    private _notifiedThisProcess = false;

    constructor(
        private repos: Repositories,
        private currentVersion: string
    ) { }

    /**
     * Fire-and-forget: schedule an async update check via setImmediate so it
     * never blocks server startup. All errors are swallowed — update checking
     * is strictly best-effort.
     */
    scheduleCheck(): void {
        setImmediate(() => {
            this._check().catch(() => { /* update check is best-effort — ignore all errors */ });
        });
    }

    /**
     * Returns an update notification if a newer version is available.
     * Only returns a value once per process lifetime to avoid spamming the
     * agent on every engram_start_session call.
     */
    getNotification(): UpdateNotification | null {
        if (this._notifiedThisProcess) return null;
        const available = this.repos.config.get(CFG_AUTO_UPDATE_AVAILABLE);
        if (!available) return null;
        this._notifiedThisProcess = true;
        const changelog = this.repos.config.get(CFG_AUTO_UPDATE_CHANGELOG) || "";
        return {
            installed_version: this.currentVersion,
            available_version: available,
            changelog,
            releases_url: GITHUB_RELEASES_URL,
        };
    }

    private async _check(): Promise<void> {
        // 1. Respect auto_update_check toggle (default: on)
        const enabled = this.repos.config.getBool(CFG_AUTO_UPDATE_CHECK, true);
        if (!enabled) return;

        // 2. Respect snooze / postpone
        const remindAfter = this.repos.config.get(CFG_AUTO_UPDATE_REMIND_AFTER);
        if (remindAfter && new Date(remindAfter) > new Date()) return;

        // 3. Throttle to once per 24h
        const lastCheck = this.repos.config.get(CFG_AUTO_UPDATE_LAST_CHECK);
        if (lastCheck) {
            const hoursSince = (Date.now() - new Date(lastCheck).getTime()) / 3_600_000;
            if (hoursSince < 24) return;
        }

        // 4. Fetch latest version info
        const fetched = await this._fetchLatest();
        const ts = new Date().toISOString();
        this.repos.config.set(CFG_AUTO_UPDATE_LAST_CHECK, ts, ts);
        if (!fetched) return;

        const { version: latestVersion, changelog } = fetched;
        const skipVersion = this.repos.config.get(CFG_AUTO_UPDATE_SKIP_VERSION) || "";
        const notifyLevel = this.repos.config.getOrDefault(CFG_AUTO_UPDATE_NOTIFY_LEVEL, "minor");

        const isNewer = compareSemver(latestVersion, this.currentVersion) > 0;
        const bumpType = semverBumpType(latestVersion, this.currentVersion);
        const shouldNotify =
            isNewer &&
            latestVersion !== skipVersion &&
            notifyLevelAllows(notifyLevel, bumpType);

        if (shouldNotify) {
            this.repos.config.set(CFG_AUTO_UPDATE_AVAILABLE, latestVersion, ts);
            this.repos.config.set(CFG_AUTO_UPDATE_CHANGELOG, changelog, ts);
        } else {
            // Clear stale notification when the user has already updated
            const stored = this.repos.config.get(CFG_AUTO_UPDATE_AVAILABLE);
            if (stored && !isNewer) {
                this.repos.config.set(CFG_AUTO_UPDATE_AVAILABLE, "", ts);
                this.repos.config.set(CFG_AUTO_UPDATE_CHANGELOG, "", ts);
            }
        }
    }

    private async _fetchLatest(): Promise<{ version: string; changelog: string } | null> {
        // Primary: npm registry — includes releaseNotes field if inject script ran at publish time
        try {
            const data = await fetchWithTimeout(NPM_REGISTRY_URL, 5_000) as Record<string, unknown>;
            const version = data["version"] as string | undefined;
            const changelog = (data["releaseNotes"] as string | undefined) ?? "";
            if (version) return { version, changelog };
        } catch { /* fall through to GitHub */ }

        // Fallback: GitHub Releases API
        try {
            const data = await fetchWithTimeout(GITHUB_RELEASES_API_URL, 5_000) as Record<string, unknown>;
            const tag = (data["tag_name"] as string | undefined) ?? "";
            const version = tag.replace(/^v/, "");
            const changelog = (data["body"] as string | undefined) ?? "";
            if (version) return { version, changelog };
        } catch { /* both sources unavailable — likely offline */ }

        return null;
    }
}
