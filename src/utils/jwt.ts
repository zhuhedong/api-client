/**
 * Signs a JWT (HMAC family — HS256 / HS384 / HS512) using the Web Crypto API.
 *
 * This is intentionally a *signer*, not a verifier — the request flow only
 * needs to mint a token before sending. Output is the standard
 * `<base64url(header)>.<base64url(payload)>.<base64url(signature)>` form.
 */

export type JwtAlg = "HS256" | "HS384" | "HS512";

interface SignJwtInput {
  alg: JwtAlg;
  /**
   * Payload claims. Can include reserved claims (iat, exp, etc.) — those
   * are written through verbatim. If `iat` is missing it's filled with the
   * current epoch seconds; `exp` is left to the caller.
   */
  payload: Record<string, unknown>;
  /** HMAC secret. Bytes or string. */
  secret: string;
  /** Treat `secret` as a base64-encoded byte string. Default false. */
  secretIsBase64?: boolean;
  /** Optional extra header fields (e.g. `kid`). `alg` is always set by us. */
  headerExtras?: Record<string, unknown>;
}

const ALG_TO_HASH: Record<JwtAlg, "SHA-256" | "SHA-384" | "SHA-512"> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
};

export async function signJwt(input: SignJwtInput): Promise<string> {
  const { alg, payload, secret, secretIsBase64, headerExtras } = input;

  const header = {
    alg,
    typ: "JWT",
    ...(headerExtras ?? {}),
  };
  const fullPayload: Record<string, unknown> = {
    iat: Math.floor(Date.now() / 1000),
    ...payload,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyBytes = secretIsBase64 ? base64Decode(secret) : new TextEncoder().encode(secret);
  // Copy into a fresh ArrayBuffer so the type is `ArrayBuffer` rather than
  // `ArrayBufferLike` / `SharedArrayBuffer`, which lib.dom rejects.
  const keyBuf = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuf).set(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: ALG_TO_HASH[alg] },
    false,
    ["sign"],
  );
  const signingBytes = new TextEncoder().encode(signingInput);
  const signingBuf = new ArrayBuffer(signingBytes.byteLength);
  new Uint8Array(signingBuf).set(signingBytes);
  const sig = await crypto.subtle.sign("HMAC", key, signingBuf);
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

function base64UrlEncode(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(s: string): Uint8Array {
  // Accept both base64 and base64url
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
