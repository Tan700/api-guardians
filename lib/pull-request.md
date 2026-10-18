Stage 5 PR API notes

- POST /api/create-pr with dryRun=true validates a patch against the latest public source file without writing to GitHub.
- POST /api/create-pr with dryRun=false requires GITHUB_TOKEN and an exact repository allowlist in GITHUB_ALLOWED_REPOS.
- Patch application requires a unique oldText match and preserves CRLF/LF line endings.
- Successful write creates a uniquely named branch and a draft pull request; it does not merge or deploy.
- The generated test is a suggested test plan/code shown in the UI. This milestone does not run target repo code or automatically commit generated tests.
