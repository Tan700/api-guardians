# Configure CI for the target repository

API Guardian Milestone 06 reads check-run results for a draft pull request. GitHub Actions runs your repository's tests and reports their outcomes to GitHub. API Guardian does not execute arbitrary repository code on its own server.

## Add a workflow to a Node.js target repository

1. Ensure `package.json` includes a real `scripts.test` command and the repository contains the required test files.
2. Copy `node-ci.yml` into the target repository at `.github/workflows/api-guardian-ci.yml`.
3. Commit the workflow to the target repository's default branch.
4. Push a meaningful update to the pull request branch so the checks run against its latest commit.
5. Make sure `GITHUB_ALLOWED_REPOS` includes the exact `owner/repo` slug and the local fine-grained token has **Checks: read**, in addition to the existing permissions needed to create the PR.
6. Restart API Guardian, return to the PR result, and click **Check CI status**.

This sample workflow intentionally fails if `package.json` or a test script is missing. A green result should mean a test command ran, not merely that the workflow skipped it. It is for Node.js repositories; Python, Go, Java, and other projects need a language-appropriate workflow.

The workflow runs repository code on GitHub-hosted runners. Keep secrets out of pull-request workflows, review third-party actions, and do not merge while checks are failing or inconclusive.
