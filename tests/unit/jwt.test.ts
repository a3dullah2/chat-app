import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signJwt, verifyJwt, readCookie, getJwtSecret } from "@shared/jwt";

const SECRET = "test-secret-that-is-long-enough-1234567890";

describe("JWT sign/verify", () => {
  it("round-trips a payload", () => {
    const token = signJwt({ sub: "user-1", email: "a@b.c" }, SECRET, 60);
    const payload = verifyJwt(token, SECRET);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.email).toBe("a@b.c");
    expect(payload?.exp).toBeGreaterThan(Date.now() / 1000 - 5);
  });

  it("rejects tampered payloads", () => {
    const token = signJwt({ sub: "user-1", email: "a@b.c" }, SECRET, 60);
    const [h, p, s] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: "attacker", email: "x@y.z", exp: Math.floor(Date.now() / 1000) + 60, iat: 0 }),
    ).toString("base64url");
    expect(verifyJwt(`${h}.${forgedBody}.${s}`, SECRET)).toBeNull();
  });

  it("rejects the wrong secret", () => {
    const token = signJwt({ sub: "user-1", email: "a@b.c" }, SECRET, 60);
    expect(verifyJwt(token, "another-secret-another-secret-another")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = signJwt({ sub: "user-1", email: "a@b.c" }, SECRET, -10);
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyJwt("not-a-token", SECRET)).toBeNull();
    expect(verifyJwt("a.b", SECRET)).toBeNull();
    expect(verifyJwt("", SECRET)).toBeNull();
  });
});

describe("readCookie", () => {
  it("parses cookie headers", () => {
    const header = "theme=dark; chat_token=abc%2F123; other=x";
    expect(readCookie(header, "chat_token")).toBe("abc/123");
    expect(readCookie(header, "theme")).toBe("dark");
    expect(readCookie(header, "missing")).toBeNull();
    expect(readCookie(undefined, "chat_token")).toBeNull();
  });
});

describe("getJwtSecret", () => {
  it("falls back to a dev secret when unset", () => {
    const previous = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(getJwtSecret()).toContain("dev-secret");
    process.env.JWT_SECRET = previous;
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases (production security sweep)
// ---------------------------------------------------------------------------

describe("JWT algorithm-confusion attack", () => {
  it("rejects a token with alg: none", () => {
    // Build a token whose header declares alg:none and signature is empty.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-1", email: "a@b.c", iat: 0, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
    const token = `${header}.${payload}.`;
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  it("rejects a token with a missing/blank signature", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-1", email: "a@b.c", iat: 0, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
    expect(verifyJwt(`${header}.${payload}.`, SECRET)).toBeNull();
    expect(verifyJwt(`${header}.${payload}`, SECRET)).toBeNull();
  });
});

describe("JWT payload validation", () => {
  it("rejects a payload missing 'sub'", () => {
    // Forge a token with valid signature but missing 'sub'.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = JSON.stringify({ email: "a@b.c", iat: 0, exp: Math.floor(Date.now() / 1000) + 60 });
    const payload = Buffer.from(body).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest();
    expect(verifyJwt(`${header}.${payload}.${sig.toString("base64url")}`, SECRET)).toBeNull();
  });

  it("rejects a payload with non-string sub", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = JSON.stringify({ sub: 12345, email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 60 });
    const payload = Buffer.from(body).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest();
    expect(verifyJwt(`${header}.${payload}.${sig.toString("base64url")}`, SECRET)).toBeNull();
  });
});

describe("readCookie (additional edge cases)", () => {
  it("decodes percent-encoded cookie values", () => {
    expect(readCookie("chat_token=hello%2Fworld", "chat_token")).toBe("hello/world");
    expect(readCookie("chat_token=%24ecret", "chat_token")).toBe("$ecret");
  });

  it("returns null when the cookie is present but malformed", () => {
    // No '=' between key and value -> ignored.
    expect(readCookie("chat_token", "chat_token")).toBeNull();
  });

  it("matches the first occurrence when duplicated", () => {
    expect(readCookie("chat_token=first; chat_token=second", "chat_token")).toBe("first");
  });

  it("is case-sensitive on cookie names", () => {
    expect(readCookie("Chat_Token=abc; chat_token=xyz", "chat_token")).toBe("xyz");
  });
});
