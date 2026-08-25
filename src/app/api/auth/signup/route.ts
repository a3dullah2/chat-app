import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, issueToken, setSessionCookie } from "@/lib/auth";
import { signupSchema, firstIssue } from "@shared/validation";
import { jsonError } from "@/lib/api";
import { publicUserSelect, toPublicUser } from "@shared/dto";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }
  const { name, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return jsonError(422, "An account with this email already exists", "EMAIL_TAKEN");
  }

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: { name, email, passwordHash },
    select: publicUserSelect,
  });

  const token = issueToken({ id: user.id, email: user.email ?? email });
  await setSessionCookie(token);
  return NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
}
