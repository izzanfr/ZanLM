import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const port = 3108;
const origin = `http://127.0.0.1:${port}`;
const code = randomBytes(16).toString("hex");
const secret = randomBytes(32).toString("hex");
// Use process-only test credentials; never read or copy .env.local.
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: {
      ...process.env,
      ACCESS_CODE: code,
      SESSION_SECRET: secret,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let ready = false;
child.stdout.on("data", (chunk) => {
  if (chunk.toString().includes("Ready")) ready = true;
});
child.stderr.on("data", () => {});
let assertions = 0;
function check(actual, expected, label) {
  assert.equal(actual, expected, label);
  assertions++;
}
try {
  for (let i = 0; i < 150 && !ready; i++) {
    if (child.exitCode !== null) throw new Error("Test server exited before startup.");
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("Test server did not become ready.");
  const post = (path, body, headers = {}) =>
    fetch(origin + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
  check((await fetch(origin)).status, 200, "home loads");
  check(
    (await fetch(origin + "/workspace", { redirect: "manual" })).status,
    307,
    "workspace redirects without session",
  );
  check(
    (await fetch(origin + "/api/workspace")).status,
    401,
    "API rejects anonymous request independently",
  );
  check((await post("/api/auth/logout")).status, 401, "logout checks session");
  check(
    (await post("/api/auth/login", { code }, { Origin: "https://untrusted.example" })).status,
    403,
    "login rejects cross-origin",
  );
  check((await post("/api/auth/login", { code: "wrong" })).status, 401, "wrong code rejected");
  check(
    (await post("/api/auth/login", { code: "x".repeat(3000) })).status,
    413,
    "oversized body rejected",
  );
  check(
    (await post("/api/auth/login", { code, extra: true })).status,
    400,
    "unknown fields rejected",
  );
  const login = await post("/api/auth/login", { code });
  check(login.status, 200, "valid login succeeds");
  const cookieHeader = login.headers.get("set-cookie");
  assert.ok(cookieHeader);
  assertions++;
  for (const flag of ["HttpOnly", "Secure", "SameSite=lax", "Max-Age=2592000"]) {
    assert.ok(cookieHeader.toLowerCase().includes(flag.toLowerCase()));
    assertions++;
  }
  const cookie = cookieHeader.split(";")[0];
  check(
    (await fetch(origin + "/api/workspace", { headers: { Cookie: cookie } })).status,
    200,
    "signed API request succeeds",
  );
  check(
    (await fetch(origin + "/workspace", { headers: { Cookie: cookie } })).status,
    200,
    "signed workspace loads",
  );
  const tampered = cookie.slice(0, -3) + "abc";
  check(
    (await fetch(origin + "/api/workspace", { headers: { Cookie: tampered } })).status,
    401,
    "tampered session rejected",
  );
  check(
    (
      await post("/api/auth/logout", undefined, {
        Cookie: cookie,
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
    "logout rejects cross-origin",
  );
  const logout = await post("/api/auth/logout", undefined, { Cookie: cookie });
  check(logout.status, 200, "logout succeeds");
  assert.ok(logout.headers.get("set-cookie").includes("Max-Age=0"));
  assertions++;
  check((await fetch(origin + "/api/workspace")).status, 401, "API rejects cleared cookie");
  check((await fetch(origin + "/unknown-page")).status, 404, "not-found page");
  console.log(
    `PASS: ${assertions} HTTP checks (login, cookies, route guards, origin checks, logout).`,
  );
} finally {
  child.kill();
}
