// Lists sticker packs visible to the requesting user:
//   - all BUNDLED packs (ownerId = null)
//   - all packs owned by the user (USER_UPLOAD or TELEGRAM_IMPORT)
// Sorted: bundled first (by slug), then personal packs (by createdAt desc).
// Stickers within each pack are ordered by sortOrder asc.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { toStickerDTO } from "@shared/dto";
import type { StickerPackDTO } from "@shared/types";

export async function GET(): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const packs = await db.stickerPack.findMany({
    where: {
      OR: [{ ownerId: null }, { ownerId: me.id }],
    },
    include: {
      stickers: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ ownerId: "asc" }, { slug: "asc" }],
  });

  const result: StickerPackDTO[] = packs.map((pack) => ({
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    source: pack.source,
    ownerId: pack.ownerId,
    coverStickerId: pack.coverStickerId,
    stickerCount: pack.stickers.length,
    createdAt: pack.createdAt.toISOString(),
    stickers: pack.stickers.map((s) => toStickerDTO(s, pack.name)),
  }));

  return NextResponse.json({ packs: result });
}
