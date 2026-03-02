// ============================================================================
// Engram Dashboard — Cursor Pagination Helpers
// ============================================================================

export interface PageResult<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
  total: number;
}

/**
 * Encode a cursor from an object.
 */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Decode a cursor string back to its object form.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

/**
 * Build a Page result from a slice of data + total count.
 * @param rows      The rows already fetched (limit+1 to detect hasMore)
 * @param limit     The requested page size
 * @param total     Total matching record count (pass undefined to skip)
 * @param cursorKey The field on the row used as the cursor (default: 'id')
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  total: number | undefined,
  cursorKey: string = "id",
): PageResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = data[data.length - 1] as Record<string, unknown> | undefined;
  const cursor = lastRow && hasMore ? encodeCursor({ [cursorKey]: lastRow[cursorKey] }) : null;

  return { data, cursor, hasMore, total: total ?? 0 };
}

/** Parse limit from query string, clamped to 1–200. Default 50. */
export function parseLimit(raw: unknown, defaultLimit = 50): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (isNaN(n)) return defaultLimit;
  return Math.max(1, Math.min(200, n));
}
