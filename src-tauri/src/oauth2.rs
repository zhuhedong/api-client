// OAuth2 token acquisition helpers.
//
// Supported grant types:
//   * `client_credentials` — service-to-service auth
//   * `password`          — legacy resource-owner password grant
//   * `authorization_code` — interactive flow with PKCE (RFC 7636); opens
//                            the system browser, spins up a one-shot
//                            redirect listener on 127.0.0.1, and exchanges
//                            the returned `code` for tokens
//   * `refresh_token`     — exchange a refresh_token for a new access_token
//   * `device_code`       — RFC 8628 Device Authorization Grant. Two-step:
//                            (a) POST to the device-authorization endpoint
//                                to receive a `user_code` + `verification_uri`
//                                that the user enters on a second device,
//                            (b) poll the token endpoint with the
//                                `device_code` until the user approves or
//                                the code expires.

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::TcpListener;

/// Subset of the standard OAuth2 token endpoint response (RFC 6749 §5.1).
/// Extra provider-specific fields are ignored.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    /// Lifetime in seconds. Optional per spec; many providers omit it.
    #[serde(default)]
    expires_in: Option<i64>,
    /// Refresh token. Returned for `authorization_code`/`password` grants
    /// and (sometimes) `client_credentials`. We surface this so the
    /// frontend can cache it and let auto-refresh keep the access_token
    /// fresh.
    #[serde(default)]
    refresh_token: Option<String>,
    /// Most providers return "Bearer"; some omit it. Not currently used.
    #[allow(dead_code)]
    #[serde(default)]
    token_type: Option<String>,
}

/// Request body for the legacy `fetch_token` Tauri command. Covers
/// `client_credentials`, `password`, `authorization_code` (with PKCE),
/// and `refresh_token` grants in a single shape so the frontend doesn't
/// need a separate IPC for each.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OAuth2FetchRequest {
    /// "client_credentials" | "password" | "authorization_code" | "refresh_token"
    pub grant_type: String,
    pub token_url: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    /// Space-separated.
    pub scope: Option<String>,
    /// "basic" (HTTP Basic in Authorization header) or "body" (in form body).
    /// Defaults to "basic" when omitted, matching most providers' preference.
    pub client_auth: Option<String>,
    /// grant_type=password fields.
    pub username: Option<String>,
    pub password: Option<String>,
    /// Whether to skip TLS verification when fetching the token. Mirrors the
    /// per-request setting so OAuth2 against self-signed dev IdPs works.
    #[serde(default)]
    pub insecure: bool,

    // authorization_code-specific fields ----------------------------------
    /// Provider's authorization endpoint (e.g. https://github.com/login/oauth/authorize).
    /// Required when grant_type == "authorization_code" and no `code` has
    /// been captured yet (i.e. we're starting the flow).
    pub authorization_url: Option<String>,
    /// Pre-captured authorization code. If supplied, the function skips the
    /// browser dance and goes straight to the token exchange. Useful for
    /// providers that don't allow loopback redirects.
    pub code: Option<String>,
    /// Pre-known redirect URI. Required if `code` is supplied (must match
    /// what was sent on the authorization request). Otherwise the helper
    /// picks an ephemeral 127.0.0.1 port and constructs the URI itself.
    pub redirect_uri: Option<String>,
    /// Pre-computed PKCE verifier. Required if `code` is supplied. When
    /// missing the helper generates one.
    pub code_verifier: Option<String>,
    /// Whether to use PKCE. Defaults to true; setting to false skips the
    /// `code_challenge` parameter (some legacy providers reject it).
    #[serde(default = "default_use_pkce")]
    pub use_pkce: bool,

    // refresh_token-specific field ----------------------------------------
    pub refresh_token: Option<String>,
}

fn default_use_pkce() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
pub struct OAuth2FetchResponse {
    pub access_token: String,
    /// Unix millis when the token stops being valid. `None` if the provider
    /// didn't supply `expires_in`.
    pub expires_at: Option<i64>,
    /// Refresh token, if the provider returned one. Stored client-side so a
    /// later call to `oauth2_fetch_token` with grant_type=refresh_token can
    /// rotate the access_token without re-prompting the user.
    pub refresh_token: Option<String>,
}

