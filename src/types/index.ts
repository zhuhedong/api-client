export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  /** When true, this entry represents a file upload (used in form-data only). */
  is_file?: boolean;
  /** Absolute path to file on disk (for form-data file uploads). */
  file_path?: string;
}

export interface AuthConfig {
  /**
   * Authentication strategy.
   *
   * - `"inherit"`: delegate to the parent folder/collection at send time.
   *   This is the default for requests created under a collection.
   * - `"none"`: explicitly disable authentication for this scope, even if
   *   the parent has auth configured.
   * - `"bearer" | "basic" | "api_key" | "oauth2"`: concrete schemes.
   */
  auth_type:
    | "inherit"
    | "none"
    | "bearer"
    | "basic"
    | "api_key"
    | "oauth2"
    | "sigv4"
    | "digest"
    | "oauth1"
    | "jwt";
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
  api_key_key?: string;
  api_key_value?: string;
  api_key_in?: "header" | "query";

  // HTTP Digest (RFC 7616) — populated when auth_type === "digest".
  /** Digest username (sent in the response). */
  digest_username?: string;
  /** Digest password (stored in keychain). */
  digest_password?: string;

  // OAuth 1.0a (RFC 5849) — populated when auth_type === "oauth1".
  oauth1_consumer_key?: string;
  /** Stored in keychain. */
  oauth1_consumer_secret?: string;
  oauth1_token?: string;
  /** Stored in keychain. */
  oauth1_token_secret?: string;
  oauth1_signature_method?: "HMAC-SHA1" | "HMAC-SHA256" | "PLAINTEXT";
  oauth1_realm?: string;
  /** Where to inject the `oauth_*` parameters. Default "header". */
  oauth1_add_to?: "header" | "query";

  // JWT HMAC signer — populated when auth_type === "jwt".
  jwt_algorithm?: "HS256" | "HS384" | "HS512";
  /** Stored in keychain. */
  jwt_secret?: string;
  /** Treat the secret as base64-encoded bytes. */
  jwt_secret_is_base64?: boolean;
  /** Claims as a JSON string. */
  jwt_payload?: string;
  /** Header name to put the token in (default "Authorization"). */
  jwt_request_header?: string;
  /** Prefix before the token (default "Bearer "). Use empty string for no prefix. */
  jwt_header_prefix?: string;

  // OAuth2 — populated only when auth_type === "oauth2".
  /** Grant type. */
  oauth2_grant_type?:
    | "client_credentials"
    | "password"
    | "authorization_code"
    | "device_code";
  oauth2_token_url?: string;
  oauth2_client_id?: string;
  /** Stored in keychain (never written to collection JSON in plaintext). */
  oauth2_client_secret?: string;
  /** Space-separated scope list. */
  oauth2_scope?: string;
  /** Where to send the client credentials. Defaults to "basic". */
  oauth2_client_auth?: "basic" | "body";
  /** Required for grant_type=password. */
  oauth2_username?: string;
  /** Required for grant_type=password. Stored in keychain. */
  oauth2_password?: string;
  /** Cached access token from the most recent Fetch Token. Stored in keychain. */
  oauth2_access_token?: string;
  /** Unix millis when the cached token stops being valid. */
  oauth2_token_expires_at?: number;
  /** Provider authorization endpoint (used for grant_type=authorization_code). */
  oauth2_authorization_url?: string;
  /** Provider device-authorization endpoint (used for grant_type=device_code).
   *  e.g. https://github.com/login/device/code, https://oauth2.googleapis.com/device/code. */
  oauth2_device_authorization_url?: string;
  /** Cached refresh_token from the last successful authorization_code /
   *  password / device_code exchange. Stored in keychain; used for transparent refresh. */
  oauth2_refresh_token?: string;
  /** Whether to send `code_challenge` on the authorization request. Defaults
   *  to true; some legacy providers reject PKCE for confidential clients. */
  oauth2_use_pkce?: boolean;

  // AWS SigV4 — populated only when auth_type === "sigv4".
  aws_access_key_id?: string;
  /** Stored in keychain. */
  aws_secret_access_key?: string;
  /** Optional STS session token. Stored in keychain. */
  aws_session_token?: string;
  aws_region?: string;
  /** AWS service name (e.g. "s3", "execute-api", "dynamodb"). */
  aws_service?: string;
}

export type BodyType = "none" | "json" | "text" | "xml" | "form-data" | "graphql";

export type Protocol = "http" | "websocket" | "sse";

