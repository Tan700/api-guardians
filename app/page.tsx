"use client";

import { ChangeEvent, useMemo, useState } from "react";
import oldExample from "@/examples/shipping-v1.json";
import newExample from "@/examples/shipping-v2.json";
import type { CompareResult, Finding, Severity } from "@/lib/compare-openapi";

type ApiResponse = CompareResult | { error: string };
type RepoImpactMatch = {
  path: string;
  line: number;
  snippet: string;
  findingId: string;
  findingTitle: string;
  severity: Severity;
  category: string;
  matchedTerm: string;
  matchKind: "route" | "field" | "parameter";
};
type RepoScanResult = {
  owner: string;
  repo: string;
  repositoryUrl: string;
  branch: string | null;
  scannedFiles: number;
  candidateFiles: number;
  truncated: boolean;
  skippedLargeFiles: number;
  matchCount: number;
  matches: RepoImpactMatch[];
  note: string;
};
type RepoApiResponse = RepoScanResult | { error: string };
type RepairSuggestion = {
  mode: "ai" | "rules" | "manual-review";
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
type RepairApiResponse = RepairSuggestion | { error: string };
type PRValidation = {
  repository: string;
  baseBranch: string;
  filePath: string;
  exactReplacementCount: number;
  changedLineCountEstimate: number;
  sourceLength?: number;
  updatedSourceLength?: number;
  sourceChanged?: boolean;
  testsExecuted: boolean;
  testPlan?: string;
  regressionTestProposalDisplayed?: boolean;
};
type PRCheck = { name: string; status: string; conclusion: string | null; detailsUrl: string | null };
type PRStatusData = {
  success: true;
  repository: string;
  pullRequestUrl: string;
  number: number;
  draft: boolean;
  headSha: string;
  status: "no_checks" | "pending" | "failure" | "success";
  message: string;
  checks: PRCheck[];
  checkedAt: string;
};
type PRStatusResponse = PRStatusData | { error: string };
type PRActionResponse = {
  success: true;
  dryRun: boolean;
  message: string;
  validation: PRValidation;
  pullRequestUrl?: string;
  branchName?: string;
} | { error: string; branchCreated?: string; note?: string };
const METHODS_HELP = "Compares JSON or YAML OpenAPI/Swagger specifications. The MVP covers common endpoints, parameters, request/response fields and basic schema references; advanced OpenAPI features may need manual review.";

function isErrorResponse(value: ApiResponse): value is { error: string } {
  return "error" in value;
}
function isRepoError(value: RepoApiResponse): value is { error: string } {
  return "error" in value;
}
function isRepairError(value: RepairApiResponse): value is { error: string } {
  return "error" in value;
}
function prettyVersion(version: string): string {
  return version === "unknown" ? "version not set" : `v${version}`;
}

export default function Home() {
  const [oldText, setOldText] = useState(JSON.stringify(oldExample, null, 2));
  const [newText, setNewText] = useState(JSON.stringify(newExample, null, 2));
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [search, setSearch] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoScanning, setRepoScanning] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [repoReport, setRepoReport] = useState<RepoScanResult | null>(null);
  const [repairingKey, setRepairingKey] = useState("");
  const [repairError, setRepairError] = useState("");
  const [repairSuggestion, setRepairSuggestion] = useState<RepairSuggestion | null>(null);
  const [prConfirmed, setPrConfirmed] = useState(false);
  const [prWorking, setPrWorking] = useState<"dry-run" | "create" | "">("");
  const [prError, setPrError] = useState("");
  const [prResult, setPrResult] = useState<PRActionResponse | null>(null);
  const [prStatusLoading, setPrStatusLoading] = useState(false);
  const [prStatusError, setPrStatusError] = useState("");
  const [prStatus, setPrStatus] = useState<PRStatusData | null>(null);

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    const query = search.trim().toLowerCase();
    return result.findings.filter((finding) => {
      const matchesSeverity = filter === "all" || finding.severity === filter;
      const searchable = `${finding.title} ${finding.location} ${finding.message} ${finding.recommendation}`.toLowerCase();
      return matchesSeverity && (!query || searchable.includes(query));
    });
  }, [result, filter, search]);

  async function compare() {
    setLoading(true);
    setError("");
    setResult(null);
    setRepoReport(null);
    setRepoError("");
    setRepairError("");
    setRepairSuggestion(null);
    setPrConfirmed(false);
    setPrError("");
    setPrResult(null);
    setPrStatus(null);
    setPrStatusError("");
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldSpecText: oldText, newSpecText: newText })
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok || isErrorResponse(payload)) {
        setError(isErrorResponse(payload) ? payload.error : "Unable to compare specifications.");
        return;
      }
      setResult(payload);
      setRepoReport(null);
      setRepoError("");
      setFilter("all");
      setSearch("");
    } catch {
      setError("Could not reach the comparison API. Check that the development server is running and try again.");
    } finally {
      setLoading(false);
    }
  }


  async function generateRepair(match: RepoImpactMatch) {
    if (!repoReport?.branch) {
      setRepairError("Scan the repository again so API Guardian can identify its default branch.");
      return;
    }
    const key = `${match.path}:${match.line}:${match.findingId}`;
    setRepairingKey(key);
    setRepairError("");
    setRepairSuggestion(null);
    setPrConfirmed(false);
    setPrError("");
    setPrResult(null);
    setPrStatus(null);
    setPrStatusError("");
    try {
      const response = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl,
          branch: repoReport.branch,
          match,
          oldSpecText: oldText,
          newSpecText: newText
        })
      });
      const payload = (await response.json()) as RepairApiResponse;
      if (!response.ok || isRepairError(payload)) {
        setRepairError(isRepairError(payload) ? payload.error : "Could not prepare a repair suggestion. Try again.");
        return;
      }
      setRepairSuggestion(payload);
    } catch {
      setRepairError("Could not reach the repair endpoint. Check that the development server is running.");
    } finally {
      setRepairingKey("");
    }
  }

  async function runPullRequestAction(dryRun: boolean) {
    if (!repoReport?.branch || !repairSuggestion || repairSuggestion.oldText === null || repairSuggestion.newText === null) {
      setPrError("Generate a concrete repair preview and scan the repository first.");
      return;
    }
    if (!dryRun && !prConfirmed) {
      setPrError("Review the proposed change and confirm before creating a draft pull request.");
      return;
    }
    setPrWorking(dryRun ? "dry-run" : "create");
    setPrError("");
    setPrResult(null);
    setPrStatus(null);
    setPrStatusError("");
    try {
      const response = await fetch("/api/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          repoUrl,
          branch: repoReport.branch,
          filePath: repairSuggestion.filePath,
          oldText: repairSuggestion.oldText,
          newText: repairSuggestion.newText,
          summary: repairSuggestion.summary,
          rationale: repairSuggestion.rationale,
          testPlan: repairSuggestion.testPlan,
          testCode: repairSuggestion.testCode
        })
      });
      const payload = (await response.json()) as PRActionResponse;
      if (!response.ok || "error" in payload) {
        setPrError("error" in payload ? `${payload.error}${payload.branchCreated ? ` Branch created: ${payload.branchCreated}. ${payload.note ?? ""}` : ""}` : "The GitHub action failed. Try again.");
        return;
      }
      setPrResult(payload);
    } catch {
      setPrError("Could not reach the patch-validation endpoint. Check that the development server is running.");
    } finally {
      setPrWorking("");
    }
  }

  async function checkPullRequestStatus() {
    if (!prResult || !("success" in prResult) || prResult.dryRun || !prResult.pullRequestUrl) {
      setPrStatusError("Create a draft pull request first, then check its CI status.");
      return;
    }
    setPrStatusLoading(true);
    setPrStatusError("");
    setPrStatus(null);
    try {
      const response = await fetch("/api/pr-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, pullRequestUrl: prResult.pullRequestUrl })
      });
      const payload = (await response.json()) as PRStatusResponse;
      if (!response.ok || "error" in payload) {
        setPrStatusError("error" in payload ? payload.error : "Could not retrieve CI status.");
        return;
      }
      setPrStatus(payload);
    } catch {
      setPrStatusError("Could not reach the CI status endpoint. Check that the development server is running.");
    } finally {
      setPrStatusLoading(false);
    }
  }

  async function scanRepository() {
    setRepoScanning(true);
    setRepoError("");
    setRepoReport(null);
    setRepairError("");
    setRepairSuggestion(null);
    setPrConfirmed(false);
    setPrError("");
    setPrResult(null);
    setPrStatus(null);
    setPrStatusError("");
    try {
      const response = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, oldSpecText: oldText, newSpecText: newText })
      });
      const payload = (await response.json()) as RepoApiResponse;
      if (!response.ok || isRepoError(payload)) {
        setRepoError(isRepoError(payload) ? payload.error : "Repository analysis failed. Try again.");
        return;
      }
      setRepoReport(payload);
    } catch {
      setRepoError("Could not reach the repository analysis endpoint. Check that the development server is running.");
    } finally {
      setRepoScanning(false);
    }
  }

  function loadExample() {
    setOldText(JSON.stringify(oldExample, null, 2));
    setNewText(JSON.stringify(newExample, null, 2));
    setResult(null);
    setError("");
    setFilter("all");
    setSearch("");
    setPrConfirmed(false);
    setPrError("");
    setPrResult(null);
    setPrStatus(null);
    setPrStatusError("");
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>, target: "old" | "new") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (target === "old") setOldText(text);
      else setNewText(text);
      setResult(null);
      setError("");
    } catch {
      setError(`Could not read ${file.name}. Try a UTF-8 JSON or YAML file.`);
    }
    event.target.value = "";
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="API Guardian home">
          <span className="brand-mark"><ShieldIcon /></span>
          <span>api<span className="brand-light">guardian</span></span>
        </a>
        <div className="topbar-right"><span className="status-dot" /> MVP · API impact + reviewed PRs <span className="topbar-separator">/</span> v0.5</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span className="eyebrow-line" /> DEVELOPER INFRASTRUCTURE</div>
        <h1>Catch breaking API changes<br /><span>before production does.</span></h1>
        <p className="hero-copy">Compare API versions, find likely affected code in public GitHub repositories, and prepare a reviewed repair proposal with a regression test.</p>
        <div className="hero-meta"><span><CheckIcon /> Rule-based detection</span><span><CheckIcon /> Local fallback works without a key</span><span><CheckIcon /> No automatic repository edits</span></div>
      </section>

      <section className="workspace" aria-label="Compare API versions">
        <div className="section-heading">
          <div><div className="section-kicker">01 / INPUT</div><h2>Compare specifications</h2><p>Paste JSON/YAML or upload OpenAPI files for the old and new versions.</p></div>
          <button className="button button-quiet" onClick={loadExample}><RefreshIcon /> Load logistics demo</button>
        </div>

        <div className="editor-grid">
          <SpecEditor title="BASELINE" subtitle="Current / old version" version="v1.0.0" value={oldText} onChange={setOldText} onFile={(event) => handleFile(event, "old")} fileLabel="Upload old spec" accent="blue" />
          <SpecEditor title="CANDIDATE" subtitle="Proposed / new version" version="v2.0.0" value={newText} onChange={setNewText} onFile={(event) => handleFile(event, "new")} fileLabel="Upload new spec" accent="violet" />
        </div>
        <div className="compare-bar">
          <span className="input-note"><InfoIcon /> {METHODS_HELP}</span>
          <button className="button button-primary" onClick={compare} disabled={loading}>
            {loading ? <><span className="spinner" /> Comparing…</> : <>Compare versions <ArrowRightIcon /></>}
          </button>
        </div>
        {error && <div className="error-banner" role="alert"><AlertIcon /> <span>{error}</span></div>}
      </section>

      {result && <section className="results" aria-live="polite">
        <div className="section-heading results-heading">
          <div><div className="section-kicker">02 / ANALYSIS</div><h2>Change report</h2><p>{prettyVersion(result.oldVersion)} <span className="arrow-inline">→</span> {prettyVersion(result.newVersion)} · {result.summary.total} finding{result.summary.total === 1 ? "" : "s"}</p></div>
          <button className="button button-quiet" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(result, null, 2)); }}><CopyIcon /> Copy report JSON</button>
        </div>
        <div className="summary-grid">
          <SummaryCard label="Breaking changes" count={result.summary.breaking} description="Fix before upgrading" tone="danger" icon={<AlertIcon />} />
          <SummaryCard label="Warnings" count={result.summary.warnings} description="Review compatibility" tone="warning" icon={<WarningIcon />} />
          <SummaryCard label="Informational" count={result.summary.info} description="New or additive changes" tone="neutral" icon={<SparkIcon />} />
        </div>
        <div className="findings-toolbar">
          <div className="toolbar-label"><ListIcon /> Findings <span className="count-pill">{filteredFindings.length}</span></div>
          <div className="toolbar-controls">
            <div className="search-field"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search findings" aria-label="Search findings" /></div>
            <select value={filter} onChange={(event) => setFilter(event.target.value as "all" | Severity)} aria-label="Filter findings by severity">
              <option value="all">All severities</option><option value="breaking">Breaking</option><option value="warning">Warnings</option><option value="info">Informational</option>
            </select>
          </div>
        </div>
        {filteredFindings.length === 0 ? <div className="empty-state"><CheckIcon /><h3>No findings match</h3><p>Try another filter or search phrase.</p></div> : <div className="finding-list">{filteredFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>}

        <section className="impact-scan" aria-label="Find affected source code">
          <div className="section-kicker">03 / CODE IMPACT</div>
          <h2>Find affected code in a public GitHub repository</h2>
          <p className="impact-copy">API Guardian will look for risky endpoint paths and changed field names in source files on the repository's default branch. This is a text-based first pass, not full semantic code analysis.</p>
          <div className="repo-scan-form">
            <label htmlFor="repo-url">Public GitHub repository</label>
            <div className="repo-scan-controls">
              <input id="repo-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" />
              <button className="button button-primary" onClick={scanRepository} disabled={repoScanning || !repoUrl.trim()}>
                {repoScanning ? <><span className="spinner" /> Scanning…</> : <>Find affected code <ArrowRightIcon /></>}
              </button>
            </div>
            <span className="repo-helper">Public repositories only · up to 45 source files · read-only · no GitHub token required</span>
          </div>
          {repoError && <div className="error-banner" role="alert"><AlertIcon /> <span>{repoError}</span></div>}
          {repoReport && <div className="repo-report">
            <div className="repo-report-top"><div><strong><a href={repoReport.repositoryUrl} target="_blank" rel="noreferrer">{repoReport.owner}/{repoReport.repo}</a></strong><span>Branch: {repoReport.branch ?? "not scanned"}</span></div><div className="repo-metrics"><span><b>{repoReport.scannedFiles}</b> files scanned</span><span><b>{repoReport.matchCount}</b> textual matches</span></div></div>
            {(repoReport.truncated || repoReport.skippedLargeFiles > 0) && <p className="repo-limits">Limited scan: {repoReport.truncated ? "the scan was truncated by repository, file, or match limits" : "some files were skipped"}{repoReport.skippedLargeFiles > 0 ? `; ${repoReport.skippedLargeFiles} large files skipped` : ""}.</p>}
            {repoReport.matches.length === 0 ? <div className="repo-no-matches"><CheckIcon /><strong>No matching lines found in the scanned files.</strong><p>This does not prove the repository is unaffected; references may be indirect, generated, or outside the scanned file limit.</p></div> : <div className="repo-match-list">{repoReport.matches.map((match, index) => <article className="repo-match" key={`${match.path}:${match.line}:${match.findingId}:${index}`}>
              <div className="repo-match-meta"><span className={`severity-tag severity-${match.severity}`}>{match.severity.toUpperCase()}</span><span className="repo-file"><a href={`${repoReport.repositoryUrl}/blob/${encodeURIComponent(repoReport.branch ?? "HEAD")}/${match.path.split("/").map(encodeURIComponent).join("/")}#L${match.line}`} target="_blank" rel="noreferrer">{match.path}:{match.line}</a></span><span className="repo-match-kind">{match.matchKind}: {match.matchedTerm}</span></div>
              <p className="repo-finding-title">{match.findingTitle}</p><code>{match.snippet}</code>
              <div className="repo-match-actions"><button className="button button-quiet repair-trigger" onClick={() => generateRepair(match)} disabled={Boolean(repairingKey)}>
                {repairingKey === `${match.path}:${match.line}:${match.findingId}` ? <><span className="spinner" /> Preparing repair…</> : <>Generate repair &amp; test <WrenchIcon /></>}
              </button></div>
            </article>)}</div>}
            {repairError && <div className="error-banner" role="alert"><AlertIcon /> <span>{repairError}</span></div>}
            {repairSuggestion && <RepairSuggestionCard suggestion={repairSuggestion} />}
            {repairSuggestion && repairSuggestion.oldText !== null && repairSuggestion.newText !== null && <section className="pr-workflow" aria-label="Validate repair and create pull request">
              <div className="section-kicker">05 / VALIDATE &amp; OPEN PR</div>
              <h3>Validate the patch before creating a draft pull request</h3>
              <p>First run a no-write preflight. If it passes, you can optionally create a draft pull request on a new branch. API Guardian does not run your repository's tests, merge the PR, or deploy the application.</p>
              <div className="pr-workflow-actions">
                <button className="button button-quiet" onClick={() => runPullRequestAction(true)} disabled={Boolean(prWorking)}>
                  {prWorking === "dry-run" ? <><span className="spinner" /> Validating…</> : <>Validate patch (no writes) <CheckIcon /></>}
                </button>
                <label className="pr-confirm"><input type="checkbox" checked={prConfirmed} onChange={(event) => setPrConfirmed(event.target.checked)} /> I reviewed the proposed change and want to create a draft PR for this repository.</label>
                <button className="button button-primary" onClick={() => runPullRequestAction(false)} disabled={Boolean(prWorking) || !prConfirmed}>
                  {prWorking === "create" ? <><span className="spinner" /> Creating PR…</> : <>Create draft pull request <ArrowRightIcon /></>}
                </button>
              </div>
              {prError && <div className="error-banner" role="alert"><AlertIcon /> <span>{prError}</span></div>}
              {prResult && "success" in prResult && <div className="pr-result" role="status">
                <strong>{prResult.dryRun ? "Patch preflight passed" : "Draft pull request created"}</strong>
                <p>{prResult.message}</p>
                <div className="pr-result-metrics"><span>File: <code>{prResult.validation.filePath}</code></span><span>Exact replacement: {prResult.validation.exactReplacementCount}</span><span>Estimated changed lines: {prResult.validation.changedLineCountEstimate}</span><span>Tests executed: No</span></div>
                {prResult.pullRequestUrl && <a href={prResult.pullRequestUrl} target="_blank" rel="noreferrer">Open draft pull request on GitHub ↗</a>}
                {prResult.dryRun && <p className="pr-result-note">This check reads the latest public file and verifies that the old block appears exactly once. It does not prove the code compiles.</p>}
                {!prResult.dryRun && prResult.pullRequestUrl && <div className="ci-status-panel">
                  <div className="ci-status-actions">
                    <div><strong>GitHub CI status</strong><p>Read the checks attached to this pull request's latest commit.</p></div>
                    <button className="button button-quiet" onClick={checkPullRequestStatus} disabled={prStatusLoading}>
                      {prStatusLoading ? <><span className="spinner" /> Checking…</> : <>Check CI status <ArrowRightIcon /></>}
                    </button>
                  </div>
                  {prStatusError && <div className="error-banner" role="alert"><AlertIcon /> <span>{prStatusError}</span></div>}
                  {prStatus && <div className={`ci-status-result ci-${prStatus.status}`}>
                    <div className="ci-status-title"><strong>{prStatus.status === "success" ? "All checks passed" : prStatus.status === "failure" ? "Checks need attention" : prStatus.status === "pending" ? "Checks are still running" : "No CI checks found"}</strong><span>PR #{prStatus.number}{prStatus.draft ? " · Draft" : ""}</span></div>
                    <p>{prStatus.message}</p>
                    <p className="ci-sha">Commit: <code>{prStatus.headSha.slice(0, 12)}</code> · Checked {new Date(prStatus.checkedAt).toLocaleTimeString()}</p>
                    {prStatus.checks.length > 0 && <ul className="ci-check-list">{prStatus.checks.map((check, index) => <li key={`${check.name}:${index}`}><span className={`ci-check-dot ci-dot-${check.status === "completed" ? check.conclusion ?? "unknown" : "pending"}`} /><span className="ci-check-name">{check.name}</span><span className="ci-check-state">{check.conclusion ?? check.status}</span>{check.detailsUrl && <a href={check.detailsUrl} target="_blank" rel="noreferrer">Details ↗</a>}</li>)}</ul>}
                    {prStatus.status === "no_checks" && <p className="pr-result-note">Add a test script and a GitHub Actions workflow to the target repository, push the change, then check CI status again. See <code>examples/github-actions/node-ci.yml</code> in the downloaded project.</p>}
                  </div>}
                </div>}
              </div>}
            </section>}
            <p className="repo-scan-note"><InfoIcon /> {repoReport.note}</p>
            <p className="repair-privacy-note"><ShieldIcon /> If OPENAI_API_KEY is configured, the selected public source-code context and API specifications are sent to the configured model provider for repair generation. Without a key, API Guardian uses a conservative local rule for unambiguous field renames. Nothing is committed to GitHub.</p>
          </div>}
        </section>
        <div className="disclaimer"><ShieldIcon /><p><strong>Review before you ship.</strong> This is an early MVP, not a complete OpenAPI validator or proof that a change is safe. It compares common paths, parameters and inline/ referenced schemas; review findings and test your real integration.</p></div>
      </section>}

      {!result && <section className="how-section">
        <div className="section-kicker">THE WORKFLOW</div><h2>From contract diff to confident release.</h2>
        <div className="workflow-grid">
          <WorkflowStep number="01" title="Compare" text="Read two machine-readable API contracts and identify differences." icon={<DiffIcon />} />
          <WorkflowStep number="02" title="Prioritize" text="Group changes by their potential impact on existing clients." icon={<FlagIcon />} />
          <WorkflowStep number="03" title="Remediate" text="Next milestone: map affected code, generate tests and propose a fix." icon={<WrenchIcon />} />
        </div>
      </section>}

      <footer className="footer"><span>API GUARDIAN <span className="footer-muted">/ BUILD IN PUBLIC</span></span><span>Milestone 06 · CI status tracking</span></footer>
    </main>
  );
}

