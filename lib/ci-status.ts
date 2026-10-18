export type CheckRunInput = {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
};
export type CiOverallStatus = "no_checks" | "pending" | "failure" | "success";
export type CiSummary = { status: CiOverallStatus; message: string };

const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"]);
const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Summarizes GitHub check runs conservatively. Unknown completed results aren't treated as success. */
export function summarizeCheckRuns(checks: CheckRunInput[]): CiSummary {
  if (checks.length === 0) {
    return {
      status: "no_checks",
      message: "No CI checks were found for the latest commit. Add a GitHub Actions workflow or wait for a configured check to start."
    };
  }
  if (checks.some((check) => check.status !== "completed")) {
    return { status: "pending", message: "Some CI checks are still running. Refresh the status after they finish." };
  }
  if (checks.some((check) => check.conclusion !== null && FAILURE_CONCLUSIONS.has(check.conclusion))) {
    return { status: "failure", message: "One or more CI checks failed or require action. Open the failed check and fix it before merging." };
  }
  if (checks.every((check) => check.status === "completed" && check.conclusion !== null && SUCCESS_CONCLUSIONS.has(check.conclusion))) {
    return { status: "success", message: "All reported checks completed successfully. Review the PR and test coverage before merging." };
  }
  return { status: "pending", message: "GitHub has checks, but at least one result is not a recognized final success. Review the checks individually." };
}
