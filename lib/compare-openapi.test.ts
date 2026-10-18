import { describe, expect, it } from "vitest";
import { compareOpenApi } from "./compare-openapi";

function spec(paths: Record<string, unknown>, version = "1.0.0") {
  return { openapi: "3.0.3", info: { title: "Test API", version }, paths };
}

const okResponse = { "200": { description: "OK" } };

describe("compareOpenApi", () => {
  it("reports a removed endpoint as breaking", () => {
    const oldSpec = spec({
      "/health": { get: { responses: okResponse } }
    }, "1.0.0");
    const newSpec = spec({}, "2.0.0");

    const result = compareOpenApi(oldSpec, newSpec);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "breaking",
      title: "Endpoint removed",
      location: "GET /health"
    });
    expect(result.summary).toEqual({ breaking: 1, warnings: 0, info: 0, total: 1 });
  });

  it("reports a newly required request parameter as breaking", () => {
    const oldSpec = spec({
      "/shipments": {
        get: {
          parameters: [{ name: "status", in: "query", required: false, schema: { type: "string" } }],
          responses: okResponse
        }
      }
    });
    const newSpec = spec({
      "/shipments": {
        get: {
          parameters: [{ name: "status", in: "query", required: true, schema: { type: "string" } }],
          responses: okResponse
        }
      }
    });

    const result = compareOpenApi(oldSpec, newSpec);
    expect(result.findings.some((item) => item.title === "Parameter is now required" && item.severity === "breaking")).toBe(true);
  });

  it("reports a removed response property as breaking", () => {
    const oldSpec = spec({
      "/shipments/{id}": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      delivery_date: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    const newSpec = spec({
      "/shipments/{id}": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { id: { type: "string" } }
                  }
                }
              }
            }
          }
        }
      }
    });

    const result = compareOpenApi(oldSpec, newSpec);
    expect(result.findings.some((item) => item.title === "Response field removed" && item.location.endsWith(".delivery_date"))).toBe(true);
  });

  it("reports a new endpoint as informational", () => {
    const oldSpec = spec({});
    const newSpec = spec({
      "/warehouses": { get: { responses: okResponse } }
    });

    const result = compareOpenApi(oldSpec, newSpec);
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "info",
      title: "Endpoint added",
      location: "GET /warehouses"
    }));
  });

  it("uses the version from each specification", () => {
    const result = compareOpenApi(spec({}, "1.2.0"), spec({}, "1.3.0"));
    expect(result.oldVersion).toBe("1.2.0");
    expect(result.newVersion).toBe("1.3.0");
  });

  it("rejects inputs without paths", () => {
    expect(() => compareOpenApi({ openapi: "3.0.3" }, { openapi: "3.0.3" })).toThrow("paths");
  });
});
