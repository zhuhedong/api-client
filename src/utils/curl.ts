import type { HttpMethod, RequestItem, KeyValue } from "../types";
import { substituteAll } from "./dynamicVars";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Serialize a request as a `curl` invocation suitable for copy-paste.
 *
 * When `envVars` is provided, every `{{var}}` / `{{$dynamic}}` placeholder
 * on the request — URL, headers, auth values, body, params — is resolved
 * before being emitted. This matches what the user would actually see if
 * they sent the request from the app, so the copied curl command is
 * directly runnable.
 *
 * Pass `envVars = {}` (or omit it) to copy the raw, un-substituted request
 * — useful for sharing a request template that someone else will fill in
 * their own values for.
 *
 * Unknown placeholders are left intact (same behaviour as
 * `substituteAll`); they survive into the curl output as `{{name}}` so the
 * user can spot what's missing.
 */
export function exportCurl(
  request: RequestItem,
  envVars: Record<string, string> = {},
): string {
  const sub = (s: string): string =>
    substituteAll(s, (k) => envVars[k]);

  const parts: string[] = ["curl"];

  if (request.method !== "GET") {
    parts.push(`-X ${request.method}`);
  }

  const resolvedUrlBase = sub(request.url);
  const urlPlaceholder = `'${resolvedUrlBase}'`;
  parts.push(urlPlaceholder);

  // Headers
  const headers = request.headers.filter((h) => h.enabled && h.key);
  for (const h of headers) {
    parts.push(`-H '${sub(h.key)}: ${sub(h.value)}'`);
  }

  // Auth
  if (request.auth) {
    const auth = request.auth;
    if (auth.auth_type === "bearer" && auth.bearer_token) {
      parts.push(`-H 'Authorization: Bearer ${sub(auth.bearer_token)}'`);
    } else if (auth.auth_type === "basic" && auth.basic_username) {
      parts.push(
        `-u '${sub(auth.basic_username)}:${sub(auth.basic_password || "")}'`,
      );
    } else if (auth.auth_type === "api_key" && auth.api_key_key) {
      if (auth.api_key_in === "header") {
        parts.push(
          `-H '${sub(auth.api_key_key)}: ${sub(auth.api_key_value || "")}'`,
        );
      }
    }
  }

  // Body
  if (request.bodyType === "form-data") {
    const fields = request.formData.filter((f) => f.enabled && f.key);
    for (const f of fields) {
      parts.push(`-F '${sub(f.key)}=${sub(f.value)}'`);
    }
  } else if (request.bodyType !== "none" && request.body) {
    parts.push(`-d '${sub(request.body).replace(/'/g, "'\\''")}'`);
  }

  // Params — append after substitution so the *resolved* URL is what gets
  // the query string. We update the placeholder we pushed above in place
  // so the URL still appears in the same slot in the final command.
  let url = resolvedUrlBase;
  const enabledParams = request.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map(
        (p) =>
          `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`,
      )
      .join("&");
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${qs}`;
    parts[parts.indexOf(urlPlaceholder)] = `'${url}'`;
  }

  return parts.join(" \\\n  ");
}

export function parseCurl(curlCmd: string): Partial<RequestItem> {
  const kv = (key: string, value: string): KeyValue => ({
    id: generateId(),
    key,
    value,
    enabled: true,
  });

  let method: HttpMethod = "GET";
  let url = "";
  const headers: KeyValue[] = [];
  let body = "";
  let bodyType: RequestItem["bodyType"] = "none";
  const formData: KeyValue[] = [];

  // Normalize: join line continuations
  const normalized = curlCmd.replace(/\\\n/g, " ").replace(/\\\r\n/g, " ").trim();

  // Simple tokenizer
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  // Remove leading "curl"
  if (tokens[0]?.toLowerCase() === "curl") tokens.shift();

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "-X" || token === "--request") {
      method = (tokens[++i] || "GET").toUpperCase() as HttpMethod;
    } else if (token === "-H" || token === "--header") {
      const headerStr = tokens[++i] || "";
      const colonIdx = headerStr.indexOf(":");
      if (colonIdx > 0) {
        headers.push(kv(headerStr.slice(0, colonIdx).trim(), headerStr.slice(colonIdx + 1).trim()));
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
      body = tokens[++i] || "";
      bodyType = "json";
      if (method === "GET") method = "POST";
    } else if (token === "-F" || token === "--form") {
      const formStr = tokens[++i] || "";
      const eqIdx = formStr.indexOf("=");
      if (eqIdx > 0) {
        formData.push(kv(formStr.slice(0, eqIdx), formStr.slice(eqIdx + 1)));
      }
      bodyType = "form-data";
      if (method === "GET") method = "POST";
    } else if (token === "-u" || token === "--user") {
      // Basic auth - we'll add it as a header
      const userPass = tokens[++i] || "";
      const encoded = btoa(userPass);
      headers.push(kv("Authorization", `Basic ${encoded}`));
    } else if (!token.startsWith("-")) {
      url = token;
    }
    i++;
  }

  // Try to detect body type from Content-Type header
  const ctHeader = headers.find((h) => h.key.toLowerCase() === "content-type");
  if (ctHeader) {
    if (ctHeader.value.includes("application/json")) bodyType = "json";
    else if (ctHeader.value.includes("text/xml") || ctHeader.value.includes("application/xml")) bodyType = "xml";
    else if (ctHeader.value.includes("text/plain")) bodyType = "text";
  }

  return {
    method,
    url,
    headers: headers.length > 0 ? headers : [kv("", "")],
    body,
    bodyType,
    formData: formData.length > 0 ? formData : [kv("", "")],
  };
}
