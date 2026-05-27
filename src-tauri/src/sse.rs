//! Server-Sent Events (SSE) client implementation.
//!
//! Streams `text/event-stream` responses chunk-by-chunk from a server, parses
//! the wire format per the WHATWG HTML spec, and forwards each event to the
//! frontend over the Tauri `sse-event` channel. One stream per `request_id`.
//!
//! The reader runs in its own Tokio task; cancellation happens through a
//! `CancellationToken` stored in [`SseConnections`]. The frontend stops a
//! stream by invoking the `sse_close` command which cancels the token.
//!
//! Spec reference: https://html.spec.whatwg.org/multipage/server-sent-events.html

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CACHE_CONTROL};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::KeyValue;

/// Map of `request_id` → cancellation handle for the spawned reader task.
#[derive(Default)]
pub struct SseConnections {
    pub map: Mutex<HashMap<String, CancellationToken>>,
}

/// Frontend-visible payload pushed on the `sse-event` channel.
///
/// `kind` is one of `"open" | "message" | "error" | "close"`. For `"message"`
/// the optional fields carry the parsed SSE frame; the others use `error`
/// (description) and leave the rest empty.
#[derive(Debug, Serialize, Clone)]
pub struct SseEvent {
    pub request_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SseConnectPayload {
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub request_id: String,
    /// Override the default TLS-verify setting for this stream.
    #[serde(default)]
    pub verify_tls: Option<bool>,
    /// Wall-clock cap for the initial handshake (ms). Once connected the
    /// stream runs until the server closes or the client cancels.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// Accumulator for a single in-flight SSE event.
#[derive(Default)]
struct EventBuilder {
    event_type: Option<String>,
    data: Vec<String>,
    last_id: Option<String>,
    retry: Option<u64>,
}

impl EventBuilder {
    fn dispatch(&mut self, request_id: &str, app: &AppHandle) {
        if self.data.is_empty() && self.event_type.is_none() && self.retry.is_none() {
            // Empty frames (just a blank line) are skipped per spec.
            return;
        }
        let data = if self.data.is_empty() {
            None
        } else {
            // Per spec, multiple `data:` lines are joined with a literal `\n`,
            // and a trailing newline is stripped — which `join` already gives.
            Some(self.data.join("\n"))
        };
        let evt = SseEvent {
            request_id: request_id.to_string(),
            kind: "message".to_string(),
            event: self.event_type.take(),
            data,
            id: self.last_id.clone(),
            retry: self.retry.take(),
            error: None,
        };
        let _ = app.emit("sse-event", evt);
        self.data.clear();
    }
}

/// Feed one line of decoded body into the accumulator. Returns `true` if the
/// line was a blank line (i.e. dispatch boundary).
fn process_line(line: &str, builder: &mut EventBuilder) -> bool {
    if line.is_empty() {
        return true;
    }
    // Comments start with `:` and are ignored.
    if let Some(rest) = line.strip_prefix(':') {
        // Common keep-alive: `:` followed by a comment payload. Ignore.
        let _ = rest;
        return false;
    }
    // Field name / value parsing: `field: value` or just `field`.
    let (field, value) = match line.find(':') {
        Some(idx) => {
            let (f, v) = line.split_at(idx);
            // Skip the colon. If a single space follows it, skip that too.
            let v = &v[1..];
            let v = v.strip_prefix(' ').unwrap_or(v);
            (f, v)
        }
        None => (line, ""),
    };
    match field {
        "event" => builder.event_type = Some(value.to_string()),
        "data" => builder.data.push(value.to_string()),
        // Per spec, ignore IDs containing NULs.
        "id" if !value.contains('\0') => {
            builder.last_id = Some(value.to_string());
        }
        "retry" => {
            if let Ok(ms) = value.parse::<u64>() {
                builder.retry = Some(ms);
            }
        }
        _ => {
            // Unknown field: ignored per spec.
        }
    }
    false
}

/// Drain whatever remains in `buffer` at stream EOF / error. The inner
/// line-draining loop may have stopped with content still pending:
///
/// 1. A deferred trailing `\r` waiting for its paired `\n` of a `\r\n`
///    sequence that won't ever arrive — we treat the `\r` as a complete
///    terminator on its own (which the SSE spec allows).
/// 2. A final line with no terminator at all (the server closed mid-line) —
///    spec says still process it as if it were terminated.
///
/// Caller is expected to invoke `builder.dispatch(...)` after this
/// (the post-flush empty line is the final dispatch boundary).
fn flush_trailing(
    buffer: &mut String,
    builder: &mut EventBuilder,
    request_id: &str,
    app: &AppHandle,
) {
    if buffer.ends_with('\r') {
        buffer.pop();
    }
    if buffer.is_empty() {
        return;
    }
    let line = std::mem::take(buffer);
    if process_line(&line, builder) {
        builder.dispatch(request_id, app);
    }
}

/// Entry point invoked by the Tauri `sse_connect` command.
///
/// Resolves outside the command handler so we can return early with a useful
/// error before kicking off the background task.
pub async fn run_sse_stream(
    app: AppHandle,
    connections: Arc<SseConnections>,
    payload: SseConnectPayload,
    verify_tls_default: bool,
) -> Result<(), String> {
    let SseConnectPayload {
        url,
        headers,
        request_id,
        verify_tls,
        timeout_ms,
    } = payload;

    // If a stream is already running for this request id, cancel it first.
    {
        let mut map = connections.map.lock().await;
        if let Some(token) = map.remove(&request_id) {
            token.cancel();
        }
    }

    // Build the request client. We don't share the global cookie-aware client
    // because SSE streams typically run for a long time and we want predictable
    // per-stream config (TLS, timeout).
    let mut builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(!verify_tls.unwrap_or(verify_tls_default));
    if let Some(ms) = timeout_ms {
        builder = builder.connect_timeout(Duration::from_millis(ms));
    }
    let client = builder
        .build()
        .map_err(|e| format!("Failed to build SSE client: {}", e))?;

    let mut header_map = HeaderMap::new();
    header_map.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    header_map.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    for h in &headers {
        if !h.enabled || h.key.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(h.key.as_bytes())
            .map_err(|e| format!("Invalid header name '{}': {}", h.key, e))?;
        let value = HeaderValue::from_str(&h.value)
            .map_err(|e| format!("Invalid header value '{}': {}", h.value, e))?;
        header_map.insert(name, value);
    }

    let response = client
        .get(&url)
        .headers(header_map)
        .send()
        .await
        .map_err(|e| format!("SSE connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "SSE server returned {}: {}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or("")
        ));
    }
    // Loose content-type check — many servers omit it.
    if let Some(ct) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        if let Ok(ct_str) = ct.to_str() {
            if !ct_str.to_ascii_lowercase().contains("text/event-stream") {
                // Not fatal; warn the user via an `error` frame but keep going.
                let _ = app.emit(
                    "sse-event",
                    SseEvent {
                        request_id: request_id.clone(),
                        kind: "error".to_string(),
                        event: None,
                        data: None,
                        id: None,
                        retry: None,
                        error: Some(format!(
                            "Server sent unexpected Content-Type '{}'; parsing as SSE anyway",
                            ct_str
                        )),
                    },
                );
            }
        }
    }

