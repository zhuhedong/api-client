# Architecture

This document describes how API Client is laid out, how data flows from
the UI to the network and back, and where the various subsystems live. It
is intended for contributors who want to find their way around the code,
not as user-facing documentation.

The high-level summary: a Tauri 2 application with a **React 18 + TypeScript
frontend** and a **Rust backend**. The frontend never speaks HTTP directly —
every network call (HTTP, WebSocket, SSE, OAuth2 token, mock-server admin)
is dispatched as a `#[tauri::command]` to the Rust process, which owns the
real connection.

---

## Process model

```
┌──────────────────────────────────────────────────────────────────┐
│  Tauri 2 binary                                                  │
│                                                                  │
│  ┌──────────────────────┐    invoke()     ┌────────────────────┐ │
│  │  WebView (React 18)  │ ─────────────▶  │  Rust process      │ │
│  │                      │ ◀───────────── │  (Tokio + reqwest) │ │
│  │  Zustand store       │    events       │                    │ │
│  └──────────────────────┘                 └────────────────────┘ │
│       │   ▲                                       │   ▲          │
│       │   │                                       │   │          │
│       ▼   │                                       ▼   │          │
│  ┌──────────────┐                          ┌────────────────────┐│
│  │  Web Worker  │  (script sandbox)        │  OS resources       ││
│  │  scriptWorker│                          │  - filesystem       ││
│  │              │                          │  - keychain         ││
│  └──────────────┘                          │  - SQLite (history) ││
│                                            │  - network          ││
│                                            └────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

- The **WebView** runs the React bundle. It is not allowed to perform
  network I/O directly — capabilities in `tauri.conf.json` constrain this.
- The **Rust process** owns all I/O. Each Tauri command runs on a Tokio
  task; long-lived streams (WebSocket, SSE, mock server) keep a handle
  alive in a global `Connections` map keyed by request id.
- **Pre-request / test scripts** run in a dedicated **Web Worker** with no
  DOM or Tauri APIs. Communication is one message in, one message out
  (`{ kind, source, context }` → `{ ok, environment, variables, tests,
  logs }`). The worker is killed after a deadline if a user script spins.

---

## Frontend layout (`src/`)

| Path | Responsibility |
|------|----------------|
| `App.tsx` | Top-level shell — global shortcut handler, modal portals, route between the request panel and modals (Settings, Search palette, …) |
| `components/Sidebar.tsx` | Collections / History / Environments / Cookies / Recent / Workspace switcher panes |
| `components/CollectionTree.tsx` | Recursive folder + request tree with drag-and-drop |
| `components/RequestPanel.tsx` | Method + URL + tabs for params/headers/body/auth/scripts/tests |
| `components/ResponsePanel.tsx` | Status/timing breakdown, JSON tree / raw / search, image & PDF preview, hex dump fallback |
| `components/AuthEditor.tsx` | Per-request auth (bearer, basic, api_key, oauth2, sigv4); folder-level overrides via "inherit" |
| `components/MockServerPanel.tsx` | UI for the embedded mock HTTP server (per workspace) |
| `components/CollectionRunnerModal.tsx` | Run a whole collection (or filtered subset) with optional data-driven iteration |
| `components/Codegen* / SearchPalette / ResponseDiff / VariablesEditor / VariableScopeModal …` | The remaining modals; each owns its own state |
| `store/useRequestStore.ts` | Single Zustand store. Holds tabs, responses, errors, loadings, collections, environments, cookies, workspace, settings, OAuth2 token cache. Tab + workspace metadata is persisted through Tauri commands (`update_workspace`) on every meaningful edit |
| `utils/requestPipeline.ts` | Builds the JSON payload sent to `send_request` — merges auth, environment vars, dynamic vars, computes effective TLS / proxy / redirect settings |
| `utils/scriptWorker.ts` | Sandbox Worker — implements the `pm.*` surface (environment, variables, response, test, expect, …) |
| `utils/scriptRunner.ts` | Host side of the sandbox — spawns the worker, applies the timeout, splices back environment changes and test results |
| `utils/{openapi,postman,insomnia,har,curl,codegen,sigv4,oauth2Refresh,jsonPath,dynamicVars,kvBulk,…}.ts` | Pure helpers for import/export, code generation, signing, OAuth2 refresh, variable resolution, key/value parsing, etc. |
| `utils/useDarkMode.ts` | Hook + observer pattern for theme state |
| `i18n/locales/{en,zh}.json` | UI translations |

---

## Backend layout (`src-tauri/src/`)

| File | Responsibility |
|------|----------------|
| `lib.rs` | The big one — exposes `send_request`, WebSocket open/close, mTLS handling, cookie jar wiring, redirect/proxy policy, request cancellation. |
| `commands.rs` | Thin `#[tauri::command]` wrappers around `storage` / `db` / `secrets` / `oauth2` (e.g. `add_recent`, `get_history`, `save_response_to_file`, …) |
| `storage.rs` | On-disk persistence of workspaces (collections, environments, cookies, window state, settings). Plain JSON files in the app data dir, written atomically. |
| `db.rs` | SQLite (via `rusqlite`). Owns `history`, `recent_opened` and schema migrations (`ensure_column` pattern). |
| `sse.rs` | Server-Sent Events parser — WHATWG-compliant `event:` / `data:` / `id:` / `retry:` handling, CRLF / LF tolerance, deferred-buffer flush on EOF. |
| `oauth2.rs` | Token acquisition for `client_credentials`, `password`, `authorization_code` (with PKCE + 127.0.0.1 redirect listener), and `refresh_token`. |
| `mock_server.rs` | Per-workspace embedded HTTP server with method + path matching (incl. `:param` and `*`), latency injection, weighted route variants. |
| `secrets.rs` | OS-keychain wrappers (`keyring` crate). Bearer/OAuth2 client secrets are stored here, never in collection JSON. |
| `main.rs` | Tauri bootstrap. |

