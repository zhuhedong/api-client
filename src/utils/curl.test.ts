import { describe, it, expect } from "vitest";
import { exportCurl, parseCurl } from "./curl";
import type { RequestItem } from "../types";

function makeRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "req-1",
    name: "test",
    method: "GET",
    url: "https://api.example.com/users",
    headers: [],
    params: [],
    body: "",
    bodyType: "none",
    formData: [],
    protocol: "http",
    createdAt: 0,
    ...overrides,
  };
}

describe("exportCurl", () => {
  it("emits a bare GET when no headers, params, or body are set", () => {
    const out = exportCurl(makeRequest());
    expect(out).toContain("curl");
    expect(out).toContain("'https://api.example.com/users'");
    expect(out).not.toContain("-X");
  });

  it("includes -X for non-GET methods", () => {
    const out = exportCurl(makeRequest({ method: "POST" }));
    expect(out).toContain("-X POST");
  });

  it("appends enabled headers via -H", () => {
    const out = exportCurl(
      makeRequest({
        headers: [
          { id: "1", key: "X-Token", value: "abc", enabled: true },
          { id: "2", key: "X-Skip", value: "ignored", enabled: false },
        ],
      }),
    );
    expect(out).toContain("-H 'X-Token: abc'");
    expect(out).not.toContain("X-Skip");
  });

  it("attaches body via -d for non-form requests", () => {
    const out = exportCurl(
      makeRequest({
        method: "POST",
        bodyType: "json",
        body: '{"hello":"world"}',
      }),
    );
    expect(out).toContain(`-d '{"hello":"world"}'`);
  });

  it("appends enabled params to the URL", () => {
    const out = exportCurl(
      makeRequest({
        params: [
          { id: "1", key: "q", value: "search term", enabled: true },
          { id: "2", key: "skip", value: "1", enabled: false },
        ],
      }),
    );
    expect(out).toMatch(/q=search%20term/);
    expect(out).not.toMatch(/skip=/);
  });

  it("leaves {{var}} placeholders intact when no envVars are passed", () => {
    const out = exportCurl(
      makeRequest({ url: "https://{{host}}/users" }),
    );
    expect(out).toContain("'https://{{host}}/users'");
  });

  it("substitutes {{var}} placeholders in the URL when envVars are passed", () => {
    const out = exportCurl(
      makeRequest({ url: "https://{{host}}/users" }),
      { host: "api.example.com" },
    );
    expect(out).toContain("'https://api.example.com/users'");
    expect(out).not.toContain("{{host}}");
  });

  it("substitutes {{var}} placeholders in headers", () => {
    const out = exportCurl(
      makeRequest({
        headers: [
          { id: "1", key: "X-Trace", value: "{{traceId}}", enabled: true },
        ],
      }),
      { traceId: "abc123" },
    );
    expect(out).toContain("'X-Trace: abc123'");
  });

  it("substitutes {{var}} placeholders in body and params", () => {
    const out = exportCurl(
      makeRequest({
        method: "POST",
        url: "https://api.example.com/u/{{id}}",
        bodyType: "json",
        body: '{"name":"{{name}}"}',
        params: [{ id: "1", key: "ref", value: "{{ref}}", enabled: true }],
      }),
      { id: "42", name: "Ada", ref: "src" },
    );
    expect(out).toContain("'https://api.example.com/u/42?ref=src'");
    expect(out).toContain(`'{"name":"Ada"}'`);
    expect(out).not.toContain("{{");
  });

  it("substitutes {{var}} placeholders in auth values", () => {
    const out = exportCurl(
      makeRequest({
        auth: { auth_type: "bearer", bearer_token: "{{token}}" },
      }),
      { token: "secret-jwt" },
    );
    expect(out).toContain("'Authorization: Bearer secret-jwt'");
  });

  it("leaves unknown placeholders as-is so the user can spot what's missing", () => {
    const out = exportCurl(
      makeRequest({ url: "https://{{host}}/u/{{id}}" }),
      { host: "api.example.com" },
    );
    expect(out).toContain("https://api.example.com/u/{{id}}");
  });
});

describe("parseCurl", () => {
  it("parses method + URL out of a simple GET", () => {
    const parsed = parseCurl("curl https://api.example.com/users");
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://api.example.com/users");
  });

  it("respects an explicit -X override", () => {
    const parsed = parseCurl(
      "curl -X POST 'https://api.example.com/users' -d '{}'",
    );
    expect(parsed.method).toBe("POST");
    expect(parsed.body).toBe("{}");
  });

  it("extracts -H headers into the headers array", () => {
    const parsed = parseCurl(
      `curl 'https://x' -H 'Authorization: Bearer abc' -H 'X-Trace: 1'`,
    );
    expect(parsed.headers?.some(
      (h) => h.key === "Authorization" && h.value === "Bearer abc",
    )).toBe(true);
    expect(parsed.headers?.some(
      (h) => h.key === "X-Trace" && h.value === "1",
    )).toBe(true);
  });

  it("survives multi-line continuation backslashes", () => {
    const parsed = parseCurl(
      `curl 'https://api.example.com/' \\\n  -H 'A: 1' \\\n  -H 'B: 2'`,
    );
    expect(parsed.url).toBe("https://api.example.com/");
    expect(parsed.headers?.length).toBeGreaterThanOrEqual(2);
  });
});
