// DTO mappers + pure aggregation helpers shared by REST, socket service and tests.

import { Prisma } from "@prisma/client";
import { STATUS_RANK } from "./constants";
import { formatDuration } from "./format";
import type {
  AttachmentDTO,
  MessageDTO,
  MessageDeliveryStatus,
  PublicUserDTO,
  ReactionGroupDTO,
  StickerDTO,
} from "./types";

// ---------------------------------------------------------------------------
// Prisma include used everywhere a full message is loaded
// ---------------------------------------------------------------------------

export const messageInclude = {
  sender: { select: { id: true, name: true, avatarUrl: true } },
  attachments: true,
  reactions: { include: { user: { select: { id: true, name: true } } } },
  statuses: true,
  replyTo: { include: { sender: { select: { id: true, name: true } }, attachments: true } },
  sticker: { include: { pack: { select: { id: true, name: true } } } },
} satisfies Prisma.MessageInclude;

export type MessageFull = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  about: true,
  isOnline: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;

export type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/**
 * Aggregates per-recipient status rows into one status from the sender's
 * perspective. Worst-to-best: if every recipient READ -> READ, if every
 * recipient at least DELIVERED -> DELIVERED, otherwise SENT.
 * Returns null when the viewer is not the sender (ticks are not rendered).
 */
export function aggregateStatuses(
  statuses: { userId: string; status: string }[],
  senderId: string,
  viewerId: string,
): MessageDeliveryStatus {
  if (viewerId !== senderId) return null;
  const recipientRows = statuses.filter((s) => s.userId !== senderId);
  if (recipientRows.length === 0) return "SENT";
  let minRank = Infinity;
  for (const row of recipientRows) {
    const rank = STATUS_RANK[row.status];
    if (rank === undefined) continue;
    if (rank < minRank) minRank = rank;
  }
  if (!Number.isFinite(minRank)) return "SENT";
  if (minRank >= STATUS_RANK.READ) return "READ";
  if (minRank >= STATUS_RANK.DELIVERED) return "DELIVERED";
  return "SENT";
}

/** Groups reaction rows into display pill data. */
export function aggregateReactions(
  reactions: { emoji: string; userId: string; user?: { name: string } | null }[],
  viewerId: string,
): ReactionGroupDTO[] {
  const groups = new Map<string, ReactionGroupDTO>();
  for (const r of reactions) {
    const group = groups.get(r.emoji) ?? {
      emoji: r.emoji,
      users: [],
      count: 0,
      reactedByMe: false,
    };
    group.users.push(r.user?.name ?? "Someone");
    group.count += 1;
    if (r.userId === viewerId) group.reactedByMe = true;
    groups.set(r.emoji, group);
  }
  return Array.from(groups.values());
}

/**
 * Type-aware last-message preview (spec FR-03 AC2):
 * "📷 Photo", "🎤 Voice message (0:07)", "📄 report.pdf".
 */
export function messagePreview(
  type: string,
  text: string | null,
  attachments: { fileName: string; durationSec: number | null; mimeType?: string }[],
  deleted: boolean,
  stickerEmoji?: string | null,
): string {
  if (deleted) return "🚫 Message deleted";
  switch (type) {
    case "IMAGE":
      return text?.trim() ? `📷 Photo — ${truncate(text, 42)}` : "📷 Photo";
    case "VIDEO":
      return "📹 Video";
    case "AUDIO":
      return `🎤 Voice message (${formatDuration(attachments[0]?.durationSec ?? 0)})`;
    case "FILE":
      return `📄 ${truncate(attachments[0]?.fileName ?? "File", 42)}`;
    case "STICKER":
      return stickerEmoji ? `${stickerEmoji} Sticker` : "🏷️ Sticker";
    case "SYSTEM":
      return text ?? "";
    default:
      return truncate(text ?? "", 80);
  }
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function toPublicUser(user: {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  about?: string | null;
  isOnline?: boolean;
  lastSeenAt?: Date;
}): PublicUserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
    about: user.about ?? undefined,
    isOnline: user.isOnline ?? false,
    lastSeenAt: user.lastSeenAt?.toISOString(),
  };
}

export function toAttachmentDTO(a: {
  id: string;
  url: string;
  mimeType: string;
  size: number;
  fileName: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}): AttachmentDTO {
  return {
    id: a.id,
    url: a.url,
    mimeType: a.mimeType,
    size: a.size,
    fileName: a.fileName,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    thumbnailUrl: a.thumbnailUrl,
  };
}

/**
 * Maps a Sticker row + the absolute URL prefix into the client-side StickerDTO.
 * Bundled stickers live in /public/stickers/... and are served at /stickers/...;
 * uploaded and Telegram-imported stickers live under /uploads and are served
 * via /api/files/... (participant-only auth in production, auth-scoped by user
 * for personal library stickers).
 */
export function toStickerDTO(
  s: {
    id: string;
    packId: string;
    storageKey: string;
    mime: string;
    width: number;
    height: number;
    emoji: string | null;
    pack?: { id: string; name: string } | null;
  },
  packNameFallback?: string,
): StickerDTO {
  const isBundled = s.storageKey.startsWith("stickers/");
  return {
    id: s.id,
    packId: s.packId,
    packName: s.pack?.name ?? packNameFallback ?? "",
    storageKey: s.storageKey,
    url: isBundled ? `/${s.storageKey}` : `/api/files/${s.storageKey}`,
    mime: s.mime,
    width: s.width,
    height: s.height,
    emoji: s.emoji,
  };
}

export function toMessageDTO(m: MessageFull, viewerId: string): MessageDTO {
  const deleted = m.deletedAt !== null;
  const replyTo = m.replyTo
    ? {
        id: m.replyTo.id,
        senderName: m.replyTo.sender.name,
        preview: messagePreview(
          m.replyTo.type,
          m.replyTo.text,
          m.replyTo.attachments,
          m.replyTo.deletedAt !== null,
        ),
        type: m.replyTo.type,
      }
    : null;

  return {
    id: m.id,
    clientId: m.clientId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: m.sender,
    type: m.type,
    // Soft-deleted messages never leak their content.
    text: deleted ? null : m.text,
    replyTo,
    attachments: m.attachments.map(toAttachmentDTO),
    reactions: aggregateReactions(m.reactions, viewerId),
    sticker: m.sticker ? toStickerDTO(m.sticker) : null,
    status: aggregateStatuses(m.statuses, m.senderId, viewerId),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
