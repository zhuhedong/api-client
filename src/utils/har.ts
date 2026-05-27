import type {
  Collection,
  CollectionRequest,
  KeyValue,
  RequestItem,
  ResponseData,
} from "../types";

/**
 * HAR 1.2 spec types — minimal subset needed for our exports.
 * See http://www.softwareishard.com/blog/har-12-spec/ for the full spec.
 *
 * These types are exported and shared between the *import* path (parsing
 * a `.har` file into a Collection) and the *export* path (building a HAR
 * document from a single request/response pair).
 */
export interface HarHeader {
  name: string;
  value: string;
}
export interface HarQueryString {
  name: string;
  value: string;
}
export interface HarPostData {
  mimeType: string;
  text: string;
  params?: { name: string; value: string }[];
}
export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarHeader[];
  headers: HarHeader[];
  queryString: HarQueryString[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
}
export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: "base64";
}
export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarHeader[];
  headers: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}
export interface HarTimings {
  send: number;
  wait: number;
  receive: number;
  blocked?: number;
  dns?: number;
  connect?: number;
  ssl?: number;
}
export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: HarTimings;
}
export interface HarLog {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

// ---------------------------------------------------------------------------
// Import: HAR → Collection
// ---------------------------------------------------------------------------

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

/**
 * Loose schema used when *parsing* arbitrary HAR files. We can't assume the
 * file is well-formed — entries may be missing fields, request may have no
 * postData, etc. — so we accept partials and fill in sensible defaults.
 */
interface HarImportFile {
  log?: {
    entries?: HarImportEntry[];
  };
}

interface HarImportEntry {
  request: {
    method?: string;
    url?: string;
    headers?: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
  };
}

/**
 * Parse a HAR (HTTP Archive) v1.2 file into a single Collection. Each entry
 * becomes one request named after its URL path.
 *
 * Reference: http://www.softwareishard.com/blog/har-12-spec/
 */
export function harToCollection(data: unknown): Collection {
  const root = data as HarImportFile;
  const entries = root?.log?.entries || [];
  const now = Date.now();

  const requests: CollectionRequest[] = entries.map((e) => {
    const r = e.request;
    const url = r.url || "";
    const headers: KeyValue[] = (r.headers || []).map((h) => ({
      id: genId(),
      key: h.name,
      value: h.value,
      // HAR records what was actually sent on the wire; drop hop-by-hop
      // headers and cookies (those get re-applied automatically) but keep
      // everything else enabled so the request reproduces faithfully.
      enabled: !isHopByHop(h.name),
    }));
    if (headers.length === 0) headers.push(emptyKV());

    const params: KeyValue[] = (r.queryString || []).map((q) => ({
      id: genId(),
      key: q.name,
      value: q.value,
      enabled: true,
    }));
    if (params.length === 0) params.push(emptyKV());

    let body = "";
    let bodyType: CollectionRequest["body_type"] = "none";
    if (r.postData) {
      body = r.postData.text || "";
      const mime = (r.postData.mimeType || "").toLowerCase();
      if (mime.includes("json")) bodyType = "json";
      else if (mime.includes("xml")) bodyType = "xml";
      else if (mime.includes("form-urlencoded")) bodyType = "text";
      else if (mime) bodyType = "text";
    }

    return {
      id: genId(),
      name: makeName(r.method, url),
      method: (r.method || "GET").toUpperCase(),
      url: stripQuery(url),
      headers,
      params,
      body,
      body_type: bodyType,
      auth: { auth_type: "inherit" },
      created_at: now,
      updated_at: now,
    };
  });

  return {
    id: genId(),
    name: "HAR Import",
    description: `Imported ${requests.length} request(s) from HAR.`,
    requests,
    folders: [],
    created_at: now,
    updated_at: now,
  };
}

function makeName(method: string | undefined, url: string): string {
  try {
    const u = new URL(url);
    return `${(method || "GET").toUpperCase()} ${u.pathname || "/"}`;
  } catch {
    return `${(method || "GET").toUpperCase()} ${url}`;
  }
}

/** Strip the query string from `url` because HAR also reports it as `queryString` entries. */
function stripQuery(url: string): string {
  const idx = url.indexOf("?");
  return idx >= 0 ? url.slice(0, idx) : url;
}

function isHopByHop(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "host" ||
    n === "content-length" ||
    n === "connection" ||
    n === "keep-alive" ||
    n === "proxy-connection" ||
    n === "transfer-encoding" ||
    n === "upgrade"
  );
}

// ---------------------------------------------------------------------------
// Export: request + response → HAR
// ---------------------------------------------------------------------------

