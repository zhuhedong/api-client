import { describe, it, expect } from "vitest";
import { formatJson, formatXml, formatBody } from "./formatBody";

describe("formatJson", () => {
  it("re-indents compact JSON with 2 spaces", () => {
    expect(formatJson('{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => formatJson("{not json}")).toThrow();
  });
});

describe("formatXml", () => {
  it("indents nested elements", () => {
    expect(formatXml("<a><b>x</b></a>")).toBe("<a>\n  <b>x</b>\n</a>");
  });

  it("keeps self-closing tags at their depth", () => {
    expect(formatXml("<root><img/></root>")).toBe("<root>\n  <img/>\n</root>");
  });

  it("does not throw on malformed input", () => {
    expect(() => formatXml("<a><b>")).not.toThrow();
  });
});

describe("formatBody", () => {
  it("dispatches by body type", () => {
    expect(formatBody('{"a":1}', "json")).toBe('{\n  "a": 1\n}');
    expect(formatBody("<a><b/></a>", "xml")).toBe("<a>\n  <b/>\n</a>");
  });

  it("returns input unchanged for types without a formatter", () => {
    expect(formatBody("hello", "text")).toBe("hello");
  });
});
