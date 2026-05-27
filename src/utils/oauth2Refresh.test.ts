import { describe, it, expect, vi } from "vitest";
import {
  REFRESH_SKEW_MS,
  applyRefreshResult,
  buildRefreshRequest,
  refreshOAuth2Token,
  shouldRefreshOAuth2,
  updateFolderAuth,
} from "./oauth2Refresh";
import type {
  AuthConfig,
  Collection,
  CollectionRequest,
  RequestItem,
} from "../types";

const oauthBase: AuthConfig = {
  auth_type: "oauth2",
  oauth2_grant_type: "authorization_code",
  oauth2_token_url: "https://example.test/token",
  oauth2_client_id: "cid",
  oauth2_client_secret: "secret",
  oauth2_access_token: "old-access",
  oauth2_refresh_token: "old-refresh",
  oauth2_token_expires_at: 0,
};

describe("shouldRefreshOAuth2", () => {
  const now = 10_000_000;

  it("returns false for non-oauth2 auth", () => {
    expect(shouldRefreshOAuth2({ auth_type: "bearer", bearer_token: "x" }, now)).toBe(false);
    expect(shouldRefreshOAuth2(undefined, now)).toBe(false);
  });

  it("returns false when there is no refresh_token to use", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_refresh_token: undefined, oauth2_token_expires_at: now - 1000 },
        now
      )
    ).toBe(false);
  });

  it("returns true when access_token is missing entirely (re-auth needed)", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_access_token: undefined }, now)
    ).toBe(true);
  });

  it("returns false when expires_at is unknown — don't speculate", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_token_expires_at: undefined }, now)
    ).toBe(false);
  });

  it("returns false when the token has comfortable headroom", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_token_expires_at: now + REFRESH_SKEW_MS * 5 },
        now
      )
    ).toBe(false);
  });

  it("returns true inside the skew window", () => {
    expect(
      shouldRefreshOAuth2(
        { ...oauthBase, oauth2_token_expires_at: now + REFRESH_SKEW_MS - 1 },
        now
      )
    ).toBe(true);
  });

  it("returns true when the token has already expired", () => {
    expect(
      shouldRefreshOAuth2({ ...oauthBase, oauth2_token_expires_at: now - 1000 }, now)
    ).toBe(true);
  });
});

describe("buildRefreshRequest", () => {
  it("plumbs the OAuth2 fields into the IPC payload shape", () => {
    const req = buildRefreshRequest({
      ...oauthBase,
      oauth2_scope: "read write",
      oauth2_client_auth: "body",
    });
    expect(req).toEqual({
      grant_type: "refresh_token",
      token_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "secret",
      scope: "read write",
      client_auth: "body",
      refresh_token: "old-refresh",
      insecure: false,
    });
  });

  it("defaults client_auth to basic and sends null scope when unset", () => {
    const req = buildRefreshRequest({
      ...oauthBase,
      oauth2_scope: undefined,
      oauth2_client_auth: undefined,
    });
    expect(req.client_auth).toBe("basic");
    expect(req.scope).toBeNull();
  });
});

describe("applyRefreshResult", () => {
  it("overwrites access_token and expires_at", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "new-access",
      expires_at: 42,
      refresh_token: null,
    });
    expect(next.oauth2_access_token).toBe("new-access");
    expect(next.oauth2_token_expires_at).toBe(42);
    // refresh_token unchanged when provider didn't return one
    expect(next.oauth2_refresh_token).toBe("old-refresh");
  });

  it("rotates the refresh_token when the provider returns one", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "a",
      expires_at: 1,
      refresh_token: "new-refresh",
    });
    expect(next.oauth2_refresh_token).toBe("new-refresh");
  });

  it("clears expires_at when the provider omits it", () => {
    const next = applyRefreshResult(oauthBase, {
      access_token: "a",
      expires_at: null,
      refresh_token: null,
    });
    expect(next.oauth2_token_expires_at).toBeUndefined();
  });
});

describe("updateFolderAuth", () => {
  const newAuth: AuthConfig = { ...oauthBase, oauth2_access_token: "fresh" };

  const collection: Collection = {
    id: "c1",
    name: "Demo",
    description: "",
    requests: [],
    created_at: 0,
    folders: [
      {
        id: "fA",
        name: "outer",
        requests: [],
        auth: { ...oauthBase, oauth2_access_token: "old-a" },
        folders: [
          {
            id: "fAA",
            name: "inner",
            requests: [],
            auth: { ...oauthBase, oauth2_access_token: "old-aa" },
            folders: [],
          },
        ],
      },
      {
        id: "fB",
        name: "sibling",
        requests: [],
        folders: [],
      },
    ],
    variables: [],
    updated_at: 0,
  };

  it("updates the auth on a root-level folder without touching siblings", () => {
    const out = updateFolderAuth(collection, "fA", newAuth);
    expect(out.folders[0].auth).toBe(newAuth);
    // The sibling's content is unchanged (we don't compare by reference
    // because the walker rebuilds the shape).
    expect(out.folders[1].id).toBe("fB");
    expect(out.folders[1].auth).toBeUndefined();
  });

  it("walks into nested folders to update deep auth", () => {
    const out = updateFolderAuth(collection, "fAA", newAuth);
    expect(out.folders[0].folders[0].auth).toBe(newAuth);
    // Parent auth must remain unchanged.
    expect(out.folders[0].auth?.oauth2_access_token).toBe("old-a");
  });

  it("returns a new object even when the folder isn't found (idempotent)", () => {
    const out = updateFolderAuth(collection, "does-not-exist", newAuth);
    expect(out).not.toBe(collection);
    expect(out.folders[0].auth?.oauth2_access_token).toBe("old-a");
  });
});

