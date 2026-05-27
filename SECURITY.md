# Security Policy

## Supported versions

API Client is in early development and has not yet cut a numbered release.
Security fixes will be applied to the `main` branch and shipped in the
next packaged build. Once `v0.1.0` is tagged, this policy will list the
versions that receive security backports.

| Version | Supported          |
|---------|--------------------|
| `main`  | :white_check_mark: |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub
issues, discussions, or pull requests.** Public reports give an attacker a
window before a fix can be released.

Instead, report the issue privately:

1. **Preferred:** open a [GitHub Security Advisory](https://github.com/onlyCodeMaster/api-client/security/advisories/new)
   on this repository — this creates a private channel between you and
   the maintainers and is the fastest route.
2. **Alternative:** email **henryzhu6266@gmail.com** with the subject
   line `[security] api-client: <short title>`.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce — minimal repro, including OS and app version
- Any proof-of-concept code or sample requests (with secrets redacted)
- Whether you intend to publish a write-up, and on what timeline

We'll acknowledge receipt within **5 business days** and aim to provide a
status update (fix in progress / mitigation / declined with rationale)
within **10 business days**. For high-severity issues we will coordinate a
disclosure timeline with you; a 90-day window from initial report to
public disclosure is the default.

## Scope

In scope:

- Code in this repository (`src/`, `src-tauri/`, `e2e/`, build/CI configs)
- Bundled packages shipped by the project's GitHub Releases
- The Tauri runtime configuration (`tauri.conf.json`) and capability
  manifests

Out of scope:

- Vulnerabilities in third-party services the app talks to (report those
  upstream)
- Self-XSS / "victim runs malicious code in the devtools" reports
- Issues that require the user to import a maliciously crafted
  Postman/OpenAPI/Insomnia file — these are accepted reports but treated
  as feature-hardening rather than emergencies, since collections are
  user-supplied content

## Hardening notes

A few things to be aware of when assessing impact:

- **Local-first storage.** Collections, environments and history live on
  the user's disk as JSON/SQLite. Plaintext secrets are kept out of these
  files; OAuth2 client secrets / Bearer tokens stored via the `secrets`
  module use the OS keychain (Keychain on macOS, libsecret on Linux,
  Credential Manager on Windows).
- **Request engine.** Network I/O runs in the Rust process via `reqwest`;
  the frontend never speaks to the network directly. TLS verification is
  on by default; users can disable it per-request or globally in Settings
  — this is intentional for local-dev use against self-signed certs.
- **Script sandbox.** Pre-request and test scripts run in a dedicated Web
  Worker without DOM or Tauri APIs. The host kills the worker after a
  timeout. The sandbox is `pm.*`-compatible but is *not* a security
  boundary against scripts the user wrote themselves — only against
  scripts received from imported collections.
- **CSP.** The current `tauri.conf.json` sets `security.csp: null`; this
  is a known gap and is tracked separately. Tightening the CSP is on the
  near-term roadmap.

## Credits

Reporters who follow this policy will be credited (with permission) in
the security advisory and the project's `CHANGELOG.md`. We do not
currently offer a paid bug bounty.
