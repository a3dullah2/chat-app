// Returns the requesting user's favorited stickers, newest-starred first.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { toStickerDTO } from "@shared/dto";

export async function GET(): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const favorites = await db.userStickerFavorite.findMany({
    where: { userId: me.id },
    orderBy: { starredAt: "desc" },
    include: { sticker: { include: { pack: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json({
    stickers: favorites.map((f) => toStickerDTO(f.sticker)),
  });
}
