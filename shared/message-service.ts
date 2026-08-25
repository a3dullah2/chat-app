// Message business logic shared by REST routes and the socket mini-service.

import type { PrismaClient, Participant, Attachment } from "@prisma/client";
import {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
  EDIT_WINDOW_MS,
  MAX_RECENT_STICKERS,
  MessageDeliveryStatus,
  MessageType,
} from "./constants";
import { messageInclude, toMessageDTO, aggregateStatuses, type MessageFull } from "./dto";
import type { MessageDTO, SendMessageInput } from "./types";

export interface ServiceError {
  ok: false;
  status: number;
  code: string;
  error: string;
}

function err(status: number, code: string, error: string): ServiceError {
  return { ok: false, status, code, error };
}

export type SendMessageResult =
  | { ok: true; message: MessageFull; duplicate: boolean }
  | ServiceError;

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export async function assertParticipant(
  db: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<Participant | null> {
  return db.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
}

/** Returns the participant row only when membership is active (leftAt is null). */
export async function requireParticipant(
  db: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<{ ok: true; participant: Participant } | ServiceError> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conversation) {
    return err(404, "NOT_FOUND", "Conversation not found");
  }
  const participant = await assertParticipant(db, userId, conversationId);
  if (!participant || participant.leftAt) {
    // Existing resource the requester shouldn't see → 403 (spec §7.4).
    return err(403, "FORBIDDEN", "You are not a participant of this conversation");
  }
  return { ok: true, participant };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendMessage(
  db: PrismaClient,
  senderId: string,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const conv = await requireParticipant(db, senderId, input.conversationId);
  if (!conv.ok) return conv;

  // Idempotency on clientId (retry-safe duplicate suppression).
  if (input.clientId) {
    const existing = await db.message.findUnique({
      where: { clientId: input.clientId },
      include: messageInclude,
    });
    if (existing) {
      if (existing.senderId === senderId) {
        return { ok: true, message: existing, duplicate: true };
      }
      return err(409, "CONFLICT", "Message clientId already used");
    }
  }

  const text = input.text != null ? input.text : null;
  let attachment: Attachment | null = null;
  let stickerId: string | null = null;

  if (input.type === MessageType.TEXT) {
    if (!text || text.trim().length === 0) {
      return err(422, "VALIDATION", "Message text is required");
    }
  } else if (input.type === MessageType.STICKER) {
    // Sticker messages: validate the stickerId and that the sender can use it.
    // A sticker is accessible to the sender if the pack is BUNDLED (ownerId is
    // null) OR the pack is owned by this user (USER_UPLOAD / TELEGRAM_IMPORT).
    if (!input.stickerId) {
      return err(422, "VALIDATION", "stickerId is required for sticker messages");
    }
    const sticker = await db.sticker.findUnique({
      where: { id: input.stickerId },
      include: { pack: { select: { id: true, ownerId: true, source: true } } },
    });
    if (!sticker) return err(404, "NOT_FOUND", "Sticker not found");
    const isOwner = sticker.pack.ownerId === senderId;
    const isBundled = sticker.pack.ownerId === null;
    if (!isOwner && !isBundled) {
      return err(403, "FORBIDDEN", "You do not have access to this sticker");
    }
    stickerId = sticker.id;
  } else {
    if (!input.attachmentId) {
      return err(422, "VALIDATION", "attachmentId is required for media messages");
    }
    attachment = await db.attachment.findUnique({ where: { id: input.attachmentId } });
    if (!attachment) return err(404, "NOT_FOUND", "Attachment not found");
    if (attachment.uploadedById !== senderId) {
      return err(403, "FORBIDDEN", "Attachment does not belong to you");
    }
    if (attachment.messageId) {
      return err(409, "CONFLICT", "Attachment is already attached to a message");
    }
  }

  const otherParticipants = await db.participant.findMany({
    where: { conversationId: input.conversationId, userId: { not: senderId }, leftAt: null },
    select: { userId: true },
  });

  const created = await db.message.create({
    data: {
      clientId: input.clientId,
      conversationId: input.conversationId,
      senderId,
      type: input.type,
      text,
      replyToId: input.replyToId ?? null,
      stickerId,
      attachments: input.attachmentId ? { connect: { id: input.attachmentId } } : undefined,
      statuses: {
        create: otherParticipants.map((p) => ({ userId: p.userId, status: "SENT" })),
      },
    },
  });

  // Bump conversation for list ordering (spec §6 Conversation.updatedAt).
  await db.conversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });

  // For STICKER messages: maintain the per-user Recent list (capped at 24).
  if (stickerId) {
    await db.userStickerRecent.upsert({
      where: { userId_stickerId: { userId: senderId, stickerId } },
      create: { userId: senderId, stickerId },
      update: { lastUsedAt: new Date() },
    });
    const overflow = await db.userStickerRecent.findMany({
      where: { userId: senderId },
      orderBy: { lastUsedAt: "desc" },
      skip: MAX_RECENT_STICKERS,
      select: { stickerId: true },
    });
    if (overflow.length > 0) {
      await db.userStickerRecent.deleteMany({
        where: {
          userId: senderId,
          stickerId: { in: overflow.map((o) => o.stickerId) },
        },
      });
    }
  }

  const message = await db.message.findUnique({
    where: { id: created.id },
    include: messageInclude,
  });
  if (!message) return err(500, "INTERNAL", "Failed to load message");
  return { ok: true, message, duplicate: false };
}

