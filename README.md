# API Guardian MVP — Milestone 06

A beginner-friendly starter for **API Guardian**, a developer tool that compares JSON/YAML OpenAPI specifications, locates potentially affected code, proposes repairs, opens reviewed draft pull requests, and reads GitHub CI check status.

## What works in this starter

- Paste or upload JSON/YAML OpenAPI specifications.
- Scan a public GitHub repository for text references related to breaking/warning API changes.
- Load a logistics/shipping demo with intentional changes.
- Detect removed operations, added operations, added/removed parameters, requiredness changes, common request-body changes, response-status changes, schema field changes, type changes, and enum changes.
- Group findings as **breaking**, **warning**, or **informational**.
- Search/filter findings and copy the report as JSON.
- Use a server-side comparison route (`POST /api/compare`). No AI key or database is required.

## What is intentionally not built yet

- Full OpenAPI validation and support for every advanced OpenAPI feature (`allOf`, `oneOf`, `anyOf`, discriminator logic, external `$ref`s, every media type, security schemes, callbacks, etc.).
- Private repository support, GitHub App/OAuth, language-aware code impact analysis, AI-generated patches, PR creation, database persistence, and post-quantum cryptography scanning.

Treat findings as a first-pass review aid, not a formal guarantee of compatibility. Real API compatibility has nuance; test actual integrations before releasing.

## Requirements

- Node.js 20.9 or newer.
- npm.
- An editor such as VS Code.

## Run it locally

1. Extract the project ZIP or open this folder in VS Code.
2. Open a terminal in this folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` in your browser.
6. Click **Load logistics demo**, then **Compare versions**.

If port 3000 is already in use, Next.js may offer another local port in the terminal.

## Useful scripts

```bash
npm run dev       # local development server
npm run typecheck # TypeScript type check
npm run build     # production build
npm start         # run the built production app
```

## Project structure

```text
api-guardian-mvp/
├── app/
│   ├── api/
│   │   ├── compare/route.ts      # POST endpoint for comparisons
│   │   └── analyze-repo/route.ts # Public GitHub source impact scan
│   ├── globals.css            # UI styling
│   ├── layout.tsx             # page metadata and root layout
│   └── page.tsx               # UI, input, results, filtering
├── examples/
│   ├── shipping-v1.json       # baseline example
│   ├── shipping-v2.json       # changed example
│   └── shipping-client-sample.ts # client intentionally using v1 field
├── lib/
│   ├── compare-openapi.ts      # deterministic diff rules
│   ├── compare-openapi.test.ts # contract diff tests
│   ├── impact-analysis.ts      # repository terms and source matches
│   └── impact-analysis.test.ts # impact scan tests
├── package.json
└── README.md
```

## How the code flows

1. The user pastes or uploads two JSON/YAML specifications in the browser.
2. The UI sends their text to `POST /api/compare`.
3. The comparison route parses the documents and checks for an OpenAPI/Swagger structure.
4. `lib/compare-openapi.ts` compares HTTP operations, parameters, request bodies, responses, and common schema properties.
5. The UI renders the findings. After a report is available, the user can submit a public repository to `POST /api/analyze-repo`.
6. The analysis route recomputes the comparison, derives risky path/field/parameter terms, scans a bounded set of source files, and returns matched lines for human review.

## Suggested development roadmap

### Milestone 1 — Make the core reliable

- Run demo and verify its findings.
- Add small test fixtures for endpoint deletion, parameter requiredness, response field removal, type change, no-change specs and malformed input.
- Add YAML input and a real OpenAPI validator later.

### Milestone 2 — Improve contract analysis

- Improve `$ref` support and schema composition handling.
- Add content-type changes, security requirement checks, deprecation detection and configurable compatibility policy.
- Add report history with PostgreSQL once the comparison logic is stable.

### Milestone 3 — Public GitHub impact scan (implemented in this stage)

- Analyze public repository source files for path/field/parameter text matches derived from risky findings.
- Keep the scan read-only and bounded; this is heuristic matching rather than language-aware analysis.

### Milestone 4 — Repair proposal preview (partially implemented in this stage)

- Public-repository repair previews and regression-test suggestions are included.
- Local allowlisted GitHub draft pull requests and patch preflight are included.
- Milestone 06 can read the check runs attached to a created PR commit. API Guardian itself does not execute arbitrary target-repository code.
- Keep human approval required; don't auto-merge or deploy.

### Milestone 5 — Post-quantum cryptography readiness module

- Treat this as a separate security scanner module.
- Inventory known algorithm/configuration use and dependencies; show file/line evidence and confidence.
- Map use-cases separately (key establishment vs digital signatures) before recommending a migration.
- Use maintained libraries and current standards; don't build crypto algorithms yourself or claim the scan certifies an application as quantum-safe.

## Notes for contributors

- The compare engine is deterministic; don't replace contract rules with an LLM guess.
- Keep findings evidence-linked: every future finding should refer to a path, method, field, dependency or configuration location.
- Avoid uploading real customer specs to a third-party LLM without explicit authorization.


## Stage 2 additions

- YAML and JSON parsing on the server, with syntax and basic specification validation.
- YAML example files in `examples/`.
- Vitest unit tests for removed endpoints, newly required parameters, removed response fields, added endpoints, version labels and invalid input.
- Upload controls accept `.json`, `.yaml`, and `.yml` files.

If the test suite fails, copy the complete terminal output. Do not ignore failing tests before adding GitHub or AI features.

## Milestone 03 — Public GitHub code-impact scan

This stage adds an optional **Find affected code in a public GitHub repository** panel after a comparison report.

### How to use it

1. Compare old and new OpenAPI versions and ensure there is at least one breaking change or warning.
2. Enter a repository URL such as `https://github.com/owner/repo` (or `owner/repo`). The repository must be public.
3. Click **Find affected code**. API Guardian resolves the repository's default branch and searches a bounded set of source-code files for changed endpoint prefixes, field names and parameters related to risky findings.
4. Review matches in the report. File links open GitHub at the line number where a text match was found.

