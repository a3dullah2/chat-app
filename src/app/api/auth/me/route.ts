import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { toPublicUser } from "@shared/dto";

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({ user: toPublicUser(user) });
}
