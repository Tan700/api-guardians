export type RepairMode = "ai" | "rules" | "manual-review";

export type RepairSuggestion = {
  mode: RepairMode;
  filePath: string;
  line: number;
  summary: string;
  rationale: string;
  oldText: string | null;
  newText: string | null;
  testCode: string | null;
  testPlan: string;
  risks: string[];
  note: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Looks for a removed property and newly-added sibling properties at the same
 * structural location in two parsed OpenAPI documents. This is a conservative
 * heuristic; ambiguous renames are deliberately not guessed.
 */
export function inferReplacementField(oldSpec: unknown, newSpec: unknown, oldField: string): string | null {
  const candidates = new Set<string>();

  function walk(oldValue: unknown, newValue: unknown, depth: number): void {
    if (depth > 28) return;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      for (let index = 0; index < Math.min(oldValue.length, newValue.length); index += 1) {
        walk(oldValue[index], newValue[index], depth + 1);
      }
      return;
    }
    if (!isObject(oldValue) || !isObject(newValue)) return;

    const oldProps = isObject(oldValue.properties) ? oldValue.properties : null;
    const newProps = isObject(newValue.properties) ? newValue.properties : null;
    if (oldProps && newProps && oldField in oldProps && !(oldField in newProps)) {
      const added = Object.keys(newProps).filter((key) => !(key in oldProps));
      for (const key of added) candidates.add(key);
    }

    if (oldProps && newProps) walk(oldProps, newProps, depth + 1);
    for (const key of Object.keys(oldValue)) {
      if (key === "properties" || !(key in newValue)) continue;
      walk(oldValue[key], newValue[key], depth + 1);
    }
  }

  walk(oldSpec, newSpec, 0);
  if (candidates.size === 1) return [...candidates][0];
  if (candidates.size === 0) return null;

  const words = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const oldWords = new Set(words(oldField));
  const ranked = [...candidates].map((candidate) => ({
    candidate,
    score: words(candidate).filter((word) => oldWords.has(word)).length
  })).sort((a, b) => b.score - a.score);
  // Only use naming similarity to break a tie when exactly one candidate shares
  // at least one meaningful token with the removed field.
  return ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score ?? 0) ? ranked[0].candidate : null;
}

export function replaceIdentifierOnLine(source: string, lineNumber: number, oldIdentifier: string, newIdentifier: string): { oldText: string; newText: string } | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(oldIdentifier) || !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(newIdentifier)) return null;
  const lines = source.split(/\r?\n/);
  if (lineNumber > lines.length) return null;
  const oldText = lines[lineNumber - 1];
  const expression = new RegExp(`\\b${oldIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  if (!expression.test(oldText)) return null;
  expression.lastIndex = 0;
  const newText = oldText.replace(expression, newIdentifier);
  return newText === oldText ? null : { oldText, newText };
}

export function replaceIdentifierAtAllRelatedLines(source: string, selectedLine: number, oldIdentifier: string, newIdentifier: string): { oldText: string; newText: string } | null {
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(oldIdentifier) || !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(newIdentifier)) return null;
  const lines = source.split(/\r?\n/);
  if (!Number.isInteger(selectedLine) || selectedLine < 1 || selectedLine > lines.length) return null;
  const expression = new RegExp(`\\b${oldIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!expression.test(lines[selectedLine - 1])) return null;
  const allMatchingLines = lines.map((line, index) => expression.test(line) ? index : -1).filter((index) => index >= 0);
  if (allMatchingLines.length === 0 || allMatchingLines.length > 20) return null;
  const first = allMatchingLines[0];
  const last = allMatchingLines[allMatchingLines.length - 1];
  // Keep patches readable and avoid broad edits if the same token appears throughout a file.
  if (last - first > 80) return null;
  const oldText = lines.slice(first, last + 1).join("\n");
  const replaceAll = new RegExp(`\\b${oldIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const newText = oldText.replace(replaceAll, newIdentifier);
  return newText === oldText ? null : { oldText, newText };
}

export function createDemoRegressionTest(args: {
  source: string;
  filePath: string;
  oldField: string;
  newField: string;
}): { testCode: string | null; testPlan: string } {
  const functionMatch = args.source.match(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/)
    ?? args.source.match(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
  const mappedOutput = args.source.match(new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*[A-Za-z_$][\\w$]*\\s*\\.\\s*${args.oldField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`))?.[1];
  const plan = `Mock the API response with the new field "${args.newField}" and verify the client still returns the expected value. Also assert the client no longer reads "${args.oldField}".`;
  if (!functionMatch || !mappedOutput) return { testCode: null, testPlan: plan };

  const functionName = functionMatch[1];
  const params = functionMatch[2].split(",").map((part) => part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1]).filter((part): part is string => Boolean(part));
  if (params.length === 0 || params.length > 4) return { testCode: null, testPlan: plan };
  const argsForCall = params.map((param, index) => /url|base/i.test(param) ? '"https://api.example.test"' : /id/i.test(param) ? '"S102"' : `"test-${index + 1}"`).join(", ");
  const fileBase = args.filePath.split("/").pop()?.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "") ?? "client";
  const expectedOutput = mappedOutput === "id" ? 'id: "S102"' : `${mappedOutput}: "2026-10-15"`;
  const testCode = `import { afterEach, describe, expect, it, vi } from "vitest";\nimport { ${functionName} } from "./${fileBase}";\n\nafterEach(() => {\n  vi.unstubAllGlobals();\n});\n\ndescribe("${functionName} API field migration", () => {\n  it("reads the new ${args.newField} response field", async () => {\n    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({\n      ok: true,\n      status: 200,\n      json: async () => ({\n        shipment_id: "S102",\n        status: "in_transit",\n        ${args.newField}: "2026-10-15"\n      })\n    }));\n\n    await expect(${functionName}(${argsForCall})).resolves.toMatchObject({\n      ${expectedOutput}\n    });\n  });\n});\n`;
  return { testCode, testPlan: plan };
}

export function countExactOccurrences(source: string, snippet: string): number {
  if (!snippet) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = source.indexOf(snippet, from);
    if (index < 0) return count;
    count += 1;
    from = index + snippet.length;
  }
}
