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

let currentLevel: LogLevel = (process.env.ENGRAM_LOG_LEVEL as LogLevel) || "info";

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
