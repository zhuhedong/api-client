import { describe, expect, it } from "vitest";
import type { EnvVariable } from "../types";
import {
  applyVarMutations,
  diffVarMutations,
  hasVarMutations,
} from "./variableMutations";

describe("diffVarMutations", () => {
  it("reports an empty diff when nothing changed", () => {
    const diff = diffVarMutations({ a: "1", b: "2" }, { a: "1", b: "2" });
    expect(diff).toEqual({ changes: {}, deletions: [] });
    expect(hasVarMutations(diff)).toBe(false);
  });

  it("detects value updates", () => {
    const diff = diffVarMutations({ a: "1" }, { a: "2" });
    expect(diff.changes).toEqual({ a: "2" });
    expect(diff.deletions).toEqual([]);
  });

  it("detects newly introduced keys as changes", () => {
    const diff = diffVarMutations({}, { fresh: "v" });
    expect(diff.changes).toEqual({ fresh: "v" });
    expect(diff.deletions).toEqual([]);
  });

  it("detects deletions when a baseline key is missing from current", () => {
    const diff = diffVarMutations({ a: "1", b: "2" }, { a: "1" });
    expect(diff.changes).toEqual({});
    expect(diff.deletions).toEqual(["b"]);
  });

  it("filters deletions through ownableKeys when provided", () => {
    // baseline has 'shared' (from a lower scope) + 'own' (this layer);
    // the script removes both. Only 'own' should count as a deletion.
    const diff = diffVarMutations(
      { shared: "x", own: "y" },
      {},
      new Set(["own"]),
    );
    expect(diff.deletions).toEqual(["own"]);
  });

  it("never counts a key as deleted if it's present in current (even empty)", () => {
    const diff = diffVarMutations({ a: "1" }, { a: "" });
    expect(diff.deletions).toEqual([]);
    expect(diff.changes).toEqual({ a: "" });
  });
});

describe("applyVarMutations", () => {
  const source: EnvVariable[] = [
    { key: "a", value: "1", enabled: true, is_secret: false },
    { key: "b", value: "2", enabled: true, is_secret: true },
    { key: "c", value: "3", enabled: false, is_secret: false },
    { key: "", value: "draft", enabled: true, is_secret: false },
  ];

  it("returns a new array (no mutation)", () => {
    const out = applyVarMutations(source, { changes: {}, deletions: [] });
    expect(out).not.toBe(source);
    expect(out).toEqual(source);
  });

  it("updates value but preserves is_secret + enabled flags", () => {
    const out = applyVarMutations(source, {
      changes: { b: "new-secret" },
      deletions: [],
    });
    const updated = out.find((v) => v.key === "b");
    expect(updated?.value).toBe("new-secret");
    expect(updated?.is_secret).toBe(true);
    expect(updated?.enabled).toBe(true);
  });

  it("appends new keys as enabled, non-secret rows", () => {
    const out = applyVarMutations(source, {
      changes: { fresh: "v" },
      deletions: [],
    });
    expect(out).toHaveLength(source.length + 1);
    const added = out[out.length - 1];
    expect(added).toEqual({
      key: "fresh",
      value: "v",
      enabled: true,
      is_secret: false,
    });
  });

  it("drops deleted enabled rows but leaves disabled / empty-key drafts alone", () => {
    const sourceWithDraft: EnvVariable[] = [
      { key: "a", value: "1", enabled: true, is_secret: false },
      { key: "a", value: "draft", enabled: false, is_secret: false },
      { key: "", value: "untyped", enabled: true, is_secret: false },
    ];
    const out = applyVarMutations(sourceWithDraft, {
      changes: {},
      deletions: ["a"],
    });
    expect(out).toEqual([
      { key: "a", value: "draft", enabled: false, is_secret: false },
      { key: "", value: "untyped", enabled: true, is_secret: false },
    ]);
  });

  it("composes deletions and additions in a single pass", () => {
    const out = applyVarMutations(source, {
      changes: { a: "updated", fresh: "v" },
      deletions: ["b"],
    });
    expect(out.map((v) => v.key)).toEqual(["a", "c", "", "fresh"]);
    expect(out.find((v) => v.key === "a")?.value).toBe("updated");
  });

  it("only updates rows whose key is enabled + non-empty (skips drafts)", () => {
    const out = applyVarMutations(source, {
      changes: { c: "ignored-because-disabled" },
      deletions: [],
    });
    expect(out.find((v) => v.key === "c")?.value).toBe("3");
  });
});

describe("hasVarMutations", () => {
  it("returns false for an empty diff", () => {
    expect(hasVarMutations({ changes: {}, deletions: [] })).toBe(false);
  });

  it("returns true when there are changes", () => {
    expect(hasVarMutations({ changes: { a: "v" }, deletions: [] })).toBe(
      true,
    );
  });

  it("returns true when there are deletions", () => {
    expect(hasVarMutations({ changes: {}, deletions: ["b"] })).toBe(true);
  });
});
