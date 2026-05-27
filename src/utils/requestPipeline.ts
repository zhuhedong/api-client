import { invoke } from "@tauri-apps/api/core";
import type {
  Collection,
  RequestItem,
  ResponseData,
  ScriptLog,
  TestResult,
} from "../types";
import { resolveAuth } from "./auth";
import { runScript } from "./scriptRunner";
import { substituteAll } from "./dynamicVars";
import { signSigV4 } from "./sigv4";

/** Defaults pulled from the request store / settings panel. */
export interface PipelineDefaults {
  defaultTimeoutMs: number;
  verifyTlsDefault: boolean;
  /** Per-request inline response body cap (bytes). The backend truncates
   *  larger bodies and flags `body_truncated=true`. Optional so older
   *  callers compile; the backend falls back to its 10 MiB default. */
  maxBodyBytes?: number;
  /** Default redirect policy applied when the request doesn't override it. */
  defaultRedirectPolicy?: "follow" | "none" | "manual";
  /** Default redirect cap. */
  defaultMaxRedirects?: number;
  /** Default proxy URL. Empty string = no proxy. */
  defaultProxyUrl?: string;
}

/** Subset of the request store that holds pipeline defaults. We accept
 *  a plain object so this helper has no dependency on the store module
 *  and stays unit-testable. */
export interface PipelineDefaultsSource {
  defaultTimeoutMs: number;
  verifyTlsDefault: boolean;
  maxBodyBytes: number;
  defaultRedirectPolicy: "follow" | "none" | "manual";
  defaultMaxRedirects: number;
  defaultProxyUrl: string;
}

/** Build a `PipelineDefaults` from the store. Centralizing the field list
 *  here prevents the "single send honours setting X, runner doesn't"
 *  class of bug — every caller goes through this one shape, so a new
 *  default can't be added to the store without showing up everywhere it
 *  needs to be threaded. */
export function pipelineDefaultsFrom(
  source: PipelineDefaultsSource,
): PipelineDefaults {
  return {
    defaultTimeoutMs: source.defaultTimeoutMs,
    verifyTlsDefault: source.verifyTlsDefault,
    maxBodyBytes: source.maxBodyBytes,
    defaultRedirectPolicy: source.defaultRedirectPolicy,
    defaultMaxRedirects: source.defaultMaxRedirects,
    defaultProxyUrl: source.defaultProxyUrl,
  };
}

/** Everything needed to execute one request end-to-end. */
export interface PipelineInput {
  request: RequestItem;
  collections: Collection[];
  /** Mutable environment scope. Pre/post scripts may write to it. */
  envVars: Record<string, string>;
  /** Mutable transient (per-run) variable scope. */
  transientVars: Record<string, string>;
  /** Mutable workspace-global scope. Scripts can read/write via `pm.globals`. */
  globalVars?: Record<string, string>;
  /** Mutable collection scope (the request's owning collection).
   *  Scripts can read/write via `pm.collectionVariables`. */
  collectionVars?: Record<string, string>;
  /** Read-only iteration data row (CSV-driven runs). Available as
   *  `pm.iterationData` in scripts. Default empty. */
  iterationData?: Record<string, string>;
  defaults: PipelineDefaults;
}

/** Per-request execution report — what both the tab UI and the runner display. */
export interface PipelineResult {
  response?: ResponseData;
  error?: string;
  tests: TestResult[];
  logs: ScriptLog[];
  scriptError?: string;
  /** Final substituted URL (for inspection / collection runner reports). */
  finalUrl?: string;
}

/**
 * Resolve `{{name}}` placeholders against the transient scope first, falling
 * back to the environment scope. Unknown keys are left intact.
 */
export function makeSubstitute(
  envVars: Record<string, string>,
  transientVars: Record<string, string>
): (s: string) => string {
  return (str) =>
    substituteAll(str, (key) => transientVars[key] ?? envVars[key]);
}

/**
 * Build the wire-level payload from a `RequestItem` plus the resolved auth
 * chain. Lifted out of `sendRequest` so the Collection Runner reuses the
 * same logic instead of duplicating it.
 */
