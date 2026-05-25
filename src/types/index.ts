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
  auth_type: "none" | "bearer" | "basic" | "api_key";
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
  api_key_key?: string;
  api_key_value?: string;
  api_key_in?: "header" | "query";
}

export type BodyType = "none" | "json" | "text" | "xml" | "form-data" | "graphql";

export type Protocol = "http" | "websocket";

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
  /** Outbound proxy URL (http/https/socks5). */
  proxyUrl?: string;
  /** Client certificate (mTLS). */
  clientCert?: {
    /** PKCS#12 bundle on disk. */
    path: string;
    /** Bundle passphrase. */
    password?: string;
  };
  /** Protocol selector: HTTP request or WebSocket connection. */
  protocol?: Protocol;
  /** GraphQL query and variables when bodyType === "graphql". */
  graphqlQuery?: string;
  graphqlVariables?: string;
  createdAt: number;
  updatedAt?: number;
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
}

// Filesystem collection (matches Rust struct)
export interface CollectionFolder {
  id: string;
  name: string;
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
  created_at: number;
  updated_at: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  auth?: AuthConfig;
  requests: CollectionRequest[];
  folders: CollectionFolder[];
  created_at: number;
  updated_at: number;
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
}

// Workspace
export interface WindowState {
  sidebar_width?: number;
  request_panel_height?: number;
  sidebar_tab?: string;
}

export interface Workspace {
  id: string;
  name: string;
  active_environment_id?: string;
  active_collection_id?: string;
  active_request_id?: string;
  window_state?: WindowState;
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
