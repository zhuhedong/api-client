/**
 * HTTP Digest Access Authentication (RFC 7616 / RFC 2617).
 *
 * The full handshake requires:
 *   1. Send the initial request.
 *   2. Server returns 401 with `WWW-Authenticate: Digest realm="..." nonce="..." ...`
 *   3. Client computes a `Digest` response and resends the request.
 *
 * This module exposes:
 *   - `parseDigestChallenge(headerValue)` — RFC 2617 grammar parser
 *   - `buildDigestAuthHeader(challenge, opts)` — computes the response
 *
 * The challenge/response cycle itself is orchestrated by the request
 * pipeline; this module only handles parsing + hashing.
 */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  algorithm?: string;
  opaque?: string;
  /** Domain (rarely used). Space-separated URI list. */
  domain?: string;
  stale?: boolean;
}

export interface DigestAuthInput {
  username: string;
  password: string;
  /** HTTP method, uppercase. */
  method: string;
  /** Request URI (path + query). */
  uri: string;
  /** Nonce-count, formatted as 8 hex digits. Pass "00000001" for the first request. */
  nc?: string;
  /** Client-generated nonce. Auto-generated if absent. */
  cnonce?: string;
  /** SHA-256 hash of the request entity body, only needed for qop=auth-int. */
  entityBody?: string;
}

/**
 * Parse a `WWW-Authenticate: Digest ...` header value into a structured
 * challenge. Returns null when the header isn't a Digest challenge.
 */
export function parseDigestChallenge(headerValue: string): DigestChallenge | null {
  const trimmed = headerValue.trim();
  if (!/^Digest\b/i.test(trimmed)) return null;
  const body = trimmed.slice(6).trim();
  const params = parseAuthParams(body);
  if (!params.realm || !params.nonce) return null;
  return {
    realm: params.realm,
    nonce: params.nonce,
    qop: params.qop,
    algorithm: params.algorithm,
    opaque: params.opaque,
    domain: params.domain,
    stale: params.stale?.toLowerCase() === "true",
  };
}

/**
 * Build a `Digest ...` Authorization header value satisfying the given
 * challenge. Supports algorithm = MD5 / SHA-256 / MD5-sess / SHA-256-sess,
 * and qop = auth / auth-int.
 */
export async function buildDigestAuthHeader(
  challenge: DigestChallenge,
  input: DigestAuthInput,
): Promise<string> {
  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  const isSession = algorithm.endsWith("-SESS");
  const hashAlg = algorithm.replace(/-SESS$/, "");
  const qop = pickQop(challenge.qop);
  const nc = input.nc ?? "00000001";
  const cnonce = input.cnonce ?? generateCnonce();

  // HA1 = H(username:realm:password)  (or session: H(H(u:r:p):nonce:cnonce))
  let ha1 = await hashHex(hashAlg, `${input.username}:${challenge.realm}:${input.password}`);
  if (isSession) {
    ha1 = await hashHex(hashAlg, `${ha1}:${challenge.nonce}:${cnonce}`);
  }

  // HA2 = H(method:uri)  (or for qop=auth-int: H(method:uri:H(entityBody)))
  let ha2: string;
  if (qop === "auth-int") {
    const bodyHash = await hashHex(hashAlg, input.entityBody ?? "");
    ha2 = await hashHex(hashAlg, `${input.method}:${input.uri}:${bodyHash}`);
  } else {
    ha2 = await hashHex(hashAlg, `${input.method}:${input.uri}`);
  }

  // response
  let response: string;
  if (qop) {
    response = await hashHex(
      hashAlg,
      `${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`,
    );
  } else {
    response = await hashHex(hashAlg, `${ha1}:${challenge.nonce}:${ha2}`);
  }

  const parts: [string, string, boolean][] = [
    ["username", input.username, true],
    ["realm", challenge.realm, true],
    ["nonce", challenge.nonce, true],
    ["uri", input.uri, true],
    ["algorithm", algorithm, false],
    ["response", response, true],
  ];
  if (challenge.opaque) parts.push(["opaque", challenge.opaque, true]);
  if (qop) {
    parts.push(["qop", qop, false]);
    parts.push(["nc", nc, false]);
    parts.push(["cnonce", cnonce, true]);
  }
  return (
    "Digest " +
    parts
      .map(([k, v, quoted]) => (quoted ? `${k}="${escapeQuoted(v)}"` : `${k}=${v}`))
      .join(", ")
  );
}

