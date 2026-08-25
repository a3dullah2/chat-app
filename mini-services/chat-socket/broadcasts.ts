// Broadcast helpers: every mutation (via socket handlers or the REST bridge)
// funnels through here so connected clients stay in sync.

import type { Server } from "socket.io";
import { db } from "./db";
import { messageInclude, toMessageDTO, aggregateReactions, type MessageFull } from "../../shared/dto";
import { markDelivered, type StatusUpdate } from "../../shared/message-service";
import { conversationListItemsForUsers } from "../../shared/conversation-service";
import { personalizeSystemText } from "../../shared/conversation-service";
import { MessageType } from "../../shared/constants";
import type { MessageDTO } from "../../shared/types";

/** Online presence: userId -> set of socket ids (kept in sync by index.ts). */
export const presence = new Map<string, Set<string>>();

export function isUserOnline(userId: string): boolean {
  return (presence.get(userId)?.size ?? 0) > 0;
}

async function activeParticipantIds(conversationId: string): Promise<string[]> {
  const rows = await db.participant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

function personalizeMessage(dto: MessageDTO, message: MessageFull, viewerId: string): MessageDTO {
  if (message.type === MessageType.SYSTEM && dto.text && message.senderId === viewerId) {
    return { ...dto, text: personalizeSystemText(dto.text, message.sender.name) };
  }
  return dto;
}

/** Emits an event to every active participant, personalized per user. */
export async function emitToParticipants(
  io: Server,
  conversationId: string,
  event: string,
  build: (userId: string) => unknown,
  exceptUserIds: string[] = [],
): Promise<void> {
  const participants = await activeParticipantIds(conversationId);
  for (const userId of participants) {
    if (exceptUserIds.includes(userId)) continue;
    io.to(`user:${userId}`).emit(event, build(userId));
  }
}

/**
 * Full "new message" fan-out:
 * 1. message:new to all participants (personalized DTO) — SKIPPED for
 *    duplicate sends (recipients already have the message)
 * 2. delivery marking for online recipients -> message:status
 * 3. conversation:updated to all participants (list reorder + unread badge)
 * 4. message:ack to the sender's tabs (optimistic reconcile) — always sent,
 *    even for duplicates (the sender's ack may have been lost in transit,
 *    which is the most common reason for a duplicate send)
 *
 * `isDuplicate`: this is a replayed send (same clientId). Skip the message:new
 * broadcast and the delivery marking; only re-send the ack so the sender can
 * reconcile its optimistic UI.
 */
export async function handleNewMessage(
  io: Server,
  message: MessageFull,
  opts: { skipDelivery?: boolean; isDuplicate?: boolean } = {},
): Promise<void> {
  if (!opts.isDuplicate) {
    await emitToParticipants(io, message.conversationId, "message:new", (userId) =>
      personalizeMessage(toMessageDTO(message, userId), message, userId),
    );

    if (!opts.skipDelivery) {
      const participants = await activeParticipantIds(message.conversationId);
      const onlineRecipients = participants.filter(
        (id) => id !== message.senderId && isUserOnline(id),
      );
      if (onlineRecipients.length > 0) {
        const updates = await markDelivered(db, [message.id], onlineRecipients);
        if (updates.length > 0) {
          emitStatusUpdate(io, message.conversationId, updates);
        }
      }
    }

    await emitConversationUpdated(io, message.conversationId);
  }

  // The ack is always emitted, even for duplicates — the sender retries
  // specifically because the ack didn't arrive.
  if (message.clientId) {
    io.to(`user:${message.senderId}`).emit("message:ack", {
      clientId: message.clientId,
      message: personalizeMessage(toMessageDTO(message, message.senderId), message, message.senderId),
    });
  }
}

export async function handleMessageUpdated(io: Server, message: MessageFull): Promise<void> {
  await emitToParticipants(io, message.conversationId, "message:updated", (userId) =>
    personalizeMessage(toMessageDTO(message, userId), message, userId),
  );
}

export async function emitReactionUpdate(io: Server, messageId: string): Promise<void> {
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message) return;
  const reactions = await db.reaction.findMany({
    where: { messageId },
    include: { user: { select: { id: true, name: true } } },
  });
  await emitToParticipants(io, message.conversationId, "reaction:update", (userId) => ({
    messageId,
    conversationId: message.conversationId,
    reactions: aggregateReactions(reactions, userId),
  }));
}

export function emitStatusUpdate(io: Server, conversationId: string, updates: StatusUpdate[]): void {
  if (updates.length === 0) return;
  io.to(`conversation:${conversationId}`).emit("message:status", {
    conversationId,
    updates,
  });
}

export async function emitConversationUpdated(
  io: Server,
  conversationId: string,
  userIds?: string[],
): Promise<void> {
  const items = await conversationListItemsForUsers(db, conversationId, userIds);
  for (const { userId, item } of items) {
    io.to(`user:${userId}`).emit("conversation:updated", { conversation: item });
  }
}

export async function loadMessage(messageId: string): Promise<MessageFull | null> {
  return db.message.findUnique({ where: { id: messageId }, include: messageInclude });
}

/** Broadcasts presence changes to everyone sharing a conversation with the user. */
export async function broadcastPresence(io: Server, userId: string, isOnline: boolean): Promise<void> {
  const lastSeenAt = new Date().toISOString();
  const convs = await db.participant.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });
  const conversationIds = convs.map((c) => c.conversationId);
  if (conversationIds.length === 0) return;
  const contacts = await db.participant.findMany({
    where: { conversationId: { in: conversationIds }, userId: { not: userId }, leftAt: null },
    select: { userId: true },
    distinct: ["userId"],
  });
  const targets = [...contacts.map((c) => c.userId), userId];
  for (const target of targets) {
    io.to(`user:${target}`).emit("presence:update", { userId, isOnline, lastSeenAt });
  }
}
