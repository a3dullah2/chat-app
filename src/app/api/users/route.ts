import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { usersSearchSchema, firstIssue } from "@shared/validation";
import { publicUserSelect, toPublicUser } from "@shared/dto";

export async function GET(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const search = new URL(request.url).searchParams.get("search") ?? "";
  const parsed = usersSearchSchema.safeParse({ search });
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  const users = await db.user.findMany({
    where: {
      id: { not: me.id },
      OR: [
        { name: { contains: parsed.data.search } },
        { email: { contains: parsed.data.search } },
      ],
    },
    select: publicUserSelect,
    take: 20,
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users: users.map(toPublicUser) });
}
