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
 * Authorization: the attachment must be linked to a message in a conversation
 * the requester belongs to, or be an unattached file the requester uploaded.
 */
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const { path: segments } = await params;
  const storageKey = segments?.[0];
  if (!storageKey) return jsonError(404, "Not found", "NOT_FOUND");

  const attachment = await db.attachment.findUnique({ where: { storageKey } });
  if (!attachment) return jsonError(404, "Not found", "NOT_FOUND");

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

  const inlineTypes = ["image/", "video/", "audio/", "text/plain", "application/pdf"];
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
