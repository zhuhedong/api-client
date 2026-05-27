import yaml from "js-yaml";
import type {
  Collection,
  CollectionFolder,
  CollectionRequest,
  KeyValue,
  MockRoute,
} from "../types";

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

/**
 * Parse an OpenAPI 3.x or Swagger 2.0 spec from a JSON/YAML string and convert
 * it into a Collection. Falls back to JSON parsing if YAML fails.
 *
 * Supports:
 *  - JSON and YAML input
 *  - Both Swagger 2.0 (`host` + `basePath`) and OpenAPI 3.x (`servers[]`)
 *  - Operations grouped into folders by their first tag
 *  - Query and header parameters
 *  - JSON request body examples (from `example`, `examples`, or `schema`)
 */
export function openapiToCollection(input: string | object): Collection {
  const spec = typeof input === "string" ? parseSpec(input) : (input as OpenApiSpec);
  const isV3 = !!spec.openapi;
  const baseUrl = pickBaseUrl(spec);
  const collectionName =
    (spec.info && spec.info.title) || (isV3 ? "OpenAPI Import" : "Swagger Import");
  const description = (spec.info && spec.info.description) || "";

  const now = Date.now();
  const byTag = new Map<string, CollectionRequest[]>();
  const noTag: CollectionRequest[] = [];

  const paths = spec.paths || {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"] as const) {
      const op = (pathItem as Record<string, OpenApiOperation | undefined>)[method];
      if (!op) continue;

      const req = operationToRequest(op, method.toUpperCase(), path, baseUrl, spec, now);
      const tag = op.tags && op.tags.length > 0 ? op.tags[0] : null;
      if (tag) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(req);
      } else {
        noTag.push(req);
      }
    }
  }

  const folders: CollectionFolder[] = [];
  for (const [tag, reqs] of byTag) {
    folders.push({
      id: genId(),
      name: tag,
      requests: reqs,
      folders: [],
    });
  }

  return {
    id: genId(),
    name: collectionName,
    description,
    requests: noTag,
    folders,
    created_at: now,
    updated_at: now,
  };
}

function parseSpec(raw: string): OpenApiSpec {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as OpenApiSpec;
    } catch {
      // fall through to YAML
    }
  }
  return yaml.load(trimmed) as OpenApiSpec;
}

function pickBaseUrl(spec: OpenApiSpec): string {
  if (spec.servers && spec.servers.length > 0) {
    const server = spec.servers[0];
    let url = server.url || "";
    // Substitute server variables with their defaults.
    if (server.variables) {
      for (const [k, v] of Object.entries(server.variables)) {
        url = url.replace(new RegExp(`\\{${k}\\}`, "g"), v.default ?? "");
      }
    }
    return url.replace(/\/$/, "");
  }
  if (spec.host) {
    const scheme = spec.schemes && spec.schemes.includes("https") ? "https" : spec.schemes?.[0] || "https";
    const basePath = spec.basePath || "";
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, "");
  }
  return "";
}

function operationToRequest(
  op: OpenApiOperation,
  method: string,
  path: string,
  baseUrl: string,
  spec: OpenApiSpec,
  now: number
): CollectionRequest {
  const headers: KeyValue[] = [];
  const params: KeyValue[] = [];

  const allParams = [...(op.parameters || []), ...((spec.paths?.[path] as PathItem | undefined)?.parameters || [])];
  for (const p of allParams) {
    if (!p || !p.name) continue;
    if (p.in === "query") {
      params.push({
        id: genId(),
        key: p.name,
        value: typeof p.example === "string" ? p.example : "",
        enabled: !!p.required,
      });
    } else if (p.in === "header") {
      headers.push({
        id: genId(),
        key: p.name,
        value: typeof p.example === "string" ? p.example : "",
        enabled: !!p.required,
      });
    }
  }
  if (params.length === 0) params.push(emptyKV());
  if (headers.length === 0) headers.push(emptyKV());

  let body = "";
  let bodyType: CollectionRequest["body_type"] = "none";
  if (op.requestBody) {
    const content = op.requestBody.content || {};
    const jsonEntry = content["application/json"];
    if (jsonEntry) {
      body = sampleFromMedia(jsonEntry);
      bodyType = "json";
    } else {
      const first = Object.entries(content)[0];
      if (first) {
        const [mime, media] = first;
        body = sampleFromMedia(media);
        bodyType = mime.includes("xml") ? "xml" : "text";
      }
    }
  }

  const url = `${baseUrl}${path}`;
  return {
    id: genId(),
    name: op.summary || op.operationId || `${method} ${path}`,
    method,
    url,
    headers,
    params,
    body,
    body_type: bodyType,
    auth: { auth_type: "inherit" },
    created_at: now,
    updated_at: now,
  };
}

function sampleFromMedia(media: OpenApiMedia): string {
  if (media.example !== undefined) return stringifyMaybe(media.example);
  if (media.examples) {
    const first = Object.values(media.examples)[0];
    if (first && "value" in first) return stringifyMaybe(first.value);
  }
  if (media.schema) {
    const sample = sampleFromSchema(media.schema);
    if (sample !== undefined) return stringifyMaybe(sample);
  }
  return "";
}

