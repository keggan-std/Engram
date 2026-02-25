// ============================================================================
// Engram MCP Server — Response Helpers
// ============================================================================

/**
 * Standard MCP tool response types.
 */
interface McpToolResponse {
    [key: string]: unknown;
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

/**
 * JSON replacer that strips null values — reduces response token cost by 3-8%.
 */
function stripNulls(_key: string, value: unknown): unknown {
    return value === null ? undefined : value;
}

/**
 * Return a successful JSON response (compact, no whitespace, nulls stripped).
 */
export function success(data: Record<string, unknown>): McpToolResponse {
    return {
        content: [{ type: "text", text: JSON.stringify(data, stripNulls) }],
    };
}

/**
 * Return a successful plain-text response.
 */
export function textResult(message: string): McpToolResponse {
    return {
        content: [{ type: "text", text: message }],
    };
}

/**
 * Return an error response.
 */
export function error(message: string): McpToolResponse {
    return {
        isError: true,
        content: [{ type: "text", text: message }],
    };
}

/**
 * Return an error response with structured data (compact, nulls stripped).
 */
export function errorWithData(message: string, data: Record<string, unknown>): McpToolResponse {
    return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: message, ...data }, stripNulls) }],
    };
}
