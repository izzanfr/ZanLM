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

// A 2 x 2 PNG, generated rather than committed, so the upload path is
// exercised with something sharp really accepts.
async function tinyPng() {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#142b4a" } })
    .png()
    .toBuffer();
}

async function checkJobRoutes({ origin, cookie, post, check }) {
  const put = (path, body, headers = {}) =>
    fetch(origin + path, {
      method: "PUT",
      headers: { Origin: origin, ...headers },
      body,
      duplex: "half",
    });

  check((await post("/api/jobs")).status, 401, "job creation checks session");
  check(
    (await post("/api/jobs", undefined, { Cookie: cookie, Origin: "https://untrusted.example" }))
      .status,
    403,
    "job creation rejects cross-origin",
  );

  const created = await post("/api/jobs", undefined, { Cookie: cookie });
  check(created.status, 201, "job created");
  const { id } = await created.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assertions++;

  // Path traversal through the id, in several shapes.
  for (const bad of ["..", "%2e%2e", "..%2f..%2fjob", "not-a-uuid"]) {
    check(
      (await fetch(`${origin}/api/jobs/${bad}`, { headers: { Cookie: cookie } })).status,
      404,
      `job id "${bad}" rejected`,
    );
  }

  const png = await tinyPng();
  check(
    (await put(`/api/jobs/${id}/files`, png, { Cookie: cookie })).status,
    400,
    "upload without a file name rejected",
  );
  check(
    (
      await put(`/api/jobs/${id}/files`, Buffer.from("MZ\x90\x00 not an image"), {
        Cookie: cookie,
        "X-File-Name": "totally-a-slide.png",
      })
    ).status,
    415,
    "a renamed executable is rejected on its bytes",
  );
  // A real PNG signature followed by 60 MB of padding, so it gets past the
  // type check and is stopped by the size cap rather than before it.
  const oversized = Buffer.concat([png.subarray(0, 8), Buffer.alloc(60 * 1024 * 1024)]);
  check(
    (await put(`/api/jobs/${id}/files`, oversized, { Cookie: cookie, "X-File-Name": "huge.png" }))
      .status,
    413,
    "a file over the cap is rejected",
  );

  const uploaded = await put(`/api/jobs/${id}/files`, png, {
    Cookie: cookie,
    "X-File-Name": "slide-2.png",
  });
  check(uploaded.status, 201, "png upload accepted");
  await put(`/api/jobs/${id}/files`, png, { Cookie: cookie, "X-File-Name": "slide-10.png" });

  // A PPTX cannot join a job that already holds images.
  check(
    (
      await put(`/api/jobs/${id}/files`, Buffer.from("PK\x03\x04 pretend deck"), {
        Cookie: cookie,
        "X-File-Name": "deck.pptx",
      })
    ).status,
    409,
    "mixing a deck into an image job is rejected",
  );

  check(
    (await post(`/api/jobs/${id}/start`, undefined, { Cookie: cookie })).status,
    202,
    "start accepted",
  );

  let job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${origin}/api/jobs/${id}`, { headers: { Cookie: cookie } });
    job = await response.json();
    if (job.status === "done" || job.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(job.status, "done", "extraction finished");
  check(job.slides.length, 2, "both images became slides");
  // Natural order: slide-2 before slide-10, despite the string order.
  check(job.files[0].name, "slide-2.png", "first uploaded file recorded");

  const slide = await fetch(`${origin}/api/jobs/${id}/slides/1`, { headers: { Cookie: cookie } });
  check(slide.status, 200, "slide image served");
  check(slide.headers.get("content-type"), "image/png", "slide served as png");
  check(
    (await fetch(`${origin}/api/jobs/${id}/slides/99`, { headers: { Cookie: cookie } })).status,
    404,
    "unknown slide index rejected",
  );
  check(
    (await fetch(`${origin}/api/jobs/${id}/slides/..%2f..%2fjob`, { headers: { Cookie: cookie } }))
      .status,
    404,
    "slide index traversal rejected",
  );
  check(
    (await fetch(`${origin}/api/jobs/${id}/slides/1`)).status,
    401,
    "slide image checks session",
  );

  const removed = await fetch(`${origin}/api/jobs/${id}`, {
    method: "DELETE",
    headers: { Cookie: cookie, Origin: origin },
  });
  check(removed.status, 200, "job deleted");
  check(
    (await fetch(`${origin}/api/jobs/${id}`, { headers: { Cookie: cookie } })).status,
    404,
    "deleted job is gone",
  );
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
  await checkJobRoutes({ origin, cookie, post, check });

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