/// Returned by `start_authorization_code_flow`. The frontend treats this as
/// an opaque object: it sends `code` + `code_verifier` + `redirect_uri`
/// back to `fetch_token` for the exchange.
#[derive(Debug, Serialize, Clone)]
pub struct AuthorizationCodeResult {
    pub code: String,
    pub redirect_uri: String,
    pub code_verifier: String,
    /// `state` parameter from the redirect — caller should verify it matches.
    pub state: String,
}

/// Request body for `start_device_code`. Hits the provider's
/// device-authorization endpoint per RFC 8628 §3.1.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceCodeStartRequest {
    /// e.g. `https://github.com/login/device/code` or
    /// `https://oauth2.googleapis.com/device/code`.
    pub device_authorization_url: String,
    pub client_id: String,
    /// Required only for confidential clients. Most provider device-code
    /// implementations target public clients and accept an empty secret.
    #[serde(default)]
    pub client_secret: String,
    pub scope: Option<String>,
    /// "basic" or "body". Defaults to "body" — many device-grant providers
    /// expect client credentials in the form body, not the Authorization
    /// header. Override per provider if needed.
    pub client_auth: Option<String>,
    #[serde(default)]
    pub insecure: bool,
}

/// Returned by `start_device_code`. The frontend should show `user_code`
/// and `verification_uri` to the user (auto-open `verification_uri_complete`
/// in the browser when available, falling back to `verification_uri`), then
/// call `poll_device_token` to await approval.
#[derive(Debug, Serialize, Clone)]
pub struct DeviceCodeStartResult {
    /// Opaque code we send back to the token endpoint while polling.
    pub device_code: String,
    /// Short, user-friendly code (e.g. `WDJB-MJHT`) the user types into
    /// the verification page.
    pub user_code: String,
    /// URL the user navigates to on a second device (or the same browser).
    pub verification_uri: String,
    /// Optional: URL with `user_code` pre-filled (RFC 8628 §3.3.1).
    /// Providers like GitHub include this so we can deep-link without
    /// asking the user to copy the code.
    pub verification_uri_complete: Option<String>,
    /// Total time before the device_code expires (seconds).
    pub expires_in: i64,
    /// Minimum interval between polls (seconds).
    pub interval: i64,
}

/// Request body for `poll_device_token`. Loops until the user approves or
/// the device_code expires.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceCodePollRequest {
    pub token_url: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    pub client_auth: Option<String>,
    pub device_code: String,
    /// Initial polling interval in seconds (from `DeviceCodeStartResult`).
    /// We may bump this on `slow_down` per RFC 8628 §3.5.
    pub interval: i64,
    /// Total polling budget in seconds (from `DeviceCodeStartResult`).
    /// Once we've polled this long, we give up with `expired_token`.
    pub expires_in: i64,
    #[serde(default)]
    pub insecure: bool,
}

/// Generate a PKCE code_verifier (RFC 7636 §4.1): 32 random bytes, base64url-
/// encoded without padding. Length: 43 characters, well within the 43–128
/// range the spec allows.
pub fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute the S256 code_challenge from a verifier:
/// `BASE64URL(SHA256(ASCII(verifier)))` per RFC 7636 §4.2.
pub fn code_challenge_s256(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Generate an opaque `state` value to bind the redirect to our session
/// and protect against CSRF. 16 random bytes is well over the 64 bits of
/// entropy OWASP recommends.
fn generate_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Bind a TCP listener on an ephemeral 127.0.0.1 port and return the
/// listener + the URI ("http://127.0.0.1:{port}/callback") the provider
/// should redirect to.
async fn bind_loopback_listener() -> Result<(TcpListener, String, u16), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind redirect listener: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read listener port: {}", e))?
        .port();
    let uri = format!("http://127.0.0.1:{}/callback", port);
    Ok((listener, uri, port))
}

