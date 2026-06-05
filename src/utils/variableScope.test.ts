import { describe, it, expect } from "vitest";
import { buildScopedVarsWithSource } from "./variableScope";
import type { Collection, Environment, RequestItem, Workspace } from "../types";

function ev(key: string, value: string) {
  return { key, value, enabled: true, is_secret: false };
}

describe("buildScopedVarsWithSource", () => {
  it("attributes each variable to its highest-priority source", () => {
    const request = { id: "r1", collectionId: "c1" } as RequestItem;
    const workspace = {
      variables: [ev("g", "global"), ev("shared", "fromGlobal")],
      active_environment_id: "e1",
    } as unknown as Workspace;
    const collection = {
      id: "c1",
      name: "My API",
      variables: [ev("c", "col"), ev("shared", "fromCol")],
      folders: [
        {
          id: "f1",
          name: "Folder",
          variables: [ev("shared", "fromFolder")],
          requests: [{ id: "r1" }],
          folders: [],
        },
      ],
    } as unknown as Collection;
    const env = {
      id: "e1",
      name: "Prod",
      variables: [ev("e", "envv"), ev("shared", "fromEnv")],
    } as unknown as Environment;

    const result = buildScopedVarsWithSource({
      workspace,
      collections: [collection],
      environments: [env],
      request,
    });
    const byKey = Object.fromEntries(result.map((r) => [r.key, r]));

    expect(byKey.g).toMatchObject({ value: "global", source: "global" });
    expect(byKey.c).toMatchObject({
      value: "col",
      source: "collection",
      origin: "My API",
    });
    expect(byKey.e).toMatchObject({
      value: "envv",
      source: "environment",
      origin: "Prod",
    });
    // Environment wins the shared key over folder / collection / global.
    expect(byKey.shared).toMatchObject({ value: "fromEnv", source: "environment" });
  });

  it("falls back to the folder source when the environment doesn't define a key", () => {
    const request = { id: "r1", collectionId: "c1" } as RequestItem;
    const workspace = {
      variables: [],
      active_environment_id: undefined,
    } as unknown as Workspace;
    const collection = {
      id: "c1",
      name: "C",
      variables: [],
      folders: [
        {
          id: "f1",
          name: "F",
          variables: [ev("x", "fromFolder")],
          requests: [{ id: "r1" }],
          folders: [],
        },
      ],
    } as unknown as Collection;
    const result = buildScopedVarsWithSource({
      workspace,
      collections: [collection],
      environments: [],
      request,
    });
    expect(result.find((r) => r.key === "x")).toMatchObject({
      source: "folder",
      origin: "F",
    });
  });
});