export interface RequestItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  bodyType: BodyType;
  formData: KeyValue[];
  auth?: AuthConfig;
  /** Per-request timeout in milliseconds. Falls back to global default if undefined. */
  timeoutMs?: number;
  /**
   * Per-request TLS verification override.
   *  - `undefined` (default): fall back to the global `verifyTlsDefault` setting.
   *  - `true`: verify TLS certificates (recommended).
   *  - `false`: skip verification (useful for self-signed certs in dev).
   */
  verifyTls?: boolean;
  /**
   * Redirect behavior. `undefined` defaults to `"follow"`.
   *  - `"follow"`: follow up to `maxRedirects` (default 10).
   *  - `"none"` / `"manual"`: return the first 3xx response untouched.
   */
  redirectPolicy?: "follow" | "none" | "manual";
  /** Cap on redirects when redirectPolicy is "follow". */
  maxRedirects?: number;
  /** Per-request override for the inline response body cap (bytes). When
   *  unset, the global setting (Settings → Max response body size) is
   *  used. Defaults to 10 MiB in the Rust backend. */
  maxBodyBytes?: number;
  /** Outbound proxy URL (http/https/socks5). */
  proxyUrl?: string;
  /** Client certificate (mTLS). */
  clientCert?: {
    /** PKCS#12 bundle on disk. */
    path: string;
    /** Bundle passphrase. */
    password?: string;
  };
  /**
   * When this request was loaded from a collection, the source collection id.
   * Used to resolve `auth: { auth_type: "inherit" }` at send time by walking
   * up the collection tree to find the effective auth.
   */
  collectionId?: string;
  /** Protocol selector: HTTP request or WebSocket connection. */
  protocol?: Protocol;
  /** GraphQL query and variables when bodyType === "graphql". */
  graphqlQuery?: string;
  graphqlVariables?: string;
  /**
   * Pre-request script source. Runs in a Web Worker sandbox before the
   * request is sent and can mutate environment / variable scopes via the
   * `pm.environment` and `pm.variables` APIs.
   */
  preScript?: string;
  /**
   * Post-response test script source. Runs in a Web Worker sandbox after
   * the response arrives. Can call `pm.test(name, fn)` and `pm.expect(...)`
   * to record assertions surfaced in the response panel.
   */
  testScript?: string;
  /**
   * Free-form labels for filtering and color-coding in the sidebar (e.g.
   * "auth", "v2", "broken"). Persisted with the collection on save.
   */
  tags?: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptLog {
  level: "log" | "warn" | "error";
  args: string[];
}

export interface ScriptRunOutcome {
  ok: boolean;
  error?: string;
  tests: TestResult[];
  logs: ScriptLog[];
}

/** Phased breakdown of a response's wall-clock time. Reqwest can't give us
 *  DNS / TCP / TLS individually without a custom connector; for now we ship
 *  the two-phase split (wait until headers arrived, then body download). */
export interface ResponseTimings {
  wait_ms: number;
  download_ms: number;
  total_ms: number;
}

/**
 * Stable error category returned by the backend `send_request` command.
 * The frontend uses this to pick icons, troubleshooting hints, and decide
 * whether to show a "Retry" button. Wire shape matches Rust
 * `request_error::ErrorKind` (snake_case via serde).
 */
export type RequestErrorKind =
  | "cancelled"
  | "timeout"
  | "dns"
  | "connection"
  | "tls"
  | "proxy"
  | "client_certificate"
  | "input"
  | "redirect"
  | "body"
  | "unknown";

/**
 * Structured error returned from `send_request`. The frontend either gets
 * one of these from a backend rejection or constructs one for purely
 * frontend failures (worker errors, etc.) via `toRequestError()`.
 */
export interface RequestError {
  kind: RequestErrorKind;
  /** Finer-grained sub-code, e.g. `"INVALID_HEADER_NAME"`. */
  code: string;
  /** Human-readable description suitable for direct display. */
  message: string;
  /** Whether retrying the request unchanged is likely to succeed. */
  retryable: boolean;
}

export interface ResponseData {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  /** `"text"` if body is UTF-8 text, `"base64"` if body is base64-encoded binary. */
  body_encoding: "text" | "base64";
  /** True when the inline body was truncated; size_bytes still reflects the full size. */
  body_truncated: boolean;
  time_ms: number;
  size_bytes: number;
  /** Phase breakdown. Optional on legacy responses. */
  timings?: ResponseTimings;
}

/** In-memory snapshot of a response kept for diffing against newer responses. */
export interface ResponseSnapshot {
  id: string;
  takenAt: number;
  response: ResponseData;
}

