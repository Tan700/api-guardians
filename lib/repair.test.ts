import { describe, expect, it } from "vitest";
import { countExactOccurrences, createDemoRegressionTest, inferReplacementField, replaceIdentifierAtAllRelatedLines, replaceIdentifierOnLine } from "./repair";
import oldSpec from "../examples/shipping-v1.json";
import newSpec from "../examples/shipping-v2.json";
const sampleSource = [
  "export type ShipmentTrackingV1 = {",
  "  shipment_id: string;",
  '  status: "created" | "in_transit" | "delivered";',
  "  estimated_delivery?: string;",
  "};",
  "",
  "export async function getShipmentTracking(baseUrl: string, shipmentId: string) {",
  "  const endpoint = `${baseUrl}/shipments/${shipmentId}/tracking`;",
  "  const response = await fetch(endpoint);",
  "  const tracking = (await response.json()) as ShipmentTrackingV1;",
  "  return {",
  "    id: tracking.shipment_id,",
  "    status: tracking.status,",
  "    estimatedDelivery: tracking.estimated_delivery",
  "  };",
  "}"
].join("\n");

describe("repair helpers", () => {
  it("infers a unique added sibling field as a candidate replacement", () => {
    expect(inferReplacementField(oldSpec, newSpec, "estimated_delivery")).toBe("delivery_date");
  });

  it("replaces only the requested identifier on the indicated line", () => {
    const result = replaceIdentifierOnLine("const x = data.old_field;\nreturn data.old_field;", 2, "old_field", "new_field");
    expect(result).toEqual({ oldText: "return data.old_field;", newText: "return data.new_field;" });
  });

  it("does not replace a field that is absent from the selected line", () => {
    expect(replaceIdentifierOnLine("const x = data.other;", 1, "old_field", "new_field")).toBeNull();
  });

  it("updates the type declaration and usage as one small related patch", () => {
    const patch = replaceIdentifierAtAllRelatedLines(sampleSource, 14, "estimated_delivery", "delivery_date");
    expect(patch?.oldText).toContain("estimated_delivery?: string;");
    expect(patch?.oldText).toContain("tracking.estimated_delivery");
    expect(patch?.newText).toContain("delivery_date?: string;");
    expect(patch?.newText).toContain("tracking.delivery_date");
  });

  it("generates a demo regression test for the sample shipping client", () => {
    const test = createDemoRegressionTest({ source: sampleSource, filePath: "examples/shipping-client-sample.ts", oldField: "estimated_delivery", newField: "delivery_date" });
    expect(test.testCode).toContain("getShipmentTracking");
    expect(test.testCode).toContain("delivery_date");
    expect(test.testPlan).toContain("estimated_delivery");
  });

  it("counts exact occurrences for safe patch validation", () => {
    expect(countExactOccurrences("alpha beta alpha", "alpha")).toBe(2);
    expect(countExactOccurrences("alpha beta", "missing")).toBe(0);
  });
});
