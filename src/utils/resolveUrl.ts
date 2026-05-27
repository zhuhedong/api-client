import type { RequestItem } from "../types";
import { substituteAll } from "./dynamicVars";

/**
 * Resolve a request's URL exactly the way the send pipeline does: substitute
 * `{{var}}` / `{{$var}}` placeholders against the transient + environment
 * scopes, then append enabled query params with the same substitution.
 *
 * Kept synchronous and side-effect-free so it can be reused from places that
 * just want to display or export the URL (Copy URL, Copy as cURL, HAR export)
 * without invoking the full `buildSendPayload` flow (which is async and does
 * auth resolution / SigV4 signing).
 *
 * Mirrors the URL-building branch of `buildSendPayload` in
 * `requestPipeline.ts`. If you change one, change the other — the two unit
 * tests in `resolveUrl.test.ts` pin the contract.
 */
export function resolveRequestUrl(
  request: RequestItem,
  envVars: Record<string, string>,
  transientVars: Record<string, string> = {},
): string {
  const sub = (str: string): string =>
    substituteAll(str, (key) => transientVars[key] ?? envVars[key]);

  let url = sub(request.url);
  const enabledParams = request.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map(
        (p) =>
          `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`,
      )
      .join("&");
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${qs}`;
  }
  return url;
}
