import "server-only";
import { cookies } from "next/headers";
import { authConfigSchema, isSameOrigin, SESSION_COOKIE, verifySession } from "./core";
export function authConfig() {
  const parsed = authConfigSchema.safeParse({
    accessCode: process.env.ACCESS_CODE,
    secret: process.env.SESSION_SECRET,
  });
  return parsed.success ? parsed.data : null;
}
export async function hasSession() {
  const config = authConfig();
  if (!config) return false;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, config.secret);
}
export function sameOrigin(request: Request) {
  // Next may normalize the internal URL hostname to localhost. Compare the
  // browser Origin with the actual Host, never a forwarded host supplied by clients.
  return isSameOrigin(
    request.headers.get("origin"),
    request.headers.get("host"),
    new URL(request.url).protocol,
    request.headers.get("sec-fetch-site"),
  );
}
