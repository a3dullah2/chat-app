import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { readStoredFile } from "@/lib/upload";
import { assertParticipant } from "@shared/message-service";

type Params = { params: Promise<{ path: string[] }> };

/**
 * Serves uploaded files only to conversation participants (spec §7.6):
 * /api/files/<storageKey>[?thumb=1]
 *
 * Authorization paths:
 *  1. Attachment linked to a message — must be a participant of that conversation.
 *  2. Attachment uploaded by the requester but not yet linked — owner only.
 *  3. Sticker row — accessible to anyone who can either:
 *       a) own the sticker's pack (USER_UPLOAD / TELEGRAM_IMPORT), or
 *       b) receive a message that references this sticker (so recipients can
 *          render stickers sent to them by other users).
 *     Bundled stickers (ownerId = null) live in /public and never reach this
 *     route, but if they did, they'd be authorized by the ownerId-null branch.
 */
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const { path: segments } = await params;
  const storageKey = segments?.[0];
  if (!storageKey) return jsonError(404, "Not found", "NOT_FOUND");

  const attachment = await db.attachment.findUnique({ where: { storageKey } });

  // -------- Attachment path --------
  if (attachment) {
    let authorized = false;
    if (attachment.messageId) {
      const message = await db.message.findUnique({
        where: { id: attachment.messageId },
        select: { conversationId: true },
      });
      if (message) {
        const participant = await assertParticipant(db, me.id, message.conversationId);
        authorized = !!participant && !participant.leftAt;
      }
    } else if (attachment.uploadedById === me.id) {
      authorized = true;
    }
    if (!authorized) return jsonError(403, "Forbidden", "FORBIDDEN");

    const wantThumb = new URL(request.url).searchParams.get("thumb") === "1";
    const buffer = await readStoredFile(storageKey, wantThumb);
    if (!buffer) return jsonError(404, "Not found", "NOT_FOUND");

    const mimeType = wantThumb && attachment.thumbnailUrl
      ? "image/webp"
      : attachment.mimeType;
    const inlineTypes = ["image/", "video/", "audio/", "text/plain", "application/pdf", "application/lottie+json"];
    const disposition = inlineTypes.some((t) => mimeType.startsWith(t)) ? "inline" : "attachment";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-length": String(buffer.length),
        "content-disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  }

  // -------- Sticker path --------
  const sticker = await db.sticker.findUnique({
    where: { storageKey },
    include: { pack: { select: { id: true, ownerId: true } } },
  });
  if (!sticker) return jsonError(404, "Not found", "NOT_FOUND");

  // Authorization: bundled → open; personal → owner or message recipient.
  let stickerAuthorized = sticker.pack.ownerId === null;
  if (!stickerAuthorized && sticker.pack.ownerId === me.id) {
    stickerAuthorized = true;
  }
  if (!stickerAuthorized) {
    // Is this sticker referenced by a message in a conversation the user is in?
    const ref = await db.message.findFirst({
      where: { stickerId: sticker.id, conversation: { participants: { some: { userId: me.id, leftAt: null } } } },
      select: { id: true },
    });
    if (ref) stickerAuthorized = true;
  }
  if (!stickerAuthorized) return jsonError(403, "Forbidden", "FORBIDDEN");

  const buffer = await readStoredFile(storageKey);
  if (!buffer) return jsonError(404, "Not found", "NOT_FOUND");

  const inlineTypes = ["image/", "video/", "application/lottie+json"];
  const disposition = inlineTypes.some((t) => sticker.mime.startsWith(t)) ? "inline" : "attachment";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": sticker.mime,
      "content-length": String(buffer.length),
      "content-disposition": `${disposition}; filename="sticker.${sticker.mime === "image/webp" ? "webp" : sticker.mime === "image/gif" ? "gif" : sticker.mime === "image/png" ? "png" : "json"}"`,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
