import { describe, expect, it } from "vitest";
import { toRequestError, makeRequestError, errorKindI18nKey } from "./requestError";
import type { RequestError } from "../types";

describe("toRequestError", () => {
  it("passes structured RequestError through unchanged", () => {
    const input: RequestError = {
      kind: "timeout",
      code: "TIMEOUT",
      message: "Request timed out after 30000ms",
      retryable: true,
    };
    expect(toRequestError(input)).toBe(input);
  });

  it("wraps a string into an unknown-kind error", () => {
    const out = toRequestError("Network is unreachable");
    expect(out.kind).toBe("unknown");
    expect(out.code).toBe("UNKNOWN");
    expect(out.message).toBe("Network is unreachable");
    expect(out.retryable).toBe(true);
  });

  it("wraps an Error instance preserving the message", () => {
    const out = toRequestError(new Error("Worker spawn failed"));
    expect(out.kind).toBe("unknown");
    expect(out.message).toBe("Worker spawn failed");
  });

  it("falls back to a default message for empty strings", () => {
    const out = toRequestError("");
    expect(out.message).toBe("Request failed");
  });

  it("rejects objects that look like RequestError but have an unknown kind", () => {
    // A bogus payload — `kind: "garbage"` is not in the union — should be
    // treated as an opaque value, not silently trusted.
    const bogus = {
      kind: "garbage",
      code: "X",
      message: "boom",
      retryable: true,
    };
    const out = toRequestError(bogus);
    expect(out.kind).toBe("unknown");
    expect(out.message).toBe(String(bogus));
  });

  it("normalizes null / undefined into a generic failure", () => {
    expect(toRequestError(null).message).toBe("Request failed");
    expect(toRequestError(undefined).message).toBe("Request failed");
  });
});

describe("makeRequestError", () => {
  it("defaults retryable=false for input errors", () => {
    const err = makeRequestError("input", "INVALID_URL", "scheme missing");
    expect(err.retryable).toBe(false);
  });

  it("defaults retryable=false for cancelled errors", () => {
    const err = makeRequestError("cancelled", "CANCELLED", "User cancelled");
    expect(err.retryable).toBe(false);
  });

  it("defaults retryable=true for network errors", () => {
    expect(makeRequestError("timeout", "TIMEOUT", "x").retryable).toBe(true);
    expect(makeRequestError("dns", "DNS_FAILED", "x").retryable).toBe(true);
    expect(makeRequestError("connection", "ECONNREFUSED", "x").retryable).toBe(
      true,
    );
  });

  it("honors explicit retryable override", () => {
    const err = makeRequestError("input", "X", "y", true);
    expect(err.retryable).toBe(true);
  });
});

describe("errorKindI18nKey", () => {
  it("returns a stable key per kind", () => {
    expect(errorKindI18nKey("timeout")).toBe("errors.kind.timeout");
    expect(errorKindI18nKey("input")).toBe("errors.kind.input");
    expect(errorKindI18nKey("unknown")).toBe("errors.kind.unknown");
  });
});