### Concurrency model

- Each `#[tauri::command]` is a Tokio task. The host (`lib.rs`) owns a
  `Connections` map (mutex-guarded `HashMap<RequestId, Handle>`) for
  in-flight WS / SSE streams so `cancel_request` can hang up cleanly.
- HTTP requests use `reqwest::Client` instances configured per-request
  (TLS verification, proxy, redirect policy, cookie store, optional mTLS
  identity). A new client is built when these settings differ from the
  default — the default client is cached.
- The cookie jar is a single in-process `reqwest::cookie::Jar`; it is
  serialized back to the workspace file at the end of each request that
  touched it.

---

## State flow — sending a request

```
User clicks "Send"
        │
        ▼
RequestPanel ──▶ useRequestStore.sendRequest(tabId)
        │
        ▼
requestPipeline.ts
   - resolve {{vars}} against env hierarchy
   - run pre-request script in scriptWorker
   - merge auth (oauth2: refresh if expired)
   - build SendRequestPayload
        │
        ▼
invoke("send_request", payload)
        │
        ▼ (Tokio task in Rust)
lib.rs::send_request
   - build/reuse reqwest::Client matching TLS/proxy/redirect/mTLS
   - issue request; respect max_body_bytes; cookie jar updates
   - capture timing breakdown (DNS / connect / TLS / TTFB / total)
        │
        ▼
Response struct returned through IPC
        │
        ▼
useRequestStore
   - cache response
   - run test script in scriptWorker
   - persist history entry (with snapshot up to max_history_body_bytes)
   - record into recent_opened
        │
        ▼
ResponsePanel re-renders
```

Cancellation: the store calls `invoke("cancel_request", { id })`, which
removes the entry from the in-flight map and drops the `reqwest`
future — the Tokio task observes the drop and unwinds.

---

## Storage layout on disk

```
<app data dir>/
├─ workspaces/
│  └─ <workspace-id>.json     # collections, environments, cookies, settings, window_state
├─ history.db                 # SQLite — history + recent_opened
├─ responses/                 # full bodies saved via Save Response
└─ certs/                     # imported mTLS identities (referenced by path)
```

OS keychain stores OAuth2 / Bearer secrets keyed by
`com.apiclient.dev :: <workspace-id> :: <kind>`.

---

## CI architecture

Three jobs in `.github/workflows/ci.yml`:

- `frontend` — Node 20, `typecheck` / `lint` (max-warnings 0) / `vitest` /
  `vite build`
- `backend` — Rust stable, `cargo check --locked` / `cargo clippy --
  no-deps -D warnings` / `cargo test --lib --locked`
- `e2e` — Playwright runs Chromium against the Vite dev server with a
  mocked `__TAURI_INTERNALS__.invoke` (`src/utils/e2eMockTauri.ts`). This
  exercises the React layer end-to-end without spinning up the Tauri
  binary itself; the Rust side is covered by `cargo test --lib`.
- `security` — `cargo audit --deny warnings` and `npm audit --omit=dev
  --audit-level=high`. Uses `continue-on-error: true` so a newly disclosed
  transitive CVE doesn't block unrelated PRs.

Release builds live in `release.yml` and produce native macOS Apple
Silicon, cross-compiled macOS Intel, Linux x86_64, and Windows x86_64
artifacts.

---

## Known gaps

These are documented elsewhere (review item references in parentheses)
and worth knowing about when adding new code:

- Streaming download to disk is not implemented; very large responses
  still flow through memory (A4).
- E2E does not yet drive the real Tauri shell — only the React layer with
  a mock IPC (C2).
- `tauri.conf.json` sets `security.csp: null`; tightening it is a
  near-term TODO (C8).
- `useRequestStore.ts` is a single ~1.9k-line file and a planned split
  (C6) will move tabs / persistence / network slices into their own
  modules.
- No code signing / auto-updater yet (C4, C5).
