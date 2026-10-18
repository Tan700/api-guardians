export type Severity = "breaking" | "warning" | "info";
export type FindingCategory = "endpoint" | "parameter" | "request" | "response" | "schema";

export type Finding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  location: string;
  message: string;
  recommendation: string;
};

export type CompareResult = {
  oldVersion: string;
  newVersion: string;
  summary: { breaking: number; warnings: number; info: number; total: number };
  findings: Finding[];
};

type JsonObject = Record<string, unknown>;
const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;
type HttpMethod = (typeof METHODS)[number];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}
function asString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}
function keys(value: unknown): string[] {
  return isObject(value) ? Object.keys(value) : [];
}
function findContentSchema(container: unknown): unknown {
  const content = asObject(asObject(container).content);
  if (isObject(content["application/json"])) return asObject(content["application/json"]).schema;
  for (const media of Object.values(content)) {
    if (isObject(media) && "schema" in media) return media.schema;
  }
  return undefined;
}
function resolveRef(schema: unknown, spec: JsonObject, seen = new Set<string>()): unknown {
  if (!isObject(schema) || typeof schema.$ref !== "string") return schema;
  const ref = schema.$ref;
  if (!ref.startsWith("#/" ) || seen.has(ref)) return schema;
  seen.add(ref);
  const parts = ref.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = spec;
  for (const part of parts) current = asObject(current)[part];
  return current === undefined ? schema : resolveRef(current, spec, seen);
}
function getOperations(spec: JsonObject): Map<string, { method: HttpMethod; path: string; operation: JsonObject }> {
  const operations = new Map<string, { method: HttpMethod; path: string; operation: JsonObject }>();
  const paths = asObject(spec.paths);
  for (const [path, pathItemUnknown] of Object.entries(paths)) {
    const pathItem = asObject(pathItemUnknown);
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (isObject(operation)) operations.set(`${method.toUpperCase()} ${path}`, { method, path, operation });
    }
  }
  return operations;
}
function getSchemaForRequest(operation: JsonObject): unknown {
  return findContentSchema(operation.requestBody);
}
function getRequired(schema: unknown, spec: JsonObject): Set<string> {
  const resolved = asObject(resolveRef(schema, spec));
  const value = resolved.required;
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

export function compareOpenApi(oldUnknown: unknown, newUnknown: unknown): CompareResult {
  if (!isObject(oldUnknown) || !isObject(newUnknown)) throw new Error("Both specifications must be JSON objects.");
  const oldSpec = oldUnknown;
  const newSpec = newUnknown;
  if (!isObject(oldSpec.paths) || !isObject(newSpec.paths)) {
    throw new Error("Both files must contain a 'paths' object. Upload OpenAPI JSON specifications.");
  }

  const findings: Finding[] = [];
  const add = (finding: Omit<Finding, "id">) => findings.push({ ...finding, id: `finding-${findings.length + 1}` });
  const oldOps = getOperations(oldSpec);
  const newOps = getOperations(newSpec);

  for (const [key, previous] of oldOps) {
    const current = newOps.get(key);
    if (!current) {
      add({
        severity: "breaking", category: "endpoint", title: "Endpoint removed", location: key,
        message: `The ${previous.method.toUpperCase()} operation at ${previous.path} exists in the old specification but not the new one. Existing clients may fail.`,
        recommendation: "Confirm that the operation is intentionally retired. Consider keeping it during a deprecation window or providing a migration path."
      });
      continue;
    }

    compareParameters(previous.operation, current.operation, key, oldSpec, newSpec, add);
    compareRequestBodies(previous.operation, current.operation, key, oldSpec, newSpec, add);
    compareResponses(previous.operation, current.operation, key, oldSpec, newSpec, add);
  }

  for (const [key, current] of newOps) {
    if (!oldOps.has(key)) {
      add({
        severity: "info", category: "endpoint", title: "Endpoint added", location: key,
        message: `The ${current.method.toUpperCase()} operation at ${current.path} is new in the latest specification.`,
        recommendation: "Add or update client methods if your application needs this capability."
      });
    }
  }

  const order: Record<Severity, number> = { breaking: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.location.localeCompare(b.location));
  findings.forEach((finding, index) => { finding.id = `finding-${index + 1}`; });
  const summary = {
    breaking: findings.filter((finding) => finding.severity === "breaking").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    total: findings.length
  };
  return {
    oldVersion: asString(asObject(oldSpec.info).version),
    newVersion: asString(asObject(newSpec.info).version),
    summary,
    findings
  };
}

type AddFinding = (finding: Omit<Finding, "id">) => void;

function mergeParameters(operation: JsonObject, pathItem: JsonObject): unknown[] {
  const operationParams = Array.isArray(operation.parameters) ? operation.parameters : [];
  const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
  return [...pathParams, ...operationParams];
}
function getPathItem(spec: JsonObject, path: string): JsonObject {
  return asObject(asObject(spec.paths)[path]);
}
function compareParameters(oldOp: JsonObject, newOp: JsonObject, key: string, oldSpec: JsonObject, newSpec: JsonObject, add: AddFinding): void {
  const path = key.substring(key.indexOf(" ") + 1);
  const oldParams = mergeParameters(oldOp, getPathItem(oldSpec, path));
  const newParams = mergeParameters(newOp, getPathItem(newSpec, path));
  const oldMap = new Map<string, JsonObject>();
  const newMap = new Map<string, JsonObject>();
  for (const param of oldParams) if (isObject(param) && typeof param.name === "string") oldMap.set(`${asString(param.in)}:${param.name}`, param);
  for (const param of newParams) if (isObject(param) && typeof param.name === "string") newMap.set(`${asString(param.in)}:${param.name}`, param);

  for (const [identity, previous] of oldMap) {
    const current = newMap.get(identity);
    if (!current) {
      add({ severity: "breaking", category: "parameter", title: "Parameter removed", location: `${key} · ${identity}`,
        message: `The ${identity} parameter was removed. Clients that still send or depend on it may stop working.`,
        recommendation: "Check existing callers and provide a migration or deprecation window before removing the parameter." });
      continue;
    }
    const oldRequired = previous.required === true;
    const newRequired = current.required === true;
    if (!oldRequired && newRequired) {
      add({ severity: "breaking", category: "parameter", title: "Parameter is now required", location: `${key} · ${identity}`,
        message: `The parameter ${identity} changed from optional to required. Existing calls may fail validation.`,
        recommendation: "Update all callers to send the parameter, or keep it optional until callers have migrated." });
    }
    compareSimpleSchema(previous.schema, current.schema, `${key} · parameter ${identity}`, add, "parameter");
  }
  for (const [identity, current] of newMap) {
    if (!oldMap.has(identity)) {
      const required = current.required === true;
      add({ severity: required ? "breaking" : "info", category: "parameter", title: required ? "Required parameter added" : "Optional parameter added", location: `${key} · ${identity}`,
        message: required ? `The new ${identity} parameter is required, so older clients may fail.` : `The optional ${identity} parameter was added. Existing calls usually remain valid.`,
        recommendation: required ? "Avoid requiring this parameter without a migration plan, or update all clients before rollout." : "No immediate action is normally needed; use the parameter when your integration needs it." });
    }
  }
}

function compareSimpleSchema(oldSchema: unknown, newSchema: unknown, location: string, add: AddFinding, category: FindingCategory): void {
  const oldObj = asObject(oldSchema);
  const newObj = asObject(newSchema);
  if (typeof oldObj.type === "string" && typeof newObj.type === "string" && oldObj.type !== newObj.type) {
    add({ severity: "breaking", category, title: "Data type changed", location,
      message: `The type changed from '${oldObj.type}' to '${newObj.type}'. Client serialization or validation may break.`,
      recommendation: "Review generated clients and validators. Consider introducing a new field or API version instead of changing the type in place." });
  }
}

function compareRequestBodies(oldOp: JsonObject, newOp: JsonObject, key: string, oldSpec: JsonObject, newSpec: JsonObject, add: AddFinding): void {
  const oldBody = asObject(oldOp.requestBody);
  const newBody = asObject(newOp.requestBody);
  if (Object.keys(oldBody).length === 0 && Object.keys(newBody).length > 0) {
    if (newBody.required === true) add({ severity: "breaking", category: "request", title: "Required request body added", location: key,
      message: "The operation now requires a request body; older clients may send no body.", recommendation: "Update callers or make the request body optional during migration." });
    return;
  }
  if (Object.keys(oldBody).length > 0 && Object.keys(newBody).length === 0) {
    add({ severity: "warning", category: "request", title: "Request body removed", location: key,
      message: "The request body is no longer described. Confirm whether the operation's contract intentionally changed.", recommendation: "Check backend behavior and client generators before treating this as safe." });
    return;
  }
  if (oldBody.required !== true && newBody.required === true) {
    add({ severity: "breaking", category: "request", title: "Request body is now required", location: key,
      message: "Clients that omit the request body may now fail.", recommendation: "Update callers or preserve optional-body behavior until the migration is complete." });
  }
  const oldSchema = findContentSchema(oldBody);
  const newSchema = findContentSchema(newBody);
  if (oldSchema !== undefined && newSchema !== undefined) {
    compareSchemas(oldSchema, newSchema, key, oldSpec, newSpec, add, "request", "request");
  }
}

function compareResponses(oldOp: JsonObject, newOp: JsonObject, key: string, oldSpec: JsonObject, newSpec: JsonObject, add: AddFinding): void {
  const oldResponses = asObject(oldOp.responses);
  const newResponses = asObject(newOp.responses);
  for (const status of Object.keys(oldResponses)) {
    if (!(status in newResponses)) {
      add({ severity: "warning", category: "response", title: "Response status removed", location: `${key} · ${status}`,
        message: `Response ${status} is no longer described. Clients may depend on this response being documented or handled.`,
        recommendation: "Verify the runtime contract and ensure clients handle the new response behavior." });
      continue;
    }
    const oldSchema = findContentSchema(oldResponses[status]);
    const newSchema = findContentSchema(newResponses[status]);
    if (oldSchema !== undefined && newSchema !== undefined) {
      compareSchemas(oldSchema, newSchema, `${key} · response ${status}`, oldSpec, newSpec, add, "response", "response");
    }
  }
  for (const status of Object.keys(newResponses)) {
    if (!(status in oldResponses)) {
      add({ severity: "info", category: "response", title: "Response status added", location: `${key} · ${status}`,
        message: `The specification now documents an additional ${status} response.`,
        recommendation: "Ensure the client handles the response if this status can occur at runtime." });
    }
  }
}

type SchemaContext = "request" | "response";
function compareSchemas(oldUnknown: unknown, newUnknown: unknown, location: string, oldSpec: JsonObject, newSpec: JsonObject, add: AddFinding, category: FindingCategory, context: SchemaContext, visited = new Set<string>()): void {
  const oldResolved = asObject(resolveRef(oldUnknown, oldSpec));
  const newResolved = asObject(resolveRef(newUnknown, newSpec));
  const visitKey = `${location}:${JSON.stringify(oldUnknown)}:${JSON.stringify(newUnknown)}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  if (typeof oldResolved.type === "string" && typeof newResolved.type === "string" && oldResolved.type !== newResolved.type) {
    add({ severity: "breaking", category: "schema", title: "Schema type changed", location,
      message: `The schema type changed from '${oldResolved.type}' to '${newResolved.type}'. Existing clients may be incompatible.`,
      recommendation: "Use a compatible migration or a new API version, and update clients and tests." });
    return;
  }

  if (Array.isArray(oldResolved.enum) && Array.isArray(newResolved.enum)) {
    const newer = new Set(newResolved.enum);
    const removed = oldResolved.enum.filter((value) => !newer.has(value));
    if (removed.length) add({ severity: "breaking", category: "schema", title: "Enum values removed", location,
      message: `Allowed values were removed: ${removed.map(String).join(", ")}. Existing data or callers may still use them.`,
      recommendation: "Keep old values during a transition or update all clients and persisted data before deployment." });
    const older = new Set(oldResolved.enum);
    const addedValues = newResolved.enum.filter((value) => !older.has(value));
    if (addedValues.length) add({ severity: "info", category: "schema", title: "Enum values added", location,
      message: `New enum values were added: ${addedValues.map(String).join(", ")}.`,
      recommendation: "Check whether clients use exhaustive enum handling, which can fail when new values appear." });
  }

  const oldProps = asObject(oldResolved.properties);
  const newProps = asObject(newResolved.properties);
  const oldRequired = getRequired(oldResolved, oldSpec);
  const newRequired = getRequired(newResolved, newSpec);
  for (const property of Object.keys(oldProps)) {
    if (!(property in newProps)) {
      add({ severity: "breaking", category: "schema", title: context === "response" ? "Response field removed" : "Request field removed", location: `${location}.${property}`,
        message: context === "response" ? `The response no longer describes '${property}'. Client code that reads this field may break.` : `The request no longer describes '${property}'. Existing callers may send a field the server no longer accepts or uses.`,
        recommendation: "Search consumers and producers for this field. Consider a deprecation period or a versioned migration." });
      continue;
    }
    compareSchemas(oldProps[property], newProps[property], `${location}.${property}`, oldSpec, newSpec, add, category, context, visited);
  }
  for (const property of Object.keys(newProps)) {
    if (!(property in oldProps)) {
      const required = newRequired.has(property);
      const breaking = context === "request" && required;
      add({ severity: breaking ? "breaking" : "info", category: "schema", title: breaking ? "New required request field" : context === "response" ? "Response field added" : "Optional request field added", location: `${location}.${property}`,
        message: breaking ? `The request now requires '${property}'. Older clients will not send it and may fail.` : context === "response" ? `The response may now include '${property}'. This is usually additive, but strict clients may need updates.` : `The optional request field '${property}' was added. Existing requests usually remain valid.`,
        recommendation: breaking ? "Make the new field optional during migration or update all clients before requiring it." : "Update generated types or clients if your application needs this field." });
    }
  }

  const oldItems = oldResolved.items;
  const newItems = newResolved.items;
  if (oldItems !== undefined && newItems !== undefined) {
    compareSchemas(oldItems, newItems, `${location}[]`, oldSpec, newSpec, add, category, context, visited);
  }
}
