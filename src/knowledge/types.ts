// ============================================================================
// Engram — PM Knowledge Base: Types
// ============================================================================

/**
 * A single entry in the PM knowledge base.
 * Compact form is ≤80 chars — safe for session delivery.
 * Full form is prose — delivered on-demand via get_knowledge.
 * locale defaults to 'en'. Future: i18n support via locale key.
 */
export interface KnowledgeEntry {
    /** Stable identifier, e.g. "principle-intentionality", "gate-2-check-3" */
    id: string;
    /** Top-level knowledge category */
    category: 'principle' | 'phase' | 'checklist' | 'instruction' | 'estimation' | 'convention';
    /** Phase number 1-6. Undefined for cross-cutting entries. */
    phase?: number;
    /** ≤80 character compact form — used for session start delivery */
    compact: string;
    /** Full prose — delivered on demand */
    full: string;
    /** Topic tags for FTS / focus filtering */
    tags: string[];
    /** Language locale key (default: 'en'). Reserved for future i18n support. */
    locale?: string;
}

/** Phase definition with entry/exit criteria and summary. */
export interface PhaseDefinition {
    /** Phase number 1-6 */
    number: number;
    /** Canonical tag-safe name ("initiation", "planning", etc.) */
    name: string;
    /** Human-readable display name */
    label: string;
    /** ≤80 char one-line description */
    compact: string;
    /** Full phase description */
    full: string;
    /** Conditions that must be met to BEGIN this phase */
    entryCriteria: string[];
    /** Conditions that must be met to EXIT this phase (gate checklist) */
    exitCriteria: string[];
    /** Tags for discovery */
    tags: string[];
}

/** A single checkable item in a phase gate checklist. */
export interface ChecklistItem {
    id: string;
    check: string;
    mandatory: boolean;
    /** Optional phase-specific guidance note */
    note?: string;
}

/** Full phase gate checklist */
export interface PhaseChecklist {
    fromPhase: number;
    toPhase: number;
    label: string;
    items: ChecklistItem[];
}

/** PERT estimation entry */
export interface EstimationGuide {
    method: string;
    formula: string;
    commitFormula: string;
    compact: string;
    full: string;
    examples: Array<{ scenario: string; optimistic: number; mostLikely: number; pessimistic: number; expected: number; sigma: number; commit: number }>;
}
