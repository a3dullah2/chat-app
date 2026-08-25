// POST  /api/stickers/<id>/favorite  → add to favorites
// DELETE /api/stickers/<id>/favorite  → remove from favorites
// Idempotent on both sides (POST twice is fine, DELETE on non-existing is 200).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const sticker = await db.sticker.findUnique({ where: { id } });
  if (!sticker) return jsonError(404, "Sticker not found", "NOT_FOUND");

  // Authorization: the user must be able to access the sticker's pack
  // (BUNDLED = everyone; otherwise owner-only). Mirrors sendMessage's check.
  const pack = await db.stickerPack.findUnique({
    where: { id: sticker.packId },
    select: { ownerId: true },
  });
  if (!pack) return jsonError(404, "Sticker not found", "NOT_FOUND");
  if (pack.ownerId !== null && pack.ownerId !== me.id) {
    return jsonError(403, "FORBIDDEN", "You do not have access to this sticker");
  }

  await db.userStickerFavorite.upsert({
    where: { userId_stickerId: { userId: me.id, stickerId: id } },
    create: { userId: me.id, stickerId: id },
    update: {},
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  await db.userStickerFavorite.deleteMany({
    where: { userId: me.id, stickerId: id },
  });

  return new NextResponse(null, { status: 204 });
}