// === Internal helpers ========================================================

function pickQop(qop?: string): string | undefined {
  if (!qop) return undefined;
  // The challenge can list multiple qops (e.g. "auth,auth-int") — prefer auth.
  const opts = qop.split(",").map((s) => s.trim().toLowerCase());
  if (opts.includes("auth")) return "auth";
  if (opts.includes("auth-int")) return "auth-int";
  return undefined;
}

function generateCnonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Parse the comma-separated `key=value` / `key="value"` body of an
 * authentication challenge. Doesn't try to be a full RFC parser — values
 * may be either unquoted (no commas/spaces/quotes) or quoted with simple
 * backslash escapes.
 */
function parseAuthParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    const start = i;
    while (i < s.length && s[i] !== "=") i++;
    const key = s.slice(start, i).trim().toLowerCase();
    if (s[i] === "=") i++;
    let value = "";
    if (s[i] === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          value += s[i + 1];
          i += 2;
        } else {
          value += s[i];
          i++;
        }
      }
      if (s[i] === '"') i++;
    } else {
      const vStart = i;
      while (i < s.length && s[i] !== ",") i++;
      value = s.slice(vStart, i).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

async function hashHex(algorithm: string, data: string): Promise<string> {
  const subtleAlg =
    algorithm === "SHA-256" || algorithm === "SHA256" ? "SHA-256" : "MD5";
  if (subtleAlg === "MD5") {
    // Web Crypto doesn't support MD5; use a small in-process MD5.
    return md5Hex(data);
  }
  const bytes = await crypto.subtle.digest(
    subtleAlg,
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- MD5 implementation ------------------------------------------------------
// Web Crypto deliberately doesn't expose MD5 (it's broken cryptographically),
// but Digest with MD5 is still the most common in the wild. RFC 1321
// reference implementation, transcribed in JS.

function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return md5(bytes);
}

function md5(input: Uint8Array): string {
  const padded = padMessage(input);
  let a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;
  for (let i = 0; i < padded.length; i += 16) {
    const [na, nb, nc, nd] = md5Round(a, b, c, d, padded.subarray(i, i + 16));
    a = (a + na) >>> 0;
    b = (b + nb) >>> 0;
    c = (c + nc) >>> 0;
    d = (d + nd) >>> 0;
  }
  return toLittleEndianHex(a) + toLittleEndianHex(b) + toLittleEndianHex(c) + toLittleEndianHex(d);
}

function padMessage(bytes: Uint8Array): Uint32Array {
  const bitLen = BigInt(bytes.length) * 8n;
  const withOne = new Uint8Array(bytes.length + 1);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const padLen = (56 - (withOne.length % 64) + 64) % 64;
  const padded = new Uint8Array(withOne.length + padLen + 8);
  padded.set(withOne);
  // Append length in bits, little-endian.
  for (let i = 0; i < 8; i++) {
    padded[padded.length - 8 + i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  }
  // Convert to little-endian uint32 view.
  const out = new Uint32Array(padded.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      padded[i * 4] |
      (padded[i * 4 + 1] << 8) |
      (padded[i * 4 + 2] << 16) |
      (padded[i * 4 + 3] << 24);
    out[i] >>>= 0;
  }
  return out;
}

function md5Round(
  a0: number,
  b0: number,
  c0: number,
  d0: number,
  m: Uint32Array,
): [number, number, number, number] {
  let a = a0, b = b0, c = c0, d = d0;
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  for (let i = 0; i < 64; i++) {
    let f: number, g: number;
    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) % 16;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) % 16;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) % 16;
    }
    f = (f + a + K[i] + m[g]) >>> 0;
    a = d;
    d = c;
    c = b;
    b = (b + leftRotate(f, S[i])) >>> 0;
  }
  return [a, b, c, d];
}

function leftRotate(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function toLittleEndianHex(n: number): string {
  return (
    ((n >>> 0) & 0xff).toString(16).padStart(2, "0") +
    ((n >>> 8) & 0xff).toString(16).padStart(2, "0") +
    ((n >>> 16) & 0xff).toString(16).padStart(2, "0") +
    ((n >>> 24) & 0xff).toString(16).padStart(2, "0")
  );
}
