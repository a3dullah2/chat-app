import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, tooManyRequests } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { saveUpload, UploadError } from "@/lib/upload";
import { uploadLimiter } from "@shared/rate-limit";
import { RATE_LIMITS, AVATAR_MIME_TYPES } from "@shared/constants";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  // Rate limit: ≤ 10 uploads / min / user.
  const rl = uploadLimiter.check(`upload:${me.id}`, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs);
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfterSec);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Expected multipart/form-data", "BAD_REQUEST");
  }

  const file = form.get("file");
  const isAvatar = form.get("kind") === "avatar";
  if (!(file instanceof File)) {
    return jsonError(422, "Missing file field", "VALIDATION");
  }
  if (isAvatar && !AVATAR_MIME_TYPES.has(file.type)) {
    return jsonError(422, "Avatars must be PNG, JPG, WEBP or GIF images", "BAD_MIME");
  }

  try {
    const stored = await saveUpload(file);
    // Voice notes carry their recorded duration (FR-05 AC3).
    const durationRaw = form.get("durationSec");
    const durationSec =
      typeof durationRaw === "string" && /^\d+$/.test(durationRaw) && Number(durationRaw) > 0
        ? Math.min(Number(durationRaw), 3600)
        : null;

    // Attachments are created unattached and linked when a message is sent.
    const attachment = await db.attachment.create({
      data: {
        uploadedById: me.id,
        storageKey: stored.storageKey,
        url: stored.url,
        mimeType: stored.mimeType,
        size: stored.size,
        fileName: stored.fileName,
        width: stored.width,
        height: stored.height,
        thumbnailUrl: stored.thumbnailUrl,
        durationSec,
      },
    });
    return NextResponse.json(
      {
        attachment: {
          id: attachment.id,
          url: attachment.url,
          mimeType: attachment.mimeType,
          size: attachment.size,
          fileName: attachment.fileName,
          width: attachment.width,
          height: attachment.height,
          durationSec: attachment.durationSec,
          thumbnailUrl: attachment.thumbnailUrl,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UploadError) {
      const status = error.code === "TOO_LARGE" ? 413 : 415;
      return jsonError(status, error.message, error.code);
    }
    console.error("[upload] failed:", error);
    return jsonError(500, "Upload failed", "INTERNAL");
  }
}
