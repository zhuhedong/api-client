pub mod commands;
pub mod db;
pub mod mock_server;
pub mod oauth2;
pub mod request_error;
pub mod secrets;
pub mod sse;
pub mod storage;

use futures_util::{SinkExt, StreamExt};
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName as WsHeaderName, HeaderValue as WsHeaderValue};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use base64::Engine;

use crate::db::CookieEntry;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default)]
    pub is_file: bool,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClientCert {
    /// Filesystem path to a PKCS#12 (`.p12` / `.pfx`) bundle containing the
    /// client certificate and its private key.
    pub path: String,
    /// Optional passphrase protecting the PKCS#12 bundle.
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub body: Option<String>,
    pub body_type: Option<String>,
    pub form_data: Option<Vec<KeyValue>>,
    pub timeout_ms: Option<u64>,
    pub request_id: Option<String>,
    /// When `false`, skip TLS certificate verification for this request.
    /// When `None` or `Some(true)`, verify normally (the safe default).
    #[serde(default)]
    pub verify_tls: Option<bool>,
    /// `"follow"` (default), `"none"`, or `"manual"`. Manual is treated the
    /// same as none — the response body is returned with the redirect headers
    /// intact so the caller can inspect them.
    #[serde(default)]
    pub redirect_policy: Option<String>,
    /// Maximum number of redirects to follow when `redirect_policy` is `follow`.
    /// Defaults to 10 if unspecified.
    #[serde(default)]
    pub max_redirects: Option<u32>,
    /// Outbound proxy, e.g. `http://user:pass@host:8080`, `https://...`, or
    /// `socks5://host:1080`. Applied to both HTTP and HTTPS.
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// Optional client certificate for mTLS.
    #[serde(default)]
    pub client_cert: Option<ClientCert>,
    /// Maximum number of bytes of the response body to return inline. When the
    /// real body exceeds this, the body is truncated and `body_truncated`
    /// is set in the response. Defaults to 10 MiB.
    #[serde(default)]
    pub max_body_bytes: Option<usize>,
}

/// Phased breakdown of the request's wall-clock time. `total_ms` is what we
/// previously surfaced as `time_ms`; the new fields split the time between
/// "everything up to and including the response headers" and "reading the
/// response body". Reqwest doesn't expose DNS/TCP/TLS individually without
/// installing a custom connector, so we ship the two-phase split for now;
/// the frontend renders any zero-valued sub-phase as omitted.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ResponseTimings {
    /// Time from `send()` start until headers arrived (DNS + TCP + TLS +
    /// request send + TTFB combined). Postman calls this "wait".
    pub wait_ms: u64,
    /// Time to drain the response body once headers arrived.
    pub download_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    /// `"text"` when `body` is a UTF-8 string, `"base64"` when `body` holds
    /// base64-encoded binary content.
    pub body_encoding: String,
    /// True when the response was larger than `max_body_bytes` and `body`
    /// holds only the first chunk. `size_bytes` still reflects the full size.
    pub body_truncated: bool,
    pub time_ms: u64,
    pub size_bytes: usize,
    #[serde(default)]
    pub timings: ResponseTimings,
}

/// Heuristic: treat these MIME types as text and decode as UTF-8. Everything
/// else is base64-encoded so the frontend can show an appropriate preview.
fn is_text_mime(ct: &str) -> bool {
    let lower = ct.to_ascii_lowercase();
    let mime = lower.split(';').next().unwrap_or("").trim();
    if mime.starts_with("text/") {
        return true;
    }
    matches!(
        mime,
        "application/json"
            | "application/ld+json"
            | "application/xml"
            | "application/xhtml+xml"
            | "application/javascript"
            | "application/x-www-form-urlencoded"
            | "application/graphql"
            | "application/yaml"
            | "application/x-yaml"
    ) || mime.ends_with("+json")
        || mime.ends_with("+xml")
}

pub struct ActiveRequests {
    map: Mutex<HashMap<String, CancellationToken>>,
}

impl Default for ActiveRequests {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveRequests {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

/// Cache of full response bodies that were too big to send over IPC in one
/// piece. Keyed by request id (the same id used for cancellation), so a Save
/// click can retrieve the complete bytes without having to re-issue the
/// request (which would be wrong for non-idempotent methods like POST).
///
/// The cache only ever holds the **most recent** body for a given request id,
/// so memory usage is bounded by the largest single response per request slot.
pub struct CachedBodies {
    map: Mutex<HashMap<String, bytes::Bytes>>,
}

impl Default for CachedBodies {
    fn default() -> Self {
        Self::new()
    }
}

impl CachedBodies {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

/// Shared cookie jar used by every HTTP client and persisted to SQLite.
///
/// The jar lives behind a `RwLock` so the UI can ask us to **rebuild** it from
/// SQLite whenever a cookie is deleted or a domain is cleared. `reqwest::cookie::Jar`
/// has no `remove` API, so the only way to make a deletion visible to new
/// requests is to swap in a fresh jar populated from the post-deletion DB.
///
/// Each `send_request` / `ws_connect` calls `current_jar()` at the time the
/// HTTP client is built, so subsequent requests immediately see the rebuilt
/// jar. Already-in-flight requests keep their old `Arc<Jar>` and finish with
/// the cookies they were started with, which is the correct semantic.
pub struct AppCookies {
    jar: std::sync::RwLock<Arc<Jar>>,
}

impl Default for AppCookies {
    fn default() -> Self {
        Self::new()
    }
}

impl AppCookies {
    pub fn new() -> Self {
        Self {
            jar: std::sync::RwLock::new(Arc::new(Jar::default())),
        }
    }

