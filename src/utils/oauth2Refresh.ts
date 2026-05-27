import type {
  AuthConfig,
  Collection,
  CollectionFolder,
  RequestItem,
} from "../types";
import { locateAuthSource, resolveAuth, type AuthSource } from "./auth";

/** Margin (ms) we treat a token as already-expired even though the clock
 *  says it's still valid. Backs the same idea as the backend's 30-second
 *  expiry skew: we'd rather refresh early than send a request that the
 *  upstream API will reject. */
export const REFRESH_SKEW_MS = 30_000;

/** True if `auth` is an OAuth2 entry whose access_token has expired (or is
 *  about to expire within the skew window) AND we have a refresh_token to
 *  use. Returns false for tokens with no `expires_at` — we don't speculate
 *  about lifetime for providers that don't tell us. */
export function shouldRefreshOAuth2(auth: AuthConfig | undefined, now: number = Date.now()): boolean {
  if (!auth || auth.auth_type !== "oauth2") return false;
  if (!auth.oauth2_refresh_token) return false;
  if (!auth.oauth2_access_token) return true;
  if (auth.oauth2_token_expires_at == null) return false;
  return auth.oauth2_token_expires_at - REFRESH_SKEW_MS <= now;
}

/** Build the request payload for an OAuth2 refresh_token exchange. The
 *  shape mirrors what the backend's `oauth2_fetch_token` Tauri command
 *  accepts; kept as a small helper so we can unit-test the field plumbing
 *  without spinning up a Tauri runtime. */
export function buildRefreshRequest(auth: AuthConfig): Record<string, unknown> {
  return {
    grant_type: "refresh_token",
    token_url: auth.oauth2_token_url || "",
    client_id: auth.oauth2_client_id || "",
    client_secret: auth.oauth2_client_secret || "",
    scope: auth.oauth2_scope || null,
    client_auth: auth.oauth2_client_auth || "basic",
    refresh_token: auth.oauth2_refresh_token,
    insecure: false,
  };
}

/** Merge the result of a successful refresh back into the existing auth
 *  config. The provider may or may not return a new refresh_token — we
 *  keep the old one if not. Returns a new object (does not mutate). */
export function applyRefreshResult(
  auth: AuthConfig,
  result: { access_token: string; expires_at: number | null; refresh_token: string | null }
): AuthConfig {
  return {
    ...auth,
    oauth2_access_token: result.access_token,
    oauth2_token_expires_at: result.expires_at ?? undefined,
    oauth2_refresh_token: result.refresh_token ?? auth.oauth2_refresh_token,
  };
}

/** Walk a collection's folder tree and overwrite the auth on the matching
 *  folder. No-op if `folderId` doesn't exist. Returns a new collection
 *  object so consumers can shallow-compare for change detection. */
export function updateFolderAuth(
  collection: Collection,
  folderId: string,
  auth: AuthConfig,
): Collection {
  const walk = (folders: CollectionFolder[]): CollectionFolder[] =>
    folders.map((f) => {
      if (f.id === folderId) return { ...f, auth };
      return { ...f, folders: walk(f.folders) };
    });
  return { ...collection, folders: walk(collection.folders) };
}

/** Shape of the response returned by the `oauth2_fetch_token` Tauri
 *  command. Surfacing it here keeps the wire contract co-located with
 *  the refresh helpers. */
export interface OAuth2TokenResponse {
  access_token: string;
  expires_at: number | null;
  refresh_token: string | null;
}

/** Outcome of `refreshOAuth2Token`: either nothing to do, or the
 *  refreshed auth config plus the location in the collection tree
 *  where it should be written back. Returning the source lets the
 *  caller dispatch the write to the right Zustand slice without the
 *  helper itself depending on the store. */
export type RefreshOutcome =
  | { kind: "noop" }
  | { kind: "write"; newAuth: AuthConfig; source: AuthSource };

/** Minimal subset of the Tauri `invoke` signature that
 *  `refreshOAuth2Token` actually needs. Tests pass a `vi.fn()`; the
 *  store passes the real `@tauri-apps/api/core` import. */
export type InvokeFn = <T>(
  cmd: string,
  args: { request: Record<string, unknown> },
) => Promise<T>;

/** Resolve effective auth for `req`, check whether it needs an OAuth2
 *  refresh, perform the token exchange via the injected `invoke`, and
 *  return the merged auth together with the location where it should
 *  be persisted. The `invoke` parameter is injected (not imported)
 *  so unit tests can stub the wire call without a Tauri runtime. */
export async function refreshOAuth2Token(
  req: RequestItem,
  collections: Collection[],
  invoke: InvokeFn,
  now: number = Date.now(),
): Promise<RefreshOutcome> {
  const auth = resolveAuth(req, collections);
  if (!shouldRefreshOAuth2(auth, now)) return { kind: "noop" };
  const payload = buildRefreshRequest(auth!);
  const resp = await invoke<OAuth2TokenResponse>("oauth2_fetch_token", {
    request: payload,
  });
  const newAuth = applyRefreshResult(auth!, resp);
  const src = locateAuthSource(req, collections);
  if (!src) return { kind: "noop" };
  return { kind: "write", newAuth, source: src };
}
