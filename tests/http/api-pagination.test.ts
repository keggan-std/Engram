// ============================================================================
// HTTP Pagination Tests — buildPage, encodeCursor, decodeCursor, parseLimit
// Pure unit tests, no database required.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  buildPage,
  encodeCursor,
  decodeCursor,
  parseLimit,
} from "../../src/http-pagination.js";

// ─── encodeCursor / decodeCursor ─────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a simple object", () => {
    const obj = { id: 42 };
    const encoded = encodeCursor(obj);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    expect(decodeCursor(encoded)).toEqual(obj);
  });

  it("round-trips nested object", () => {
    const obj = { id: 7, created_at: "2026-01-01T00:00:00Z" };
    expect(decodeCursor(encodeCursor(obj))).toEqual(obj);
  });

  it("decodeCursor returns null for invalid base64url", () => {
    expect(decodeCursor("!!!invalid!!!")).toBeNull();
  });

  it("decodeCursor returns null for valid base64url but non-JSON", () => {
    const notJson = Buffer.from("not json here").toString("base64url");
    expect(decodeCursor(notJson)).toBeNull();
  });

  it("encoded string uses base64url (no + or / or = padding)", () => {
    const encoded = encodeCursor({ id: 999 });
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded.endsWith("=")).toBe(false);
  });
});

// ─── parseLimit ──────────────────────────────────────────────────────────────

describe("parseLimit", () => {
  it("returns the default for undefined input", () => {
    expect(parseLimit(undefined)).toBe(50);
  });

  it("returns the default for empty string", () => {
    expect(parseLimit("")).toBe(50);
  });

  it("returns the default for NaN string", () => {
    expect(parseLimit("abc")).toBe(50);
  });

  it("returns custom default when provided", () => {
    expect(parseLimit(undefined, 100)).toBe(100);
  });

  it("parses a valid integer string", () => {
    expect(parseLimit("20")).toBe(20);
  });

  it("clamps to minimum 1", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-50")).toBe(1);
  });

  it("clamps to maximum 200", () => {
    expect(parseLimit("500")).toBe(200);
    expect(parseLimit("201")).toBe(200);
  });

  it("accepts exact boundary values", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("200")).toBe(200);
  });
});

// ─── buildPage ───────────────────────────────────────────────────────────────

interface Row { id: number; name: string }

describe("buildPage", () => {
  const makeRows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `row-${i + 1}` }));

  it("returns all rows when fewer than limit", () => {
    const rows = makeRows(3);
    const result = buildPage(rows, 10, 3);
    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
    expect(result.total).toBe(3);
  });

  it("returns exactly limit rows when data equals limit", () => {
    const rows = makeRows(10);
    const result = buildPage(rows, 10, 10);
    expect(result.data).toHaveLength(10);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it("detects hasMore when data has limit+1 rows", () => {
    const rows = makeRows(11); // limit=10, extra 1 = hasMore
    const result = buildPage(rows, 10, 100);
    expect(result.data).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).not.toBeNull();
    expect(result.total).toBe(100);
  });

  it("cursor encodes the cursorKey of the last returned row", () => {
    const rows = makeRows(11);
    const result = buildPage(rows, 10, 100, "id");
    const decoded = decodeCursor(result.cursor!);
    expect(decoded).toEqual({ id: 10 }); // last of the 10 returned rows
  });

  it("uses custom cursorKey", () => {
    const rows: Array<{ id: number; name: string }> = makeRows(6);
    const result = buildPage(rows, 5, 50, "name");
    const decoded = decodeCursor(result.cursor!);
    expect(decoded).toEqual({ name: "row-5" });
  });

  it("total defaults to 0 if undefined", () => {
    const rows = makeRows(3);
    const result = buildPage(rows, 10, undefined);
    expect(result.total).toBe(0);
  });

  it("returns empty data for empty input", () => {
    const result = buildPage([], 10, 0);
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });
});
