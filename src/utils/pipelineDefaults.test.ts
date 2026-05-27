import { describe, expect, it } from "vitest";
import {
  pipelineDefaultsFrom,
  type PipelineDefaults,
  type PipelineDefaultsSource,
} from "./requestPipeline";

/**
 * Regression test for the bug Devin Review caught on PR #6: the
 * Collection Runner used to build the `defaults` payload by hand and
 * forgot the new B6 fields (defaultRedirectPolicy, defaultMaxRedirects,
 * defaultProxyUrl), so a user's Settings tweaks were silently ignored
 * during collection runs.
 *
 * The fix routed every caller through `pipelineDefaultsFrom`, which
 * means the only way to regress this is to drop a key from the helper
 * itself. This test pins that key set: if anyone adds a field to
 * `PipelineDefaultsSource` they must also add it to the helper, and the
 * "all expected fields propagate" assertion catches them.
 */

const source: PipelineDefaultsSource = {
  defaultTimeoutMs: 30_000,
  verifyTlsDefault: true,
  maxBodyBytes: 10 * 1024 * 1024,
  defaultRedirectPolicy: "manual",
  defaultMaxRedirects: 7,
  defaultProxyUrl: "http://proxy.example.com:8080",
};

describe("pipelineDefaultsFrom", () => {
  it("propagates every settings field the backend pipeline cares about", () => {
    const out = pipelineDefaultsFrom(source);
    const expected: PipelineDefaults = {
      defaultTimeoutMs: 30_000,
      verifyTlsDefault: true,
      maxBodyBytes: 10 * 1024 * 1024,
      defaultRedirectPolicy: "manual",
      defaultMaxRedirects: 7,
      defaultProxyUrl: "http://proxy.example.com:8080",
    };
    expect(out).toEqual(expected);
  });

  it("never drops or renames a key from the source", () => {
    // Lock the key set so a future renaming/dropping is caught here
    // rather than as a silent runtime no-op in the runner.
    const out = pipelineDefaultsFrom(source);
    expect(Object.keys(out).sort()).toEqual(
      [
        "defaultMaxRedirects",
        "defaultProxyUrl",
        "defaultRedirectPolicy",
        "defaultTimeoutMs",
        "maxBodyBytes",
        "verifyTlsDefault",
      ].sort(),
    );
  });

  it("preserves a 'follow' redirect policy and zero-length proxy", () => {
    // Empty proxy string means "no proxy" — must round-trip as-is
    // because requestPipeline.buildSendPayload only falls back to the
    // global default when the *request* doesn't set its own; an empty
    // global should propagate too.
    const out = pipelineDefaultsFrom({
      ...source,
      defaultRedirectPolicy: "follow",
      defaultMaxRedirects: 10,
      defaultProxyUrl: "",
    });
    expect(out.defaultRedirectPolicy).toBe("follow");
    expect(out.defaultMaxRedirects).toBe(10);
    expect(out.defaultProxyUrl).toBe("");
  });
});
