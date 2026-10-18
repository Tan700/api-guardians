import { describe, expect, it } from "vitest";
import { applyUniquePatch, isSafeSourcePath, sanitizeOneLine } from "./pull-request";

describe("applyUniquePatch", () => {
  it("replaces a unique source block", () => {
    const result = applyUniquePatch("const eta = data.old_field;\n", "data.old_field", "data.new_field");
    expect(result.updatedSource).toBe("const eta = data.new_field;\n");
    expect(result.replacementCount).toBe(1);
  });

  it("preserves CRLF line endings when replacing a multiline block", () => {
    const source = "type Tracking = {\r\n  old_field: string;\r\n};\r\n";
    const result = applyUniquePatch(source, "old_field: string;\n", "new_field: string;\n");
    expect(result.updatedSource).toBe("type Tracking = {\r\n  new_field: string;\r\n};\r\n");
  });

  it("refuses an ambiguous repeated block", () => {
    expect(() => applyUniquePatch("x.old;\nx.old;\n", "x.old", "x.new")).toThrow(/more than once/i);
  });

  it("refuses a stale preview", () => {
    expect(() => applyUniquePatch("const value = 1;", "oldValue", "newValue")).toThrow(/source has changed/i);
  });

  it("refuses empty and no-op patches", () => {
    expect(() => applyUniquePatch("const x = 1;", "", "next")).toThrow(/empty/i);
    expect(() => applyUniquePatch("const x = 1;", "const x = 1;", "const x = 1;")).toThrow(/does not change/i);
  });
});

describe("isSafeSourcePath", () => {
  it("allows ordinary source files", () => {
    expect(isSafeSourcePath("src/shipment.ts")).toBe(true);
  });
  it("blocks traversal and configuration paths", () => {
    expect(isSafeSourcePath("../.env")).toBe(false);
    expect(isSafeSourcePath(".github/workflows/deploy.ts")).toBe(false);
    expect(isSafeSourcePath("src/../../secrets.ts")).toBe(false);
    expect(isSafeSourcePath("package.json")).toBe(false);
  });
});

describe("sanitizeOneLine", () => {
  it("removes line breaks from PR titles", () => {
    expect(sanitizeOneLine("Fix delivery\nfield", 100)).toBe("Fix delivery field");
  });
});
