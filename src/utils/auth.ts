import type {
  AuthConfig,
  Collection,
  CollectionFolder,
  CollectionRequest,
  RequestItem,
} from "../types";

/**
 * Determine the effective auth for a request, honoring inheritance.
 *
 * Lookup order:
 *   1. The request's own auth, if it is a concrete strategy (anything other
 *      than `"inherit"`).
 *   2. The closest enclosing folder's auth, if the request was loaded from a
 *      collection and lives inside a folder with concrete auth.
 *   3. The owning collection's auth, if concrete.
 *   4. Otherwise no auth.
 *
 * An auth_type of `"none"` is concrete: a request can explicitly opt out of
 * inheriting a parent's auth by selecting "None".
 */
export function resolveAuth(
  req: RequestItem,
  collections: Collection[]
): AuthConfig | undefined {
  if (req.auth && req.auth.auth_type !== "inherit") {
    return req.auth;
  }
  if (!req.collectionId) return undefined;
  const col = collections.find((c) => c.id === req.collectionId);
  if (!col) return undefined;

  const folderAuth = findFolderAuth(col.folders, req.id);
  if (folderAuth && folderAuth.auth_type !== "inherit") {
    return folderAuth;
  }
  if (col.auth && col.auth.auth_type !== "inherit") {
    return col.auth;
  }
  return undefined;
}

/** Walk a folder tree to find the innermost folder containing `requestId`. */
function findFolderAuth(
  folders: CollectionFolder[],
  requestId: string
): AuthConfig | undefined {
  for (const folder of folders) {
    if (folder.requests.some((r) => r.id === requestId)) {
      return folder.auth;
    }
    const deeper = findFolderAuth(folder.folders, requestId);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

/** Tagged location of where the *effective* (resolved) auth lives so the
 *  store knows which slice to mutate when it refreshes an OAuth2 token. */
export type AuthSource =
  | { source: "request" }
  | { source: "folder"; collectionId: string; folderId: string }
  | { source: "collection"; collectionId: string };

/** Walk the same chain as `resolveAuth`, but return *where* the auth was
 *  found so the caller can write updates back to the right place. */
export function locateAuthSource(
  req: RequestItem,
  collections: Collection[]
): AuthSource | undefined {
  if (req.auth && req.auth.auth_type !== "inherit") {
    return { source: "request" };
  }
  if (!req.collectionId) return undefined;
  const col = collections.find((c) => c.id === req.collectionId);
  if (!col) return undefined;

  const folderId = findFolderIdWithAuth(col.folders, req.id);
  if (folderId) return { source: "folder", collectionId: col.id, folderId };
  if (col.auth && col.auth.auth_type !== "inherit") {
    return { source: "collection", collectionId: col.id };
  }
  return undefined;
}

function findFolderIdWithAuth(
  folders: CollectionFolder[],
  requestId: string
): string | undefined {
  for (const folder of folders) {
    if (folder.requests.some((r) => r.id === requestId)) {
      if (folder.auth && folder.auth.auth_type !== "inherit") {
        return folder.id;
      }
      return undefined;
    }
    const deeper = findFolderIdWithAuth(folder.folders, requestId);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * Locate a request inside a collection tree, returning its parent path so the
 * UI can render breadcrumbs / labels for "inherits from X".
 */
export function locateRequest(
  collection: Collection,
  requestId: string
):
  | { collection: Collection; folderPath: CollectionFolder[]; request: CollectionRequest }
  | null {
  const direct = collection.requests.find((r) => r.id === requestId);
  if (direct) return { collection, folderPath: [], request: direct };
  return walkFolders(collection.folders, requestId, []).map((hit) => ({
    collection,
    ...hit,
  }))[0] ?? null;
}

function walkFolders(
  folders: CollectionFolder[],
  requestId: string,
  acc: CollectionFolder[]
): { folderPath: CollectionFolder[]; request: CollectionRequest }[] {
  const out: { folderPath: CollectionFolder[]; request: CollectionRequest }[] = [];
  for (const folder of folders) {
    const direct = folder.requests.find((r) => r.id === requestId);
    if (direct) out.push({ folderPath: [...acc, folder], request: direct });
    out.push(...walkFolders(folder.folders, requestId, [...acc, folder]));
  }
  return out;
}

/**
 * Human-readable description of what `auth_type: "inherit"` would resolve to
 * right now, e.g. "Bearer (from folder under My API)". Returns `null` when
 * inheritance has nothing concrete to fall back to.
 */
export function describeInherited(
  req: RequestItem,
  collections: Collection[]
): string | null {
  if (!req.collectionId) return null;
  const col = collections.find((c) => c.id === req.collectionId);
  if (!col) return null;

  const folderAuth = findFolderAuth(col.folders, req.id);
  if (folderAuth && folderAuth.auth_type !== "inherit") {
    return `${labelFor(folderAuth)} (folder under ${col.name})`;
  }
  if (col.auth && col.auth.auth_type !== "inherit") {
    return `${labelFor(col.auth)} (collection ${col.name})`;
  }
  return null;
}

function labelFor(a: AuthConfig): string {
  switch (a.auth_type) {
    case "bearer":
      return "Bearer";
    case "basic":
      return "Basic";
    case "api_key":
      return "API Key";
    case "oauth2":
      return "OAuth 2";
    case "sigv4":
      return "AWS SigV4";
    case "digest":
      return "Digest";
    case "oauth1":
      return "OAuth 1.0";
    case "jwt":
      return "JWT";
    case "none":
      return "No auth";
    case "inherit":
      return "Inherited";
  }
}
