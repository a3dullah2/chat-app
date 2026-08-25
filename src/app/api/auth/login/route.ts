import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, issueToken, setSessionCookie } from "@/lib/auth";
import { loginSchema, firstIssue } from "@shared/validation";
import { jsonError, clientIp, tooManyRequests } from "@/lib/api";
import { publicUserSelect, toPublicUser } from "@shared/dto";
import { loginLimiter } from "@shared/rate-limit";
import { RATE_LIMITS } from "@shared/constants";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  // Rate limit: 10 attempts / 15 min / IP.
  const rl = loginLimiter.check(
    `login:${clientIp(request)}`,
    RATE_LIMITS.login.limit,
    RATE_LIMITS.login.windowMs,
  );
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfterSec);
  }

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });

  // Non-enumerating error message (spec §7.2).
  const genericError = () => jsonError(401, "Invalid email or password", "INVALID_CREDENTIALS");

  if (!user) return genericError();
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return genericError();

  loginLimiter.reset(`login:${clientIp(request)}`);

  const token = issueToken({ id: user.id, email: user.email });
  await setSessionCookie(token);

  const publicUser = await db.user.findUnique({ where: { id: user.id }, select: publicUserSelect });
  return NextResponse.json({ user: toPublicUser(publicUser ?? user) });
}
