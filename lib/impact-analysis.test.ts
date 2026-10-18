import { describe, expect, it } from "vitest";
import type { Finding } from "./compare-openapi";
import { buildImpactTerms, findImpactedLines, parsePublicGitHubRepo } from "./impact-analysis";

const finding: Finding = {
  id: "finding-1",
  severity: "breaking",
  category: "schema",
  title: "Response field removed",
  location: "GET /shipments · response 200.estimated_delivery",
  message: "The response no longer describes 'estimated_delivery'. Client code that reads this field may break.",
  recommendation: "Update clients."
};

describe("parsePublicGitHubRepo", () => {
  it("parses a normal public repository URL", () => {
    expect(parsePublicGitHubRepo("https://github.com/octocat/Hello-World")).toEqual({ owner: "octocat", repo: "Hello-World" });
  });
  it("accepts owner/repo and strips .git", () => {
    expect(parsePublicGitHubRepo("octocat/Hello-World")).toEqual({ owner: "octocat", repo: "Hello-World" });
    expect(parsePublicGitHubRepo("https://github.com/octocat/Hello-World.git/")).toEqual({ owner: "octocat", repo: "Hello-World" });
  });
  it("rejects non-GitHub hosts", () => {
    expect(() => parsePublicGitHubRepo("https://example.com/a/b")).toThrow("github.com only");
  });
  it("rejects URLs with additional paths", () => {
    expect(() => parsePublicGitHubRepo("https://github.com/a/b/tree/main")).toThrow("format");
  });
});

describe("repository impact text analysis", () => {
  it("builds changed-field terms without adding noisy route terms from schema findings", () => {
    const terms = buildImpactTerms([finding, { ...finding, id: "info-1", severity: "info" }]);
    expect(terms.some((term) => term.kind === "route" && term.value === "/shipments")).toBe(false);
    expect(terms.some((term) => term.kind === "field" && term.value === "estimated_delivery")).toBe(true);
    expect(terms.every((term) => term.findingId !== "info-1")).toBe(true);
  });
  it("does not mistake an appended request field name for part of the URL path", () => {
    const requiredField: Finding = {
      id: "finding-request", severity: "breaking", category: "schema", title: "New required request field",
      location: "POST /shipments.carrier_code", message: "The request now requires 'carrier_code'. Older clients may fail.", recommendation: "Update callers."
    };
    const terms = buildImpactTerms([requiredField]);
    // This is a schema finding, so it should not create a route term.
    expect(terms.some((term) => term.kind === "route")).toBe(false);
    expect(terms.some((term) => term.kind === "field" && term.value === "carrier_code")).toBe(true);
    expect(terms.some((term) => term.value === "/shipments.carrier_code")).toBe(false);
  });
  it("returns matching source lines with line numbers and evidence snippets", () => {
    const terms = buildImpactTerms([finding]);
    const matches = findImpactedLines("src/shipment.ts", "const status = 'ok';\nconst eta = shipment.estimated_delivery;\nfetch('/shipments/' + id);", terms);
    expect(matches.some((match) => match.line === 2 && match.matchedTerm === "estimated_delivery")).toBe(true);
    // Schema/field findings should not create route matches; that caused noisy false positives.
    expect(matches.some((match) => match.line === 3 && match.matchKind === "route")).toBe(false);
  });
  it("ignores harmless nearby words that only contain the field name", () => {
    const terms = buildImpactTerms([finding]);
    const matches = findImpactedLines("src/test.ts", "const estimated_delivery_date = 'x';", terms);
    expect(matches).toHaveLength(0);
  });
});