export async function createSystemMessage(
  db: PrismaClient,
  conversationId: string,
  actorId: string,
  text: string,
): Promise<MessageFull> {
  const message = await db.message.create({
    data: {
      conversationId,
      senderId: actorId,
      type: MessageType.SYSTEM,
      text,
    },
    include: messageInclude,
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return message;
}

// ---------------------------------------------------------------------------
// Edit / delete
// ---------------------------------------------------------------------------

export async function editMessage(
  db: PrismaClient,
  userId: string,
  messageId: string,
  text: string,
): Promise<{ ok: true; message: MessageFull } | ServiceError> {
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message) return err(404, "NOT_FOUND", "Message not found");
  if (message.senderId !== userId) return err(403, "FORBIDDEN", "You can only edit your own messages");
  if (message.type !== MessageType.TEXT) return err(422, "VALIDATION", "Only text messages can be edited");
  if (message.deletedAt) return err(422, "VALIDATION", "Message was deleted");
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    return err(403, "FORBIDDEN", "Messages can only be edited within 15 minutes");
  }
  await db.message.update({ where: { id: messageId }, data: { text, editedAt: new Date() } });
  const updated = await db.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!updated) return err(500, "INTERNAL", "Failed to load message");
  return { ok: true, message: updated };
}

export async function deleteMessage(
  db: PrismaClient,
  userId: string,
  messageId: string,
  forEveryone: boolean,
): Promise<{ ok: true; message: MessageFull } | ServiceError> {
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message) return err(404, "NOT_FOUND", "Message not found");

  const membership = await assertParticipant(db, userId, message.conversationId);
  if (!membership || membership.leftAt) {
    return err(403, "FORBIDDEN", "Not a participant of this conversation");
  }

  if (forEveryone) {
    if (message.senderId !== userId) {
      return err(403, "FORBIDDEN", "You can only delete your own messages for everyone");
    }
    await db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), text: null },
    });
    const updated = await db.message.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!updated) return err(500, "INTERNAL", "Failed to load message");
    return { ok: true, message: updated };
  }

  // Delete for me: hide only for the requesting user.
  await db.hiddenMessage.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {},
  });
  const updated = await db.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!updated) return err(500, "INTERNAL", "Failed to load message");
  return { ok: true, message: updated };
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export async function toggleReaction(
  db: PrismaClient,
  userId: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: true; reactions: MessageDTO["reactions"] } | ServiceError> {
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message) return err(404, "NOT_FOUND", "Message not found");
  const membership = await assertParticipant(db, userId, message.conversationId);
  if (!membership || membership.leftAt) {
    return err(403, "FORBIDDEN", "Not a participant of this conversation");
  }
  if (message.deletedAt) return err(422, "VALIDATION", "Cannot react to a deleted message");

  const existing = await db.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
  });
  if (existing) {
    await db.reaction.delete({ where: { id: existing.id } });
  } else {
    await db.reaction.create({ data: { messageId, userId, emoji } });
  }
  const reactions = await db.reaction.findMany({
    where: { messageId },
    include: { user: { select: { id: true, name: true } } },
  });
  const { aggregateReactions } = await import("./dto");
  return { ok: true, reactions: aggregateReactions(reactions, userId) };
}

// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------

export interface StatusUpdate {
  messageId: string;
  status: string;
}

/** Marks a conversation read: bumps lastReadAt and advances MessageStatus rows to READ. */
export async function markConversationRead(
  db: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<{ ok: true; updates: StatusUpdate[] } | ServiceError> {
  const conv = await requireParticipant(db, userId, conversationId);
  if (!conv.ok) return conv;

  const now = new Date();
  await db.participant.update({
    where: { userId_conversationId: { userId, conversationId } },
    data: { lastReadAt: now },
  });

  const pendingRows = await db.messageStatus.findMany({
    where: {
      userId,
      status: { not: MessageDeliveryStatus.READ },
      message: { conversationId, senderId: { not: userId } },
    },
    select: { messageId: true },
  });
  const messageIds = Array.from(new Set(pendingRows.map((r) => r.messageId)));
  if (messageIds.length === 0) return { ok: true, updates: [] };

  await db.messageStatus.updateMany({
    where: { messageId: { in: messageIds }, userId },
    data: { status: MessageDeliveryStatus.READ },
  });

  const rows = await db.messageStatus.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, userId: true, status: true, message: { select: { senderId: true } } },
  });

  const byMessage = new Map<string, { userId: string; status: string }[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ userId: row.userId, status: row.status });
    byMessage.set(row.messageId, list);
  }

  const updates: StatusUpdate[] = [];
  for (const [messageId, statuses] of byMessage) {
    const senderId = rows.find((r) => r.messageId === messageId)!.message.senderId;
    const aggregated = aggregateStatuses(statuses, senderId, senderId);
    if (aggregated) updates.push({ messageId, status: aggregated });
  }
  return { ok: true, updates };
}

