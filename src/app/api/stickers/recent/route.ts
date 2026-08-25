// Returns the requesting user's most-recently-used stickers (up to 24).
// Sorted by lastUsedAt desc. The recent list is auto-populated on every
// sticker send (see shared/message-service.ts sendMessage).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { toStickerDTO } from "@shared/dto";
import { MAX_RECENT_STICKERS } from "@shared/constants";

export async function GET(): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const recent = await db.userStickerRecent.findMany({
    where: { userId: me.id },
    orderBy: { lastUsedAt: "desc" },
    take: MAX_RECENT_STICKERS,
    include: { sticker: { include: { pack: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json({
    stickers: recent.map((r) => toStickerDTO(r.sticker)),
  });
}