function stringifyMaybe(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Build a tiny synthetic example from a JSON schema. Only covers the common shapes. */
function sampleFromSchema(schema: OpenApiSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 4) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "string":
      return schema.format === "date-time" ? new Date().toISOString() : "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [sampleFromSchema(schema.items, depth + 1)];
    case "object":
    default: {
      if (!schema.properties) return {};
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        obj[k] = sampleFromSchema(v, depth + 1);
      }
      return obj;
    }
  }
}

// === Minimal OpenAPI types (we only touch a subset). ===
interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: { url: string; variables?: Record<string, { default?: string }> }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, PathItem>;
}

interface PathItem {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

interface OpenApiOperation {
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, OpenApiMedia> };
  /** Used by openApiToMockRoutes when generating mock responses. */
  responses?: Record<string, OpenApiOperationResponse>;
}

interface OpenApiOperationResponse {
  description?: string;
  content?: Record<string, OpenApiMedia>;
}

interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie" | "body";
  required?: boolean;
  example?: unknown;
  schema?: OpenApiSchema;
}

interface OpenApiMedia {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
}

interface OpenApiSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
}

// ============================================================================
// Export: Collection → OpenAPI 3.0.3 JSON
// ============================================================================

interface ExportOpenApiInfo {
  title: string;
  description?: string;
  version: string;
}

interface ExportOpenApiParameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  schema?: { type: string };
}

interface ExportOpenApiMediaType {
  schema?: Record<string, unknown>;
  example?: unknown;
}

interface ExportOpenApiRequestBody {
  content: Record<string, ExportOpenApiMediaType>;
}

interface ExportOpenApiResponse {
  description: string;
  content?: Record<string, ExportOpenApiMediaType>;
}

interface ExportOpenApiOperation {
  summary?: string;
  operationId?: string;
  parameters?: ExportOpenApiParameter[];
  requestBody?: ExportOpenApiRequestBody;
  responses: Record<string, ExportOpenApiResponse>;
  tags?: string[];
}

type ExportOpenApiPathItem = Partial<Record<string, ExportOpenApiOperation>>;

interface ExportOpenApiSpec {
  openapi: string;
  info: ExportOpenApiInfo;
  paths: Record<string, ExportOpenApiPathItem>;
  tags?: { name: string; description?: string }[];
}

