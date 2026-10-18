import { NextResponse } from "next/server";
import { parseDocument } from "yaml";
import { compareOpenApi, type Finding } from "@/lib/compare-openapi";
import { buildImpactTerms, findImpactedLines, parsePublicGitHubRepo, type ImpactMatch } from "@/lib/impact-analysis";

export const runtime = "nodejs";
const MAX_SPEC_CHARS = 500_000;
const MAX_SCAN_FILES = 45;
const MAX_FILE_BYTES = 180_000;
const MAX_MATCHES = 100;
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|php|rb|cs|swift|kt|rs|vue|svelte|dart)$/i;
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "coverage", "generated", "target", "bin", "obj"]);
const EXCLUDED_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|composer\.lock|poetry\.lock|uv\.lock)$/i;
type JsonObject = Record<string, unknown>;
class RouteError extends Error { constructor(message: string, public status: number = 400) { super(message); } }
function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }

function parseSpecText(text: string, label: string): unknown {
  let document;
  try { document = parseDocument(text, { uniqueKeys: true, prettyErrors: false }); }
  catch { throw new RouteError(`${label} is not valid JSON or YAML. Check the syntax and try again.`); }
  if (document.errors.length > 0) throw new RouteError(`${label} is not valid JSON or YAML: ${document.errors[0].message}`);
  let parsed: unknown;
  try { parsed = document.toJS(); }
  catch { throw new RouteError(`${label} could not be converted into a specification object.`); }
  if (!isObject(parsed) || !isObject(parsed.paths) || (typeof parsed.openapi !== "string" && typeof parsed.swagger !== "string")) {
    throw new RouteError(`${label} must be an OpenAPI/Swagger JSON or YAML document with a version field and a 'paths' object.`);
  }
  return parsed;
}

async function githubJson(url: string): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "api-guardian-public-repo-impact-scanner" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new RouteError("Could not reach GitHub. Check your internet connection and retry.", 502);
  }
  if (response.status === 404) throw new RouteError("Repository or branch not found. Check the URL and confirm the repository is public.", 404);
  if (response.status === 403 || response.status === 429) throw new RouteError("GitHub API rate limit or access restriction reached. Wait a little and retry, or connect an authenticated GitHub App in a later milestone.", 429);
  if (!response.ok) throw new RouteError(`GitHub returned HTTP ${response.status}. Try again later.`, 502);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new RouteError("GitHub returned an unreadable response.", 502); }
  if (!isObject(payload)) throw new RouteError("GitHub returned an unexpected response shape.", 502);
  return payload;
}

function shouldScanFile(path: string, size: unknown): boolean {
  if (!SOURCE_EXTENSIONS.test(path) || EXCLUDED_FILES.test(path)) return false;
  if (path.split("/").some((part) => EXCLUDED_SEGMENTS.has(part.toLowerCase()))) return false;
  if (typeof size === "number" && size > MAX_FILE_BYTES) return false;
  return true;
}

async function scanRawFile(url: string, path: string, terms: ReturnType<typeof buildImpactTerms>): Promise<ImpactMatch[]> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
  catch { return []; }
  if (!response.ok) return [];
  const text = await response.text();
  if (text.length > MAX_FILE_BYTES || text.includes("\u0000")) return [];
  return findImpactedLines(path, text, terms);
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isObject(body)) throw new RouteError("Send repoUrl, oldSpecText and newSpecText.");
    if (typeof body.repoUrl !== "string" || typeof body.oldSpecText !== "string" || typeof body.newSpecText !== "string") {
      throw new RouteError("repoUrl, oldSpecText and newSpecText must all be text strings.");
    }
    if (!body.oldSpecText.trim() || !body.newSpecText.trim()) throw new RouteError("Run the API comparison with both specifications before scanning a repository.");
    if (body.oldSpecText.length > MAX_SPEC_CHARS || body.newSpecText.length > MAX_SPEC_CHARS) throw new RouteError("Each specification must be smaller than 500,000 characters.", 413);

    const { owner, repo } = parsePublicGitHubRepo(body.repoUrl);
    const oldSpec = parseSpecText(body.oldSpecText, "Old specification");
    const newSpec = parseSpecText(body.newSpecText, "New specification");
    const comparison = compareOpenApi(oldSpec, newSpec);
    const terms = buildImpactTerms(comparison.findings as Finding[]);
    if (terms.length === 0) {
      return NextResponse.json({
        owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}`, branch: null,
        scannedFiles: 0, candidateFiles: 0, truncated: false, skippedLargeFiles: 0,
        matchCount: 0, matches: [],
        note: "No matching terms could be derived from breaking or warning findings. Compare versions with at least one breaking change or warning, then scan again."
      });
    }

    const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const metadata = await githubJson(baseUrl);
    if (metadata.private === true) throw new RouteError("This milestone scans public GitHub repositories only. Private repository support requires GitHub App authentication.", 400);
    const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";
    const commit = await githubJson(`${baseUrl}/commits/${encodeURIComponent(defaultBranch)}`);
    const commitSha = typeof commit.sha === "string" ? commit.sha : "";
    const treeSha = isObject(commit.commit) && isObject(commit.commit.tree) && typeof commit.commit.tree.sha === "string" ? commit.commit.tree.sha : "";
    if (!commitSha || !treeSha) throw new RouteError("Could not resolve the repository's default branch to a commit.", 502);
    const treePayload = await githubJson(`${baseUrl}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
    const rawTree = Array.isArray(treePayload.tree) ? treePayload.tree : [];
    const entries = rawTree.filter((entry): entry is JsonObject => isObject(entry) && entry.type === "blob" && typeof entry.path === "string");
    const candidates = entries.filter((entry) => shouldScanFile(String(entry.path), entry.size));
    const selected = candidates.slice(0, MAX_SCAN_FILES);
    const skippedLargeFiles = entries.filter((entry) => SOURCE_EXTENSIONS.test(String(entry.path)) && typeof entry.size === "number" && entry.size > MAX_FILE_BYTES).length;
    let cursor = 0;
    let scannedFiles = 0;
    const allMatches: ImpactMatch[] = [];
    const workerCount = Math.min(5, selected.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= selected.length) return;
        const entry = selected[index];
        const path = String(entry.path);
        const rawPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}/${rawPath}`;
        const found = await scanRawFile(rawUrl, path, terms);
        scannedFiles += 1;
        allMatches.push(...found);
      }
    }));

    const severityOrder = { breaking: 0, warning: 1, info: 2 };
    allMatches.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
    const limitedMatches = allMatches.slice(0, MAX_MATCHES);
    return NextResponse.json({
      owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}`, branch: defaultBranch,
      scannedFiles, candidateFiles: candidates.length, truncated: treePayload.truncated === true || candidates.length > MAX_SCAN_FILES || allMatches.length > MAX_MATCHES,
      skippedLargeFiles, matchCount: allMatches.length, matches: limitedMatches,
      note: "These are textual indicators, not proof of a dependency or data-flow relationship. No source files were changed. Review each match before deciding whether code is affected."
    });
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Repository analysis failed unexpectedly.";
    return NextResponse.json({ error: message }, { status });
  }
}