/// Wait for the OAuth provider's redirect on a one-shot HTTP listener. The
/// listener accepts a single TCP connection, parses the request line for
/// query parameters (`code`, `state`, optional `error`), responds with a
/// minimal HTML "you can close this window" page, and returns the
/// captured params. Caller is responsible for verifying `state`.
async fn await_redirect(listener: TcpListener) -> Result<HashMap<String, String>, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Cap the wait so a forgotten/abandoned flow eventually frees the port.
    let accept = tokio::time::timeout(Duration::from_secs(300), listener.accept())
        .await
        .map_err(|_| "Timed out waiting for OAuth redirect (5 minutes).".to_string())?
        .map_err(|e| format!("Failed to accept redirect connection: {}", e))?;
    let (mut stream, _peer): (tokio::net::TcpStream, SocketAddr) = accept;

    // Read just enough of the request to get the request line + headers.
    // We don't care about the body; this is GET /callback?code=...&state=...
    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read redirect request: {}", e))?;
    buf.truncate(n);
    let req = String::from_utf8_lossy(&buf);

    // Parse the request line: "GET /callback?code=...&state=... HTTP/1.1"
    let first_line = req.lines().next().unwrap_or_default();
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("/");
    let query = path_and_query.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut params: HashMap<String, String> = HashMap::new();
    for pair in query.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let k = percent_decode(k);
        let v = percent_decode(v);
        params.insert(k, v);
    }

    let (status, title, message) = if let Some(err) = params.get("error") {
        (
            "400 Bad Request",
            "Authorization failed",
            err.clone(),
        )
    } else if params.contains_key("code") {
        (
            "200 OK",
            "Authorization complete",
            "You can close this window and return to the app.".to_string(),
        )
    } else {
        (
            "400 Bad Request",
            "Authorization failed",
            "Missing 'code' parameter in callback URL.".to_string(),
        )
    };
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title>\
         <style>body{{font:14px -apple-system,system-ui,sans-serif;color:#222;display:flex;\
         align-items:center;justify-content:center;height:100vh;margin:0}}\
         .card{{max-width:420px;padding:32px;text-align:center}}\
         h1{{font-size:18px;margin:0 0 12px}}p{{margin:0;color:#666}}</style></head>\
         <body><div class=\"card\"><h1>{}</h1><p>{}</p></div></body></html>",
        title, title, html_escape(&message)
    );
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        html.len(),
        html
    );
    // Best-effort write; the provider's redirect already gave us the code,
    // so even if the browser misses our response we still got what we need.
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;

    Ok(params)
}

/// Minimal URL percent-decoder. Handles the cases an OAuth provider would
/// actually produce in a redirect: %XX hex escapes and `+` for space.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push(((h << 4) | l) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Truncate an arbitrary text body so it's safe to embed in an error
/// message. Three constraints:
///   * Never panic on multi-byte UTF-8 — `&s[..n]` panics if `n` lands
///     inside a code point, which happens easily with localized provider
///     errors (CJK, accented Latin, emoji). We walk back to the nearest
///     char boundary instead.
///   * Keep the message size bounded so a malicious or runaway provider
///     can't push megabytes of HTML into a Rust panic / log line.
///   * Preserve any short body verbatim so unit-test assertions and the
///     UI's "everything fits, here's the JSON" path stay simple.
fn truncate_for_error_snippet(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

/// URL-encode a single query value. Conservative; allows only unreserved
/// characters and percent-encodes the rest. Used for building the
/// authorization endpoint URL.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Drive the authorization_code flow end-to-end:
///   1. Generate PKCE verifier + challenge + state
///   2. Bind a loopback listener and use its URI as redirect_uri
///   3. Open the system browser to the authorization endpoint
///   4. Await the redirect, capture the `code`
///   5. Return `(code, code_verifier, redirect_uri, state)` to the caller
///
/// The caller (Tauri command) is responsible for actually launching the
/// browser — we don't take a dependency on tauri_plugin_shell from this
/// module so the helper stays unit-testable.
pub async fn start_authorization_code<F, Fut>(
    req: &OAuth2FetchRequest,
    open_url: F,
) -> Result<AuthorizationCodeResult, String>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    if req.authorization_url.as_deref().unwrap_or("").is_empty() {
        return Err("Authorization URL is required for authorization_code grant".to_string());
    }
    if req.client_id.trim().is_empty() {
        return Err("Client ID is required".to_string());
    }

    let (listener, redirect_uri, _port) = bind_loopback_listener().await?;
    let state = generate_state();
    let code_verifier = generate_code_verifier();
    let code_challenge = code_challenge_s256(&code_verifier);

    let mut auth_url = req.authorization_url.clone().unwrap();
    let sep = if auth_url.contains('?') { '&' } else { '?' };
    auth_url.push(sep);
    auth_url.push_str(&format!(
        "response_type=code&client_id={}&redirect_uri={}&state={}",
        url_encode(&req.client_id),
        url_encode(&redirect_uri),
        url_encode(&state)
    ));
    if let Some(scope) = req.scope.as_deref() {
        if !scope.is_empty() {
            auth_url.push_str(&format!("&scope={}", url_encode(scope)));
        }
    }
    if req.use_pkce {
        auth_url.push_str(&format!(
            "&code_challenge={}&code_challenge_method=S256",
            url_encode(&code_challenge)
        ));
    }

    open_url(auth_url).await?;

    let params = await_redirect(listener).await?;
    if let Some(err) = params.get("error") {
        let desc = params
            .get("error_description")
            .map(|s| format!(": {}", s))
            .unwrap_or_default();
        return Err(format!("Authorization failed ({}{})", err, desc));
    }
    let returned_state = params.get("state").cloned().unwrap_or_default();
    if returned_state != state {
        return Err(format!(
            "OAuth state mismatch (expected {}, got {}); possible CSRF — token exchange aborted.",
            state, returned_state
        ));
    }
    let code = params
        .get("code")
        .cloned()
        .ok_or_else(|| "Authorization callback did not include a 'code' parameter.".to_string())?;

    Ok(AuthorizationCodeResult {
        code,
        redirect_uri,
        code_verifier,
        state,
    })
}