    /// The `Arc<Jar>` to hand to `reqwest::ClientBuilder::cookie_provider`.
    /// Cheap clone of an `Arc`; never panics because we only ever swap the
    /// inner value under the write lock.
    pub fn current_jar(&self) -> Arc<Jar> {
        self.jar
            .read()
            .expect("AppCookies jar lock poisoned")
            .clone()
    }

    /// Hydrate the jar from cookies already persisted in SQLite.
    pub fn preload_from_db(&self, db: &db::Database) {
        if let Some(new_jar) = build_jar_from_db(db) {
            *self.jar.write().expect("AppCookies jar lock poisoned") = new_jar;
        }
    }

    /// Replace the in-memory jar with a freshly-populated one. Call this after
    /// any operation that removes cookies from SQLite (delete, clear).
    ///
    /// If the SQLite read fails (poisoned mutex, transient I/O error) we
    /// **keep the existing in-memory jar** rather than wiping it — losing the
    /// cookies the user collected this session would be a worse outcome than
    /// possibly continuing to send a deleted cookie until the DB recovers.
    pub fn rebuild_from_db(&self, db: &db::Database) {
        if let Some(new_jar) = build_jar_from_db(db) {
            *self.jar.write().expect("AppCookies jar lock poisoned") = new_jar;
        }
    }
}

/// Build a fresh jar from the cookies currently in SQLite. Returns `None` on
/// a DB read failure so the caller can decide whether to swap or keep the
/// existing jar.
fn build_jar_from_db(db: &db::Database) -> Option<Arc<Jar>> {
    let all = match db.get_all_cookies() {
        Ok(all) => all,
        Err(_) => return None,
    };
    let jar = Arc::new(Jar::default());
    for c in all {
        let scheme = if c.secure { "https" } else { "http" };
        let path = if c.path.is_empty() { "/" } else { &c.path };
        let url_str = format!("{}://{}{}", scheme, c.domain, path);
        let Ok(url) = url::Url::parse(&url_str) else { continue };
        let mut s = format!("{}={}; Domain={}; Path={}", c.name, c.value, c.domain, path);
        if c.secure {
            s.push_str("; Secure");
        }
        if c.http_only {
            s.push_str("; HttpOnly");
        }
        jar.add_cookie_str(&s, &url);
    }
    Some(jar)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Parse every Set-Cookie header on the response and persist each to SQLite.
/// The reqwest jar has already absorbed these for in-memory cookie behavior;
/// this just gives us cross-restart persistence and visibility in the UI.
fn persist_set_cookies(
    db: &db::Database,
    request_url: &url::Url,
    headers: &reqwest::header::HeaderMap,
) {
    let default_domain = request_url.host_str().unwrap_or("");
    for set_cookie in headers.get_all(reqwest::header::SET_COOKIE).iter() {
        let Ok(s) = set_cookie.to_str() else { continue };
        let Ok(parsed) = cookie::Cookie::parse(s.to_string()) else { continue };
        let name = parsed.name().to_string();
        let value = parsed.value().to_string();
        let domain = parsed
            .domain()
            .map(|d| d.trim_start_matches('.').to_string())
            .unwrap_or_else(|| default_domain.to_string());
        let path = parsed.path().unwrap_or("/").to_string();
        let secure = parsed.secure().unwrap_or(false);
        let http_only = parsed.http_only().unwrap_or(false);
        let expires = parsed
            .expires()
            .and_then(|e| e.datetime())
            .map(|d| d.unix_timestamp() * 1000);

        // Use (domain, path, name) as a stable id so refreshing a cookie
        // updates the existing row rather than inserting a duplicate.
        let id = format!("{}|{}|{}", domain, path, name);
        let entry = CookieEntry {
            id,
            domain,
            name,
            value,
            path,
            expires,
            secure,
            http_only,
            created_at: now_ms(),
        };
        let _ = db.save_cookie(&entry);
    }
}

#[tauri::command]
async fn cancel_request(
    active_requests: State<'_, Arc<ActiveRequests>>,
    request_id: String,
) -> Result<(), String> {
    let map = active_requests.map.lock().await;
    if let Some(token) = map.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn send_request(
    active_requests: State<'_, Arc<ActiveRequests>>,
    cookies: State<'_, Arc<AppCookies>>,
    cached_bodies: State<'_, Arc<CachedBodies>>,
    db: State<'_, db::Database>,
    payload: RequestPayload,
) -> Result<ResponseData, request_error::RequestError> {
    use request_error::{from_reqwest, RequestError};
    let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(30000));
    // Default is the safe behavior: verify TLS. Only skip when the frontend
    // explicitly opts out (per-request or via the global setting).
    let verify_tls = payload.verify_tls.unwrap_or(true);

    // Redirect policy. Default: follow up to 10. "none" or "manual" => stop
    // at the first 3xx so the caller can see the Location header.
    let redirect = match payload.redirect_policy.as_deref().unwrap_or("follow") {
        "none" | "manual" => reqwest::redirect::Policy::none(),
        _ => reqwest::redirect::Policy::limited(payload.max_redirects.unwrap_or(10) as usize),
    };

    let mut builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(!verify_tls)
        .cookie_provider(cookies.current_jar())
        .redirect(redirect)
        .timeout(timeout);

    if let Some(proxy_url) = payload.proxy_url.as_deref() {
        if !proxy_url.is_empty() {
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|e| {
                RequestError::new(
                    request_error::ErrorKind::Proxy,
                    "INVALID_PROXY_URL",
                    format!("Invalid proxy URL: {}", e),
                )
            })?;
            builder = builder.proxy(proxy);
        }
    }

    if let Some(cert) = &payload.client_cert {
        if !cert.path.is_empty() {
            let pkcs12_bytes = tokio::fs::read(&cert.path).await.map_err(|e| {
                RequestError::new(
                    request_error::ErrorKind::ClientCertificate,
                    "CLIENT_CERT_READ_FAILED",
                    format!("Failed to read client certificate '{}': {}", cert.path, e),
                )
            })?;
            let identity = reqwest::Identity::from_pkcs12_der(
                &pkcs12_bytes,
                cert.password.as_deref().unwrap_or(""),
            )
            .map_err(|e| {
                RequestError::new(
                    request_error::ErrorKind::ClientCertificate,
                    "CLIENT_CERT_INVALID",
                    format!("Invalid client certificate: {}", e),
                )
            })?;
            builder = builder.identity(identity);
        }
    }

    let client = builder.build().map_err(|e| {
        RequestError::new(
            request_error::ErrorKind::Unknown,
            "CLIENT_BUILD_FAILED",
            format!("Failed to create client: {}", e),
        )
    })?;

    // Register cancellation token
    let cancel_token = CancellationToken::new();
    let request_id = payload.request_id.clone().unwrap_or_default();
    if !request_id.is_empty() {
        let mut map = active_requests.map.lock().await;
        map.insert(request_id.clone(), cancel_token.clone());
    }

    let mut headers = HeaderMap::new();
    for h in &payload.headers {
        if !h.enabled || h.key.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(h.key.as_bytes()).map_err(|e| {
            RequestError::input(
                "INVALID_HEADER_NAME",
                format!("Invalid header name '{}': {}", h.key, e),
            )
        })?;
        let value = HeaderValue::from_str(&h.value).map_err(|e| {
            RequestError::input(
                "INVALID_HEADER_VALUE",
                format!("Invalid header value '{}': {}", h.value, e),
            )
        })?;
        headers.insert(name, value);
    }

    let method = payload
        .method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|e| {
            RequestError::input("INVALID_METHOD", format!("Invalid method: {}", e))
        })?;