    let token = CancellationToken::new();
    {
        let mut map = connections.map.lock().await;
        map.insert(request_id.clone(), token.clone());
    }

    // Announce a successful handshake before spawning the reader so the UI
    // can flip its connection indicator immediately.
    let _ = app.emit(
        "sse-event",
        SseEvent {
            request_id: request_id.clone(),
            kind: "open".to_string(),
            event: None,
            data: None,
            id: None,
            retry: None,
            error: None,
        },
    );

    let app_clone = app.clone();
    let connections_arc = connections.clone();
    let request_id_clone = request_id.clone();
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        // SSE is required to be valid UTF-8. We use a rolling buffer so we
        // can wait for whole lines (and whole events) before parsing.
        let mut buffer = String::new();
        let mut builder = EventBuilder::default();
        let mut error_msg: Option<String> = None;

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            match std::str::from_utf8(&bytes) {
                                Ok(s) => buffer.push_str(s),
                                Err(_) => {
                                    // Lossy fallback so a single bad byte doesn't kill the stream.
                                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                                }
                            }
                            // Drain whole lines out of the buffer. Spec accepts
                            // \r, \n, or \r\n as the line terminator.
                            loop {
                                let nl = buffer.find('\n');
                                let cr = buffer.find('\r');
                                let cut = match (nl, cr) {
                                    (Some(n), Some(c)) => Some(n.min(c)),
                                    (Some(n), None) => Some(n),
                                    (None, Some(c)) => Some(c),
                                    (None, None) => None,
                                };
                                let Some(idx) = cut else { break };
                                // If the terminator is a trailing `\r` with no
                                // byte after it, the paired `\n` of a `\r\n`
                                // sequence might be split across a chunk
                                // boundary. Bail out and wait for the next
                                // chunk so we don't dispatch an event twice.
                                if buffer.as_bytes()[idx] == b'\r' && idx + 1 == buffer.len() {
                                    break;
                                }
                                let line: String = buffer.drain(..idx).collect();
                                // Pop the terminator (and the paired \n in CRLF).
                                let first = buffer.chars().next();
                                if first == Some('\r') {
                                    buffer.drain(..1);
                                    if buffer.starts_with('\n') {
                                        buffer.drain(..1);
                                    }
                                } else if first == Some('\n') {
                                    buffer.drain(..1);
                                }
                                if process_line(&line, &mut builder) {
                                    builder.dispatch(&request_id_clone, &app_clone);
                                }
                            }
                        }
                        Some(Err(e)) => {
                            // Stream errored mid-flight. Match the original
                            // behavior — drop any in-flight event and only
                            // surface the error to the frontend. (Unlike
                            // EOF, we have no guarantee the partial line
                            // is complete.)
                            error_msg = Some(e.to_string());
                            break;
                        }
                        None => {
                            // Stream EOF. The inner line-draining loop may
                            // have left content in `buffer`: either a
                            // deferred `\r` waiting on its paired `\n`, or
                            // a final line with no trailing terminator at
                            // all. Both cases need to be processed before
                            // we emit the final dispatch — otherwise the
                            // last event of a stream that ends abruptly is
                            // silently dropped.
                            flush_trailing(&mut buffer, &mut builder, &request_id_clone, &app_clone);
                            builder.dispatch(&request_id_clone, &app_clone);
                            break;
                        }
                    }
                }
            }
        }

        if let Some(e) = error_msg {
            let _ = app_clone.emit(
                "sse-event",
                SseEvent {
                    request_id: request_id_clone.clone(),
                    kind: "error".to_string(),
                    event: None,
                    data: None,
                    id: None,
                    retry: None,
                    error: Some(e),
                },
            );
        }
        let _ = app_clone.emit(
            "sse-event",
            SseEvent {
                request_id: request_id_clone.clone(),
                kind: "close".to_string(),
                event: None,
                data: None,
                id: None,
                retry: None,
                error: None,
            },
        );

        let mut map = connections_arc.map.lock().await;
        map.remove(&request_id_clone);
    });

    Ok(())
}

