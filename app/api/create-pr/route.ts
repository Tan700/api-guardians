import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parsePublicGitHubRepo } from "@/lib/impact-analysis";
import { applyUniquePatch, isSafeSourcePath, sanitizeOneLine } from "@/lib/pull-request";

export const runtime = "nodejs";

const MAX_PATCH_TEXT = 100_000;
const MAX_SOURCE_TEXT = 500_000;
const GITHUB_API = "https://api.github.com";

class RouteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function encodedPath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}
function validateBranch(branch: string): void {
  if (!branch || branch.length > 200 || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.split("/").some((part) => !part || part.startsWith("."))) {
    throw new RouteError("The base branch name is invalid. Rescan the repository and try again.");
  }
}
function validatePatchInputs(body: JsonObject) {
  const required = ["repoUrl", "branch", "filePath", "oldText", "newText", "summary"] as const;
  for (const key of required) {
    if (typeof body[key] !== "string") throw new RouteError(`The ${key} field is required.`);
  }
  const repoUrl = body.repoUrl as string;
  const branch = body.branch as string;
  const filePath = body.filePath as string;
  const oldText = body.oldText as string;
  const newText = body.newText as string;
  const summary = body.summary as string;
  if (repoUrl.length > 1000) throw new RouteError("The repository URL is too long.");
  validateBranch(branch);
  if (!isSafeSourcePath(filePath)) throw new RouteError("For safety, API Guardian only opens PRs for ordinary source files. It will not modify config, workflow, hidden or traversal paths.");
  if (!oldText || !newText || oldText.length > MAX_PATCH_TEXT || newText.length > MAX_PATCH_TEXT) throw new RouteError("The proposed patch is empty or too large.");
  if (summary.length > 800) throw new RouteError("The repair summary is too long.");
  const rationale = typeof body.rationale === "string" ? body.rationale.slice(0, 5000) : "Review the API contract and generated patch before merging.";
  const testPlan = typeof body.testPlan === "string" ? body.testPlan.slice(0, 1500) : "Run the repository's tests and verify the API migration.";
  return { repoUrl, branch, filePath, oldText, newText, summary, rationale, testPlan };
}
async function getSourceFromGitHubApi(owner: string, repo: string, branch: string, path: string): Promise<string> {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(branch)}`;
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "api-guardian-local-mvp"
  });
  // Public repositories work without a token. If a local token is configured, use it
  // to make validation more reliable and reduce anonymous API rate-limit pressure.
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new RouteError("Could not reach GitHub using either the raw-file host or GitHub API. Check your internet connection, VPN/proxy or firewall, then retry.", 502);
  }

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) { try { payload = JSON.parse(raw); } catch { payload = null; } }
  if (!response.ok) {
    if (response.status === 401) throw new RouteError("GitHub rejected GITHUB_TOKEN. Check that the token is valid and has not expired.", 401);
    if (response.status === 403) throw new RouteError("GitHub denied the source-file request. Check the token's repository access or GitHub API rate limit; public unauthenticated requests are rate-limited.", 403);
    if (response.status === 404) throw new RouteError("The selected source file or branch was not found. Confirm the repository, branch and file path, then rescan.", 404);
    throw new RouteError(`GitHub API could not provide the source file (HTTP ${response.status}).`, 502);
  }
  if (!isObject(payload) || payload.type !== "file" || typeof payload.content !== "string" || payload.encoding !== "base64") {
    throw new RouteError("GitHub returned an unsupported file response. Check that the selected path is a normal text file under GitHub's contents API size limit.", 502);
  }
  const source = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (source.length > MAX_SOURCE_TEXT || source.includes("\u0000")) throw new RouteError("The selected source file is too large or is not a text file.", 413);
  return source;
}

async function getRawSource(owner: string, repo: string, branch: string, path: string): Promise<string> {
  const branchPath = branch.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branchPath}/${encodedPath(path)}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch {
    // Some networks block or fail to resolve raw.githubusercontent.com even when
    // api.github.com is reachable. Fall back to the GitHub Contents API.
    return getSourceFromGitHubApi(owner, repo, branch, path);
  }
  if (response.status === 404) throw new RouteError("The selected source file was not found. Rescan the repository and generate a fresh repair.", 404);
  if (!response.ok) {
    // Retry via API for transient CDN errors; preserve a clear 404 above.
    return getSourceFromGitHubApi(owner, repo, branch, path);
  }
  const source = await response.text();
  if (source.length > MAX_SOURCE_TEXT || source.includes("\u0000")) throw new RouteError("The selected source file is too large or is not a text file.", 413);
  return source;
}
async function githubRequest(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2026-03-10");
  headers.set("Content-Type", "application/json");
  headers.set("User-Agent", "api-guardian-local-mvp");
  try {
    response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new RouteError("Could not reach GitHub. Check your internet connection and retry.", 502);
  }
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) { try { payload = JSON.parse(raw); } catch { payload = null; } }
  if (!response.ok) {
    const message = isObject(payload) && typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
    if (response.status === 401) throw new RouteError("GitHub rejected GITHUB_TOKEN. Check that the token is valid and has not expired.", 401);
    if (response.status === 403) throw new RouteError("GitHub denied this operation. Check token permissions, repository access, and API rate limits.", 403);
    if (response.status === 404) throw new RouteError("GitHub could not find the repository, branch or file, or the token cannot access it.", 404);
    if (response.status === 409 || response.status === 422) throw new RouteError(`GitHub could not apply this operation: ${message}. Check for a stale file or an existing pull request.`, response.status);
    throw new RouteError(`GitHub API error (${response.status}): ${message}`, 502);
  }
  return payload;
}
function getRequiredString(value: unknown, key: string, label: string): string {
  if (!isObject(value) || typeof value[key] !== "string" || !(value[key] as string)) throw new RouteError(`GitHub did not return the expected ${label}.`, 502);
  return value[key] as string;
}
function allowedRepositories(): Set<string> {
  return new Set((process.env.GITHUB_ALLOWED_REPOS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export async function POST(request: Request) {
  let createdBranch: { owner: string; repo: string; branch: string; token: string } | null = null;
  try {
    const body: unknown = await request.json();
    if (!isObject(body)) throw new RouteError("Send the repository, selected file, and proposed old/new code blocks.");
    const input = validatePatchInputs(body);
    const { owner, repo } = parsePublicGitHubRepo(input.repoUrl);
    const repoSlug = `${owner}/${repo}`.toLowerCase();
    const dryRun = body.dryRun === true;

    if (dryRun) {
      const source = await getRawSource(owner, repo, input.branch, input.filePath);
      const applied = applyUniquePatch(source, input.oldText, input.newText);
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: "Patch preflight passed. No GitHub content was changed and no tests were executed.",
        validation: {
          repository: `${owner}/${repo}`,
          baseBranch: input.branch,
          filePath: input.filePath,
          exactReplacementCount: applied.replacementCount,
          changedLineCountEstimate: applied.changedLineCount,
          sourceLength: source.length,
          updatedSourceLength: applied.updatedSource.length,
          sourceChanged: applied.updatedSource !== source,
          testPlan: input.testPlan,
          testsExecuted: false
        }
      });
    }

    if (process.env.NODE_ENV === "production") {
      throw new RouteError("Draft PR creation is disabled in production for this student MVP. Use local development only until user authentication and a GitHub App flow are implemented.", 403);
    }
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new RouteError("Set GITHUB_TOKEN in your local .env.local file before creating a pull request. Dry-run validation works without a token.", 400);
    const allowlist = allowedRepositories();
    if (allowlist.size === 0) throw new RouteError("Set GITHUB_ALLOWED_REPOS to an explicit comma-separated allowlist, such as your-username/api-guardian-shipping-test. PR creation stays disabled when no repository is allowlisted.", 400);
    if (!allowlist.has(repoSlug)) throw new RouteError(`Repository ${owner}/${repo} is not in GITHUB_ALLOWED_REPOS. Add the exact owner/repository to .env.local and restart the server if you intend to allow it.`, 403);

    const apiRepo = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const metadata = await githubRequest(apiRepo, token);
    if (isObject(metadata) && metadata.private === true) throw new RouteError("This milestone currently supports public repositories only.", 400);

    const baseRefUrl = `${apiRepo}/git/ref/heads/${encodedPath(input.branch)}`;
    const baseRef = await githubRequest(baseRefUrl, token);
    const baseCommitSha = getRequiredString(isObject(baseRef) ? baseRef.object : null, "sha", "base branch commit SHA");

    const fileUrl = `${apiRepo}/contents/${encodedPath(input.filePath)}?ref=${encodeURIComponent(input.branch)}`;
    const filePayload = await githubRequest(fileUrl, token);
    if (!isObject(filePayload) || filePayload.type !== "file" || typeof filePayload.sha !== "string" || typeof filePayload.content !== "string") {
      throw new RouteError("GitHub did not return a regular text file. Symlinks and non-file objects are not supported.", 400);
    }
    const source = Buffer.from(filePayload.content.replace(/\n/g, ""), "base64").toString("utf8");
    if (source.length > MAX_SOURCE_TEXT || source.includes("\u0000")) throw new RouteError("The selected source file is too large or is not a text file.", 413);
    const applied = applyUniquePatch(source, input.oldText, input.newText);

    const branchName = `api-guardian/fix-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await githubRequest(`${apiRepo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseCommitSha })
    });
    createdBranch = { owner, repo, branch: branchName, token };

    await githubRequest(`${apiRepo}/contents/${encodedPath(input.filePath)}`, token, {
      method: "PUT",
      body: JSON.stringify({
        message: `API Guardian: ${sanitizeOneLine(input.summary, 100)}`,
        content: Buffer.from(applied.updatedSource, "utf8").toString("base64"),
        sha: filePayload.sha,
        branch: branchName
      })
    });

    const testCodeIncluded = typeof body.testCode === "string" && body.testCode.trim().length > 0;
    const prBody = [
      "## API Guardian proposed API migration",
      "",
      `**Summary:** ${sanitizeOneLine(input.summary, 500)}`,
      `**Source file:** \`${input.filePath}\``,
      `**Base branch:** \`${input.branch}\``,
      "",
      "### Rationale",
      input.rationale.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 4000),
      "",
      "### Validation performed by API Guardian",
      `- Confirmed the original code block occurred exactly once in the latest source on \`${input.branch}\`.`,
      "- Applied the patch on a new branch; the base branch was not changed.",
      "- No application tests were executed by API Guardian. Review and run the repository's CI checks before merging.",
      testCodeIncluded ? "- A regression-test proposal was displayed in API Guardian but was not committed because the repository's test framework and import conventions have not been verified." : "- No regression-test code was available; add/execute a test for the changed API contract.",
      "",
      "### Suggested test plan",
      input.testPlan,
      "",
      "### Human review required",
      "Please inspect the diff, run the relevant tests, and verify the new API field has the intended semantics. This pull request was generated for review; it is not approved for automatic merge or deployment.",
      "",
      "---",
      "Generated by API Guardian MVP."
    ].join("\n");

    let prPayload: unknown;
    try {
      prPayload = await githubRequest(`${apiRepo}/pulls`, token, {
        method: "POST",
        body: JSON.stringify({
          title: `API Guardian: ${sanitizeOneLine(input.summary, 120)}`,
          head: branchName,
          base: input.branch,
          body: prBody,
          draft: true
        })
      });
    } catch (error) {
      // Avoid leaving a stray branch if GitHub couldn't open the PR.
      try { await githubRequest(`${apiRepo}/git/refs/heads/${encodedPath(branchName)}`, token, { method: "DELETE" }); } catch { /* best-effort cleanup */ }
      createdBranch = null;
      throw error;
    }
    createdBranch = null;
    return NextResponse.json({
      success: true,
      dryRun: false,
      message: "Draft pull request created. Review its diff and wait for repository CI before merging.",
      branchName,
      pullRequestUrl: getRequiredString(prPayload, "html_url", "pull request URL"),
      validation: {
        repository: `${owner}/${repo}`,
        baseBranch: input.branch,
        filePath: input.filePath,
        exactReplacementCount: applied.replacementCount,
        changedLineCountEstimate: applied.changedLineCount,
        testsExecuted: false,
        regressionTestProposalDisplayed: typeof body.testCode === "string" && body.testCode.trim().length > 0
      }
    });
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not validate the patch or create a GitHub pull request.";
    return NextResponse.json({ error: message, ...(createdBranch ? { branchCreated: createdBranch.branch, note: "A branch was created before the operation failed. Delete it from GitHub if it is no longer needed." } : {}) }, { status });
  }
}
