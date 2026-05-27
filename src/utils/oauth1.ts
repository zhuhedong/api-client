/**
 * OAuth 1.0a (RFC 5849) request signer.
 *
 * Produces either an Authorization header or a set of query-string parameters
 * containing the `oauth_*` fields. Signature methods supported:
 *   - HMAC-SHA1
 *   - HMAC-SHA256
 *   - PLAINTEXT (consumer_secret&token_secret — no hashing)
 *
 * RSA-SHA1 is not implemented yet (it requires private-key handling that
 * doesn't fit the keychain-only-strings model we use for other auth types).
 */

export type Oauth1SignatureMethod = "HMAC-SHA1" | "HMAC-SHA256" | "PLAINTEXT";

export interface Oauth1Input {
  /** HTTP method, e.g. "GET" / "POST". */
  method: string;
  /** Full request URL — may include a query string; we strip it for signing. */
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  signatureMethod: Oauth1SignatureMethod;
  /** Optional realm — added to the Authorization header but not to the signature base string. */
  realm?: string;
  /** Optional callback URL — required for the "request token" step. */
  callback?: string;
  /** Where to inject the oauth_* params. Default "header". */
  addTo?: "header" | "query";
  /**
   * Optional overrides — used in tests to make output deterministic. In
   * production these are auto-generated.
   */
  timestamp?: string;
  nonce?: string;
}

export interface Oauth1Output {
  /** Set when `addTo === "header"`. */
  authorizationHeader?: string;
  /** Set when `addTo === "query"` — parameters to append to the URL. */
  queryParams?: Record<string, string>;
}

export async function signOauth1(input: Oauth1Input): Promise<Oauth1Output> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? randomNonce();
  const addTo = input.addTo ?? "header";

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: input.signatureMethod,
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
  };
  if (input.token) oauthParams.oauth_token = input.token;
  if (input.callback) oauthParams.oauth_callback = input.callback;

  const { baseUrl, urlQueryParams } = splitUrl(input.url);

  // Per RFC 5849 §3.4.1.3, the signature base string includes oauth_* params,
  // query-string params, and (for form-encoded bodies) form-data params. We
  // only handle oauth_* + query here — form-data bodies aren't covered.
  const allParams: [string, string][] = [
    ...Object.entries(oauthParams),
    ...urlQueryParams,
  ];

  let signature: string;
  if (input.signatureMethod === "PLAINTEXT") {
    signature =
      `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret ?? "")}`;
  } else {
    const baseString = [
      input.method.toUpperCase(),
      percentEncode(baseUrl),
      percentEncode(buildParamString(allParams)),
    ].join("&");
    const signingKey =
      `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret ?? "")}`;
    signature = await hmacSign(input.signatureMethod, signingKey, baseString);
  }
  oauthParams.oauth_signature = signature;

  if (addTo === "header") {
    const headerKvs = [
      ...(input.realm ? [["realm", input.realm] as [string, string]] : []),
      ...Object.entries(oauthParams).sort(([a], [b]) => (a < b ? -1 : 1)),
    ];
    const headerValue =
      "OAuth " +
      headerKvs.map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`).join(", ");
    return { authorizationHeader: headerValue };
  }
  return { queryParams: oauthParams };
}

// --- Internal helpers --------------------------------------------------------

function splitUrl(url: string): {
  baseUrl: string;
  urlQueryParams: [string, string][];
} {
  const qIdx = url.indexOf("?");
  if (qIdx < 0) return { baseUrl: url, urlQueryParams: [] };
  const baseUrl = url.slice(0, qIdx);
  const qs = url.slice(qIdx + 1);
  const pairs: [string, string][] = [];
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq < 0 ? part : part.slice(0, eq);
    const v = eq < 0 ? "" : part.slice(eq + 1);
    pairs.push([decodeURIComponent(k), decodeURIComponent(v)]);
  }
  return { baseUrl, urlQueryParams: pairs };
}

/** Per RFC 5849 §3.6 — every byte except unreserved (A-Z, a-z, 0-9, -, _, ., ~) is percent-encoded. */
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function buildParamString(params: [string, string][]): string {
  const encoded = params.map<[string, string]>(([k, v]) => [
    percentEncode(k),
    percentEncode(v),
  ]);
  encoded.sort(([k1, v1], [k2, v2]) => {
    if (k1 !== k2) return k1 < k2 ? -1 : 1;
    return v1 < v2 ? -1 : v1 > v2 ? 1 : 0;
  });
  return encoded.map(([k, v]) => `${k}=${v}`).join("&");
}

async function hmacSign(
  method: "HMAC-SHA1" | "HMAC-SHA256",
  key: string,
  data: string,
): Promise<string> {
  const hash = method === "HMAC-SHA1" ? "SHA-1" : "SHA-256";
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