For a reliable demonstration, make this project repository public (or copy `examples/shipping-client-sample.ts` to your own public test repository), then compare the bundled `shipping-v1.json` and `shipping-v2.json`. The sample client intentionally uses the old `estimated_delivery` field and `/shipments/` route.

### Safety and limits

- No GitHub token is needed or stored; private repositories are not supported in this milestone.
- The scan uses public GitHub metadata and raw source files. It does not clone or execute repository code.
- It scans up to 45 candidate files, skips large files, and returns up to 100 matches. Large repositories may be truncated.
- Matching is heuristic text search, not language-aware AST, type-flow, or dependency analysis. It can produce false positives and miss indirect usages.
- Source files are not changed. No branch or pull request is created.
- Public GitHub API rate limits can apply. Retry later if the anonymous rate limit is reached.
- Treat repository content as untrusted. This tool only displays narrow text snippets matching risky API change indicators; review the file and surrounding code yourself.

### Added files

- `app/api/analyze-repo/route.ts` — public-repo discovery, file selection, bounded concurrent fetch and line matching.
- `lib/impact-analysis.ts` — validates repository input and creates searchable indicators from breaking/warning findings.
- `lib/impact-analysis.test.ts` — tests repo URL parsing and impact matching.

### Run checks

```bash
npm test
npm run typecheck
npm run build
```

This stage still does not make automatic code changes. Future work should add authenticated GitHub App support, more precise language-aware code analysis, isolated validation, and reviewed pull-request creation.


### Stage 3.1: reduce noisy route matches

The code-impact scanner now creates route search terms only for endpoint-level findings. A schema/response-field finding still includes its API route as context, but the scanner no longer flags any source line containing that route as though it were a direct use of the removed field. This keeps field-level findings focused on the changed field name.


## Milestone 04 — repair proposal and regression-test preview

This milestone adds a **Generate repair & test** button to each public-repository code match.

### Use it

