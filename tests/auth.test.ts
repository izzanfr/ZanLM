import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  authConfigSchema,
  createLoginLimiter,
  createSession,
  equalCode,
  isSameOrigin,
  loginSchema,
  SESSION_SECONDS,
  sessionCookieOptions,
  verifySession,
} from "../lib/auth/core.ts";
const secret = "unit-test-only-secret-with-more-than-32-characters";
const now = 1_800_000_000_000;
test("origin validation handles loopback without trusting cross-site requests", () => {
  assert.equal(
    isSameOrigin("http://127.0.0.1:3000", "127.0.0.1:3000", "http:", "same-origin"),
    true,
  );
  assert.equal(isSameOrigin("http://localhost:3000", "localhost:3000", "http:", null), true);
  assert.equal(isSameOrigin("https://evil.example", "localhost:3000", "http:", null), false);
  assert.equal(isSameOrigin(null, "localhost:3000", "http:", null), false);
  assert.equal(
    isSameOrigin("http://localhost:3000", "localhost:3000", "http:", "cross-site"),
    false,
  );
  assert.equal(isSameOrigin("http://localhost:3000/path", "localhost:3000", "http:", null), false);
});
test("access code comparison preserves exact Unicode and whitespace", () => {
  assert.equal(equalCode("sample-code", "sample-code"), true);
  assert.equal(equalCode(" sample-code", "sample-code"), false);
  assert.equal(equalCode("é", "e\u0301"), false);
  assert.equal(equalCode("", "sample-code"), false);
});
test("sessions are signed, unique, and valid until the exact expiry", () => {
  const token = createSession(secret, now);
  assert.notEqual(token, createSession(secret, now));
  assert.equal(verifySession(token, secret, now), true);
  assert.equal(verifySession(token, secret, now + SESSION_SECONDS * 1000 - 1), true);
  assert.equal(verifySession(token, secret, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifySession(token, secret, now - 1000), false);
});
test("tampered payloads, signatures and wrong secrets fail closed", () => {
  const token = createSession(secret, now);
  const [payload, signature] = token.split(".");
  assert.equal(verifySession(`${payload}a.${signature}`, secret, now), false);
  assert.equal(verifySession(`${payload}.${signature.slice(0, -1)}!`, secret, now), false);
  assert.equal(verifySession(token, secret + "wrong", now), false);
  for (const malformed of [undefined, "", "x.y", "..", "x".repeat(2000), token + ".extra"]) {
    assert.equal(verifySession(malformed, secret, now), false);
  }
});
test("signed malformed payloads and extended lifetimes fail validation", () => {
  for (const data of [
    {
      version: 2,
      issued: now / 1000,
      expires: now / 1000 + SESSION_SECONDS,
      nonce: "a".repeat(32),
    },
    {
      version: 1,
      issued: now / 1000,
      expires: now / 1000 + SESSION_SECONDS + 1,
      nonce: "a".repeat(32),
    },
    { version: 1, issued: 0, expires: 9999999999, nonce: "bad" },
  ]) {
    const p = Buffer.from(JSON.stringify(data)).toString("base64url");
    const sig = createHmac("sha256", secret).update(p).digest("base64url");
    assert.equal(verifySession(`${p}.${sig}`, secret, now), false);
  }
});
test("cookie security attributes and configuration are enforced", () => {
  assert.deepEqual(sessionCookieOptions(true), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 2592000,
  });
  assert.equal(sessionCookieOptions(false).secure, false);
  assert.equal(authConfigSchema.safeParse({ accessCode: "short", secret: "bad" }).success, false);
  assert.equal(loginSchema.safeParse({ code: "ok", admin: true }).success, false);
  assert.equal(loginSchema.safeParse({ code: "x".repeat(513) }).success, false);
});
test("bounded login limiter resets after its window", () => {
  const allow = createLoginLimiter(2, 1000);
  assert.equal(allow(1000), true);
  assert.equal(allow(1001), true);
  assert.equal(allow(1002), false);
  assert.equal(allow(2000), true);
});
