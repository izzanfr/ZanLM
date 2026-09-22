import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SESSION_COOKIE = "zanlm_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
const payloadSchema = z.object({version:z.literal(1), issued:z.number().int(), expires:z.number().int(), nonce:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export const loginSchema = z.object({code:z.string().min(1).max(512)}).strict();
export const authConfigSchema = z.object({accessCode:z.string().min(8).max(512),secret:z.string().min(32).max(4096)});
export function equalCode(input: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(input).digest(), createHash("sha256").update(expected).digest());
}
export function createSession(secret: string, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({version:1,issued,expires:issued+SESSION_SECONDS,nonce:randomBytes(16).toString("hex")})).toString("base64url");
  const signature = createHmac("sha256",secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token || token.length > 1024 || secret.length < 32) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const expected = createHmac("sha256",secret).update(parts[0]).digest("base64url");
  if (!timingSafeEqual(Buffer.from(expected),Buffer.from(parts[1]))) return false;
  try {
    const result = payloadSchema.safeParse(JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")));
    if (!result.success) return false;
    const {issued,expires} = result.data;
    const seconds = Math.floor(now/1000);
    return issued <= seconds && expires > seconds && expires-issued === SESSION_SECONDS;
  } catch { return false; }
}
export function sessionCookieOptions(production: boolean) {
  return {httpOnly:true, sameSite:"lax" as const, secure:production, path:"/", maxAge:SESSION_SECONDS};
}
export function isSameOrigin(origin: string | null, host: string | null, protocol: string, fetchSite: string | null): boolean {
  if (!origin || !host || fetchSite === "cross-site") return false;
  try {
    const url=new URL(origin);
    return url.origin === origin && url.host === host && url.protocol === protocol && ["http:","https:"].includes(protocol);
  } catch { return false; }
}

// A single bounded bucket is appropriate for this single-user loopback app.
// It deliberately ignores spoofable forwarded-IP headers. Restart clears it.
export function createLoginLimiter(limit = 10, windowMs = 60_000) {
  let start = 0; let attempts = 0;
  return (now = Date.now()) => {
    if (now-start >= windowMs) {start=now; attempts=0;}
    attempts += 1;
    return attempts <= limit;
  };
}
