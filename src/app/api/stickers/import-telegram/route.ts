// POST /api/stickers/import-telegram
// Body: { packLink: "https://t.me/addstickers/PackName" }
// Response: { packId, name, stickerCount, skipped, skippedReason }
//
// Imports a Telegram sticker pack into the user's personal library.
// Idempotent: if the user already imported this pack (by telegramName),
// returns the existing pack. Stickers > 500 KB are skipped with a reason.
// Stickers in formats we don't support (current set: webp/png/gif/lottie+json/webm)
// are skipped — currently all Telegram formats are supported.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, tooManyRequests } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { telegramImportSchema, firstIssue } from "@shared/validation";
import { StickerSource, STICKER_IMPORT_RATE_LIMIT } from "@shared/constants";
import {
  parsePackName,
  getStickerSet,
  downloadFile,
  persistStickerFile,
  TelegramImportError,
  type TelegramSticker,
} from "@/lib/stickers/telegram";
import { toStickerDTO } from "@shared/dto";
import { stickerImportLimiter } from "@shared/rate-limit";

const SUPPORTED_EXTS = new Set([".webp", ".png", ".gif", ".webm", ".json"]);

export async function POST(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = telegramImportSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  // Rate limit: 5 imports per hour per user.
  const rl = stickerImportLimiter.check(
    `tg-import:${me.id}`,
    STICKER_IMPORT_RATE_LIMIT.limit,
    STICKER_IMPORT_RATE_LIMIT.windowMs,
  );
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const packName = parsePackName(parsed.data.packLink);
  if (!packName) {
    return jsonError(422, "Could not parse pack name from link", "VALIDATION");
  }

  // Idempotency: if the user already imported this pack, return it as-is.
  const existing = await db.stickerPack.findFirst({
    where: { telegramName: packName, ownerId: me.id },
    include: { stickers: { orderBy: { sortOrder: "asc" } } },
  });
  if (existing) {
    return NextResponse.json({
      packId: existing.id,
      name: existing.name,
      stickerCount: existing.stickers.length,
      skipped: 0,
      skippedReason: null,
      stickers: existing.stickers.map((s) => toStickerDTO(s, existing.name)),
      alreadyImported: true,
    });
  }

  // Fetch the pack metadata.
  let packMeta;
  try {
    packMeta = await getStickerSet(packName);
  } catch (err) {
    if (err instanceof TelegramImportError) {
      const status = err.code === "TG_NOT_FOUND" ? 422 : 502;
      return jsonError(status, err.message, err.code);
    }
    throw err;
  }

  // Download each sticker and persist to /uploads.
  let skipped = 0;
  let skippedReason: string | null = null;
  const stickers: Array<{ storageKey: string; mime: string; width: number; height: number; emoji: string | null; sortOrder: number }> = [];
  let sortOrder = 0;
  for (const s of packMeta.stickers) {
    try {
      const downloaded = await downloadFile(s.fileId);
      if (!SUPPORTED_EXTS.has(downloaded.ext)) {
        skipped += 1;
        skippedReason = `Skipped ${skipped} unsupported sticker${skipped === 1 ? "" : "s"} (format ${downloaded.ext} not supported)`;
        continue;
      }
      const stored = await persistStickerFile(
        me.id,
        downloaded.buffer,
        downloaded.ext,
        s.width ?? null,
        s.height ?? null,
      );
      stickers.push({
        storageKey: stored.storageKey,
        mime: stored.mime,
        width: stored.width,
        height: stored.height,
        emoji: s.emoji ?? null,
        sortOrder: sortOrder++,
      });
    } catch (err) {
      skipped += 1;
      const reason = err instanceof TelegramImportError ? err.message : (err as Error).message;
      skippedReason = `Skipped ${skipped} sticker${skipped === 1 ? "" : "s"}: ${reason}`;
    }
  }

  if (stickers.length === 0) {
    return jsonError(
      422,
      `No stickers could be imported${skippedReason ? ` — ${skippedReason}` : ""}`,
      "NO_STICKERS_IMPORTED",
    );
  }

  // Persist the pack.
  const slug = `tg-${packName}-${me.id}`.slice(0, 60);
  const pack = await db.stickerPack.create({
    data: {
      slug,
      name: packMeta.title || packName,
      source: StickerSource.TELEGRAM_IMPORT,
      ownerId: me.id,
      telegramName: packName,
      stickers: { create: stickers },
    },
    include: { stickers: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  const firstSticker = pack.stickers[0];
  if (firstSticker) {
    await db.stickerPack.update({
      where: { id: pack.id },
      data: { coverStickerId: firstSticker.id },
    });
  }

  return NextResponse.json(
    {
      packId: pack.id,
      name: pack.name,
      stickerCount: stickers.length,
      skipped,
      skippedReason,
      alreadyImported: false,
    },
    { status: 201 },
  );
}