function RepairSuggestionCard({ suggestion }: { suggestion: RepairSuggestion }) {
  const modeLabel = suggestion.mode === "ai" ? "AI PROPOSAL" : suggestion.mode === "rules" ? "RULE-BASED PROPOSAL" : "MANUAL REVIEW";
  const modeClass = suggestion.mode === "ai" ? "repair-mode-ai" : suggestion.mode === "rules" ? "repair-mode-rules" : "repair-mode-manual";
  return <section className="repair-suggestion" aria-live="polite">
    <div className="repair-suggestion-header"><div><div className="section-kicker">04 / REPAIR PREVIEW</div><h3>{suggestion.summary}</h3><p>{suggestion.filePath}:{suggestion.line}</p></div><span className={`repair-mode ${modeClass}`}>{modeLabel}</span></div>
    <p className="repair-rationale">{suggestion.rationale}</p>
    {suggestion.oldText !== null && suggestion.newText !== null ? <div className="repair-diff-grid">
      <div><div className="repair-code-label">BEFORE</div><pre className="repair-code repair-before"><code>{suggestion.oldText}</code></pre></div>
      <div><div className="repair-code-label">PROPOSED AFTER</div><pre className="repair-code repair-after"><code>{suggestion.newText}</code></pre></div>
    </div> : <div className="repair-manual-message"><InfoIcon /> API Guardian could not verify one safe replacement. Use the finding and new API contract to make a manual change.</div>}
    <div className="repair-test-block"><div className="repair-code-label">REGRESSION TEST</div><p>{suggestion.testPlan}</p>{suggestion.testCode ? <pre className="repair-code repair-test-code"><code>{suggestion.testCode}</code></pre> : <p className="repair-test-placeholder">No runnable test code was generated for this match. Use the test plan above to write one.</p>}</div>
    {suggestion.risks.length > 0 && <div className="repair-risks"><strong>Review before accepting</strong><ul>{suggestion.risks.map((risk, index) => <li key={`${index}:${risk}`}>{risk}</li>)}</ul></div>}
    <p className="repair-note"><InfoIcon /> {suggestion.note}</p>
    {(suggestion.oldText !== null && suggestion.newText !== null) && <button className="button button-quiet repair-copy-button" onClick={() => navigator.clipboard?.writeText(suggestion.newText ?? "")}><CopyIcon /> Copy proposed line/block</button>}
  </section>;
}