/// Start the Device Authorization Grant flow (RFC 8628 §3.1–§3.2).
/// POST `client_id` (+ optional `scope`) to the device-authorization
/// endpoint and parse the JSON response into `DeviceCodeStartResult`.
///
/// We default `client_auth` to "body" because most device-grant providers
/// (GitHub, Google) target public clients and either ignore or reject the
/// Authorization header on this endpoint.
pub async fn start_device_code(req: DeviceCodeStartRequest) -> Result<DeviceCodeStartResult, String> {
    if req.device_authorization_url.trim().is_empty() {
        return Err("Device authorization URL is required".to_string());
    }
    if req.client_id.trim().is_empty() {
        return Err("Client ID is required".to_string());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(req.insecure)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut form: HashMap<&str, &str> = HashMap::new();
    if let Some(s) = req.scope.as_deref() {
        if !s.is_empty() {
            form.insert("scope", s);
        }
    }

    let client_auth = req.client_auth.as_deref().unwrap_or("body");
    let has_secret = !req.client_secret.is_empty();
    let mut builder = client.post(&req.device_authorization_url);
    match client_auth {
        "basic" if has_secret => {
            builder = builder.basic_auth(&req.client_id, Some(&req.client_secret));
        }
        "basic" => {
            form.insert("client_id", &req.client_id);
        }
        "body" => {
            form.insert("client_id", &req.client_id);
            if has_secret {
                form.insert("client_secret", &req.client_secret);
            }
        }
        other => return Err(format!("Unsupported client_auth: {}", other)),
    }

    builder = builder.header("Accept", "application/json").form(&form);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Device authorization request failed: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read device authorization response body: {}", e))?;

    if !status.is_success() {
        let snippet = truncate_for_error_snippet(&body_text, 500);
        return Err(format!(
            "Device authorization endpoint returned {}: {}",
            status, snippet
        ));
    }

    // RFC 8628 §3.2 shape (only the fields we care about; provider extras
    // are ignored). `interval` and `expires_in` are optional in the spec —
    // fall back to the RFC-recommended defaults when omitted.
    #[derive(Debug, Deserialize)]
    struct DeviceAuthResponse {
        device_code: String,
        user_code: String,
        verification_uri: Option<String>,
        /// Google historically used `verification_url` instead of
        /// `verification_uri`. Accept either; prefer the RFC spelling.
        #[serde(default)]
        verification_url: Option<String>,
        #[serde(default)]
        verification_uri_complete: Option<String>,
        #[serde(default)]
        expires_in: Option<i64>,
        #[serde(default)]
        interval: Option<i64>,
    }

    let parsed: DeviceAuthResponse = serde_json::from_str(&body_text).map_err(|e| {
        format!(
            "Failed to parse device authorization response: {} (body: {})",
            e, body_text
        )
    })?;

    let verification_uri = parsed
        .verification_uri
        .or(parsed.verification_url)
        .ok_or_else(|| {
            format!(
                "Device authorization response missing verification_uri (body: {})",
                body_text
            )
        })?;

    Ok(DeviceCodeStartResult {
        device_code: parsed.device_code,
        user_code: parsed.user_code,
        verification_uri,
        verification_uri_complete: parsed.verification_uri_complete,
        // RFC 8628 §3.2: clients SHOULD default `interval` to 5s and
        // `expires_in` to whatever the provider tells them. If neither
        // shows up, 10 minutes is a safe upper bound.
        expires_in: parsed.expires_in.unwrap_or(600).max(60),
        interval: parsed.interval.unwrap_or(5).max(1),
    })
}

/// RFC 8628 §3.4–§3.5 token polling. Repeatedly POST
/// `grant_type=urn:ietf:params:oauth:grant-type:device_code` to the token
/// endpoint until the user approves (token returned), the user denies
/// (`access_denied`), or the device_code expires (`expired_token` /
/// deadline reached).
///
/// `interval` is the minimum delay between polls. `slow_down` responses
/// bump the interval by 5s per spec.
pub async fn poll_device_token(
    req: DeviceCodePollRequest,
) -> Result<OAuth2FetchResponse, String> {
    if req.token_url.trim().is_empty() {
        return Err("Token URL is required".to_string());
    }
    if req.client_id.trim().is_empty() {
        return Err("Client ID is required".to_string());
    }
    if req.device_code.trim().is_empty() {
        return Err("Device code is required".to_string());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(req.insecure)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut interval = req.interval.max(1);
    let deadline = tokio::time::Instant::now()
        + Duration::from_secs(req.expires_in.max(30) as u64);

    let client_auth = req.client_auth.as_deref().unwrap_or("body");
    let has_secret = !req.client_secret.is_empty();

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "Device authorization timed out before the user approved.".to_string(),
            );
        }

        // Hold the form values in local strings so the &str inserts into
        // the form HashMap stay alive for the duration of the request.
        let device_code = req.device_code.clone();
        let client_id = req.client_id.clone();
        let client_secret = req.client_secret.clone();

        let mut form: HashMap<&str, &str> = HashMap::new();
        form.insert(
            "grant_type",
            "urn:ietf:params:oauth:grant-type:device_code",
        );
        form.insert("device_code", &device_code);

        let mut builder = client.post(&req.token_url);
        match client_auth {
            "basic" if has_secret => {
                builder = builder.basic_auth(&client_id, Some(&client_secret));
            }
            "basic" => {
                form.insert("client_id", &client_id);
            }
            "body" => {
                form.insert("client_id", &client_id);
                if has_secret {
                    form.insert("client_secret", &client_secret);
                }
            }
            other => return Err(format!("Unsupported client_auth: {}", other)),
        }
        builder = builder.header("Accept", "application/json").form(&form);

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Device token poll failed: {}", e))?;

        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read device token poll body: {}", e))?;

        if status.is_success() {
            let parsed: TokenResponse =
                serde_json::from_str(&body_text).map_err(|e| {
                    format!(
                        "Failed to parse token response: {} (body: {})",
                        e, body_text
                    )
                })?;
            let expires_at = parsed.expires_in.map(|seconds| {
                let now = chrono::Utc::now().timestamp_millis();
                now + (seconds.max(60) - 30) * 1000
            });
            return Ok(OAuth2FetchResponse {
                access_token: parsed.access_token,
                expires_at,
                refresh_token: parsed.refresh_token,
            });
        }

        // Per RFC 8628 §3.5, the body is JSON with `error` (and optional
        // `error_description`) on every non-success response. We branch
        // on the error code rather than the HTTP status: providers vary
        // between 400/403 for the polling-in-progress states.
        #[derive(Debug, Deserialize)]
        struct PollError {
            error: String,
            #[serde(default)]
            error_description: Option<String>,
        }
        // Take ownership of the parsed struct (when present) so we can
        // move out of its fields in the `Some(other)` arm below.
        let parsed: Option<PollError> = serde_json::from_str(&body_text).ok();
        match parsed.as_ref().map(|p| p.error.as_str()) {
            Some("authorization_pending") => {
                tokio::time::sleep(Duration::from_secs(interval as u64)).await;
                continue;
            }
            Some("slow_down") => {
                // §3.5: client MUST increase its polling interval by 5s.
                interval = interval.saturating_add(5);
                tokio::time::sleep(Duration::from_secs(interval as u64)).await;
                continue;
            }
            Some("access_denied") => {
                return Err("Authorization was denied by the user.".to_string());
            }
            Some("expired_token") => {
                return Err(
                    "Device code expired before the user approved.".to_string(),
                );
            }
            Some(other) => {
                let other = other.to_string();
                let desc = parsed
                    .and_then(|p| p.error_description)
                    .map(|s| format!(": {}", s))
                    .unwrap_or_default();
                return Err(format!("Device token poll failed ({}{})", other, desc));
            }
            None => {
                let snippet = truncate_for_error_snippet(&body_text, 500);
                return Err(format!(
                    "Token endpoint returned {} during device polling: {}",
                    status, snippet
                ));
            }
        }
    }
}

