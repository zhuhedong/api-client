import { describe, it, expect } from "vitest";
import { buildHarLog } from "./har";
import type { RequestItem, ResponseData } from "../types";

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

function makeResponse(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    status: 200,
    status_text: "OK",
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    body_encoding: "text",
    body_truncated: false,
    time_ms: 123,
    size_bytes: 11,
    ...overrides,
  };
}

describe("buildHarLog", () => {
  it("emits HAR 1.2 envelope with creator and one entry", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse(),
      "https://api.example.com/users",
      1_700_000_000_000,
    );
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator).toEqual({ name: "api-client", version: "0.1.0" });
    expect(har.log.entries).toHaveLength(1);
  });

  it("formats startedDateTime as ISO 8601", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse(),
      "https://api.example.com/users",
      1_700_000_000_000,
    );
    expect(har.log.entries[0].startedDateTime).toBe(
      "2023-11-14T22:13:20.000Z",
    );
  });

  it("uses finalUrl as the canonical request URL and derives queryString from it", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse(),
      "https://api.example.com/users?q=hello%20world&lang=en",
      1_700_000_000_000,
    );
    const entry = har.log.entries[0];
    expect(entry.request.url).toBe(
      "https://api.example.com/users?q=hello%20world&lang=en",
    );
    expect(entry.request.queryString).toEqual([
      { name: "q", value: "hello world" },
      { name: "lang", value: "en" },
    ]);
  });

  it("returns an empty queryString when URL has no '?'", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse(),
      "https://api.example.com/users",
      1_700_000_000_000,
    );
    expect(har.log.entries[0].request.queryString).toEqual([]);
  });

  it("includes only enabled, non-empty-key headers on the request", () => {
    const req = makeRequest({
      headers: [
        { id: "h1", key: "X-Keep", value: "1", enabled: true },
        { id: "h2", key: "X-Drop", value: "2", enabled: false },
        { id: "h3", key: "", value: "3", enabled: true },
      ],
    });
    const entry = buildHarLog(
      req,
      makeResponse(),
      "https://api.example.com/users",
      0,
    ).log.entries[0];
    expect(entry.request.headers).toEqual([{ name: "X-Keep", value: "1" }]);
  });

  it("emits postData for JSON bodies", () => {
    const req = makeRequest({
      method: "POST",
      bodyType: "json",
      body: '{"k":"v"}',
    });
    const entry = buildHarLog(
      req,
      makeResponse(),
      "https://api.example.com/users",
      0,
    ).log.entries[0];
    expect(entry.request.postData).toEqual({
      mimeType: "application/json",
      text: '{"k":"v"}',
    });
  });

  it("emits postData with params for form-data bodies", () => {
    const req = makeRequest({
      method: "POST",
      bodyType: "form-data",
      formData: [
        { id: "f1", key: "user", value: "alice", enabled: true },
        { id: "f2", key: "age", value: "30", enabled: true },
        { id: "f3", key: "skip", value: "x", enabled: false },
      ],
    });
    const entry = buildHarLog(
      req,
      makeResponse(),
      "https://api.example.com/users",
      0,
    ).log.entries[0];
    expect(entry.request.postData?.mimeType).toBe("multipart/form-data");
    expect(entry.request.postData?.params).toEqual([
      { name: "user", value: "alice" },
      { name: "age", value: "30" },
    ]);
  });

  it("omits postData for bodyType=none", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse(),
      "https://api.example.com/users",
      0,
    );
    expect(har.log.entries[0].request.postData).toBeUndefined();
  });

  it("flags binary response content with base64 encoding", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse({
        body: "aGVsbG8=",
        body_encoding: "base64",
        headers: { "content-type": "image/png" },
      }),
      "https://api.example.com/users",
      0,
    );
    expect(har.log.entries[0].response.content).toEqual({
      size: 11,
      mimeType: "image/png",
      text: "aGVsbG8=",
      encoding: "base64",
    });
  });

  it("populates redirectURL from a Location header (case-insensitive)", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse({
        status: 302,
        status_text: "Found",
        headers: { Location: "https://elsewhere.example.com/" },
      }),
      "https://api.example.com/users",
      0,
    );
    expect(har.log.entries[0].response.redirectURL).toBe(
      "https://elsewhere.example.com/",
    );
  });

  it("splits timings into wait/receive when ResponseTimings is present", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse({
        time_ms: 200,
        timings: { wait_ms: 150, download_ms: 50, total_ms: 200 },
      }),
      "https://api.example.com/users",
      0,
    );
    expect(har.log.entries[0].timings).toEqual({
      send: 0,
      wait: 150,
      receive: 50,
    });
  });

  it("falls back to wait=time_ms when ResponseTimings is missing", () => {
    const har = buildHarLog(
      makeRequest(),
      makeResponse({ time_ms: 99 }),
      "https://api.example.com/users",
      0,
    );
    expect(har.log.entries[0].timings).toEqual({
      send: 0,
      wait: 99,
      receive: 0,
    });
  });
});