describe("refreshOAuth2Token", () => {
  const now = 10_000_000;

  function makeRequestItem(over: Partial<RequestItem> = {}): RequestItem {
    return {
      id: "r1",
      name: "Req",
      method: "GET",
      url: "https://api.example.test/me",
      headers: [],
      params: [],
      body: "",
      bodyType: "none",
      formData: [],
      createdAt: 0,
      updatedAt: 0,
      ...over,
    };
  }

  function makeCollection(over: Partial<Collection> = {}): Collection {
    return {
      id: "c1",
      name: "Demo",
      description: "",
      requests: [],
      folders: [],
      variables: [],
      created_at: 0,
      updated_at: 0,
      ...over,
    };
  }

  function makeCollectionRequest(
    over: Partial<CollectionRequest> = {},
  ): CollectionRequest {
    return {
      id: "r1",
      name: "Req",
      method: "GET",
      url: "https://api.example.test/me",
      headers: [],
      params: [],
      body: "",
      body_type: "none",
      auth: { auth_type: "inherit" },
      created_at: 0,
      updated_at: 0,
      ...over,
    };
  }

  it("returns noop when the resolved auth doesn't need refreshing", async () => {
    const invoke = vi.fn();
    const req = makeRequestItem({
      auth: { auth_type: "bearer", bearer_token: "static" },
    });
    const out = await refreshOAuth2Token(req, [], invoke, now);
    expect(out).toEqual({ kind: "noop" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns noop and skips the wire call when the token has headroom", async () => {
    const invoke = vi.fn();
    const req = makeRequestItem({
      auth: {
        ...oauthBase,
        oauth2_token_expires_at: now + REFRESH_SKEW_MS * 5,
      },
    });
    const out = await refreshOAuth2Token(req, [], invoke, now);
    expect(out).toEqual({ kind: "noop" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the token exchange and returns the new auth + 'request' source for inline auth", async () => {
    const invoke = vi.fn().mockResolvedValue({
      access_token: "fresh-access",
      expires_at: now + 3600_000,
      refresh_token: null,
    });
    const req = makeRequestItem({
      auth: { ...oauthBase, oauth2_token_expires_at: now - 1000 },
    });
    const out = await refreshOAuth2Token(req, [], invoke, now);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("oauth2_fetch_token", {
      request: expect.objectContaining({ grant_type: "refresh_token" }),
    });
    expect(out.kind).toBe("write");
    if (out.kind !== "write") return;
    expect(out.source).toEqual({ source: "request" });
    expect(out.newAuth.oauth2_access_token).toBe("fresh-access");
    expect(out.newAuth.oauth2_token_expires_at).toBe(now + 3600_000);
  });

  it("locates a collection-level auth source when the request inherits", async () => {
    const invoke = vi.fn().mockResolvedValue({
      access_token: "a",
      expires_at: now + 1,
      refresh_token: "rotated",
    });
    const colReq = makeCollectionRequest();
    const col = makeCollection({
      auth: { ...oauthBase, oauth2_token_expires_at: now - 1 },
      requests: [colReq],
    });
    const req = makeRequestItem({
      auth: { auth_type: "inherit" },
      collectionId: col.id,
    });
    const out = await refreshOAuth2Token(req, [col], invoke, now);
    expect(out.kind).toBe("write");
    if (out.kind !== "write") return;
    expect(out.source).toEqual({ source: "collection", collectionId: "c1" });
    expect(out.newAuth.oauth2_refresh_token).toBe("rotated");
  });

  it("locates a folder-level auth source by walking the tree", async () => {
    const invoke = vi.fn().mockResolvedValue({
      access_token: "a",
      expires_at: now + 1,
      refresh_token: null,
    });
    const colReq = makeCollectionRequest();
    const col = makeCollection({
      folders: [
        {
          id: "fA",
          name: "outer",
          auth: { ...oauthBase, oauth2_token_expires_at: now - 1 },
          requests: [colReq],
          folders: [],
        },
      ],
    });
    const req = makeRequestItem({
      auth: { auth_type: "inherit" },
      collectionId: col.id,
    });
    const out = await refreshOAuth2Token(req, [col], invoke, now);
    expect(out.kind).toBe("write");
    if (out.kind !== "write") return;
    expect(out.source).toEqual({
      source: "folder",
      collectionId: "c1",
      folderId: "fA",
    });
  });

  it("propagates the invoke rejection (caller decides how to surface it)", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("network down"));
    const req = makeRequestItem({
      auth: { ...oauthBase, oauth2_token_expires_at: now - 1 },
    });
    await expect(refreshOAuth2Token(req, [], invoke, now)).rejects.toThrow(
      "network down",
    );
  });
});