export async function buildSendPayload(
  req: RequestItem,
  collections: Collection[],
  envVars: Record<string, string>,
  transientVars: Record<string, string>,
  defaults: PipelineDefaults
): Promise<{
  finalUrl: string;
  headers: { key: string; value: string; enabled: boolean }[];
  bodyStr: string | null;
  payload: Record<string, unknown>;
}> {
  const sub = makeSubstitute(envVars, transientVars);

  let finalUrl = sub(req.url);
  const enabledParams = req.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map((p) => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`)
      .join("&");
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}${qs}`;
  }

  const headers = req.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => ({ key: sub(h.key), value: sub(h.value), enabled: h.enabled }));

  // Walk the auth-inheritance chain.
  const auth = resolveAuth(req, collections);
  if (auth && auth.auth_type !== "none" && auth.auth_type !== "inherit") {
    if (auth.auth_type === "bearer" && auth.bearer_token) {
      headers.push({ key: "Authorization", value: `Bearer ${sub(auth.bearer_token)}`, enabled: true });
    } else if (auth.auth_type === "basic" && auth.basic_username) {
      const encoded = btoa(`${sub(auth.basic_username)}:${sub(auth.basic_password || "")}`);
      headers.push({ key: "Authorization", value: `Basic ${encoded}`, enabled: true });
    } else if (auth.auth_type === "api_key" && auth.api_key_key && auth.api_key_in === "header") {
      headers.push({ key: sub(auth.api_key_key), value: sub(auth.api_key_value || ""), enabled: true });
    } else if (auth.auth_type === "oauth2" && auth.oauth2_access_token) {
      // We don't auto-refresh here: the user fetches a token via the
      // "Fetch Token" button in the auth editor, and we just attach
      // whatever's cached. If the token has expired the API will return
      // 401 and the user can re-fetch. Auto-refresh is intentionally
      // deferred — see PR description.
      headers.push({
        key: "Authorization",
        value: `Bearer ${auth.oauth2_access_token}`,
        enabled: true,
      });
    }
    // SigV4 happens after body construction below, since the canonical
    // request hashes the payload. We resolve auth here and stash a flag.
  }

  // Auto Content-Type if user hasn't set one explicitly.
  const hasCT = headers.some((h) => h.key.toLowerCase() === "content-type");
  if (!hasCT) {
    if (req.bodyType === "json" || req.bodyType === "graphql") {
      headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    } else if (req.bodyType === "xml") {
      headers.push({ key: "Content-Type", value: "application/xml", enabled: true });
    } else if (req.bodyType === "text") {
      headers.push({ key: "Content-Type", value: "text/plain", enabled: true });
    }
  }

  // API key in query string.
  if (auth && auth.auth_type === "api_key" && auth.api_key_in === "query" && auth.api_key_key) {
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}${encodeURIComponent(sub(auth.api_key_key))}=${encodeURIComponent(sub(auth.api_key_value || ""))}`;
  }

  // Body.
  let bodyStr: string | null = null;
  let formData:
    | { key: string; value: string; enabled: boolean; is_file?: boolean; file_path?: string }[]
    | null = null;
  if (req.bodyType === "form-data") {
    formData = req.formData
      .filter((f) => f.enabled && f.key)
      .map((f) => ({
        key: f.key,
        value: f.value,
        enabled: f.enabled,
        is_file: !!f.is_file,
        file_path: f.file_path,
      }));
  } else if (req.bodyType === "graphql") {
    bodyStr = JSON.stringify({
      query: sub(req.graphqlQuery || ""),
      variables: req.graphqlVariables ? JSON.parse(sub(req.graphqlVariables)) : undefined,
    });
  } else if (req.bodyType !== "none") {
    bodyStr = sub(req.body || "") || null;
  }

  // AWS SigV4 — signs URL/headers/body. Has to run after the body is fully
  // computed because the signature hashes the payload bytes.
  if (
    auth &&
    auth.auth_type === "sigv4" &&
    auth.aws_access_key_id &&
    auth.aws_secret_access_key &&
    auth.aws_region &&
    auth.aws_service
  ) {
    const sig = await signSigV4({
      method: req.method,
      url: finalUrl,
      // Strip enabled flag — signer only needs k/v pairs.
      headers: headers.map((h) => ({ key: h.key, value: h.value })),
      body: bodyStr,
      // Form-data is built by the Rust backend, so we don't have the
      // exact bytes to hash here. Fall back to UNSIGNED-PAYLOAD which
      // S3/API Gateway accept over HTTPS.
      unsignedPayload: req.bodyType === "form-data",
      accessKeyId: sub(auth.aws_access_key_id),
      secretAccessKey: sub(auth.aws_secret_access_key),
      sessionToken: auth.aws_session_token ? sub(auth.aws_session_token) : undefined,
      region: sub(auth.aws_region),
      service: sub(auth.aws_service),
    });
    for (const h of sig.headers) {
      headers.push({ key: h.key, value: h.value, enabled: true });
    }
  }

  const payload = {
    method: req.method,
    url: finalUrl,
    headers,
    body: bodyStr,
    body_type: req.bodyType !== "none" ? req.bodyType : null,
    form_data: formData,
    timeout_ms: req.timeoutMs ?? defaults.defaultTimeoutMs,
    request_id: req.id,
    verify_tls: req.verifyTls ?? defaults.verifyTlsDefault,
    redirect_policy: req.redirectPolicy ?? defaults.defaultRedirectPolicy ?? null,
    max_redirects:
      req.maxRedirects ?? defaults.defaultMaxRedirects ?? null,
    proxy_url: req.proxyUrl?.trim()
      ? req.proxyUrl.trim()
      : defaults.defaultProxyUrl?.trim()
      ? defaults.defaultProxyUrl.trim()
      : null,
    client_cert:
      req.clientCert && req.clientCert.path
        ? { path: req.clientCert.path, password: req.clientCert.password ?? null }
        : null,
    // Per-request override wins; otherwise fall back to the global setting.
    // Omitted entirely when neither is set so the Rust default applies.
    ...(req.maxBodyBytes ?? defaults.maxBodyBytes
      ? { max_body_bytes: req.maxBodyBytes ?? defaults.maxBodyBytes }
      : {}),
  };

  return { finalUrl, headers, bodyStr, payload };
}

/**
 * Run one full request through pre-script -> send -> post-script. Mutates
 * `envVars` / `transientVars` in place to reflect script mutations so the
 * caller can persist them.
 */
export async function executeRequestWithScripts(input: PipelineInput): Promise<PipelineResult> {
  const {
    request: req,
    collections,
    envVars,
    transientVars,
    globalVars,
    collectionVars,
    iterationData,
    defaults,
  } = input;
  const logs: ScriptLog[] = [];
  let scriptError: string | undefined;

  // Fallback to empty maps for the new scopes so older callers that haven't
  // been wired through yet keep working. The caller owns these maps — any
  // mutations we adopt below land directly on the caller's object, just
  // like envVars/transientVars.
  const globals: Record<string, string> = globalVars ?? {};
  const collectionScope: Record<string, string> = collectionVars ?? {};

  /** Sync `target` so it equals `src`: copy all entries from src and delete
   *  any extra keys. Lets us adopt deletions, not just additions/updates. */
  const adopt = (target: Record<string, string>, src: Record<string, string>) => {
    for (const k of Object.keys(src)) target[k] = src[k];
    for (const k of Object.keys(target)) {
      if (!(k in src)) delete target[k];
    }
  };

  // --- Pre-request script -----------------------------------------------------
  if (req.preScript && req.preScript.trim()) {
    try {
      const pre = await runScript({
        kind: "pre",
        source: req.preScript,
        request: {
          method: req.method,
          url: req.url,
          headers: Object.fromEntries(
            req.headers.filter((h) => h.enabled).map((h) => [h.key, h.value])
          ),
          body: req.body || "",
        },
        environment: envVars,
        globals,
        collectionVariables: collectionScope,
        variables: transientVars,
        iterationData: iterationData ?? {},
      });
      logs.push(...pre.logs);
      if (!pre.ok && pre.error) {
        scriptError = `Pre-request: ${pre.error}`;
      }
      adopt(envVars, pre.environment);
      adopt(globals, pre.globals);
      adopt(collectionScope, pre.collectionVariables);
      adopt(transientVars, pre.variables);
    } catch (e) {
      // Worker spawn / import failures must not abort the request pipeline —
      // surface as a script error and continue with unmodified env/vars.
      scriptError = `Pre-request: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // --- Send -------------------------------------------------------------------
  let response: ResponseData | undefined;
  let error: string | undefined;
  let finalUrl = req.url;
  let bodyStr: string | null = null;
  let headerMap: Record<string, string> = {};
  try {
    const built = await buildSendPayload(req, collections, envVars, transientVars, defaults);
    finalUrl = built.finalUrl;
    bodyStr = built.bodyStr;
    headerMap = Object.fromEntries(built.headers.map((h) => [h.key, h.value]));
    response = await invoke<ResponseData>("send_request", { payload: built.payload });
  } catch (e) {
    error = String(e);
  }

  // --- Post-response (test) script -------------------------------------------
  let tests: TestResult[] = [];
  if (response && req.testScript && req.testScript.trim()) {
    try {
      const post = await runScript({
        kind: "test",
        source: req.testScript,
        request: {
          method: req.method,
          url: finalUrl,
          headers: headerMap,
          body: bodyStr || "",
        },
        response,
        environment: envVars,
        globals,
        collectionVariables: collectionScope,
        variables: transientVars,
        iterationData: iterationData ?? {},
      });
      logs.push(...post.logs);
      tests = post.tests;
      if (!post.ok && post.error) {
        scriptError = scriptError ? `${scriptError}; Test: ${post.error}` : `Test: ${post.error}`;
      }
      adopt(envVars, post.environment);
      adopt(globals, post.globals);
      adopt(collectionScope, post.collectionVariables);
      adopt(transientVars, post.variables);
    } catch (e) {
      const msg = `Test: ${e instanceof Error ? e.message : String(e)}`;
      scriptError = scriptError ? `${scriptError}; ${msg}` : msg;
    }
  }

  return { response, error, tests, logs, scriptError, finalUrl };
}
