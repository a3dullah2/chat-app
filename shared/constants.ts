// Shared constants used by both the Next.js app and the socket mini-service.

export const ConversationType = {
  DIRECT: "DIRECT",
  GROUP: "GROUP",
} as const;
export type ConversationTypeValue = (typeof ConversationType)[keyof typeof ConversationType];

export const ParticipantRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;
export type ParticipantRoleValue = (typeof ParticipantRole)[keyof typeof ParticipantRole];

export const MessageType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
  FILE: "FILE",
  SYSTEM: "SYSTEM",
  STICKER: "STICKER",
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export const StickerSource = {
  BUNDLED: "BUNDLED",
  TELEGRAM_IMPORT: "TELEGRAM_IMPORT",
  USER_UPLOAD: "USER_UPLOAD",
} as const;
export type StickerSourceValue = (typeof StickerSource)[keyof typeof StickerSource];

/** MIME types supported for stickers. Lottie is stored as decompressed JSON. */
export const STICKER_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/webp",
  "image/png",
  "image/gif",
  "application/lottie+json",
]);

/** Hard cap on sticker file size (bytes). Telegram imports skip oversized files. */
export const MAX_STICKER_SIZE_BYTES = 512 * 1024; // 500 KB

/** Telegram pack link parser — accepts t.me/addstickers/<name> and telegram.me/addstickers/<name>. */
export const TELEGRAM_PACK_LINK_RE = /^https?:\/\/(?:t\.me|telegram\.me)\/addstickers\/([A-Za-z0-9_]+)$/;

/** Maximum stickers kept in a user's Recent list. New ones bump the oldest out. */
export const MAX_RECENT_STICKERS = 24;

/** Rate limit for Telegram pack imports: 5 per hour per user. */
export const STICKER_IMPORT_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

export const MessageDeliveryStatus = {
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
} as const;
export type MessageDeliveryStatusValue =
  (typeof MessageDeliveryStatus)[keyof typeof MessageDeliveryStatus];

/** Status rank for worst-to-best aggregation (SENT < DELIVERED < READ). */
export const STATUS_RANK: Record<string, number> = {
  SENT: 0,
  DELIVERED: 1,
  READ: 2,
};

export const MAX_TEXT_LENGTH = 4096;
export const DEFAULT_MESSAGE_PAGE_SIZE = 30;
export const MAX_MESSAGE_PAGE_SIZE = 100;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const TYPING_TIMEOUT_MS = 5000;
export const TYPING_THROTTLE_MS = 1500;
export const JWT_COOKIE = "chat_token";
export const JWT_EXPIRY_SECONDS = 24 * 60 * 60;

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  message: { limit: 20, windowMs: 10 * 1000 },
  upload: { limit: 10, windowMs: 60 * 1000 },
} as const;

export const DEFAULT_MAX_UPLOAD_MB = 25;

export function getMaxUploadMb(): number {
  const parsed = Number(process.env.MAX_UPLOAD_MB);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB;
}

/** MIME whitelist for uploads (spec §7.6). */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/zip",
  "application/json",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "application/json": ".json",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

/** Maps a MIME type to a safe extension; falls back to the sanitized client filename. */
export function safeExtension(mimeType: string, fileName: string): string {
  const known = MIME_TO_EXT[mimeType];
  if (known) return known;
  const ext = fileName.match(/\.[A-Za-z0-9]{1,8}$/)?.[0];
  return ext && /^\.?[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : "";
}

/** Strips path separators / unsafe characters from a client-provided filename. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim();
  return (cleaned || "file").slice(0, 180);
}

export const AVATAR_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
