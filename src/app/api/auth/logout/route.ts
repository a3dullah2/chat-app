import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(): Promise<NextResponse> {
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}
