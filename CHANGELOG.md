# Changelog

All notable user-facing changes to **API Client** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The repository has not yet cut a numbered release. The first tagged version
> will be **v0.1.0** and this file will move the items under "Unreleased" to a
> dated `## [0.1.0]` heading at that point.

---

## [Unreleased]

### Added

- **OAuth2 — authorization_code + PKCE + automatic refresh_token.** The
  built-in OAuth2 helper now drives the full interactive flow (system browser,
  one-shot 127.0.0.1 redirect listener, PKCE per RFC 7636) and the request
  pipeline auto-refreshes expired access tokens before sending.
- **History — full response snapshots.** Each history entry persists status,
  headers, body, encoding and a truncation flag, so reopening an old call
  shows the original response without re-sending. The body cap is configurable
  in Settings (`max_history_body_bytes`, KiB).
- **Sidebar — Recent Opened.** The sidebar tracks recently opened requests
  and history entries; older entries fall off after 30.
- **Sidebar — nested folder UI.** Collections can now contain folders;
  folders support CRUD, drag-and-drop reorder, and per-folder auth/variable
  overrides. Nested-folder requests can also be renamed/deleted.
- **Tabs — full persistence.** Open tabs, active tab id and tab order are
  restored on relaunch. State is snapshotted on every meaningful edit, not
  just on quit.
- **Keyboard shortcuts.** `⌘/Ctrl+D` (duplicate tab), `⌘/Ctrl+[` and
  `⌘/Ctrl+]` (cycle tabs), `⌘/Ctrl+F` (find in response),
  `⌘/Ctrl+,` (open Settings).
- **Dark mode — single source.** `useDarkMode` is now the sole driver of
  theme state across the tree (previously Sidebar maintained a parallel
  copy).
- **i18n.** Nine more components are now localized (English / 简体中文),
  including Run Collection, Mock server, Diff, Search palette, WebSocket,
  SSE, Auth editor, TabBar, and the Codegen modal.
- **Confirm/alert dialogs unified.** Native `window.confirm` / `window.alert`
  calls were replaced by the in-app `ConfirmDialog` so dark-mode styling and
  i18n apply consistently.
- **Response panel — image and PDF preview.** Binary responses with
  `image/*` MIME render inline and `application/pdf` opens in an iframe.
- **Settings — body caps.** `max_body_bytes` (MiB) controls the per-request
  in-memory cap; `max_history_body_bytes` (KiB) controls per-history
  truncation.
- **Release packaging.** CI now ships a native macOS Apple Silicon build and
  cross-compiles a macOS Intel build on Apple Silicon runners.
- **CI — security audit + Dependabot.** Weekly Dependabot updates for npm,
  cargo and github-actions plus a `security` job that runs `cargo audit` and
  `npm audit --omit=dev --audit-level=high` on every PR.

### Fixed

- Tab list survives closing the last tab and persists on every keystroke.
- KeyValue parser anchors on `": "` first so URLs containing `:` survive
  bulk-edit round trips, and `=`-separated rows (`KEY=value`) no longer
  corrupt their keys.
- History schema migration includes `workspace_id` and the index is created
  after the column exists.

### Documentation

- README rewritten with hero shot, screenshots, architecture diagrams, and
  a 简体中文 mirror (`README.zh-CN.md`).
- Added `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
  `docs/architecture.md`.

---

## Earlier work (pre-changelog)

Before this file existed the project went through five development phases
(P1 → P4) summarized below. Full commit history is available via
`git log --no-merges` on `main`.

- **P4** — ESLint + Vitest + GitHub Actions CI + Release workflow;
  Playwright E2E smoke suite against a mocked Tauri IPC layer.
- **P3** — i18n foundation (en / zh), CodeMirror editor for body/scripts/
  GraphQL/mock routes, persistent layout, JSONPath filter, variable preview,
  timing breakdown.
- **P2** — AWS SigV4 request signing, embedded mock HTTP server,
  multi-workspace partitioning, OAuth2 client_credentials + password,
  variable hierarchy (global / collection / folder / env), dynamic
  variables, global search, JSON tree viewer, request tags.
- **P1** — Server-Sent Events (SSE) protocol support with chunked parser
  fixes.
- **P0** — initial Tauri 2 + React 18 + Rust skeleton: HTTP, WebSocket,
  GraphQL, scripting sandbox, cookie jar, collections, environments,
  history.

[Unreleased]: https://github.com/onlyCodeMaster/api-client/compare/main...HEAD