    let mut request_builder = client.request(method, &payload.url).headers(headers);

    // Handle form-data (multipart) with optional file upload support
    if payload.body_type.as_deref() == Some("form-data") {
        if let Some(form_fields) = &payload.form_data {
            let mut form = multipart::Form::new();
            for field in form_fields {
                if !field.enabled || field.key.is_empty() {
                    continue;
                }
                if field.is_file {
                    if let Some(path) = &field.file_path {
                        let bytes = tokio::fs::read(path).await.map_err(|e| {
                            RequestError::input(
                                "FILE_READ_FAILED",
                                format!("Failed to read file '{}': {}", path, e),
                            )
                        })?;
                        let file_name = std::path::Path::new(path)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("file")
                            .to_string();
                        let part = multipart::Part::bytes(bytes).file_name(file_name);
                        form = form.part(field.key.clone(), part);
                    }
                } else {
                    form = form.text(field.key.clone(), field.value.clone());
                }
            }
            request_builder = request_builder.multipart(form);
        }
    } else if let Some(body) = &payload.body {
        if !body.is_empty() {
            request_builder = request_builder.body(body.clone());
        }
    }

    let start = Instant::now();

    // Race between request and cancellation
    let result: Result<reqwest::Response, RequestError> = tokio::select! {
        res = request_builder.send() => res.map_err(from_reqwest),
        _ = cancel_token.cancelled() => Err(RequestError::cancelled()),
    };

    // Cleanup
    if !request_id.is_empty() {
        let mut map = active_requests.map.lock().await;
        map.remove(&request_id);
    }