/// Cancel the stream associated with `request_id`. No-op if none exists.
pub async fn close_sse_stream(
    connections: Arc<SseConnections>,
    request_id: String,
) {
    let mut map = connections.map.lock().await;
    if let Some(token) = map.remove(&request_id) {
        token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: feed a sequence of lines through process_line and return what
    // the EventBuilder accumulated, *without* actually dispatching (since
    // dispatch needs a real Tauri AppHandle which we can't fake in a unit
    // test). Returns a vec of "synthetic events" reconstructed from the
    // builder state at each dispatch boundary.
    #[derive(Debug, PartialEq, Eq, Default)]
    struct Frame {
        event: Option<String>,
        data: Option<String>,
        last_id: Option<String>,
        retry: Option<u64>,
    }

    fn parse(input: &str) -> Vec<Frame> {
        let mut builder = EventBuilder::default();
        let mut frames = Vec::new();
        for line in input.split('\n') {
            // Strip the optional CR so we can write tests with regular \n.
            let line = line.trim_end_matches('\r');
            let boundary = process_line(line, &mut builder);
            if boundary {
                // Mimic dispatch logic — only emit if at least one field set.
                if !(builder.data.is_empty()
                    && builder.event_type.is_none()
                    && builder.retry.is_none())
                {
                    let data = if builder.data.is_empty() {
                        None
                    } else {
                        Some(builder.data.join("\n"))
                    };
                    frames.push(Frame {
                        event: builder.event_type.take(),
                        data,
                        last_id: builder.last_id.clone(),
                        retry: builder.retry.take(),
                    });
                    builder.data.clear();
                }
            }
        }
        frames
    }

    #[test]
    fn parses_simple_data_event() {
        // Two data lines + dispatch boundary.
        let frames = parse("data: hello\ndata: world\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, Some("hello\nworld".to_string()));
        assert!(frames[0].event.is_none());
        assert!(frames[0].retry.is_none());
    }

    #[test]
    fn parses_event_type() {
        let frames = parse("event: ping\ndata: pong\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].event, Some("ping".to_string()));
        assert_eq!(frames[0].data, Some("pong".to_string()));
    }

    #[test]
    fn carries_id_across_events() {
        // `id` is sticky — once set, all subsequent dispatches inherit it
        // until overridden, matching the EventSource spec.
        let frames = parse("id: 42\ndata: a\n\ndata: b\n\n");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].last_id, Some("42".to_string()));
        assert_eq!(frames[1].last_id, Some("42".to_string()));
    }

    #[test]
    fn ignores_id_with_null_byte() {
        // Per spec, IDs containing NUL must be discarded.
        let frames = parse("id: ok\ndata: first\n\nid: bad\0id\ndata: second\n\n");
        assert_eq!(frames.len(), 2);
        // Second event should still see the *previous* good ID, not "bad\0id".
        assert_eq!(frames[1].last_id, Some("ok".to_string()));
    }

    #[test]
    fn parses_retry_directive() {
        let frames = parse("retry: 5000\ndata: hi\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].retry, Some(5000));
    }

    #[test]
    fn ignores_invalid_retry() {
        // Non-numeric retry is silently ignored per spec.
        let frames = parse("retry: garbage\ndata: hi\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].retry, None);
    }

    #[test]
    fn comment_lines_skipped() {
        // Lines starting with ':' are comments (heartbeats). They should
        // NOT count as a dispatch boundary and must NOT produce a frame.
        let frames = parse(": ping\n: another\ndata: real\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, Some("real".to_string()));
    }

    #[test]
    fn empty_dispatch_boundary_skipped() {
        // A blank line with NO preceding fields is just whitespace —
        // dispatch should not emit anything.
        let frames = parse("\n\n\ndata: only\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, Some("only".to_string()));
    }

    #[test]
    fn field_without_value() {
        // `data` alone (no colon, no value) yields an empty-string data line
        // per spec.
        let frames = parse("data\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, Some("".to_string()));
    }

    #[test]
    fn unknown_field_ignored() {
        // Spec says unknown fields are silently discarded.
        let frames = parse("foo: bar\ndata: ok\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, Some("ok".to_string()));
    }

    #[test]
    fn single_leading_space_after_colon_stripped() {
        // "data: hi" and "data:hi" must both yield data == "hi".
        let frames = parse("data:hi\n\n");
        assert_eq!(frames[0].data, Some("hi".to_string()));
        let frames = parse("data: hi\n\n");
        assert_eq!(frames[0].data, Some("hi".to_string()));
        // But TWO leading spaces means the second space is part of the data.
        let frames = parse("data:  hi\n\n");
        assert_eq!(frames[0].data, Some(" hi".to_string()));
    }

    #[test]
    fn multiline_data_joined_with_lf() {
        // Per spec, multiple `data:` lines join with a literal \n.
        let frames = parse("data: a\ndata: b\ndata: c\n\n");
        assert_eq!(frames[0].data, Some("a\nb\nc".to_string()));
    }

    #[test]
    fn process_line_returns_true_only_for_blank() {
        let mut builder = EventBuilder::default();
        assert!(process_line("", &mut builder));
        assert!(!process_line("data: x", &mut builder));
        assert!(!process_line(": comment", &mut builder));
        assert!(!process_line("retry: 1000", &mut builder));
    }

    #[test]
    fn payload_deserialize_defaults() {
        // The TS layer omits verify_tls / timeout_ms for default-setting
        // requests; serde defaults must produce None for both.
        let json = r#"{"url":"https://x","headers":[],"request_id":"r1"}"#;
        let payload: SseConnectPayload = serde_json::from_str(json).expect("parse");
        assert_eq!(payload.url, "https://x");
        assert_eq!(payload.request_id, "r1");
        assert!(payload.verify_tls.is_none());
        assert!(payload.timeout_ms.is_none());
    }

    #[test]
    fn sse_event_omits_none_fields() {
        // The `serde(skip_serializing_if = "Option::is_none")` rules keep
        // the wire payload small; this test pins the contract because the
        // frontend SsePanel depends on the shape.
        let evt = SseEvent {
            request_id: "r".to_string(),
            kind: "open".to_string(),
            event: None,
            data: None,
            id: None,
            retry: None,
            error: None,
        };
        let json = serde_json::to_string(&evt).expect("serialize");
        // Should ONLY contain the two non-optional fields.
        assert!(json.contains("\"request_id\":\"r\""));
        assert!(json.contains("\"kind\":\"open\""));
        assert!(!json.contains("event"));
        assert!(!json.contains("data"));
        assert!(!json.contains("retry"));
    }

    #[test]
    fn cancellation_removes_token() {
        // close_sse_stream must remove the token from the map even when
        // called twice (second invocation is a no-op).
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(async {
            let connections = Arc::new(SseConnections::default());
            let token = CancellationToken::new();
            connections
                .map
                .lock()
                .await
                .insert("abc".to_string(), token.clone());
            close_sse_stream(connections.clone(), "abc".to_string()).await;
            assert!(token.is_cancelled());
            assert!(!connections.map.lock().await.contains_key("abc"));
            // Second close: must not panic.
            close_sse_stream(connections.clone(), "abc".to_string()).await;
        });
    }
}
