import { NextResponse } from "next/server";
import { authConfig, sameOrigin } from "@/lib/auth/server";
import {
  createLoginLimiter,
  createSession,
  equalCode,
  loginSchema,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/core";
import { en } from "@/lib/i18n/en";
const allowAttempt = createLoginLimiter();
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: en.errors.forbidden }, { status: 403 });
  if (!allowAttempt())
    return NextResponse.json(
      { error: en.login.rate },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  const config = authConfig();
  if (!config) return NextResponse.json({ error: en.login.unavailable }, { status: 503 });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json({ error: en.errors.invalidRequest }, { status: 415 });
  // Bound the actual stream as well as Content-Length (which clients can omit).
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: en.errors.invalidRequest }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return NextResponse.json({ error: en.errors.tooLarge }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = loginSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!body.success) return NextResponse.json({ error: en.login.invalid }, { status: 400 });
    if (!equalCode(body.data.code, config.accessCode))
      return NextResponse.json({ error: en.login.error }, { status: 401 });
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(
      SESSION_COOKIE,
      createSession(config.secret),
      sessionCookieOptions(process.env.NODE_ENV === "production"),
    );
    return response;
  } catch {
    return NextResponse.json({ error: en.errors.invalidRequest }, { status: 400 });
  }
}