    let response = result?;
    // Headers have arrived — capture the "wait" phase before we start
    // draining the body so we can report a real phase split, not just a
    // single total.
    let wait_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    // Persist any Set-Cookie headers from this response so the cookie jar UI
    // and future sessions see them.
    if let Ok(request_url) = url::Url::parse(&payload.url) {
        persist_set_cookies(&db, &request_url, response.headers());
    }

    let mut resp_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.to_string(), v.to_string());
        }
    }

    let body_start = Instant::now();
    let body_bytes = response.bytes().await.map_err(from_reqwest)?;
    let download_ms = body_start.elapsed().as_millis() as u64;
    let elapsed = start.elapsed().as_millis() as u64;
    let size_bytes = body_bytes.len();

    // Truncate before encoding so we don't blow up the IPC channel.
    // Default cap is 10 MiB; the frontend can configure this per request.
    let cap = payload.max_body_bytes.unwrap_or(10 * 1024 * 1024);
    let truncated = size_bytes > cap;
    let take = if truncated { cap } else { size_bytes };
    let display_bytes = &body_bytes[..take];

    let content_type = resp_headers
        .get("content-type")
        .cloned()
        .unwrap_or_default();
    let (body, body_encoding) = if is_text_mime(&content_type) {
        (
            String::from_utf8_lossy(display_bytes).to_string(),
            "text".to_string(),
        )
    } else {
        (
            base64::engine::general_purpose::STANDARD.encode(display_bytes),
            "base64".to_string(),
        )
    };

    // Stash the full bytes when we had to truncate, so a subsequent Save can
    // recover them. Otherwise drop any stale entry from a previous response
    // in this same request slot so we don't hold onto memory unnecessarily.
    if !request_id.is_empty() {
        let mut cache = cached_bodies.map.lock().await;
        if truncated {
            cache.insert(request_id.clone(), body_bytes.clone());
        } else {
            cache.remove(&request_id);
        }
    }

    Ok(ResponseData {
        status,
        status_text,
        headers: resp_headers,
        body,
        body_encoding,
        body_truncated: truncated,
        time_ms: elapsed,
        size_bytes,
        timings: ResponseTimings {
            wait_ms,
            download_ms,
            total_ms: elapsed,
        },
    })
}

// ============================================================================
// WebSocket support
// ============================================================================

#[derive(Default)]
pub struct WsConnections {
    map: Mutex<HashMap<String, mpsc::UnboundedSender<WsCommand>>>,
}

enum WsCommand {
    Send(String),
    Close,
}

#[derive(Debug, Serialize, Clone)]
pub struct WsEvent {
    pub request_id: String,
    pub kind: String, // "open" | "message" | "error" | "close"
    pub text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsConnectPayload {
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub request_id: String,
}

#[tauri::command]
async fn ws_connect(
    app: AppHandle,
    connections: State<'_, Arc<WsConnections>>,
    payload: WsConnectPayload,
) -> Result<(), String> {
    let WsConnectPayload {
        url,
        headers,
        request_id,
    } = payload;

    // If already connected, close first.
    {
        let mut map = connections.map.lock().await;
        if let Some(tx) = map.remove(&request_id) {
            let _ = tx.send(WsCommand::Close);
        }
    }

    // Validate the URL early for a friendlier error message.
    url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Build the handshake request so caller-supplied headers (e.g. Authorization,
    // Sec-WebSocket-Protocol) actually reach the server.
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket request: {}", e))?;
    {
        let req_headers = request.headers_mut();
        for h in &headers {
            if !h.enabled || h.key.is_empty() {
                continue;
            }
            let name = WsHeaderName::from_bytes(h.key.as_bytes())
                .map_err(|e| format!("Invalid WS header name '{}': {}", h.key, e))?;
            let value = WsHeaderValue::from_bytes(h.value.as_bytes())
                .map_err(|e| format!("Invalid WS header value '{}': {}", h.value, e))?;
            req_headers.insert(name, value);
        }
    }

    let (ws_stream, _resp) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut sink, mut stream) = ws_stream.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<WsCommand>();
    {
        let mut map = connections.map.lock().await;
        map.insert(request_id.clone(), tx);
    }

    let _ = app.emit(
        "ws-event",
        WsEvent {
            request_id: request_id.clone(),
            kind: "open".to_string(),
            text: None,
        },
    );

    // Task: forward outgoing commands to sink
    let app_clone = app.clone();
    let connections_arc = connections.inner().clone();
    let request_id_clone = request_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    match cmd {
                        Some(WsCommand::Send(text)) => {
                            if sink.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                        Some(WsCommand::Close) | None => {
                            let _ = sink.send(Message::Close(None)).await;
                            break;
                        }
                    }
                }
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "message".to_string(),
                                    text: Some(t),
                                },
                            );
                        }
                        Some(Ok(Message::Binary(b))) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "message".to_string(),
                                    text: Some(format!("[binary {} bytes]", b.len())),
                                },
                            );
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            break;
                        }
                        Some(Ok(_)) => {
                            // ping/pong/frame – ignore
                        }
                        Some(Err(e)) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "error".to_string(),
                                    text: Some(e.to_string()),
                                },
                            );
                            break;
                        }
                    }
                }
            }
        }

        let _ = app_clone.emit(
            "ws-event",
            WsEvent {
                request_id: request_id_clone.clone(),
                kind: "close".to_string(),
                text: None,
            },
        );
        let mut map = connections_arc.map.lock().await;
        map.remove(&request_id_clone);
    });

    Ok(())
}