1. Compare the bundled logistics OpenAPI v1 and v2 specifications.
2. Scan a public repository that has source code using a removed or changed field.
3. Click **Generate repair & test** beneath the field match (for the demo, choose the `estimated_delivery` field match rather than the endpoint-route match).
4. Review the proposed before/after block, rationale, risks and regression test. Copy the proposed change only after you understand it.

The local rule-based path works without an AI key when both specifications show a removed field and a uniquely likely new sibling field. It uses name-token similarity to distinguish `delivery_date` from unrelated new fields such as `carrier_name`; this remains a heuristic, not proof that the fields have the same business meaning. It updates matching references in a short span within the one selected file, including a local matching field declaration when present.

### Optional AI mode

AI repair generation is optional. Copy `.env.example` to `.env.local`, then set:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-6-sol
```

Keep `.env.local` private and never commit it. Restart `npm run dev` after changing environment variables. The key is read only by the server-side route; it is not exposed in browser code. API Guardian uses the OpenAI Responses API to ask for a minimal exact-text patch and a proposed Vitest test. If the model is unavailable or its patch cannot be validated as a unique exact substring, the app falls back to the rule-based path or asks for manual review.

**Privacy:** with AI mode enabled, the selected public source file, selected finding, and old/new API specifications are sent to the configured model provider. Do not use the AI mode with confidential code/specifications unless you have reviewed and approved that data handling.

### Safety boundaries

- This stage only generates a preview. It does not change source files, push commits, open pull requests, merge code or deploy anything.
- The generated test is a proposal. API Guardian does not run it yet; copy it into the repository and run your tests locally.
- Only public GitHub repositories are supported. Private repo permissions and GitHub App authentication are future work.
- If the change is ambiguous, the correct result is manual review—not an invented replacement.

### Added files

- `app/api/repair/route.ts` — fetches the selected public source file, optionally asks the model for a patch, and validates the exact old text before returning a preview.
- `lib/repair.ts` — conservative field-rename inference, local patch generation, test template generation, and patch-validation helpers.
- `lib/repair.test.ts` — unit tests for replacement inference, bounded token replacement and generated test suggestions.
- `.env.example` — safe template for optional server-side AI configuration.

### Validate locally

```bash
npm test
npm run typecheck
npm run build
```

**Deployment warning:** This educational MVP does not yet include user authentication or durable rate limits. Run it locally while using `OPENAI_API_KEY`; do not expose the key-enabled repair endpoint to the public internet until authentication, quotas/rate limits, logging and abuse controls have been added.


## Stage 4.1 test expectation fix

The impact-analysis implementation intentionally creates route search terms only for endpoint-level findings. Schema/field findings should search for the changed field name, not re-scan the route embedded in the finding location. The unit tests were updated to reflect this behavior and avoid regressions that flag every request to the same endpoint as a schema-field impact.


## Milestone 05 — patch validation and draft pull requests

Stage 5 adds a conservative patch preflight and an optional GitHub draft-PR workflow. It still requires human review: API Guardian does not run arbitrary repository code, merge a pull request, or deploy anything.

### Troubleshooting: validation cannot reach GitHub

The no-write validator first tries `raw.githubusercontent.com`. Some networks can reach `github.com` or `api.github.com` but fail to reach the raw-content host. This version falls back to GitHub's Contents API if the raw-host request fails or returns a transient error. If both endpoints fail, check your connection, VPN/proxy/firewall, repository visibility, branch name, and file path. If `GITHUB_TOKEN` is already configured, the fallback uses it; otherwise public repositories can be read anonymously subject to GitHub rate limits.

### 1. Run the no-write validation first

1. Run `npm install`, `npm test`, `npm run typecheck`, and `npm run dev`.
2. Load the logistics demo and compare the API specs.
3. Scan a public repository and generate a repair for a concrete field match.
4. Click **Validate patch (no writes)**. The server re-fetches the latest public file and confirms that the exact old block appears once. It does not prove the code compiles or run tests.

### 2. Optional: enable draft pull request creation

Use this only with a throwaway public test repository you own. Create a fine-grained personal access token on GitHub, scoped to that repository, with these permissions:

- **Contents: Read and write**
- **Pull requests: Read and write**
- **Checks: Read** (needed for Milestone 06 CI status)
- **Metadata: Read-only** (normally granted automatically)

Copy `.env.example` to `.env.local` and set:

```env
GITHUB_TOKEN=github_pat_your_token_here
GITHUB_ALLOWED_REPOS=your-github-name/api-guardian-shipping-test
```

Replace the example repository slug with the exact `owner/repo` for your test repository. Multiple repositories may be comma-separated. Restart the development server after changing `.env.local`. Never commit this file or put the token in client-side code.

After a repair preview is shown, click **Validate patch (no writes)**. Review the result, select the explicit confirmation checkbox, then click **Create draft pull request**. A successful action creates a new `api-guardian/fix-*` branch and a **draft** PR for review. The base branch is not written directly.

### What Stage 5 validates — and does not validate

- It checks that the selected path is an ordinary source-code file, not a hidden/config/workflow/traversal path.
- It re-fetches the latest file and refuses to patch if the original text is missing or occurs more than once. This helps prevent stale or ambiguous edits.
- It never runs the target repository's code on the API Guardian server.
- It does **not** compile the target code, run its test suite, guarantee semantic correctness, or automatically commit the proposed regression test. The suggested test plan is included in the PR description; inspect and run checks in the repository before merging.
- Actual PR creation is disabled unless both `GITHUB_TOKEN` and `GITHUB_ALLOWED_REPOS` are set.

### Security note

This project is a local student MVP. Do not deploy the write-enabled API route to a public host while using a personal token. A production version should use GitHub App installation authentication, user authentication, per-user repository authorization, audit logging, and rate limits.


## Milestone 06 — Read GitHub CI status

After API Guardian opens a draft pull request, click **Check CI status** in the successful PR card. The app requests the PR's current head commit and reads its GitHub check runs, then reports **success**, **failure**, **pending**, or **no checks**. The status is a snapshot for the commit SHA displayed in the card; click check again to refresh it.

### Required token permission

The local fine-grained `GITHUB_TOKEN` needs **Checks: read** in addition to **Contents: read/write**, **Pull requests: read/write**, and **Metadata: read-only** for the selected test repository. Add the permission to the existing fine-grained token (or create a replacement), update `.env.local` only if the token value changes, and restart `npm run dev`. Keep the token private and keep `GITHUB_ALLOWED_REPOS` narrowly allowlisted.

### Configure actual CI in your target repository

API Guardian reads checks; it does not run the repository's tests itself. For a Node.js repository, copy `examples/github-actions/node-ci.yml` to `.github/workflows/api-guardian-ci.yml` on the target repository's default branch. The workflow expects a `package.json` with a real `scripts.test` command and test files. It runs `npm test`, optionally `npm run typecheck`, and optionally `npm run build`. If the test repository only contains a single TypeScript file and no package/test setup, create a test script first—the workflow intentionally fails instead of claiming the tests passed.

After adding CI, make a small commit to the PR branch so the workflow runs for the current head commit. Then use **Check CI status** in API Guardian. A green check means the configured workflow passed, not that every possible integration scenario is correct. Review the logs and diff before merging.

### What the status panel means

- `success`: all returned check runs completed with recognized successful conclusions.
- `failure`: at least one completed check failed or requires action.
- `pending`: one or more checks are still running, or a result is unknown.
- `no_checks`: no GitHub check runs were found for the current PR head commit; configure CI or wait for checks to start.

The status endpoint only reads allowlisted repositories and never changes the pull request. It requires local `GITHUB_TOKEN` and is intended for development use. It does not merge, approve, or deploy code.

### Automated tests added in Milestone 06

- `lib/ci-status.ts` summarizes check-run states conservatively.
- `lib/ci-status.test.ts` covers no-check, pending, failure, success, skipped/neutral, and unknown conclusions.
- `app/api/pr-status/route.ts` validates PR/repository URLs, checks repository allowlisting, and reads check runs from GitHub.

Run all checks locally:

```bash
npm test
npm run typecheck
npm run build
```
