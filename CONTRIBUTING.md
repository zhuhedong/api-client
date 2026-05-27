# Contributing to API Client

Thanks for your interest! This document captures the conventions and
workflow that make a contribution likely to land smoothly. It is **not** a
gate — small drive-by fixes are welcome without reading the whole thing.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Repository layout](#repository-layout)
- [Development setup](#development-setup)
- [Running checks locally](#running-checks-locally)
- [Coding conventions](#coding-conventions)
- [Branching, commits, and pull requests](#branching-commits-and-pull-requests)
- [Reporting bugs](#reporting-bugs)
- [Security issues](#security-issues)

---

## Code of conduct

This project follows the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/).
Be respectful, assume good intent, and keep technical disagreements
technical. Maintainers reserve the right to close threads that drift into
personal attacks or off-topic noise.

## Repository layout

```
src/                React frontend (TypeScript)
├─ components/       UI components — one file per panel/modal
├─ store/            Zustand store (single source of truth for app state)
├─ utils/            Pure-ish helpers: HTTP pipeline, codegen, KV parser,
│                    OpenAPI/Postman/Insomnia importers, dynamic vars …
├─ i18n/locales/     UI translations (en, zh)
└─ types/            Shared TypeScript types matching the Rust backend

src-tauri/src/       Rust backend (Tokio + reqwest + tauri 2)
├─ lib.rs            send_request, mTLS, redirect/proxy/cookie handling
├─ commands.rs       #[tauri::command] entrypoints
├─ storage.rs        Workspace persistence (collections / envs / cookies)
├─ db.rs             SQLite schema + history + recent_opened
├─ sse.rs            Server-Sent Events parser
├─ oauth2.rs         OAuth2 token acquisition (cc / password / code+PKCE / refresh)
├─ mock_server.rs    Per-workspace embedded mock HTTP server
└─ secrets.rs        OS keychain integration

e2e/                 Playwright tests (against React UI with mocked Tauri IPC)
docs/                Architecture notes + screenshots
```

A more detailed architecture overview is in [`docs/architecture.md`](./docs/architecture.md).

## Development setup

Prerequisites — install the toolchains your platform requires:

- **Node** 20 LTS (the CI matrix pins to 20)
- **Rust** stable (`rustup` is fine; the workflow uses
  `dtolnay/rust-toolchain@stable`)
- **Tauri 2 system deps** — see the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) page for
  your OS. On Ubuntu, the runner installs:

  ```sh
  sudo apt-get install -y pkg-config libglib2.0-dev libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
  ```

First-time setup:

```sh
npm ci                  # install JS deps
cd src-tauri && cargo fetch && cd ..   # warm the cargo cache (optional)
npm run tauri dev        # launches Vite + Rust dev binary
```

`npm run dev` alone runs the Vite dev server in the browser, which is fine
for purely visual work but cannot exercise any Tauri commands.

## Running checks locally

Before opening a PR, run:

```sh
npm run typecheck                       # tsc --noEmit
npm run lint                            # eslint --max-warnings 0
npm test                                # tsc --noEmit + vitest run
npm run build                           # tsc + vite build
npm run test:e2e                        # Playwright (browser, mocked IPC)

(cd src-tauri && cargo check --locked)
(cd src-tauri && cargo clippy --no-deps -- -D warnings)
(cd src-tauri && cargo test --lib --locked)
```

`cargo audit` (and `npm audit --omit=dev --audit-level=high`) runs in CI
under the `security` job. They use `continue-on-error: true` so a freshly
disclosed CVE on a transitive dep doesn't block unrelated PRs — but please
do glance at the warnings.

## Coding conventions

### TypeScript / React

- **No `any`, no `as unknown as`.** If you need to escape the type system,
  add a typed adapter instead.
- **Imports at the top.** Don't import from inside functions.
- **Follow neighbouring files.** Match the existing import order
  (third-party → relative), prop typing (named interfaces, not inline), and
  styling (Tailwind via the project's `apple-*` token set).
- **i18n.** Any new user-facing string must be added to **both**
  `src/i18n/locales/en.json` and `src/i18n/locales/zh.json`. Components
  consume strings via `const { t } = useTranslation()`.
- **Comments** describe *the code*, not the diff. Don't write "now we also
  do X" — write the rationale inline only when the next reader would be
  puzzled otherwise.

### Rust

- `#[forbid(unsafe_code)]` is the default mode; if you genuinely need
  `unsafe`, justify it in the PR.
- Errors surface to the frontend through two patterns:
  - **`Result<T, String>`** — used by most `#[tauri::command]`s. Keep
    messages short and human-readable. Suitable for CRUD-style commands
    where the frontend just needs to display the message.
  - **`Result<T, request_error::RequestError>`** — used by
    request-execution commands (currently `send_request`). The error is
    a structured `{ kind, code, message, retryable }` payload that lets
    the frontend pattern-match against stable categories
    (`Cancelled` / `Timeout` / `Dns` / `Connection` / `Tls` / `Proxy` /
    `ClientCertificate` / `Input` / `Redirect` / `Body` / `Unknown`),
    render a localized category title, and decide whether to show a
    "Retry" button. Prefer this for any new command that performs
    network I/O — see `src-tauri/src/request_error.rs` for the helpers
    (`RequestError::input(...)`, `from_reqwest(...)`, etc.) and the
    `classify_reqwest()` source-chain walker.
- New commands go through the existing serde structs in `lib.rs` /
  `commands.rs` rather than ad-hoc maps.
- Run `cargo clippy --no-deps -- -D warnings` locally; CI enforces it.

### Commit messages

Conventional Commits style is the local norm — e.g. `feat(oauth2): …`,
`fix(kv): …`, `chore(deps): …`, `docs(readme): …`, `ci(release): …`.
Keep the summary line under ~72 characters; expand in the body. Reference
issues with `Refs #123` / `Closes #123` when applicable.

## Branching, commits, and pull requests

- Branch off `main`. Name branches with a short slug, e.g.
  `feat/openapi-export` or `fix/sse-crlf`.
- Open PRs against `main`. The repository's PR template will be applied
  automatically — please fill it out, especially the human review/testing
  checklist.
- Keep PRs **small and focused**. A 200-line PR is much easier to land than
  a 2000-line one.
- CI must be green before merge. If a check is flaky, say so in the PR
  rather than re-running silently.
- **Don't force-push to `main`.** Force-push on your own feature branch is
  fine (e.g. after rebase / squash).

## Reporting bugs

Open a GitHub issue with:

1. What you expected to happen
2. What actually happened (paste error text or screenshot)
3. Reproduction steps — including OS, app version, and the request
   minus any secrets
4. If the failure is in the request engine, the response status / headers
   it produced

For UI bugs a short screen recording is hugely helpful.

## Security issues

Please **do not** open a public issue for security vulnerabilities. See
[`SECURITY.md`](./SECURITY.md) for the disclosure process.