/** Advances status rows for online recipients to DELIVERED (server-side delivery detection). */
export async function markDelivered(
  db: PrismaClient,
  messageIds: string[],
  userIds: string[],
): Promise<StatusUpdate[]> {
  if (messageIds.length === 0 || userIds.length === 0) return [];
  await db.messageStatus.updateMany({
    where: {
      messageId: { in: messageIds },
      userId: { in: userIds },
      status: MessageDeliveryStatus.SENT,
    },
    data: { status: MessageDeliveryStatus.DELIVERED },
  });
  const rows = await db.messageStatus.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, userId: true, status: true, message: { select: { senderId: true } } },
  });
  const byMessage = new Map<string, { userId: string; status: string; senderId: string }[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ userId: row.userId, status: row.status, senderId: row.message.senderId });
    byMessage.set(row.messageId, list);
  }
  const updates: StatusUpdate[] = [];
  for (const [messageId, statuses] of byMessage) {
    const senderId = statuses[0]?.senderId ?? "";
    const aggregated = aggregateStatuses(
      statuses.map((s) => ({ userId: s.userId, status: s.status })),
      senderId,
      senderId,
    );
    if (aggregated) updates.push({ messageId, status: aggregated });
  }
  return updates;
}

// ---------------------------------------------------------------------------
// Listing / pagination
// ---------------------------------------------------------------------------

export interface ListMessagesResult {
  ok: true;
  messages: MessageFull[];
  nextCursor: string | null;
}

export async function listMessages(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  opts: { cursor?: string | null; limit?: number; highlight?: string | null },
): Promise<ListMessagesResult | ServiceError> {
  const conv = await requireParticipant(db, userId, conversationId);
  if (!conv.ok) return conv;

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, 1), MAX_MESSAGE_PAGE_SIZE);
  const baseWhere = {
    conversationId,
    hiddenBy: { none: { userId } },
  };

  if (opts.highlight) {
    const target = await db.message.findFirst({
      where: { ...baseWhere, id: opts.highlight },
    });
    if (!target) return err(404, "NOT_FOUND", "Message not found");

    const older = await db.message.findMany({
      where: {
        ...baseWhere,
        OR: [
          { createdAt: { lt: target.createdAt } },
          { createdAt: target.createdAt, id: { lt: target.id } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    const newer = await db.message.findMany({
      where: {
        ...baseWhere,
        OR: [
          { createdAt: { gt: target.createdAt } },
          { createdAt: target.createdAt, id: { gt: target.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit * 2,
    });
    const merged = [...older, target, ...newer]
      .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
      .sort((a, b) =>
        a.createdAt.getTime() === b.createdAt.getTime()
          ? a.id.localeCompare(b.id)
          : a.createdAt.getTime() - b.createdAt.getTime(),
      );
    const full = await loadFull(db, merged.map((m) => m.id));
    return { ok: true, messages: full, nextCursor: older.length >= limit ? older[older.length - 1].id : null };
  }

  let where = baseWhere;
  if (opts.cursor) {
    const cursorMsg = await db.message.findUnique({ where: { id: opts.cursor } });
    if (cursorMsg && cursorMsg.conversationId === conversationId) {
      where = {
        ...baseWhere,
        OR: [
          { createdAt: { lt: cursorMsg.createdAt } },
          { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } },
        ],
      };
    }
  }

  const rows = await db.message.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // API contract: messages are returned oldest-first (newest last).
  const full = await loadFull(db, page.slice().reverse().map((m) => m.id));
  return { ok: true, messages: full, nextCursor: hasMore ? page[page.length - 1].id : null };
}

async function loadFull(db: PrismaClient, ids: string[]): Promise<MessageFull[]> {
  if (ids.length === 0) return [];
  const rows = await db.message.findMany({
    where: { id: { in: ids } },
    include: messageInclude,
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchMessages(
  db: PrismaClient,
  userId: string,
  q: string,
): Promise<
  {
    conversationId: string;
    matchCount: number;
    firstMatchMessageId: string;
    preview: string;
  }[]
> {
  const messages = await db.message.findMany({
    where: {
      text: { contains: q },
      deletedAt: null,
      hiddenBy: { none: { userId } },
      conversation: { participants: { some: { userId, leftAt: null } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, conversationId: true, text: true, createdAt: true },
  });
  const grouped = new Map<string, { count: number; first: (typeof messages)[number] }>();
  for (const m of messages) {
    const entry = grouped.get(m.conversationId);
    if (entry) entry.count += 1;
    else grouped.set(m.conversationId, { count: 1, first: m });
  }
  return Array.from(grouped.entries()).map(([conversationId, g]) => ({
    conversationId,
    matchCount: g.count,
    firstMatchMessageId: g.first.id,
    preview: g.first.text ?? "",
  }));
}

// ---------------------------------------------------------------------------
// DTO helper
// ---------------------------------------------------------------------------

export function toDTOFor(message: MessageFull, viewerId: string): MessageDTO {
  return toMessageDTO(message, viewerId);
}
