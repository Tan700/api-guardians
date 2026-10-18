import { describe, expect, it } from "vitest";
import { summarizeCheckRuns, type CheckRunInput } from "./ci-status";

const check = (overrides: Partial<CheckRunInput> = {}): CheckRunInput => ({
  name: "tests",
  status: "completed",
  conclusion: "success",
  detailsUrl: null,
  ...overrides
});

describe("summarizeCheckRuns", () => {
  it("reports no_checks when the PR has no configured checks", () => {
    expect(summarizeCheckRuns([]).status).toBe("no_checks");
  });
  it("reports pending while a check is running", () => {
    expect(summarizeCheckRuns([check({ status: "in_progress", conclusion: null })]).status).toBe("pending");
  });
  it("reports failure when a completed check fails", () => {
    expect(summarizeCheckRuns([check({ conclusion: "failure" })]).status).toBe("failure");
  });
  it("reports success when all checks have recognized successful conclusions", () => {
    expect(summarizeCheckRuns([check(), check({ name: "lint", conclusion: "neutral" }), check({ name: "optional", conclusion: "skipped" })]).status).toBe("success");
  });
  it("does not treat an unknown conclusion as success", () => {
    expect(summarizeCheckRuns([check({ conclusion: "unknown-value" })]).status).toBe("pending");
  });
  it("shows pending if checks are unfinished even if another check has failed", () => {
    expect(summarizeCheckRuns([check({ conclusion: "failure" }), check({ status: "queued", conclusion: null })]).status).toBe("pending");
  });
});
