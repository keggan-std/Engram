// ============================================================================
// Unit Tests — normalizePath()
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizePath } from "../../src/utils.js";

describe("normalizePath", () => {
  it("should replace backslashes with forward slashes", () => {
    expect(normalizePath("src\\tools\\sessions.ts")).toBe("src/tools/sessions.ts");
  });

  it("should strip leading ./", () => {
    expect(normalizePath("./src/utils.ts")).toBe("src/utils.ts");
  });

  it("should collapse consecutive slashes", () => {
    expect(normalizePath("src//tools///sessions.ts")).toBe("src/tools/sessions.ts");
  });

  it("should strip trailing slash", () => {
    expect(normalizePath("src/tools/")).toBe("src/tools");
  });

  it("should handle mixed backslashes and forward slashes", () => {
    expect(normalizePath("src\\tools/intelligence.ts")).toBe("src/tools/intelligence.ts");
  });

  it("should handle Windows absolute path with projectRoot", () => {
    // path.relative handles cross-platform, but we re-slash after
    const result = normalizePath("C:\\Users\\dev\\project\\src\\index.ts", "C:\\Users\\dev\\project");
    expect(result).toBe("src/index.ts");
  });

  it("should handle Unix absolute path with projectRoot", () => {
    const result = normalizePath("/home/dev/project/src/index.ts", "/home/dev/project");
    expect(result).toBe("src/index.ts");
  });

  it("should return relative path unchanged if already relative", () => {
    expect(normalizePath("src/index.ts")).toBe("src/index.ts");
  });

  it("should handle just a filename", () => {
    expect(normalizePath("package.json")).toBe("package.json");
  });

  it("should handle empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  it("should handle leading ./ with backslashes", () => {
    expect(normalizePath(".\\src\\utils.ts")).toBe("src/utils.ts");
  });

  it("should normalize complex mixed path", () => {
    expect(normalizePath(".\\src//tools\\\\sessions.ts/")).toBe("src/tools/sessions.ts");
  });

  it("should not alter paths with no issues", () => {
    expect(normalizePath("src/repositories/index.ts")).toBe("src/repositories/index.ts");
  });
});
