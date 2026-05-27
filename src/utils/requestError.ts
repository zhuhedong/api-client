import type { RequestError, RequestErrorKind } from "../types";

const KNOWN_KINDS: ReadonlySet<RequestErrorKind> = new Set<RequestErrorKind>([
  "cancelled",
  "timeout",
  "dns",
  "connection",
  "tls",
  "proxy",
  "client_certificate",
  "input",
  "redirect",
  "body",
  "unknown",
]);

function isRequestErrorShape(v: unknown): v is RequestError {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<RequestError>;
  return (
    typeof o.kind === "string" &&
    KNOWN_KINDS.has(o.kind as RequestErrorKind) &&
    typeof o.code === "string" &&
    typeof o.message === "string" &&
    typeof o.retryable === "boolean"
  );
}

/**
 * Normalize any value caught at a request boundary into a {@link RequestError}.
 *
 * Tauri can reject `invoke()` with either:
 * - A structured `RequestError` (preferred — what the new Rust code returns)
 * - A plain string (legacy / frontend-only failures)
 * - An `Error` instance (worker spawn failures, JS exceptions)
 *
 * Frontend code shouldn't have to care which one it got, so this helper
 * collapses everything into the `RequestError` shape. Unknown shapes fall
 * back to `kind: "unknown"` with the original message preserved.
 */
export function toRequestError(value: unknown): RequestError {
  if (isRequestErrorShape(value)) {
    // Already structured — pass through unchanged.
    return value;
  }
  if (value instanceof Error) {
    return {
      kind: "unknown",
      code: "UNKNOWN",
      message: value.message || "Request failed",
      retryable: true,
    };
  }
  if (typeof value === "string") {
    return {
      kind: "unknown",
      code: "UNKNOWN",
      message: value || "Request failed",
      retryable: true,
    };
  }
  return {
    kind: "unknown",
    code: "UNKNOWN",
    message: String(value ?? "Request failed"),
    retryable: true,
  };
}

/** Build a frontend-only structured error (e.g. for cancelled requests). */
export function makeRequestError(
  kind: RequestErrorKind,
  code: string,
  message: string,
  retryable?: boolean,
): RequestError {
  // Input/cancelled are never retryable; everything else defaults to true
  // unless the caller overrides.
  const isRetryable =
    retryable ?? !(kind === "input" || kind === "cancelled");
  return { kind, code, message, retryable: isRetryable };
}

/**
 * Map an `ErrorKind` to a translation key for the human-readable title.
 * The frontend uses these to render localized headings above the error
 * message body.
 */
export function errorKindI18nKey(kind: RequestErrorKind): string {
  return `errors.kind.${kind}`;
}
