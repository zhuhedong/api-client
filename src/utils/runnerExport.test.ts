import { describe, expect, it } from "vitest";
import { exportHtml, exportJson, exportJUnit } from "./runnerExport";
import type { RunResult } from "./runnerExport";

const sampleResults: RunResult[] = [
  {
    name: "Get Users",
    method: "GET",
    status: 200,
    timeMs: 120,
    tests: [
      { name: "status is 200", passed: true },
      { name: "body has users", passed: true },
    ],
    iteration: 1,
  },
  {
    name: "Create User",
    method: "POST",
    status: 400,
    timeMs: 85,
    tests: [
      { name: "status is 201", passed: false, error: "expected status 201, got 400" },
    ],
    iteration: 1,
  },
  {
    name: "Get Users",
    method: "GET",
    status: 200,
    timeMs: 95,
    tests: [{ name: "status is 200", passed: true }],
    iteration: 2,
  },
  {
    name: "Error Request",
    method: "DELETE",
    tests: [],
    error: "Connection refused",
    iteration: 2,
  },
];

describe("exportJUnit", () => {
  it("produces valid XML with testsuites / testsuite / testcase elements", () => {
    const xml = exportJUnit(sampleResults, "My API", 2);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites name="My API"');
    expect(xml).toContain("tests=\"4\"");
    expect(xml).toContain("failures=\"1\"");
    expect(xml).toContain("<testsuite");
    expect(xml).toContain("<testcase");
  });

  it("wraps failures in <failure> elements", () => {
    const xml = exportJUnit(sampleResults, "My API", 2);
    expect(xml).toContain("<failure");
    expect(xml).toContain("expected status 201, got 400");
  });

  it("wraps request-level errors in <error> elements", () => {
    const xml = exportJUnit(sampleResults, "My API", 2);
    expect(xml).toContain("<error");
    expect(xml).toContain("Connection refused");
  });

  it("escapes XML special characters", () => {
    const results: RunResult[] = [
      {
        name: "A & B <test>",
        method: "GET",
        status: 200,
        timeMs: 10,
        tests: [{ name: 'check "value"', passed: true }],
        iteration: 1,
      },
    ];
    const xml = exportJUnit(results, "Suite & <Collection>", 1);
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&gt;");
    expect(xml).toContain("&quot;");
  });
});

describe("exportJson", () => {
  it("returns valid JSON with summary and results", () => {
    const json = exportJson(sampleResults, "My API", 2);
    const parsed = JSON.parse(json);
    expect(parsed.summary.collectionName).toBe("My API");
    expect(parsed.summary.totalTests).toBe(4);
    expect(parsed.summary.passedTests).toBe(3);
    expect(parsed.summary.failedTests).toBe(1);
    expect(parsed.summary.erroredRequests).toBe(1);
    expect(parsed.results).toHaveLength(4);
  });

  it("includes iteration count in summary", () => {
    const json = exportJson(sampleResults, "My API", 2);
    const parsed = JSON.parse(json);
    expect(parsed.summary.iterations).toBe(2);
  });
});

describe("exportHtml", () => {
  it("produces a full HTML document with the collection name", () => {
    const html = exportHtml(sampleResults, "My API", 2);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Collection Run: My API");
  });

  it("includes pass / fail stats", () => {
    const html = exportHtml(sampleResults, "My API", 2);
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
  });

  it("shows test names", () => {
    const html = exportHtml(sampleResults, "My API", 2);
    expect(html).toContain("status is 200");
    expect(html).toContain("body has users");
    expect(html).toContain("status is 201");
  });

  it("escapes HTML entities", () => {
    const results: RunResult[] = [
      {
        name: "<script>alert(1)</script>",
        method: "GET",
        status: 200,
        timeMs: 10,
        tests: [],
        iteration: 1,
      },
    ];
    const html = exportHtml(results, "Test", 1);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