// SQLite history entry (matches Rust struct)
export interface HistoryEntry {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: string;
  params: string;
  body: string;
  body_type: string;
  response_status?: number;
  response_time_ms?: number;
  created_at: number;
  updated_at: number;
  /** Workspace this entry belongs to. Optional on legacy rows. */
  workspace_id?: string;
  /** JSON-encoded headers map captured on response. None on legacy rows. */
  response_headers?: string;
  /** Response body, truncated to the user's history-body cap. */
  response_body?: string;
  /** `"text"` or `"base64"`. Matches ResponseData.body_encoding. */
  response_body_encoding?: "text" | "base64";
  /** True if the persisted `response_body` was truncated. */
  response_body_truncated?: boolean;
  /** Full response size in bytes (pre-truncation), if known. */
  response_size_bytes?: number;
}

// Filesystem collection (matches Rust struct)
export interface CollectionFolder {
  id: string;
  name: string;
  /** Folder-level auth override. Requests in this folder with auth_type "inherit" fall back to this. */
  auth?: AuthConfig;
  /** Folder-scoped variables. Override collection/global vars during substitution. */
  variables?: EnvVariable[];
  requests: CollectionRequest[];
  folders: CollectionFolder[];
}

export interface CollectionRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  body_type: string;
  auth?: AuthConfig;
  /** Pre-request script source. */
  pre_script?: string;
  /** Post-response test script source. */
  test_script?: string;
  /** User-defined labels used for filtering & color-coding in the sidebar. */
  tags?: string[];
  created_at: number;
  updated_at: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  auth?: AuthConfig;
  /** Collection-scoped variables. Override global vars; overridden by folder/env/transient. */
  variables?: EnvVariable[];
  requests: CollectionRequest[];
  folders: CollectionFolder[];
  created_at: number;
  updated_at: number;
  /** Workspace this collection belongs to. Optional on legacy files. */
  workspace_id?: string;
}

// Environment
export interface EnvVariable {
  key: string;
  value: string;
  enabled: boolean;
  is_secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvVariable[];
  created_at: number;
  updated_at: number;
  /** Workspace this environment belongs to. Optional on legacy files. */
  workspace_id?: string;
}

// Workspace
export interface WindowState {
  sidebar_width?: number;
  request_panel_height?: number;
  sidebar_tab?: string;
  /** Snapshot of the open tabs from the last session. Restored on workspace
   *  load so users keep their tabs across app restarts. */
  open_tabs?: RequestItem[];
  /** Tab to activate after restoration. Falls back to the first open tab. */
  active_tab_id?: string;
}

export interface Workspace {
  id: string;
  name: string;
  active_environment_id?: string;
  active_collection_id?: string;
  active_request_id?: string;
  window_state?: WindowState;
  /** Workspace-global variables. Lowest precedence in the variable hierarchy. */
  variables?: EnvVariable[];
  created_at: number;
  updated_at: number;
}

// Settings
export interface SettingEntry {
  key: string;
  value: string;
}

// Cookies
export interface CookieEntry {
  id: string;
  domain: string;
  name: string;
  value: string;
  path: string;
  expires?: number;
  secure: boolean;
  http_only: boolean;
  created_at: number;
}

// Recent
export interface RecentEntry {
  id: string;
  item_type: "request" | "collection" | "environment";
  item_id: string;
  name: string;
  opened_at: number;
}

// WebSocket
export interface WsMessage {
  id: string;
  direction: "sent" | "received" | "system";
  text: string;
  ts: number;
}

// Server-Sent Events
/**
 * One entry in the per-request SSE event log. `kind = "message"` carries the
 * parsed fields from the wire frame; `"open" / "close" / "error"` are
 * system markers emitted by the backend reader.
 */
export interface SseEventRecord {
  id: string;
  ts: number;
  kind: "message" | "open" | "close" | "error" | "system";
  /** Custom `event:` field from the frame, if the server sent one. */
  event?: string;
  /** `data:` field — multiple `data:` lines are joined with `\n`. */
  data?: string;
  /** Server-supplied `id:` field. */
  lastEventId?: string;
  /** Server-supplied `retry:` field, in ms. */
  retry?: number;
  /** Filled when `kind === "error"`. */
  error?: string;
}

// Mock Server
export interface MockRoute {
  id: string;
  /** HTTP method to match — concrete method or "*" for any. */
  method: string;
  /** Path pattern. Supports `:param` placeholders matched per-segment. */
  path: string;
  status: number;
  headers: KeyValue[];
  body: string;
  delay_ms?: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface MockServerStatus {
  running: boolean;
  port?: number;
  workspace_id?: string;
}
