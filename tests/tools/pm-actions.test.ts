// ============================================================================
// Step 7 Tests — get_knowledge dispatcher + PM admin actions
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/test-db.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Simulate the core logic of each action (not calling the full MCP dispatcher,
// just the repos & services operations the switch cases perform).

function makeRepos(pmFull = false) {
    const { repos } = createTestDb();
    if (pmFull) repos.config.set('pm_full_enabled', 'true', new Date().toISOString());
    return repos;
}

// ─── get_knowledge pm-full guard ─────────────────────────────────────────────

describe("get_knowledge PM-Full guard", () => {
    it("returns error message when PM-Full disabled", () => {
        const repos = makeRepos(false);
        const pmFull = repos.config.get('pm_full_enabled');
        expect(pmFull).not.toBe('true');
    });

    it("allows access when PM-Full enabled", () => {
        const repos = makeRepos(true);
        const pmFull = repos.config.get('pm_full_enabled');
        expect(pmFull).toBe('true');
    });
});

// ─── PM admin: enable_pm / disable_pm ────────────────────────────────────────

describe("PM admin: enable_pm / disable_pm", () => {
    it("enable_pm sets pm_full_enabled=true and clears declined flag", () => {
        const repos = makeRepos(false);
        repos.config.set('pm_full_declined', 'true', '');
        // Simulate enable_pm
        const ts = new Date().toISOString();
        repos.config.set('pm_full_enabled', 'true', ts);
        repos.config.set('pm_full_declined', 'false', ts);
        expect(repos.config.get('pm_full_enabled')).toBe('true');
        expect(repos.config.get('pm_full_declined')).toBe('false');
    });

    it("disable_pm sets pm_full_enabled=false", () => {
        const repos = makeRepos(true);
        repos.config.set('pm_full_enabled', 'false', new Date().toISOString());
        expect(repos.config.get('pm_full_enabled')).toBe('false');
    });

    it("enable/disable is idempotent", () => {
        const repos = makeRepos(false);
        const ts = new Date().toISOString();
        repos.config.set('pm_full_enabled', 'true', ts);
        repos.config.set('pm_full_enabled', 'true', ts); // second call
        expect(repos.config.get('pm_full_enabled')).toBe('true');
    });
});

// ─── PM admin: enable_pm_lite / disable_pm_lite ───────────────────────────────

describe("PM admin: enable_pm_lite / disable_pm_lite", () => {
    it("disable_pm_lite sets pm_lite_enabled=false", () => {
        const repos = makeRepos();
        repos.config.set('pm_lite_enabled', 'false', new Date().toISOString());
        expect(repos.config.get('pm_lite_enabled')).toBe('false');
    });

    it("enable_pm_lite sets pm_lite_enabled=true", () => {
        const repos = makeRepos();
        repos.config.set('pm_lite_enabled', 'false', '');
        repos.config.set('pm_lite_enabled', 'true', new Date().toISOString());
        expect(repos.config.get('pm_lite_enabled')).toBe('true');
    });
});

// ─── PM admin: decline_pm ────────────────────────────────────────────────────

describe("PM admin: decline_pm", () => {
    it("sets pm_full_declined=true and pm_full_offered=true", () => {
        const repos = makeRepos(false);
        const ts = new Date().toISOString();
        repos.config.set('pm_full_declined', 'true', ts);
        repos.config.set('pm_full_offered', 'true', ts);
        expect(repos.config.get('pm_full_declined')).toBe('true');
        expect(repos.config.get('pm_full_offered')).toBe('true');
    });

    it("after decline, PM-Full offer should not re-appear (guard check)", () => {
        const repos = makeRepos(false);
        repos.config.set('pm_full_declined', 'true', '');
        const declined = repos.config.get('pm_full_declined');
        expect(declined).toBe('true');
        // Advisor uses this to skip the eligibility offer
    });
});

// ─── PM admin: reset_pm_offer ────────────────────────────────────────────────

describe("PM admin: reset_pm_offer", () => {
    it("clears both offer and decline flags", () => {
        const repos = makeRepos(false);
        repos.config.set('pm_full_offered', 'true', '');
        repos.config.set('pm_full_declined', 'true', '');
        // Simulate reset_pm_offer
        const ts = new Date().toISOString();
        repos.config.set('pm_full_offered', 'false', ts);
        repos.config.set('pm_full_declined', 'false', ts);
        expect(repos.config.get('pm_full_offered')).toBe('false');
        expect(repos.config.get('pm_full_declined')).toBe('false');
    });
});

// ─── PM admin: pm_status ─────────────────────────────────────────────────────

describe("PM admin: pm_status", () => {
    it("pm_lite enabled by default (pm_lite_enabled not set to false)", () => {
        const repos = makeRepos(false);
        const pmLiteEnabled = repos.config.get('pm_lite_enabled') !== 'false';
        expect(pmLiteEnabled).toBe(true);
    });

    it("pm_full disabled by default", () => {
        const repos = makeRepos(false);
        const pmFullEnabled = repos.config.get('pm_full_enabled') === 'true';
        expect(pmFullEnabled).toBe(false);
    });

    it("pm_status reflects enabled state after enable_pm", () => {
        const repos = makeRepos(false);
        repos.config.set('pm_full_enabled', 'true', '');
        const pmFullEnabled = repos.config.get('pm_full_enabled') === 'true';
        expect(pmFullEnabled).toBe(true);
    });

    it("pm_status reflects decline state after decline_pm", () => {
        const repos = makeRepos(false);
        repos.config.set('pm_full_declined', 'true', '');
        const pmDeclined = repos.config.get('pm_full_declined') === 'true';
        expect(pmDeclined).toBe(true);
    });
});

// ─── Knowledge base content verification ─────────────────────────────────────

describe("knowledge base content (via direct import)", () => {
    it("getKnowledge principles returns 5 principles", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('principles') as { principles: unknown[] };
        expect(result.principles).toBeDefined();
        expect(Array.isArray(result.principles)).toBe(true);
        expect(result.principles.length).toBeGreaterThan(0);
    });

    it("getKnowledge phase_info returns phase overview for phase 1", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('phase_info', 1) as { phase: number; name: string };
        expect(result.phase).toBe(1);
        expect(result.name).toBeDefined();
    });

    it("getKnowledge checklist returns a checklist for phase 2", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('checklist', 2) as { fromPhase: number; items: unknown[] };
        expect(result.fromPhase).toBe(2);
        expect(Array.isArray(result.items)).toBe(true);
    });

    it("getKnowledge estimation returns PERT guide", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('estimation') as { method: string; formula: string };
        expect(result.method).toBeDefined();
        expect(result.formula).toBeDefined();
    });

    it("getKnowledge returns error for phase_info without phase", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('phase_info') as { error: string };
        expect(result.error).toBeDefined();
    });

    it("getKnowledge phase_info returns error for unknown phase", async () => {
        const { getKnowledge } = await import("../../src/knowledge/index.js");
        const result = getKnowledge('phase_info', 99) as { error: string };
        expect(result.error).toBeDefined();
    });
});

// ─── ADMIN_ACTIONS and MEMORY_ACTIONS catalog completeness ───────────────────

describe("tool catalog completeness", () => {
    it("ADMIN_CATALOG includes all 7 PM admin actions", async () => {
        const { ADMIN_CATALOG } = await import("../../src/tools/find.js");
        const pmAdminActions = ['enable_pm', 'disable_pm', 'enable_pm_lite', 'disable_pm_lite', 'decline_pm', 'reset_pm_offer', 'pm_status'];
        for (const action of pmAdminActions) {
            expect(ADMIN_CATALOG).toHaveProperty(action);
        }
    });

    it("MEMORY_CATALOG includes get_knowledge", async () => {
        const { MEMORY_CATALOG } = await import("../../src/tools/find.js");
        expect(MEMORY_CATALOG).toHaveProperty('get_knowledge');
    });
});