function headersFromRecord(headers: Record<string, string>): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function queryStringFromUrl(url: string): HarQueryString[] {
  const idx = url.indexOf("?");
  if (idx < 0) return [];
  const qs = url.slice(idx + 1);
  const pairs = qs.split("&").filter(Boolean);
  return pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      return { name: decodeOrRaw(pair), value: "" };
    }
    return {
      name: decodeOrRaw(pair.slice(0, eq)),
      value: decodeOrRaw(pair.slice(eq + 1)),
    };
  });
}

function decodeOrRaw(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function mimeFromHeaders(headers: Record<string, string>): string {
  const ct = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === "content-type",
  )?.[1];
  return ct ?? "";
}

function postDataFor(req: RequestItem): HarPostData | undefined {
  if (req.bodyType === "none") return undefined;

  if (req.bodyType === "form-data") {
    const enabled = req.formData.filter((f) => f.enabled && f.key);
    return {
      mimeType: "multipart/form-data",
      text: enabled.map((f) => `${f.key}=${f.value}`).join("&"),
      params: enabled.map((f) => ({ name: f.key, value: f.value })),
    };
  }

  let mime: string;
  let text: string;
  switch (req.bodyType) {
    case "json":
      mime = "application/json";
      text = req.body ?? "";
      break;
    case "xml":
      mime = "application/xml";
      text = req.body ?? "";
      break;
    case "graphql":
      mime = "application/json";
      // For GraphQL the wire body is a JSON envelope. We emit the raw
      // user-authored body so the HAR import-side can round-trip it; the
      // backend may apply its own envelope when actually sending.
      text = req.body ?? "";
      break;
    case "text":
    default:
      mime = "text/plain";
      text = req.body ?? "";
      break;
  }
  return { mimeType: mime, text };
}

/**
 * Build a HAR 1.2 log object for a single request/response pair.
 *
 * - `finalUrl` is the substituted URL (typically from `resolveRequestUrl`) —
 *   we use it as the canonical URL on the HAR request and to derive
 *   `queryString`. The HAR spec requires `queryString` to be present
 *   independently of the URL, so we re-extract it from `finalUrl`.
 * - `startedAtMs` is a Unix-epoch millisecond timestamp; we render it as ISO
 *   8601 because HAR requires it. When the caller doesn't have a recorded
 *   start time, computing `Date.now() - response.time_ms` immediately after
 *   the send is a fine approximation.
 * - `headersSize` / `bodySize` are set to `-1` per the spec when unknown.
 */
export function buildHarLog(
  request: RequestItem,
  response: ResponseData,
  finalUrl: string,
  startedAtMs: number,
  creator: { name: string; version: string } = {
    name: "api-client",
    version: "0.1.0",
  },
): HarLog {
  const reqHeaders: HarHeader[] = request.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => ({ name: h.key, value: h.value }));

  const respHeaders = headersFromRecord(response.headers);

  const harRequest: HarRequest = {
    method: request.method,
    url: finalUrl,
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: reqHeaders,
    queryString: queryStringFromUrl(finalUrl),
    postData: postDataFor(request),
    headersSize: -1,
    bodySize: request.body ? new TextEncoder().encode(request.body).length : 0,
  };

  const respMime = mimeFromHeaders(response.headers);
  const content: HarContent =
    response.body_encoding === "base64"
      ? {
          size: response.size_bytes,
          mimeType: respMime,
          text: response.body,
          encoding: "base64",
        }
      : {
          size: response.size_bytes,
          mimeType: respMime,
          text: response.body,
        };

  const redirectHeader = Object.entries(response.headers).find(
    ([k]) => k.toLowerCase() === "location",
  );

  const harResponse: HarResponse = {
    status: response.status,
    statusText: response.status_text,
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: respHeaders,
    content,
    redirectURL: redirectHeader?.[1] ?? "",
    headersSize: -1,
    bodySize: response.size_bytes,
  };

  // Two-phase split: send=0, wait=time-to-first-byte, receive=download.
  // Reqwest doesn't surface DNS/connect/SSL individually without a custom
  // connector, so we leave those out (HAR allows omitting them).
  const timings: HarTimings = response.timings
    ? {
        send: 0,
        wait: response.timings.wait_ms,
        receive: response.timings.download_ms,
      }
    : {
        send: 0,
        wait: response.time_ms,
        receive: 0,
      };

  return {
    log: {
      version: "1.2",
      creator,
      entries: [
        {
          startedDateTime: new Date(startedAtMs).toISOString(),
          time: response.time_ms,
          request: harRequest,
          response: harResponse,
          cache: {},
          timings,
        },
      ],
    },
  };
}