function slugifyOperation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Extract the path component of a URL, normalizing :param / {{param}} to {param}. */
function extractPath(url: string): string {
  try {
    const u = new URL(
      url.startsWith("http")
        ? url
        : `http://x${url.startsWith("/") ? "" : "/"}${url}`,
    );
    return (
      u.pathname
        .split("/")
        .map((seg) => {
          if (seg.startsWith(":")) return `{${seg.slice(1)}}`;
          if (seg.startsWith("{{") && seg.endsWith("}}"))
            return `{${seg.slice(2, -2)}}`;
          return seg;
        })
        .join("/") || "/"
    );
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function guessSchemaType(value: string): string {
  if (value === "true" || value === "false") return "boolean";
  if (!isNaN(Number(value)) && value.trim() !== "") return "number";
  return "string";
}

function bodyToRequestBody(
  body: string,
  bodyType: string,
): ExportOpenApiRequestBody | undefined {
  if (!body.trim()) return undefined;
  const contentType =
    bodyType === "json"
      ? "application/json"
      : bodyType === "xml"
        ? "application/xml"
        : bodyType === "form"
          ? "application/x-www-form-urlencoded"
          : "text/plain";

  let example: unknown = undefined;
  let schema: Record<string, unknown> | undefined = undefined;
  if (bodyType === "json") {
    try {
      example = JSON.parse(body);
      const t =
        typeof example === "object" && example !== null
          ? Array.isArray(example)
            ? "array"
            : "object"
          : typeof example;
      schema = { type: t };
    } catch {
      /* invalid JSON — fall through with no schema */
    }
  }
  return {
    content: {
      [contentType]: {
        ...(schema ? { schema } : {}),
        ...(example !== undefined ? { example } : {}),
      },
    },
  };
}

function requestToOperation(
  req: CollectionRequest,
  folderName?: string,
): ExportOpenApiOperation {
  const params: ExportOpenApiParameter[] = [];

  // Query parameters
  for (const p of req.params) {
    if (!p.enabled || !p.key) continue;
    params.push({
      name: p.key,
      in: "query",
      schema: { type: guessSchemaType(p.value) },
    });
  }

  // Path parameters extracted from the URL
  const path = extractPath(req.url);
  const pathParams = path.match(/\{([^}]+)\}/g) ?? [];
  for (const pp of pathParams) {
    const name = pp.slice(1, -1);
    if (!params.find((p) => p.name === name && p.in === "path")) {
      params.push({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    }
  }

  // Header parameters (skip Content-Type — it's implied by requestBody)
  for (const h of req.headers) {
    if (!h.enabled || !h.key) continue;
    if (h.key.toLowerCase() === "content-type") continue;
    params.push({ name: h.key, in: "header", schema: { type: "string" } });
  }

  const op: ExportOpenApiOperation = {
    summary: req.name || undefined,
    operationId: slugifyOperation(req.name || req.url),
    responses: { "200": { description: "Successful response" } },
  };
  if (params.length > 0) op.parameters = params;
  if (folderName) op.tags = [folderName];
  const reqBody = bodyToRequestBody(req.body, req.body_type);
  if (reqBody) op.requestBody = reqBody;
  return op;
}

function flattenCollection(
  col: Collection,
): { req: CollectionRequest; folderName?: string }[] {
  const out: { req: CollectionRequest; folderName?: string }[] = [];
  for (const r of col.requests) out.push({ req: r });
  function walk(folders: CollectionFolder[]) {
    for (const f of folders) {
      for (const r of f.requests) out.push({ req: r, folderName: f.name });
      walk(f.folders);
    }
  }
  walk(col.folders);
  return out;
}

/**
 * Export a Collection as an OpenAPI 3.0.3 JSON specification.
 *
 * - Folders become operation tags.
 * - Query params, path params (extracted from `:name` / `{{name}}` segments),
 *   and request headers become `parameters[]`.
 * - JSON request bodies are parsed for examples and a coarse schema type.
 * - The collection's name + description seed the `info` block.
 */
export function exportOpenApi(col: Collection): string {
  const spec: ExportOpenApiSpec = {
    openapi: "3.0.3",
    info: {
      title: col.name,
      description: col.description || undefined,
      version: "1.0.0",
    },
    paths: {},
  };

  const tags = new Set<string>();
  for (const { req, folderName } of flattenCollection(col)) {
    const path = extractPath(req.url);
    const method = req.method.toLowerCase();
    if (!spec.paths[path]) spec.paths[path] = {};
    spec.paths[path][method] = requestToOperation(req, folderName);
    if (folderName) tags.add(folderName);
  }
  if (tags.size > 0) spec.tags = [...tags].map((name) => ({ name }));

  return JSON.stringify(spec, null, 2);
}

// ============================================================================
// Import: OpenAPI → MockRoute[]
// ============================================================================

/** Convert OpenAPI `{name}` path params to the mock server's `:name` syntax. */
function openApiPathToMockPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/**
 * Generate `MockRoute[]` from an OpenAPI 3.x / Swagger 2.0 spec string.
 *
 * One MockRoute per operation. For each operation we pick the first 2xx
 * response (falling back to the first response) and try, in order:
 *   1. `content[ct].example`
 *   2. `content[ct].examples[*].value`
 *   3. A synthetic example derived from `content[ct].schema`
 *
 * If none of those exist, the route returns `{ message: <summary or "OK"> }`
 * with `Content-Type: application/json` so the mock at least responds with
 * something plausible.
 */
export function openApiToMockRoutes(specInput: string | object): MockRoute[] {
  let spec: { paths?: Record<string, Record<string, OpenApiOperation>> };
  try {
    spec =
      typeof specInput === "string"
        ? (yaml.load(specInput) as typeof spec)
        : (specInput as typeof spec);
  } catch {
    spec =
      typeof specInput === "string"
        ? (JSON.parse(specInput) as typeof spec)
        : (specInput as typeof spec);
  }
  const routes: MockRoute[] = [];
  const now = Date.now();
  const methods = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
  ];

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of methods) {
      const op = (pathItem as Record<string, OpenApiOperation | undefined>)[
        method
      ];
      if (!op) continue;

      const responseEntries = Object.entries(op.responses ?? {});
      const successEntry =
        responseEntries.find(([code]) => code.startsWith("2")) ??
        responseEntries[0];
      const status = successEntry ? parseInt(successEntry[0], 10) || 200 : 200;
      const responseObj = successEntry?.[1];

      let body = "";
      const headers: KeyValue[] = [];
      if (responseObj?.content) {
        const contentEntries = Object.entries(responseObj.content);
        const [contentType, media] = contentEntries[0] ?? [];
        if (contentType) {
          headers.push({
            id: genId(),
            key: "Content-Type",
            value: contentType,
            enabled: true,
          });
        }
        if (media?.example !== undefined) {
          body =
            typeof media.example === "string"
              ? media.example
              : JSON.stringify(media.example, null, 2);
        } else if (media?.examples) {
          const first = Object.values(media.examples)[0];
          if (first?.value !== undefined) {
            body =
              typeof first.value === "string"
                ? first.value
                : JSON.stringify(first.value, null, 2);
          }
        } else if (media?.schema) {
          const sample = sampleFromSchema(media.schema);
          body =
            typeof sample === "string"
              ? sample
              : JSON.stringify(sample, null, 2);
        }
      }
      if (!body) {
        if (headers.length === 0) {
          headers.push({
            id: genId(),
            key: "Content-Type",
            value: "application/json",
            enabled: true,
          });
        }
        body = JSON.stringify({ message: op.summary ?? "OK" });
      }

      routes.push({
        id: genId(),
        method: method.toUpperCase(),
        path: openApiPathToMockPath(path),
        status,
        headers,
        body,
        enabled: true,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return routes;
}
