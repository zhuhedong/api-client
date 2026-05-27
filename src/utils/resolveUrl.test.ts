import { describe, it, expect } from "vitest";
import { resolveRequestUrl } from "./resolveUrl";
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

describe("resolveRequestUrl", () => {
  it("returns the URL unchanged when there are no params or placeholders", () => {
    expect(resolveRequestUrl(makeRequest(), {})).toBe(
      "https://api.example.com/users",
    );
  });

  it("substitutes {{var}} placeholders from the env scope", () => {
    const req = makeRequest({ url: "https://{{host}}/v1/{{resource}}" });
    expect(
      resolveRequestUrl(req, { host: "api.example.com", resource: "users" }),
    ).toBe("https://api.example.com/v1/users");
  });

  it("transient vars win over env vars (mirrors pipeline behaviour)", () => {
    const req = makeRequest({ url: "https://{{host}}/" });
    expect(
      resolveRequestUrl(req, { host: "prod" }, { host: "staging" }),
    ).toBe("https://staging/");
  });

  it("appends enabled query params with proper URL encoding", () => {
    const req = makeRequest({
      params: [
        { id: "p1", key: "q", value: "hello world", enabled: true },
        { id: "p2", key: "lang", value: "en", enabled: true },
      ],
    });
    expect(resolveRequestUrl(req, {})).toBe(
      "https://api.example.com/users?q=hello%20world&lang=en",
    );
  });

  it("skips disabled or empty-keyed params", () => {
    const req = makeRequest({
      params: [
        { id: "p1", key: "keep", value: "1", enabled: true },
        { id: "p2", key: "drop", value: "x", enabled: false },
        { id: "p3", key: "", value: "y", enabled: true },
      ],
    });
    expect(resolveRequestUrl(req, {})).toBe(
      "https://api.example.com/users?keep=1",
    );
  });

  it("uses '&' separator when the URL already has a query string", () => {
    const req = makeRequest({
      url: "https://api.example.com/users?existing=1",
      params: [{ id: "p1", key: "added", value: "2", enabled: true }],
    });
    expect(resolveRequestUrl(req, {})).toBe(
      "https://api.example.com/users?existing=1&added=2",
    );
  });

  it("substitutes inside param keys and values", () => {
    const req = makeRequest({
      url: "https://{{host}}/",
      params: [{ id: "p1", key: "user", value: "{{userId}}", enabled: true }],
    });
    expect(
      resolveRequestUrl(req, { host: "api.example.com", userId: "42" }),
    ).toBe("https://api.example.com/?user=42");
  });

  it("leaves unknown {{placeholders}} intact", () => {
    const req = makeRequest({ url: "https://{{unknown}}/path" });
    expect(resolveRequestUrl(req, {})).toBe("https://{{unknown}}/path");
  });
});
