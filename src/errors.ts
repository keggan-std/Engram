// ============================================================================
// Engram MCP Server — Error Types
// ============================================================================

/**
 * Base error class for all Engram errors.
 * Includes an error code and optional context for structured error handling.
 */
export class EngramError extends Error {
    readonly code: string;
    readonly context?: Record<string, unknown>;

    constructor(message: string, code: string = "ENGRAM_ERROR", context?: Record<string, unknown>) {
        super(message);
        this.name = "EngramError";
        this.code = code;
        this.context = context;
    }
}

/**
 * Thrown when a requested entity is not found.
 */
export class NotFoundError extends EngramError {
    constructor(entity: string, id: string | number) {
        super(`${entity} #${id} not found.`, "NOT_FOUND", { entity, id });
        this.name = "NotFoundError";
    }
}

/**
 * Thrown when input validation fails beyond what Zod catches.
 */
export class ValidationError extends EngramError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, "VALIDATION_ERROR", context);
        this.name = "ValidationError";
    }
}

/**
 * Thrown when a database operation fails.
 */
export class DatabaseError extends EngramError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, "DATABASE_ERROR", context);
        this.name = "DatabaseError";
    }
}

/**
 * Thrown when a safety confirmation is missing or incorrect.
 */
export class SafetyCheckError extends EngramError {
    constructor(expectedConfirm: string) {
        super(`Safety check: set confirm to "${expectedConfirm}" to proceed.`, "SAFETY_CHECK", { expectedConfirm });
        this.name = "SafetyCheckError";
    }
}

/**
 * Thrown when no active session exists for an operation that requires one.
 */
export class NoActiveSessionError extends EngramError {
    constructor() {
        super('No active session. Call engram_session({ action: "start" }) first.', "NO_SESSION");
        this.name = "NoActiveSessionError";
    }
}
