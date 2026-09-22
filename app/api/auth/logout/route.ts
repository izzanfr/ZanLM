import { NextResponse } from "next/server";
import { hasSession, sameOrigin } from "@/lib/auth/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/core";
import { en } from "@/lib/i18n/en";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({error:en.errors.forbidden},{status:403});
  const valid=await hasSession();
  const response=NextResponse.json(valid?{ok:true}:{error:en.errors.unauthorized},{status:valid?200:401,headers:{"Cache-Control":"no-store"}});
  response.cookies.set(SESSION_COOKIE,"",{...sessionCookieOptions(process.env.NODE_ENV === "production"),maxAge:0});
  return response;
}
