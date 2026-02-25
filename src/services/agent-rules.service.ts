// ============================================================================
// Engram MCP Server — Agent Rules Service
// Fetches agent rules from the GitHub README and caches them locally.
// Falls back to hardcoded AGENT_RULES on any failure.
// ============================================================================

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { GITHUB_REPO } from "../constants.js";
import { AGENT_RULES } from "../tools/find.js";
import { log } from "../logger.js";

const CACHE_FILE = ".engram/agent_rules_cache.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const README_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/README.md`;
const RULES_START_MARKER = "<!-- AGENT_RULES_START -->";
const RULES_END_MARKER = "<!-- AGENT_RULES_END -->";

interface AgentRule {
  priority: string;
  id: string;
  rule: string;
}

interface RulesCache {
  fetched_at: number;
  rules: AgentRule[];
  source_url: string;
}

export class AgentRulesService {
  private cachePath: string;
  private cachedRules: AgentRule[] | null = null;

  constructor(private projectRoot: string) {
    this.cachePath = path.join(projectRoot, CACHE_FILE);
  }

  /**
   * Returns agent rules synchronously.
   * Uses cached rules if fresh, otherwise returns fallback and triggers a background refresh.
   */
  getRules(): { rules: AgentRule[]; source: "cache" | "fallback"; cache_age_hours?: number } {
    const cached = this.loadCache();
    if (cached) {
      const ageHours = Math.round((Date.now() - cached.fetched_at) / 3_600_000);
      return { rules: cached.rules, source: "cache", cache_age_hours: ageHours };
    }

    // Trigger async refresh but don't block
    this.refreshInBackground();
    return { rules: AGENT_RULES, source: "fallback" };
  }

  /**
   * Force-refresh the cache from GitHub. Returns the refreshed rules or null on failure.
   */
  async refresh(): Promise<AgentRule[] | null> {
    return this.fetchAndCache();
  }

  private loadCache(): RulesCache | null {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const raw = fs.readFileSync(this.cachePath, "utf-8");
      const cache = JSON.parse(raw) as RulesCache;
      if (Date.now() - cache.fetched_at > CACHE_TTL_MS) return null; // expired
      if (!Array.isArray(cache.rules) || cache.rules.length === 0) return null;
      return cache;
    } catch {
      return null;
    }
  }

  private refreshInBackground(): void {
    this.fetchAndCache().catch(() => { /* silent — fallback already returned */ });
  }

  private async fetchAndCache(): Promise<AgentRule[] | null> {
    try {
      const raw = await this.httpGet(README_URL);
      const rules = this.parseRulesFromReadme(raw);
      if (!rules || rules.length === 0) return null;

      const cache: RulesCache = { fetched_at: Date.now(), rules, source_url: README_URL };
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), "utf-8");
      this.cachedRules = rules;
      log.info(`[agent-rules] Fetched ${rules.length} rules from GitHub README.`);
      return rules;
    } catch (err) {
      log.info(`[agent-rules] Fetch failed, using fallback: ${String(err)}`);
      return null;
    }
  }

  private parseRulesFromReadme(readme: string): AgentRule[] | null {
    // Look for <!-- AGENT_RULES_START --> ... <!-- AGENT_RULES_END --> JSON block
    const start = readme.indexOf(RULES_START_MARKER);
    const end = readme.indexOf(RULES_END_MARKER);
    if (start !== -1 && end !== -1 && end > start) {
      const json = readme.slice(start + RULES_START_MARKER.length, end).trim();
      try {
        const parsed = JSON.parse(json) as AgentRule[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* fall through */ }
    }
    return null; // Section not found — keep fallback
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000, headers: { "User-Agent": "engram-mcp-server" } }, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", reject);
    });
  }
}