pub async fn fetch_token(req: OAuth2FetchRequest) -> Result<OAuth2FetchResponse, String> {
    if req.token_url.trim().is_empty() {
        return Err("Token URL is required".to_string());
    }
    if req.client_id.trim().is_empty() {
        return Err("Client ID is required".to_string());
    }
    let grant = req.grant_type.as_str();
    match grant {
        "client_credentials" | "password" | "authorization_code" | "refresh_token" => {}
        other => return Err(format!("Unsupported grant_type: {}", other)),
    }
    if grant == "password" {
        if req.username.as_deref().unwrap_or("").is_empty() {
            return Err("Username is required for grant_type=password".to_string());
        }
        if req.password.as_deref().unwrap_or("").is_empty() {
            return Err("Password is required for grant_type=password".to_string());
        }
    }
    if grant == "authorization_code" {
        if req.code.as_deref().unwrap_or("").is_empty() {
            return Err("Authorization code is required for grant_type=authorization_code".to_string());
        }
        if req.redirect_uri.as_deref().unwrap_or("").is_empty() {
            return Err("Redirect URI is required for grant_type=authorization_code".to_string());
        }
    }
    if grant == "refresh_token" && req.refresh_token.as_deref().unwrap_or("").is_empty() {
        return Err("Refresh token is required for grant_type=refresh_token".to_string());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(req.insecure)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut form: HashMap<&str, &str> = HashMap::new();
    form.insert("grant_type", grant);
    if let Some(s) = req.scope.as_deref() {
        if !s.is_empty() {
            form.insert("scope", s);
        }
    }
    match grant {
        "password" => {
            // SAFETY: validated above.
            form.insert("username", req.username.as_deref().unwrap());
            form.insert("password", req.password.as_deref().unwrap());
        }
        "authorization_code" => {
            form.insert("code", req.code.as_deref().unwrap());
            form.insert("redirect_uri", req.redirect_uri.as_deref().unwrap());
            if let Some(v) = req.code_verifier.as_deref() {
                if !v.is_empty() {
                    form.insert("code_verifier", v);
                }
            }
        }
        "refresh_token" => {
            form.insert("refresh_token", req.refresh_token.as_deref().unwrap());
        }
        _ => {}
    }

    let client_auth = req.client_auth.as_deref().unwrap_or("basic");
    let mut builder = client.post(&req.token_url);

    // For public clients (PKCE with no secret), skip Basic auth even if
    // the caller defaulted to "basic" — sending an empty password trips
    // some providers.
    let has_secret = !req.client_secret.is_empty();

    match client_auth {
        "basic" if has_secret => {
            // Per RFC 6749 §2.3.1, client creds in HTTP Basic is the preferred
            // method when the provider supports it.
            builder = builder.basic_auth(&req.client_id, Some(&req.client_secret));
        }
        "basic" => {
            // No client_secret — fall through to body and just send client_id
            // so the provider can identify us. Required for the PKCE-only
            // public-client flow.
            form.insert("client_id", &req.client_id);
        }
        "body" => {
            form.insert("client_id", &req.client_id);
            if has_secret {
                form.insert("client_secret", &req.client_secret);
            }
        }
        other => return Err(format!("Unsupported client_auth: {}", other)),
    }

    builder = builder.header("Accept", "application/json").form(&form);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read token response body: {}", e))?;

    if !status.is_success() {
        // Many providers return JSON {"error": "...", "error_description": "..."}
        // on failure. Surface that verbatim if present, otherwise raw body.
        let snippet = truncate_for_error_snippet(&body_text, 500);
        return Err(format!("Token endpoint returned {}: {}", status, snippet));
    }

    let parsed: TokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse token response: {} (body: {})", e, body_text))?;

    let expires_at = parsed.expires_in.map(|seconds| {
        let now = chrono::Utc::now().timestamp_millis();
        // Treat the token as expiring 30s earlier than the provider claims
        // so clock skew and in-flight latency don't cause first-use 401s.
        now + (seconds.max(60) - 30) * 1000
    });

    Ok(OAuth2FetchResponse {
        access_token: parsed.access_token,
        expires_at,
        refresh_token: parsed.refresh_token,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_for_error_snippet_preserves_short_ascii() {
        assert_eq!(truncate_for_error_snippet("hello", 500), "hello");
        assert_eq!(truncate_for_error_snippet("", 500), "");
    }

    #[test]
    fn truncate_for_error_snippet_bounds_long_ascii_with_ellipsis() {
        let long = "a".repeat(1000);
        let out = truncate_for_error_snippet(&long, 500);
        // 500 bytes of 'a' + the single-codepoint ellipsis.
        assert_eq!(out.len(), 500 + '…'.len_utf8());
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_for_error_snippet_does_not_panic_on_multibyte_boundary() {
        // 200 copies of a 3-byte CJK character (600 bytes total). A naive
        // `&s[..500]` would land at byte 500, which is inside the 167th
        // character (bytes 498..501) and panic. The helper must back up
        // to byte 498 (the nearest char boundary).
        let s: String = std::iter::repeat_n('哈', 200).collect();
        assert_eq!(s.len(), 600);
        let out = truncate_for_error_snippet(&s, 500);
        // Sanity-check: the truncated body must be valid UTF-8 (already
        // implied by Rust's `&str`, but we verify the boundary handling
        // by confirming the byte length matches 498 + ellipsis).
        assert_eq!(out.len(), 498 + '…'.len_utf8());
        assert!(out.ends_with('…'));
        // Every char in the body must be the original CJK char (no
        // partial code point smuggled in).
        for c in out.chars().take_while(|c| *c != '…') {
            assert_eq!(c, '哈');
        }
    }

    #[test]
    fn truncate_for_error_snippet_handles_emoji_at_boundary() {
        // 🌍 is 4 bytes; place one straddling byte 500.
        let mut s = "x".repeat(498);
        s.push('🌍');
        s.push_str("yz");
        // Total = 498 + 4 + 2 = 504 bytes.
        let out = truncate_for_error_snippet(&s, 500);
        // Must back up to byte 498 (before the emoji).
        assert_eq!(out.len(), 498 + '…'.len_utf8());
    }

    #[test]
    fn code_verifier_is_43_chars_url_safe() {
        let v = generate_code_verifier();
        assert_eq!(v.len(), 43);
        for c in v.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "code_verifier must be url-safe base64 (no padding); got {:?}",
                c
            );
        }
    }

    #[test]
    fn code_challenge_matches_rfc7636_test_vector() {
        // RFC 7636 Appendix B test vector:
        //   verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        //   challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        let v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let c = code_challenge_s256(v);
        assert_eq!(c, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn percent_decode_handles_common_cases() {
        assert_eq!(percent_decode("hello"), "hello");
        assert_eq!(percent_decode("hello+world"), "hello world");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a%2Bb"), "a+b");
        // Malformed escape — pass through verbatim.
        assert_eq!(percent_decode("a%2"), "a%2");
    }

    #[test]
    fn url_encode_preserves_unreserved_chars() {
        assert_eq!(url_encode("abc"), "abc");
        assert_eq!(url_encode("a b"), "a%20b");
        assert_eq!(url_encode("a/b"), "a%2Fb");
        assert_eq!(url_encode("user:pass"), "user%3Apass");
    }

    #[test]
    fn fetch_token_rejects_missing_authorization_code_fields() {
        // Missing code
        let req = OAuth2FetchRequest {
            grant_type: "authorization_code".into(),
            token_url: "https://example.test/token".into(),
            client_id: "cid".into(),
            client_secret: String::new(),
            scope: None,
            client_auth: None,
            username: None,
            password: None,
            insecure: false,
            authorization_url: None,
            code: None,
            redirect_uri: Some("http://127.0.0.1:1234/callback".into()),
            code_verifier: Some("v".into()),
            use_pkce: true,
            refresh_token: None,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_token(req))
            .unwrap_err();
        assert!(err.contains("Authorization code is required"), "got {}", err);

        // Missing redirect_uri
        let req = OAuth2FetchRequest {
            grant_type: "authorization_code".into(),
            token_url: "https://example.test/token".into(),
            client_id: "cid".into(),
            client_secret: String::new(),
            scope: None,
            client_auth: None,
            username: None,
            password: None,
            insecure: false,
            authorization_url: None,
            code: Some("c".into()),
            redirect_uri: None,
            code_verifier: Some("v".into()),
            use_pkce: true,
            refresh_token: None,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_token(req))
            .unwrap_err();
        assert!(err.contains("Redirect URI is required"), "got {}", err);
    }

    #[test]
    fn fetch_token_rejects_missing_refresh_token() {
        let req = OAuth2FetchRequest {
            grant_type: "refresh_token".into(),
            token_url: "https://example.test/token".into(),
            client_id: "cid".into(),
            client_secret: String::new(),
            scope: None,
            client_auth: None,
            username: None,
            password: None,
            insecure: false,
            authorization_url: None,
            code: None,
            redirect_uri: None,
            code_verifier: None,
            use_pkce: true,
            refresh_token: None,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(fetch_token(req))
            .unwrap_err();
        assert!(err.contains("Refresh token is required"), "got {}", err);
    }

    #[test]
    fn start_device_code_rejects_missing_inputs() {
        // Missing device_authorization_url
        let req = DeviceCodeStartRequest {
            device_authorization_url: String::new(),
            client_id: "cid".into(),
            client_secret: String::new(),
            scope: None,
            client_auth: None,
            insecure: false,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(start_device_code(req))
            .unwrap_err();
        assert!(
            err.contains("Device authorization URL is required"),
            "got {}",
            err
        );

        // Missing client_id
        let req = DeviceCodeStartRequest {
            device_authorization_url: "https://example.test/device".into(),
            client_id: String::new(),
            client_secret: String::new(),
            scope: None,
            client_auth: None,
            insecure: false,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(start_device_code(req))
            .unwrap_err();
        assert!(err.contains("Client ID is required"), "got {}", err);
    }

    #[test]
    fn poll_device_token_rejects_missing_inputs() {
        // Missing token_url
        let req = DeviceCodePollRequest {
            token_url: String::new(),
            client_id: "cid".into(),
            client_secret: String::new(),
            client_auth: None,
            device_code: "dc".into(),
            interval: 5,
            expires_in: 600,
            insecure: false,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(poll_device_token(req))
            .unwrap_err();
        assert!(err.contains("Token URL is required"), "got {}", err);

        // Missing device_code
        let req = DeviceCodePollRequest {
            token_url: "https://example.test/token".into(),
            client_id: "cid".into(),
            client_secret: String::new(),
            client_auth: None,
            device_code: String::new(),
            interval: 5,
            expires_in: 600,
            insecure: false,
        };
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(poll_device_token(req))
            .unwrap_err();
        assert!(err.contains("Device code is required"), "got {}", err);
    }

    #[test]
    fn poll_device_token_does_not_hang_when_token_endpoint_is_unreachable() {
        // Smoke test: point the poll loop at an unreachable port. Whatever
        // error it returns (immediate connection-refused, or the deadline
        // firing inside the loop), the helper must surface it as Err
        // rather than spinning indefinitely. We bound the test on a 10s
        // wall clock so a regression here shows up as a clear hang.
        let req = DeviceCodePollRequest {
            // Port 1 is reserved and effectively guaranteed to refuse
            // connections in CI environments.
            token_url: "http://127.0.0.1:1/token".into(),
            client_id: "cid".into(),
            client_secret: String::new(),
            client_auth: None,
            device_code: "dc".into(),
            interval: 5,
            expires_in: 0, // will get clamped to a 30s deadline internally
            insecure: false,
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(async {
            tokio::time::timeout(Duration::from_secs(10), poll_device_token(req)).await
        });
        let outer = result.expect("poll_device_token hung past 10s");
        // We accept any Err — connection refused, dns error, etc. The
        // failure mode we're guarding against is the function silently
        // succeeding (impossible without a real token endpoint) or
        // hanging past the wall clock.
        assert!(outer.is_err(), "expected an error from unreachable endpoint");
    }
}
