import { describe, it, expect } from "vitest";
import {
  generateId,
  createEmptyKeyValue,
  createNewRequest,
  requestToHistoryEntry,
  historyEntryToRequest,
  findRequestInCollection,
} from "./storeHelpers";
import type {
  Collection,
  CollectionRequest,
  HistoryEntry,
  RequestItem,
} from "../types";

describe("generateId", () => {
  it("returns a non-empty alphanumeric string", () => {
    const id = generateId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it("produces distinct ids across calls", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe("createEmptyKeyValue", () => {
  it("returns an enabled row with empty key/value and a fresh id", () => {
    const kv = createEmptyKeyValue();
    expect(kv).toEqual({
      id: expect.any(String),
      key: "",
      value: "",
      enabled: true,
    });
  });
});

describe("createNewRequest", () => {
  it("returns a defaults-only request with method=GET and protocol=http", () => {
    const req = createNewRequest();
    expect(req.method).toBe("GET");
    expect(req.protocol).toBe("http");
    expect(req.bodyType).toBe("none");
    expect(req.url).toBe("");
    expect(req.name).toBe("New Request");
    expect(req.headers).toHaveLength(1);
    expect(req.params).toHaveLength(1);
    expect(req.formData).toHaveLength(1);
    expect(req.createdAt).toBeGreaterThan(0);
  });

  it("gives each request a distinct id", () => {
    const a = createNewRequest();
    const b = createNewRequest();
    expect(a.id).not.toBe(b.id);
  });
});

describe("requestToHistoryEntry / historyEntryToRequest round-trip", () => {
  it("preserves the headers/params/body/method/url across a round-trip", () => {
    const req = createNewRequest();
    req.method = "POST";
    req.url = "https://example.com/users";
    req.body = '{"name":"alice"}';
    req.bodyType = "json";
    req.headers = [
      { id: "h1", key: "Content-Type", value: "application/json", enabled: true },
    ];
    req.params = [{ id: "p1", key: "page", value: "1", enabled: true }];

    const entry = requestToHistoryEntry(req);
    const restored = historyEntryToRequest(entry);

    expect(restored.method).toBe("POST");
    expect(restored.url).toBe("https://example.com/users");
    expect(restored.body).toBe('{"name":"alice"}');
    expect(restored.bodyType).toBe("json");
    expect(restored.headers).toEqual(req.headers);
    expect(restored.params).toEqual(req.params);
  });

  it("falls back to a single empty kv row when headers JSON is malformed", () => {
    const entry: HistoryEntry = {
      id: "abc",
      name: "broken",
      method: "GET",
      url: "https://x.example/",
      headers: "{not valid json",
      params: "[]",
      body: "",
      body_type: "none",
      created_at: 0,
      updated_at: 0,
    };
    const restored = historyEntryToRequest(entry);
    expect(restored.headers).toHaveLength(1);
    expect(restored.headers[0].key).toBe("");
  });

  it("backfills an empty kv row when headers is the empty array", () => {
    const entry: HistoryEntry = {
      id: "abc",
      name: "empty",
      method: "GET",
      url: "https://x.example/",
      headers: "[]",
      params: "[]",
      body: "",
      body_type: "none",
      created_at: 0,
      updated_at: 0,
    };
    const restored = historyEntryToRequest(entry);
    // Empty arrays get a single empty placeholder row so the editor UI
    // always has something to render.
    expect(restored.headers).toHaveLength(1);
    expect(restored.params).toHaveLength(1);
  });
});

describe("findRequestInCollection", () => {
  const r = (id: string, name: string): CollectionRequest => ({
    id,
    name,
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: "",
    body_type: "none",
    created_at: 0,
    updated_at: 0,
  });

  const col = (overrides: Partial<Collection>): Collection => ({
    id: "c1",
    name: "C",
    description: "",
    requests: [],
    folders: [],
    created_at: 0,
    updated_at: 0,
    ...overrides,
  });

  it("returns null for an unknown id", () => {
    expect(findRequestInCollection(col({}), "missing")).toBeNull();
  });

  it("finds requests at the collection root", () => {
    const found = findRequestInCollection(
      col({ requests: [r("req1", "root request")] }),
      "req1",
    );
    expect(found?.id).toBe("req1");
  });

  it("recurses into nested folders to find requests", () => {
    const found = findRequestInCollection(
      col({
        folders: [
          {
            id: "f1",
            name: "Folder A",
            requests: [],
            folders: [
              {
                id: "f2",
                name: "Sub-folder",
                requests: [r("nested-req", "deep one")],
                folders: [],
              },
            ],
          },
        ],
      }),
      "nested-req",
    );
    expect(found?.id).toBe("nested-req");
  });

  it("prefers a root match over a folder match", () => {
    const c = col({
      requests: [r("dup", "root")],
      folders: [
        {
          id: "f1",
          name: "f",
          requests: [r("dup", "in folder")],
          folders: [],
        },
      ],
    });
    const found = findRequestInCollection(c, "dup");
    // Implementation searches root before folders. We intentionally pin
    // that behavior so a future refactor doesn't silently flip the order
    // and start returning folder duplicates first.
    expect(found?.name).toBe("root");
  });
});

// Type-only: requestToHistoryEntry must accept a workspaceId override.
describe("requestToHistoryEntry options", () => {
  it("propagates workspace_id when supplied", () => {
    const req: RequestItem = createNewRequest();
    const entry = requestToHistoryEntry(req, null, "ws-123");
    expect(entry.workspace_id).toBe("ws-123");
  });

  it("propagates undefined workspace_id by default (top-level / no workspace)", () => {
    const req: RequestItem = createNewRequest();
    const entry = requestToHistoryEntry(req);
    expect(entry.workspace_id).toBeUndefined();
  });
});
