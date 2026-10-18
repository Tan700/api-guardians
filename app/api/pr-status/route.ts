import { NextResponse } from "next/server";
import { parsePublicGitHubRepo } from "@/lib/impact-analysis";
import { summarizeCheckRuns } from "@/lib/ci-status";

export const runtime = "nodejs";

class RouteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Obj = Record<string, unknown>;
function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function allowedRepositories(): Set<string> {
  return new Set((process.env.GITHUB_ALLOWED_REPOS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}
function parsePullRequestUrl(value: string): { owner: string; repo: string; number: number } {
  let url: URL;
  try { url = new URL(value); } catch { throw new RouteError("Enter the full GitHub pull request URL."); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search || url.hash) {
    throw new RouteError("Use a canonical https://github.com/owner/repo/pull/123 URL.");
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (!match) throw new RouteError("The pull request URL must look like https://github.com/owner/repo/pull/123.");
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) throw new RouteError("The pull request number is invalid.");
  return { owner: match[1], repo: match[2], number };
}
async function githubGet(url: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "api-guardian-local-mvp"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new RouteError("Could not reach GitHub. Check your internet connection and retry.", 502);
  }
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) { try { payload = JSON.parse(raw); } catch { payload = null; } }
  if (!response.ok) {
    if (response.status === 401) throw new RouteError("GitHub rejected GITHUB_TOKEN. Check whether it is valid and has not expired.", 401);
    if (response.status === 403) throw new RouteError("GitHub denied the Actions workflow-runs request. Add Actions: read to your fine-grained token, confirm repository access, and check the API rate limit.", 403);
    if (response.status === 404) throw new RouteError("GitHub could not find this pull request, or the token cannot access it.", 404);
    throw new RouteError(`GitHub returned HTTP ${response.status} while reading CI status.`, 502);
  }
  return payload;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isObject(body) || typeof body.repoUrl !== "string" || typeof body.pullRequestUrl !== "string") {
      throw new RouteError("Provide the repository URL and full pull request URL.");
    }
    if (body.repoUrl.length > 1000 || body.pullRequestUrl.length > 1000) throw new RouteError("The supplied URL is too long.");
    const { owner, repo } = parsePublicGitHubRepo(body.repoUrl);
    const pr = parsePullRequestUrl(body.pullRequestUrl);
    if (owner.toLowerCase() !== pr.owner.toLowerCase() || repo.toLowerCase() !== pr.repo.toLowerCase()) {
      throw new RouteError("The pull request belongs to a different repository than the one you scanned.");
    }
    const slug = `${owner}/${repo}`.toLowerCase();
    const allowlist = allowedRepositories();
    if (!allowlist.has(slug)) throw new RouteError(`Repository ${owner}/${repo} is not in GITHUB_ALLOWED_REPOS.`, 403);
    const token = process.env.GITHUB_TOKEN?.trim();
    if (!token) throw new RouteError("Set GITHUB_TOKEN in your local .env.local file to read private/repository CI details.", 400);

    const apiRepo = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const prPayload = await githubGet(`${apiRepo}/pulls/${pr.number}`, token);
    if (!isObject(prPayload) || !isObject(prPayload.head) || typeof prPayload.head.sha !== "string") {
      throw new RouteError("GitHub did not return the pull request head commit.", 502);
    }
    const sha = prPayload.head.sha;
    const runsPayload = await githubGet(`${apiRepo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`, token);
    if (!isObject(runsPayload) || !Array.isArray(runsPayload.workflow_runs)) {
      throw new RouteError("GitHub returned an unexpected Actions workflow-runs response.", 502);
    }
    const checks = runsPayload.workflow_runs.filter(isObject).map((check) => ({
      name: typeof check.name === "string" ? check.name : "Unnamed check",
      status: typeof check.status === "string" ? check.status : "unknown",
      conclusion: typeof check.conclusion === "string" ? check.conclusion : null,
      detailsUrl: typeof check.html_url === "string" ? check.html_url : null
    }));

    const { status, message } = summarizeCheckRuns(checks);
    return NextResponse.json({
      success: true,
      repository: slug,
      pullRequestUrl: typeof prPayload.html_url === "string" ? prPayload.html_url : body.pullRequestUrl,
      number: pr.number,
      draft: prPayload.draft === true,
      headSha: sha,
      status,
      message,
      checks,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not read pull request CI status.";
    return NextResponse.json({ error: message }, { status });
  }
}
