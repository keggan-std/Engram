// ============================================================================
// Engram MCP Server — PM Diagnostics Tracker + pmSafe Utility
// ============================================================================
//
// PMDiagnosticsTracker is a lightweight in-memory tracker for PM subsystem
// failures within a session. It is used to populate pm_status diagnostic
// reports and to detect repeated failures.
//
// pmSafe<T>() is the isolation boundary for all PM code paths. It ensures
// that any PM feature failure:
//   1. Logs a descriptive message to console.error
//   2. Records the failure in the diagnostics tracker (if available)
//   3. Returns the specified fallback value instead of throwing
//
// PM failures NEVER propagate to callers — the PM system must never
// break core Engram operations.
// ============================================================================

export interface PMFailureRecord {
    context: string;
    message: string;
    timestamp: number;
    count: number;
}

export interface PMStatusReport {
    pm_lite_healthy: boolean;
    pm_full_healthy: boolean;
    failure_count: number;
    recent_failures: PMFailureRecord[];
    uptime_ms: number;
}

// ─── PMDiagnosticsTracker ─────────────────────────────────────────────────────

export class PMDiagnosticsTracker {
    private readonly failures: Map<string, PMFailureRecord> = new Map();
    private readonly startTime: number = Date.now();

    /**
     * Record a PM subsystem failure. Subsequent failures for the same context
     * increment the count rather than creating duplicate entries.
     */
    recordFailure(context: string, message: string): void {
        const existing = this.failures.get(context);
        if (existing) {
            existing.count++;
            existing.message = message; // keep latest message
            existing.timestamp = Date.now();
        } else {
            this.failures.set(context, { context, message, timestamp: Date.now(), count: 1 });
        }
    }

    /**
     * Return a status report summarising PM subsystem health.
     * pm_lite_healthy = no context has failed 3+ times
     * pm_full_healthy = zero failures
     */
    getStatus(): PMStatusReport {
        const allFailures = [...this.failures.values()];
        const totalCount = allFailures.reduce((sum, f) => sum + f.count, 0);
        return {
            pm_lite_healthy: allFailures.every(f => f.count < 3),
            pm_full_healthy: allFailures.length === 0,
            failure_count: totalCount,
            recent_failures: allFailures
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5),
            uptime_ms: Date.now() - this.startTime,
        };
    }

    /** Reset all tracked failures (e.g. after a PM mode toggle). */
    reset(): void {
        this.failures.clear();
    }
}

// ─── pmSafe — Isolation Boundary ─────────────────────────────────────────────

/**
 * Execute a PM operation safely inside an isolation boundary.
 *
 * On success: returns the operation result.
 * On any error:
 *   - Logs with [Engram/PM] prefix to console.error (never console.log).
 *   - Records the failure in the tracker when one is provided.
 *   - Returns the fallback value silently.
 *
 * @param operation  The PM feature code to run.
 * @param fallback   Safe default to return on failure.
 * @param context    Human-readable label for diagnostic messages.
 * @param tracker    Optional diagnostics tracker; pass `null` when not yet available.
 */
export function pmSafe<T>(
    operation: () => T,
    fallback: T,
    context: string,
    tracker?: PMDiagnosticsTracker | null,
): T {
    try {
        return operation();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Engram/PM] ${context} failed: ${message}`);
        if (tracker) {
            tracker.recordFailure(context, message);
        }
        return fallback;
    }
}
