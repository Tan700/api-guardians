import type { Finding, Severity } from "@/lib/compare-openapi";

export type PublicGitHubRepo = { owner: string; repo: string };
export type ImpactTermKind = "route" | "field" | "parameter";
export type ImpactTerm = {
  findingId: string;
  findingTitle: string;
  severity: Severity;
  category: Finding["category"];
  kind: ImpactTermKind;
  value: string;
};
export type ImpactMatch = {
  path: string;
  line: number;
  snippet: string;
  findingId: string;
  findingTitle: string;
  severity: Severity;
  category: Finding["category"];
  matchedTerm: string;
  matchKind: ImpactTermKind;
};

/** Accept only canonical public github.com repository URLs or owner/repo slugs. */
export function parsePublicGitHubRepo(input: string): PublicGitHubRepo {
  const value = input.trim();
  let owner = "";
  let repo = "";

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    [owner, repo] = value.split("/");
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Enter a public GitHub repository URL, such as https://github.com/owner/repo, or owner/repo.");
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search || url.hash) {
      throw new Error("For this MVP, use a public repository hosted on https://github.com only.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) {
      throw new Error("Enter a repository URL in the format https://github.com/owner/repo.");
    }
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, "");
  }

  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("The repository owner or name is invalid.");
  }
  return { owner, repo };
}

function addTerm(terms: ImpactTerm[], seen: Set<string>, term: ImpactTerm) {
  const value = term.value.trim();
  if (value.length < 3 || value.length > 100) return;
  const key = term.kind === "route" ? `route:${value.toLowerCase()}` : `${term.findingId}:${term.kind}:${value.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  terms.push({ ...term, value });
}

/** Create conservative textual search terms from risky findings. This is a heuristic, not AST/data-flow analysis. */
export function buildImpactTerms(findings: Finding[]): ImpactTerm[] {
  const terms: ImpactTerm[] = [];
  const seen = new Set<string>();
  const risky = findings.filter((finding) => finding.severity === "breaking" || finding.severity === "warning");

  for (const finding of risky) {
    const base = {
      findingId: finding.id,
      findingTitle: finding.title,
      severity: finding.severity,
      category: finding.category
    } as const;

    // Only endpoint-level findings should create route search terms. A schema/field
    // finding includes its endpoint in the location for context, but searching that
    // route again creates noisy matches on every call to the same endpoint.
    const routeMatch = finding.category === "endpoint"
      ? finding.location.match(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE)\s+(\/[^\s·.]+)/i)
      : null;
    if (routeMatch) {
      const path = routeMatch[2].replace(/[),;]+$/, "");
      // Replace OpenAPI path parameters with nothing; match only the stable route portion.
      const staticPrefix = path.split("{")[0].replace(/\/+$/, "");
      const marker = staticPrefix || path.split("/").filter((part) => part && !part.startsWith("{")).slice(0, 1).join("/");
      if (marker && marker !== "/") addTerm(terms, seen, { ...base, kind: "route", value: marker });
      const firstStaticSegment = path.split("/").find((part) => part && !part.startsWith("{"));
      if (firstStaticSegment && marker !== `/${firstStaticSegment}`) {
        addTerm(terms, seen, { ...base, kind: "route", value: `/${firstStaticSegment}` });
      }
    }

    const parameterMatch = finding.location.match(/(?:^|[·\s])(query|path|header|cookie):([A-Za-z_][\w-]*)/i);
    if (parameterMatch) {
      addTerm(terms, seen, { ...base, kind: "parameter", value: parameterMatch[2] });
    }

    // Schema property names are stored at the end of a finding location (e.g. GET /shipments · response 200.delivery_date).
    if (finding.category === "schema" || finding.category === "request" || finding.category === "response") {
      const propertyMatch = finding.location.match(/\.([A-Za-z_][A-Za-z0-9_-]*)$/);
      if (propertyMatch && !/^\d+$/.test(propertyMatch[1])) {
        addTerm(terms, seen, { ...base, kind: "field", value: propertyMatch[1] });
      }
    }
    const quotedField = finding.message.match(/(?:field|parameter)\s+['"]([A-Za-z_][A-Za-z0-9_-]*)['"]/i);
    if (quotedField) {
      addTerm(terms, seen, { ...base, kind: finding.category === "parameter" ? "parameter" : "field", value: quotedField[1] });
    }
  }
  return terms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lineHasTerm(line: string, term: ImpactTerm): boolean {
  if (term.kind === "route") return line.toLowerCase().includes(term.value.toLowerCase());
  const expression = new RegExp(`\\b${escapeRegExp(term.value)}\\b`, "i");
  return expression.test(line);
}

export function findImpactedLines(path: string, content: string, terms: ImpactTerm[]): ImpactMatch[] {
  const results: ImpactMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const matchingTerms = terms.filter((term) => lineHasTerm(line, term));
    for (const term of matchingTerms) {
      results.push({
        path,
        line: index + 1,
        snippet: line.trim().slice(0, 260),
        findingId: term.findingId,
        findingTitle: term.findingTitle,
        severity: term.severity,
        category: term.category,
        matchedTerm: term.value,
        matchKind: term.kind
      });
    }
  }
  return results;
}
