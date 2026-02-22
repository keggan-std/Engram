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
 * Return a successful JSON response.
 */
export function success(data: Record<string, unknown>): McpToolResponse {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
 * Return an error response with structured data.
 */
export function errorWithData(message: string, data: Record<string, unknown>): McpToolResponse {
    return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: message, ...data }, null, 2) }],
    };
}
