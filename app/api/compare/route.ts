import { NextResponse } from "next/server";
import { parseDocument } from "yaml";
import { compareOpenApi } from "@/lib/compare-openapi";

export const runtime = "nodejs";

const MAX_SPEC_CHARS = 500_000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSpecText(text: string, label: string): unknown {
  let document;
  try {
    // YAML is a superset of JSON, so this parses both formats.
    // uniqueKeys prevents ambiguous documents with duplicate mapping keys.
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  } catch {
    throw new Error(`${label} is not valid JSON or YAML. Check the syntax and try again.`);
  }

  if (document.errors.length > 0) {
    throw new Error(`${label} is not valid JSON or YAML: ${document.errors[0].message}`);
  }

  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch {
    throw new Error(`${label} could not be converted into a specification object.`);
  }

  if (!isObject(parsed)) {
    throw new Error(`${label} must contain a JSON/YAML object at the top level.`);
  }
  if (!isObject(parsed.paths)) {
    throw new Error(`${label} must contain a 'paths' object. Provide an OpenAPI/Swagger specification.`);
  }
  if (typeof parsed.openapi !== "string" && typeof parsed.swagger !== "string") {
    throw new Error(`${label} does not appear to be an OpenAPI or Swagger specification: add an 'openapi' or 'swagger' version field.`);
  }

  return parsed;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isObject(body)) {
      return NextResponse.json({ error: "Send a JSON object containing oldSpecText and newSpecText." }, { status: 400 });
    }

    if (typeof body.oldSpecText !== "string" || typeof body.newSpecText !== "string") {
      return NextResponse.json({ error: "Both oldSpecText and newSpecText must be text strings." }, { status: 400 });
    }

    if (body.oldSpecText.length > MAX_SPEC_CHARS || body.newSpecText.length > MAX_SPEC_CHARS) {
      return NextResponse.json({ error: "Each specification must be smaller than 500,000 characters in this MVP." }, { status: 413 });
    }
    if (body.oldSpecText.trim().length === 0 || body.newSpecText.trim().length === 0) {
      return NextResponse.json({ error: "Both the old and new specifications are required." }, { status: 400 });
    }

    const oldSpec = parseSpecText(body.oldSpecText, "Old specification");
    const newSpec = parseSpecText(body.newSpecText, "New specification");
    const result = compareOpenApi(oldSpec, newSpec);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
