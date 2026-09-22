import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth/server";
import { en } from "@/lib/i18n/en";
export async function GET() {
  if (!(await hasSession()))
    return NextResponse.json(
      { error: en.errors.unauthorized },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  return NextResponse.json(
    { stage: "foundation", conversionAvailable: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
