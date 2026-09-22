import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/core";
export function proxy(request: NextRequest) {
  const secret=process.env.SESSION_SECRET ?? "";
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value,secret)) {
    const url=new URL("/sign-in",request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config={matcher:["/workspace/:path*"]};
