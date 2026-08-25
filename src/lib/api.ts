// Helpers shared by API routes: auth guard, JSON errors, client IP.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import type { PublicUserRow } from "@shared/dto";

export function jsonError(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

export function unauthorized(): NextResponse {
  return jsonError(401, "Unauthorized", "UNAUTHORIZED");
}

/** Wraps a handler so it only runs for authenticated users. */
export async function withUser(
  handler: (user: PublicUserRow) => Promise<NextResponse>,
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return handler(user);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests, please slow down", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