#[tauri::command]
async fn ws_send(
    connections: State<'_, Arc<WsConnections>>,
    request_id: String,
    text: String,
) -> Result<(), String> {
    let map = connections.map.lock().await;
    if let Some(tx) = map.get(&request_id) {
        tx.send(WsCommand::Send(text))
            .map_err(|e| format!("WS send failed: {}", e))?;
        Ok(())
    } else {
        Err("WebSocket not connected".to_string())
    }
}

#[tauri::command]
async fn ws_close(
    connections: State<'_, Arc<WsConnections>>,
    request_id: String,
) -> Result<(), String> {
    let mut map = connections.map.lock().await;
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(WsCommand::Close);
    }
    Ok(())
}

// ============================================================================
// Server-Sent Events (SSE) support
// ============================================================================

/// Open an SSE stream. Long-lived: returns as soon as the handshake succeeds;
/// events are pushed via the `sse-event` Tauri channel until cancelled or the
/// server closes the connection.
#[tauri::command]
async fn sse_connect(
    app: AppHandle,
    connections: State<'_, Arc<sse::SseConnections>>,
    payload: sse::SseConnectPayload,
) -> Result<(), String> {
    // Verify-TLS default mirrors the regular HTTP send: we currently keep
    // it on (the legacy `danger_accept_invalid_certs(true)` is gone after
    // PR1). Per-request override is honored via payload.verify_tls.
    sse::run_sse_stream(app, connections.inner().clone(), payload, true).await
}

#[tauri::command]
async fn sse_close(
    connections: State<'_, Arc<sse::SseConnections>>,
    request_id: String,
) -> Result<(), String> {
    sse::close_sse_stream(connections.inner().clone(), request_id).await;
    Ok(())
}

/// Fetch an OAuth2 access token using the supplied configuration. Runs in
/// the backend so providers that block CORS or self-signed dev IdPs still
/// work, and so the client secret never has to leave Rust into JS context.
#[tauri::command]
async fn oauth2_fetch_token(
    request: oauth2::OAuth2FetchRequest,
) -> Result<oauth2::OAuth2FetchResponse, String> {
    oauth2::fetch_token(request).await
}

/// Drive the authorization_code flow: open the user's browser, await the
/// loopback redirect, return the authorization code + redirect_uri +
/// code_verifier so the frontend can call `oauth2_fetch_token` to swap
/// the code for tokens.
#[tauri::command]
async fn oauth2_start_authorization_code(
    app: tauri::AppHandle,
    request: oauth2::OAuth2FetchRequest,
) -> Result<oauth2::AuthorizationCodeResult, String> {
    use tauri_plugin_shell::ShellExt;
    oauth2::start_authorization_code(&request, |url| async move {
        // `Shell::open` is deprecated in favor of `tauri-plugin-opener`,
        // but we only use it here to launch the system browser. Pulling
        // in a new crate to silence the warning isn't worth it; revisit
        // when we next bump the Tauri toolchain.
        #[allow(deprecated)]
        app.shell()
            .open(url, None)
            .map_err(|e| format!("Failed to open browser: {}", e))
    })
    .await
}

/// First leg of the RFC 8628 Device Authorization Grant: POST to the
/// device-authorization endpoint and return the user-facing code +
/// verification URL. The frontend shows these to the user and then
/// calls `oauth2_poll_device_token` to await approval.
#[tauri::command]
async fn oauth2_start_device_code(
    request: oauth2::DeviceCodeStartRequest,
) -> Result<oauth2::DeviceCodeStartResult, String> {
    oauth2::start_device_code(request).await
}

/// Second leg of the device grant: poll the token endpoint until the user
/// approves on the verification page (success), denies (error), or the
/// device_code expires (error). May run for several minutes; the frontend
/// should show progress and offer a cancel button (the IPC future being
/// dropped by `cancel_request` will tear the loop down).
#[tauri::command]
async fn oauth2_poll_device_token(
    request: oauth2::DeviceCodePollRequest,
) -> Result<oauth2::OAuth2FetchResponse, String> {
    oauth2::poll_device_token(request).await
}

