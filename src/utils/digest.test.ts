import { describe, expect, it } from "vitest";
import { parseDigestChallenge, buildDigestAuthHeader } from "./digest";

describe("parseDigestChallenge", () => {
  it("parses a canonical RFC 2617 challenge", () => {
    const c = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    );
    expect(c).toBeDefined();
    expect(c!.realm).toBe("testrealm@host.com");
    expect(c!.nonce).toBe("dcd98b7102dd2f0e8b11d0f600bfb0c093");
    expect(c!.qop).toBe("auth,auth-int");
    expect(c!.opaque).toBe("5ccc069c403ebaf9f0171e9517f40e41");
  });

  it("parses unquoted parameters", () => {
    const c = parseDigestChallenge(
      'Digest realm="r", nonce="n", algorithm=MD5, stale=true',
    );
    expect(c!.algorithm).toBe("MD5");
    expect(c!.stale).toBe(true);
  });

  it("returns null for non-Digest schemes", () => {
    expect(parseDigestChallenge('Basic realm="x"')).toBeNull();
    expect(parseDigestChallenge('Bearer realm="x"')).toBeNull();
  });

  it("returns null when realm or nonce is missing", () => {
    expect(parseDigestChallenge('Digest realm="r"')).toBeNull();
    expect(parseDigestChallenge('Digest nonce="n"')).toBeNull();
  });

  it("handles escape sequences inside quoted values", () => {
    const c = parseDigestChallenge('Digest realm="a\\"b", nonce="n"');
    expect(c!.realm).toBe('a"b');
  });
});

describe("buildDigestAuthHeader (RFC 2617 §3.5)", () => {
  // Test vectors from RFC 2617 §3.5
  it("matches the canonical RFC 2617 §3.5 example (MD5 + qop=auth)", async () => {
    const challenge = {
      realm: "testrealm@host.com",
      nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
      qop: "auth",
      opaque: "5ccc069c403ebaf9f0171e9517f40e41",
    };
    const header = await buildDigestAuthHeader(challenge, {
      username: "Mufasa",
      password: "Circle Of Life",
      method: "GET",
      uri: "/dir/index.html",
      nc: "00000001",
      cnonce: "0a4f113b",
    });
    // RFC 2617 §3.5: response = "6629fae49393a05397450978507c4ef1"
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('username="Mufasa"');
    expect(header).toContain('realm="testrealm@host.com"');
    expect(header).toContain("qop=auth");
    expect(header).toContain("nc=00000001");
    expect(header).toContain('cnonce="0a4f113b"');
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  it("works without qop (RFC 2069 mode)", async () => {
    const challenge = {
      realm: "test",
      nonce: "abc123",
    };
    const header = await buildDigestAuthHeader(challenge, {
      username: "user",
      password: "pass",
      method: "GET",
      uri: "/",
    });
    expect(header).toContain('username="user"');
    expect(header).toContain('nonce="abc123"');
    expect(header).not.toContain("qop=");
    expect(header).not.toContain("cnonce=");
  });

  it("supports SHA-256 algorithm", async () => {
    const challenge = {
      realm: "test",
      nonce: "abc",
      algorithm: "SHA-256",
      qop: "auth",
    };
    const h256 = await buildDigestAuthHeader(challenge, {
      username: "u",
      password: "p",
      method: "GET",
      uri: "/",
      nc: "00000001",
      cnonce: "c",
    });
    const hMd5 = await buildDigestAuthHeader(
      { ...challenge, algorithm: "MD5" },
      {
        username: "u",
        password: "p",
        method: "GET",
        uri: "/",
        nc: "00000001",
        cnonce: "c",
      },
    );
    expect(h256).toContain("algorithm=SHA-256");
    // Different algorithm ⇒ different response.
    const sha256Resp = h256.match(/response="([^"]+)"/)![1];
    const md5Resp = hMd5.match(/response="([^"]+)"/)![1];
    expect(sha256Resp).not.toBe(md5Resp);
    expect(sha256Resp.length).toBe(64); // SHA-256 hex is 64 chars
    expect(md5Resp.length).toBe(32); // MD5 hex is 32 chars
  });

  it("prefers qop=auth when challenge offers both auth and auth-int", async () => {
    const challenge = {
      realm: "r",
      nonce: "n",
      qop: "auth-int,auth",
    };
    const header = await buildDigestAuthHeader(challenge, {
      username: "u",
      password: "p",
      method: "GET",
      uri: "/",
      cnonce: "c",
    });
    expect(header).toContain("qop=auth");
    expect(header).not.toContain("qop=auth-int");
  });
});
