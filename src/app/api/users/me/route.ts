import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { updateProfileSchema, firstIssue } from "@shared/validation";
import { publicUserSelect, toPublicUser } from "@shared/dto";

export async function PATCH(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  const user = await db.user.update({
    where: { id: me.id },
    data: parsed.data,
    select: publicUserSelect,
  });
  return NextResponse.json({ user: toPublicUser(user) });
}