function SpecEditor({ title, subtitle, version, value, onChange, onFile, fileLabel, accent }: { title: string; subtitle: string; version: string; value: string; onChange: (value: string) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; fileLabel: string; accent: "blue" | "violet" }) {
  return <div className={`editor-card editor-${accent}`}>
    <div className="editor-top"><div className="editor-heading"><span className="editor-dot" /><div><span className="editor-kicker">{title}</span><strong>{subtitle}</strong></div></div><span className="version-tag">{version}</span></div>
    <div className="editor-tools"><span><CodeIcon /> OpenAPI spec</span><label className="upload-link"><UploadIcon /> {fileLabel}<input type="file" accept=".json,.yaml,.yml,application/json,text/yaml,text/plain,.txt" onChange={onFile} /></label></div>
    <textarea spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${title} OpenAPI specification`} placeholder="Paste an OpenAPI JSON or YAML specification here…" />
    <div className="editor-bottom"><span><span className="editor-dot-small" /> JSON / YAML editor</span><span>{value.length.toLocaleString()} chars</span></div>
  </div>;
}
function SummaryCard({ label, count, description, tone, icon }: { label: string; count: number; description: string; tone: string; icon: React.ReactNode }) {
  return <div className={`summary-card tone-${tone}`}><div className="summary-top"><span className="summary-icon">{icon}</span><span className="summary-label">{label}</span></div><div className="summary-bottom"><strong>{count.toString().padStart(2, "0")}</strong><span>{description}</span></div></div>;
}
function FindingCard({ finding }: { finding: Finding }) {
  const label = finding.severity === "breaking" ? "BREAKING" : finding.severity === "warning" ? "REVIEW" : "INFO";
  const icon = finding.severity === "breaking" ? <AlertIcon /> : finding.severity === "warning" ? <WarningIcon /> : <SparkIcon />;
  return <article className={`finding-card finding-${finding.severity}`}>
    <div className="finding-rail">{icon}</div>
    <div className="finding-content"><div className="finding-meta"><span className={`severity-tag severity-${finding.severity}`}>{label}</span><span className="category-tag">{finding.category}</span><span className="finding-location">{finding.location}</span></div><h3>{finding.title}</h3><p>{finding.message}</p><div className="recommendation"><span className="recommendation-label">RECOMMENDED ACTION</span><span>{finding.recommendation}</span></div></div>
  </article>;
}
function WorkflowStep({ number, title, text, icon }: { number: string; title: string; text: string; icon: React.ReactNode }) {
  return <div className="workflow-step"><div className="workflow-icon">{icon}<span>{number}</span></div><h3>{title}</h3><p>{text}</p></div>;
}
function Svg({ children }: { children: React.ReactNode }) { return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
function ShieldIcon() { return <Svg><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></Svg>; }
function CheckIcon() { return <Svg><path d="m5 12 4 4L19 6"/></Svg>; }
function RefreshIcon() { return <Svg><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></Svg>; }
function ArrowRightIcon() { return <Svg><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></Svg>; }
function InfoIcon() { return <Svg><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></Svg>; }
function AlertIcon() { return <Svg><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></Svg>; }
function WarningIcon() { return <Svg><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></Svg>; }
function SparkIcon() { return <Svg><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></Svg>; }
function CopyIcon() { return <Svg><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></Svg>; }
function ListIcon() { return <Svg><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></Svg>; }
function SearchIcon() { return <Svg><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></Svg>; }
function CodeIcon() { return <Svg><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></Svg>; }
function UploadIcon() { return <Svg><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/></Svg>; }
function DiffIcon() { return <Svg><path d="M8 4H4v16h4M16 4h4v16h-4M9 8h6M9 12h6M9 16h3"/></Svg>; }
function FlagIcon() { return <Svg><path d="M5 21V5"/><path d="M5 5c6-4 8 4 14 0v10c-6 4-8-4-14 0"/></Svg>; }
function WrenchIcon() { return <Svg><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3 3.7-3.7Z"/></Svg>; }