/// Write a response body to disk. Two modes:
///
/// 1. **Truncated body**: when the response was too big to send over IPC in
///    full, the backend stashed the original bytes in `CachedBodies` keyed by
///    `request_id`. Pass `use_cached: true` and the matching `request_id` to
///    write the complete body — the truncated `body`/`encoding` arguments are
///    ignored in this mode.
///
/// 2. **Inline body** (default): the frontend sends back the `body` it
///    already has, and we write those bytes verbatim. `encoding` matches
///    `ResponseData.body_encoding`: `"text"` writes the string verbatim,
///    `"base64"` decodes first so the file on disk is the original binary.
#[tauri::command]
async fn save_response_to_file(
    cached_bodies: State<'_, Arc<CachedBodies>>,
    path: String,
    body: String,
    encoding: String,
    #[allow(non_snake_case)] request_id: Option<String>,
    #[allow(non_snake_case)] use_cached: Option<bool>,
) -> Result<(), String> {
    if use_cached.unwrap_or(false) {
        let rid = request_id.unwrap_or_default();
        if rid.is_empty() {
            return Err("Cannot save full body: no request id was provided.".to_string());
        }
        // Clone the Bytes (cheap: it's Arc-backed) and drop the lock before we
        // hit the filesystem. Saving a multi-hundred-MiB body should not block
        // any other request finishing and updating the cache.
        let bytes = {
            let cache = cached_bodies.map.lock().await;
            cache.get(&rid).cloned().ok_or_else(|| {
                "Full response body is no longer cached. Re-send the request and try again."
                    .to_string()
            })?
        };
        tokio::fs::write(&path, bytes.as_ref())
            .await
            .map_err(|e| format!("Failed to write file '{}': {}", path, e))?;
        return Ok(());
    }

    let bytes: Vec<u8> = if encoding == "base64" {
        base64::engine::general_purpose::STANDARD
            .decode(body.as_bytes())
            .map_err(|e| format!("Invalid base64 body: {}", e))?
    } else {
        body.into_bytes()
    };
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("Failed to write file '{}': {}", path, e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = db::Database::new().expect("Failed to initialize database");
    let active_requests = Arc::new(ActiveRequests::new());
    let ws_connections = Arc::new(WsConnections::default());
    let sse_connections = Arc::new(sse::SseConnections::default());
    let cookies = Arc::new(AppCookies::new());
    let cached_bodies = Arc::new(CachedBodies::new());
    let mock_server = Arc::new(mock_server::MockServerState::new());
    cookies.preload_from_db(&database);

    // --- Utility: write plain text to a user-chosen path (used by the
    // Collection Runner export flow — the frontend already prompted the
    // user via the dialog plugin, now it just needs us to write the bytes).
    #[tauri::command]
    async fn write_file(path: String, contents: String) -> Result<(), String> {
        tokio::fs::write(&path, contents.as_bytes())
            .await
            .map_err(|e| format!("Failed to write {path}: {e}"))
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .manage(active_requests)
        .manage(ws_connections)
        .manage(sse_connections)
        .manage(cookies)
        .manage(cached_bodies)
        .manage(mock_server)
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
            save_response_to_file,
            ws_connect,
            ws_send,
            ws_close,
            sse_connect,
            sse_close,
            oauth2_fetch_token,
            oauth2_start_authorization_code,
            oauth2_start_device_code,
            oauth2_poll_device_token,
            // History
            commands::save_history,
            commands::get_history,
            commands::delete_history,
            commands::clear_history,
            commands::search_history,
            // Settings
            commands::set_setting,
            commands::get_setting,
            commands::get_all_settings,
            commands::delete_setting,
            // Cookies
            commands::save_cookie,
            commands::get_cookies_by_domain,
            commands::get_all_cookies,
            commands::delete_cookie,
            commands::clear_cookies_by_domain,
            // Recent
            commands::add_recent,
            commands::get_recent,
            commands::clear_recent,
            // Collections (filesystem)
            commands::save_collection,
            commands::load_collection,
            commands::list_collections,
            commands::delete_collection,
            // Environments (filesystem)
            commands::save_environment,
            commands::load_environment,
            commands::list_environments,
            commands::delete_environment,
            // Workspace (filesystem)
            commands::save_workspace,
            commands::load_workspace,
            commands::load_default_workspace,
            commands::list_workspaces,
            commands::create_workspace,
            commands::delete_workspace,
            commands::migrate_legacy_to_workspace,
            // Secrets (keychain)
            commands::store_secret,
            commands::get_secret,
            commands::delete_secret,
            commands::store_env_secret,
            commands::get_env_secret,
            commands::delete_env_secret,
            commands::store_auth_secret,
            commands::get_auth_secret,
            commands::delete_auth_secret,
            // Mock Server
            commands::mock_server_start,
            commands::mock_server_stop,
            commands::mock_server_status,
            commands::list_mock_routes,
            commands::save_mock_route,
            commands::delete_mock_route,
            // Utility
            write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn is_text_mime_text_prefix() {
        assert!(is_text_mime("text/plain"));
        assert!(is_text_mime("text/html"));
        assert!(is_text_mime("text/html; charset=utf-8"));
        assert!(is_text_mime("text/css"));
    }

    #[test]
    fn is_text_mime_known_application_types() {
        assert!(is_text_mime("application/json"));
        assert!(is_text_mime("application/json; charset=utf-8"));
        assert!(is_text_mime("application/xml"));
        assert!(is_text_mime("application/javascript"));
        assert!(is_text_mime("application/x-www-form-urlencoded"));
        assert!(is_text_mime("application/graphql"));
        assert!(is_text_mime("application/yaml"));
    }

    #[test]
    fn is_text_mime_structured_suffixes() {
        // RFC 6839 +json / +xml structured-syntax suffixes are common in
        // hypermedia APIs (e.g. application/vnd.github.v3+json).
        assert!(is_text_mime("application/vnd.github.v3+json"));
        assert!(is_text_mime("application/atom+xml"));
        assert!(is_text_mime("application/something+xml"));
    }

    #[test]
    fn is_text_mime_binary_types_rejected() {
        assert!(!is_text_mime("application/octet-stream"));
        assert!(!is_text_mime("application/pdf"));
        assert!(!is_text_mime("image/png"));
        assert!(!is_text_mime("image/jpeg"));
        assert!(!is_text_mime("video/mp4"));
        assert!(!is_text_mime("audio/mpeg"));
    }

    #[test]
    fn is_text_mime_case_insensitive() {
        // Some servers send the Content-Type in uppercase or mixed case.
        assert!(is_text_mime("APPLICATION/JSON"));
        assert!(is_text_mime("Text/HTML"));
        assert!(is_text_mime("APPLICATION/Vnd.Foo+JSON"));
    }

    #[test]
    fn is_text_mime_empty_input_is_binary() {
        // An empty / missing Content-Type should NOT be treated as text —
        // we'd rather base64 a body than corrupt binary data.
        assert!(!is_text_mime(""));
        assert!(!is_text_mime("   "));
    }

    #[test]
    fn now_ms_monotonic_within_call() {
        // Two successive calls in the same thread must produce a non-
        // decreasing timestamp. (Wall-clock time can move backwards
        // across NTP corrections, but not within a tight loop.)
        let a = now_ms();
        let b = now_ms();
        assert!(b >= a, "now_ms went backwards: {} -> {}", a, b);
    }

    #[test]
    fn active_requests_tracks_in_flight() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(async {
            let active = Arc::new(ActiveRequests::new());
            assert!(active.map.lock().await.is_empty());

            // Insert a fake cancellation token.
            let token = CancellationToken::new();
            active
                .map
                .lock()
                .await
                .insert("req-1".to_string(), token.clone());
            assert_eq!(active.map.lock().await.len(), 1);

            // Cancellation is observable through the cloned handle.
            token.cancel();
            assert!(active
                .map
                .lock()
                .await
                .get("req-1")
                .unwrap()
                .is_cancelled());

            // Removal is independent of cancellation.
            active.map.lock().await.remove("req-1");
            assert!(active.map.lock().await.is_empty());
        });
    }

    #[test]
    fn cached_bodies_holds_only_latest() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(async {
            let cache = Arc::new(CachedBodies::new());
            let first = bytes::Bytes::from_static(b"first response");
            let second = bytes::Bytes::from_static(b"second response");

            cache
                .map
                .lock()
                .await
                .insert("req-1".to_string(), first.clone());
            assert_eq!(
                cache.map.lock().await.get("req-1").cloned(),
                Some(first.clone())
            );

            // Re-insert the same key with a newer body — the cache is
            // bounded by "most recent per request id", so the old body
            // must be replaced, not appended.
            cache
                .map
                .lock()
                .await
                .insert("req-1".to_string(), second.clone());
            assert_eq!(
                cache.map.lock().await.get("req-1").cloned(),
                Some(second)
            );
            // No leftover under the original key.
            assert_eq!(cache.map.lock().await.len(), 1);
        });
    }

    #[test]
    fn app_cookies_returns_cheap_arc_clone() {
        let cookies = AppCookies::new();
        let jar_a = cookies.current_jar();
        let jar_b = cookies.current_jar();
        // Same underlying Arc — confirms the lock isn't building a fresh
        // jar on every call.
        assert!(Arc::ptr_eq(&jar_a, &jar_b));
    }

    #[test]
    fn persist_set_cookies_handles_zero_headers() {
        // Empty header map must not panic, must not insert anything.
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let url = url::Url::parse("https://example.com/").unwrap();
        let headers = reqwest::header::HeaderMap::new();
        persist_set_cookies(&db, &url, &headers);
        let all = db.get_all_cookies().expect("get_all_cookies");
        assert!(all.is_empty());
    }

    #[test]
    fn persist_set_cookies_basic() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let url = url::Url::parse("https://example.com/path").unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static(
                "session=abc123; Path=/; HttpOnly; Secure",
            ),
        );
        persist_set_cookies(&db, &url, &headers);
        let all = db.get_all_cookies().expect("get_all_cookies");
        assert_eq!(all.len(), 1);
        let c = &all[0];
        assert_eq!(c.name, "session");
        assert_eq!(c.value, "abc123");
        assert_eq!(c.domain, "example.com"); // default from request URL
        assert_eq!(c.path, "/");
        assert!(c.http_only);
        assert!(c.secure);
    }

    #[test]
    fn persist_set_cookies_strips_leading_dot_from_domain() {
        // RFC 6265 §5.2.3 says servers may send the Domain attribute with a
        // leading dot (legacy compat). The jar treats `.example.com` and
        // `example.com` as the same domain — we normalize so we never store
        // two rows that differ only by the leading dot.
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let url = url::Url::parse("https://example.com/").unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static(
                "tracker=xyz; Domain=.example.com; Path=/",
            ),
        );
        persist_set_cookies(&db, &url, &headers);
        let all = db.get_all_cookies().expect("get_all_cookies");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].domain, "example.com");
    }

    #[test]
    fn persist_set_cookies_upsert_replaces_existing() {
        // Saving the same (domain, path, name) tuple twice must produce a
        // single row whose value reflects the latest write — otherwise a
        // refreshed session cookie would silently duplicate.
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let url = url::Url::parse("https://example.com/").unwrap();

        let mut h1 = reqwest::header::HeaderMap::new();
        h1.insert(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static("session=v1; Path=/"),
        );
        persist_set_cookies(&db, &url, &h1);

        let mut h2 = reqwest::header::HeaderMap::new();
        h2.insert(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static("session=v2; Path=/"),
        );
        persist_set_cookies(&db, &url, &h2);

        let all = db.get_all_cookies().expect("get_all_cookies");
        assert_eq!(all.len(), 1, "should still be one row, not two");
        assert_eq!(all[0].value, "v2");
    }

    #[test]
    fn persist_set_cookies_skips_malformed_keeps_valid() {
        // A garbage Set-Cookie header must not bring down the request: the
        // loop must skip it and continue persisting subsequent valid ones.
        //
        // We exercise BOTH skip paths in persist_set_cookies:
        //   1. `to_str()` failure  — header bytes that aren't visible ASCII.
        //   2. `Cookie::parse()` failure — well-formed ASCII but not a
        //      valid cookie string (empty value here triggers cookie::ParseError).
        //
        // After all three headers are processed, only the trailing valid
        // cookie should be in the DB. This pins the "skip-don't-crash"
        // contract — if either skip path is removed, the test will either
        // panic on unwrap (loud failure) OR end up with len > 1.
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let url = url::Url::parse("https://example.com/").unwrap();
        let mut headers = reqwest::header::HeaderMap::new();

        // Skip path #1: bytes outside the visible-ASCII range make to_str()
        // return Err (the http crate accepts them via from_bytes but they
        // can't be losslessly converted to &str).
        if let Ok(non_visible) = reqwest::header::HeaderValue::from_bytes(&[0xC3, 0x28]) {
            headers.append(reqwest::header::SET_COOKIE, non_visible);
        }

        // Skip path #2: parseable as a string, but not as a cookie. An empty
        // header value cannot be a cookie (no name=value pair).
        headers.append(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static(""),
        );

        // Trailing valid cookie — must survive both skips and be persisted.
        headers.append(
            reqwest::header::SET_COOKIE,
            reqwest::header::HeaderValue::from_static("session=ok; Path=/"),
        );

        // Sanity-check the test fixture itself: prove the "malformed" inputs
        // actually fail their respective parser steps. If a future cookie-crate
        // version starts accepting these, the test would silently pass with
        // 3 cookies — make that loud instead.
        if let Some(non_visible) = headers
            .iter()
            .find_map(|(k, v)| (k == reqwest::header::SET_COOKIE && v.to_str().is_err()).then_some(v))
        {
            assert!(
                non_visible.to_str().is_err(),
                "fixture invariant: non-visible-ASCII header must fail to_str()"
            );
        }
        assert!(
            cookie::Cookie::parse("".to_string()).is_err(),
            "fixture invariant: empty string must fail Cookie::parse()"
        );

        persist_set_cookies(&db, &url, &headers);

        let all = db.get_all_cookies().expect("get_all_cookies");
        assert_eq!(
            all.len(),
            1,
            "malformed headers must be skipped, only the valid cookie persisted; got {:?}",
            all
        );
        assert_eq!(all[0].name, "session");
        assert_eq!(all[0].value, "ok");
    }

    #[test]
    fn build_jar_from_db_returns_empty_jar_for_empty_db() {
        // No cookies in the DB → still returns Some(jar), not None.
        // (Returning None would unnecessarily disable the cookie middleware
        // on fresh installs.)
        let conn = Connection::open_in_memory().expect("open in-memory db");
        let db = db::Database::from_connection(conn).expect("init_tables");
        let jar = build_jar_from_db(&db);
        assert!(jar.is_some(), "should return a jar even when no cookies stored");
    }
}
