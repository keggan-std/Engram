// ============================================================================
// Engram MCP Server — Structured Logger
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: "DEBUG",
    info: "INFO",
    warn: "WARN",
    error: "ERROR",
};

/**
 * FR-D6: ENGRAM_LOG_LEVEL is validated.
 *
 * It used to be a bare `as LogLevel` cast. A typo — ENGRAM_LOG_LEVEL=verbose,
 * =trace, =INFO — put an unknown key in `currentLevel`, so `LEVEL_ORDER[currentLevel]`
 * was `undefined`, every `>=` comparison against it was false, and ALL LOGGING
 * SILENTLY DISAPPEARED. The one knob the product has for turning observability
 * up was also the one way to turn it off by accident, with no message saying so.
 *
 * An unknown value now falls back to "info" and says why — on stderr, which is
 * the only channel a stdio MCP server may use.
 */
function resolveInitialLevel(): LogLevel {
    const raw = process.env.ENGRAM_LOG_LEVEL;
    if (!raw) return "info";
    if (raw in LEVEL_ORDER) return raw as LogLevel;
    console.error(
        `[Engram] [WARN] Ignoring ENGRAM_LOG_LEVEL="${raw}" — expected one of ${Object.keys(LEVEL_ORDER).join(", ")}. Falling back to "info".`,
    );
    return "info";
}

let currentLevel: LogLevel = resolveInitialLevel();

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const parts = [`[Engram] [${LEVEL_LABELS[level]}] ${message}`];
    if (context && Object.keys(context).length > 0) {
        parts.push(JSON.stringify(context));
    }
    return parts.join(" ");
}

export const log = {
    debug(message: string, context?: Record<string, unknown>): void {
        if (shouldLog("debug")) console.error(formatMessage("debug", message, context));
    },

    info(message: string, context?: Record<string, unknown>): void {
        if (shouldLog("info")) console.error(formatMessage("info", message, context));
    },

    warn(message: string, context?: Record<string, unknown>): void {
        if (shouldLog("warn")) console.error(formatMessage("warn", message, context));
    },

    error(message: string, context?: Record<string, unknown>): void {
        if (shouldLog("error")) console.error(formatMessage("error", message, context));
    },

    setLevel(level: LogLevel): void {
        currentLevel = level;
    },

    getLevel(): LogLevel {
        return currentLevel;
    },
};
