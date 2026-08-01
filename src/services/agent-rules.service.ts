// ============================================================================
// Engram MCP Server — Agent Rules Service
//
// Serves the agent rules that ship inside this npm package. Nothing else.
//
// AUDIT N1 (CRITICAL, proven): this service used to fetch rules from the
// GitHub README over the network and cache them at
// `.engram/agent_rules_cache.json`, then read that file back with
// `JSON.parse(raw) as RulesCache` — a cast, not a validation. No schema, no
// size cap, no provenance, and no lower bound on `fetched_at`.
//
// The cache read never depended on the fetch succeeding. `.gitignore` does not
// stop a repository from SHIPPING a file: `git add -f` commits it and
// `git clone` checks it out. So any hostile repo could hand every agent that
// opened it a set of attacker-authored instructions labelled CRITICAL and
// binding, permanently (a forward-dated `fetched_at` never expires), at a size
// of its choosing (a 2 MB rule measured ~500,000 tokens injected into every
// session start). The poisoned state even reported `source: "cache"`, which
// reads as MORE trustworthy than the legitimate `"fallback"`.
//
// That is CVE-2026-21852 ("MemoryTrap") in a different product. Anthropic's fix
// in Claude Code v2.1.50 was to remove memory from the system-prompt injection
// path ENTIRELY rather than to validate it harder, and this is the same fix:
// rules are versioned, reviewed, and shipped with the package. Deleting the
// mechanism deletes the attack class; validating it would only narrow it.
//
// Consequence worth knowing: with the fetch gone, Engram's SECURITY.md claim
// that the update check is the only outbound network call is now true. It was
// not before.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import { AGENT_RULES } from "../tools/find.js";
import { log } from "../logger.js";

/** Legacy poisoning vector. Never read; detected only so it can be reported. */
const LEGACY_CACHE_FILE = ".engram/agent_rules_cache.json";

interface AgentRule {
  priority: string;
  id: string;
  rule: string;
}

export interface AgentRulesResult {
  rules: AgentRule[];
  /**
   * Provenance, stated honestly. Exactly one value is possible now, and that is
   * the point — the audit's recommendation #5 was that this field should never
   * again be able to say "cache" about content nobody verified.
   */
  source: "packaged";
  /** Present only when a legacy cache file was found on disk. */
  security_notice?: string;
}

export class AgentRulesService {
  private legacyCachePath: string;
  private legacyCacheReported = false;

  constructor(private projectRoot: string) {
    this.legacyCachePath = path.join(projectRoot, LEGACY_CACHE_FILE);
  }

  /**
   * The rules that shipped with this package version. Synchronous, offline,
   * and not influenceable by anything on disk.
   */
  getRules(): AgentRulesResult {
    const notice = this.checkForLegacyCache();
    return notice
      ? { rules: AGENT_RULES, source: "packaged", security_notice: notice }
      : { rules: AGENT_RULES, source: "packaged" };
  }

  /**
   * A leftover cache file is inert now, but its presence in a repository is
   * worth surfacing rather than silently ignoring: either this project
   * predates the fix, or someone shipped one deliberately. The file is NOT
   * deleted — quietly removing files from a user's working tree is the same
   * class of surprise as the destructive corruption-recovery path.
   */
  private checkForLegacyCache(): string | undefined {
    try {
      if (!fs.existsSync(this.legacyCachePath)) return undefined;
      if (!this.legacyCacheReported) {
        this.legacyCacheReported = true;
        log.warn(
          `[agent-rules] Ignoring ${LEGACY_CACHE_FILE}. Agent rules now ship with the package and are never read from disk (audit N1). ` +
          `If you did not create this file, treat it as a prompt-injection attempt and inspect it before deleting.`
        );
      }
      return `A legacy ${LEGACY_CACHE_FILE} file is present and was IGNORED. Agent rules ship with the package and are never loaded from disk. If you did not create this file, inspect it — it is a prompt-injection vector (audit N1) — then delete it.`;
    } catch {
      return undefined;
    }
  }
}
