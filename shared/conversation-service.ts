// Conversation business logic shared by REST routes and the socket mini-service.

import type { PrismaClient, Participant } from "@prisma/client";
import { ConversationType, MessageType, ParticipantRole } from "./constants";
import {
  messageInclude,
  messagePreview,
  publicUserSelect,
  toPublicUser,
  type MessageFull,
  type PublicUserRow,
} from "./dto";
import { createSystemMessage, type ServiceError } from "./message-service";
import type {
  ConversationDetailDTO,
  ConversationListItemDTO,
  LastMessagePreview,
  PublicUserDTO,
} from "./types";

function err(status: number, code: string, error: string): ServiceError {
  return { ok: false, status, code, error };
}

interface ConversationWithRelations {
  id: string;
  type: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  participants: { userId: string; role: string; joinedAt: Date; leftAt: Date | null; user: PublicUserRow }[];
  messages: MessageFull[];
}

const conversationInclude = {
  participants: {
    where: { leftAt: null },
    include: { user: { select: publicUserSelect } },
  },
  messages: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] as const,
    take: 1,
    include: messageInclude,
  },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

function toListItem(
  conversation: ConversationRow,
  viewerParticipant: Participant,
  unreadCount: number,
): ConversationListItemDTO {
  const others = conversation.participants.filter((p) => p.userId !== viewerParticipant.userId);
  const last = conversation.messages[0] ?? null;
  const lastMessage: LastMessagePreview | null = last
    ? {
        preview: messagePreview(
          last.type,
          last.type === MessageType.SYSTEM && last.text && last.senderId === viewerParticipant.userId
            ? personalizeSystemText(last.text, last.sender.name)
            : last.text,
          last.attachments,
          last.deletedAt !== null,
        ),
        type: last.type,
        senderId: last.senderId,
        senderName: last.sender.name,
        createdAt: last.createdAt.toISOString(),
      }
    : null;

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    avatarUrl: conversation.avatarUrl,
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessage,
    unreadCount,
    isPinned: viewerParticipant.isPinned,
    isMuted: viewerParticipant.isMuted,
    isArchived: viewerParticipant.isArchived,
    otherParticipant:
      conversation.type === ConversationType.DIRECT && others[0]
        ? toPublicUser(others[0].user)
        : null,
    participants: conversation.participants.map((p) => toPublicUser(p.user)),
  };
}

async function countUnread(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  since: Date,
): Promise<number> {
  return db.message.count({
    where: {
      conversationId,
      createdAt: { gt: since },
      senderId: { not: userId },
      deletedAt: null,
      type: { not: MessageType.SYSTEM },
      hiddenBy: { none: { userId } },
    },
  });
}

/** Personalizes system message text for the viewer ("You" instead of the actor name). */
export function personalizeSystemText(text: string, actorName: string): string {
  if (!actorName) return text;
  const quoted = `"${actorName}"`;
  if (text.startsWith(quoted)) return `You${text.slice(quoted.length)}`;
  if (text.startsWith(`${actorName} `)) return `You${text.slice(actorName.length)}`;
  return text;
}

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

export async function getConversationList(
  db: PrismaClient,
  userId: string,
): Promise<ConversationListItemDTO[]> {
  const viewer = await db.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
  if (!viewer) return [];

  const participations = await db.participant.findMany({
    where: { userId, leftAt: null },
    include: { conversation: { include: conversationInclude } },
  });

  const items = await Promise.all(
    participations.map(async (p) => {
      const unreadCount = await countUnread(db, userId, p.conversationId, p.lastReadAt);
      return toListItem(p.conversation, p, unreadCount);
    }),
  );

  items.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return items;
}

export async function getConversationDetail(
  db: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<{ ok: true; conversation: ConversationDetailDTO } | ServiceError> {
  const participant = await db.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  if (!participant) return err(404, "NOT_FOUND", "Conversation not found");
  if (participant.leftAt) return err(403, "FORBIDDEN", "You are no longer a participant of this conversation");

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      ...conversationInclude,
      createdBy: { select: { name: true } },
    },
  });
  if (!conversation) return err(404, "NOT_FOUND", "Conversation not found");

  // Re-fetch every participant (including those who left) for the detail view.
  const allParticipants = await db.participant.findMany({
    where: { conversationId },
    include: { user: { select: publicUserSelect } },
    orderBy: { joinedAt: "asc" },
  });

  const unreadCount = await countUnread(db, userId, conversationId, participant.lastReadAt);
  const base = toListItem(conversation as unknown as ConversationRow, participant, unreadCount);

  const detail: ConversationDetailDTO = {
    ...base,
    createdAt: conversation.createdAt.toISOString(),
    createdByName: conversation.createdBy?.name ?? null,
    participantDetails: allParticipants
      .filter((p) => !p.leftAt)
      .map((p) => ({
        userId: p.userId,
        role: p.role,
        joinedAt: p.joinedAt.toISOString(),
        user: toPublicUser(p.user),
      })),
    myRole: participant.role,
  };
  return { ok: true, conversation: detail };
}

/** Computes per-user list items for a single conversation (used for broadcasts). */
export async function conversationListItemsForUsers(
  db: PrismaClient,
  conversationId: string,
  userIds?: string[],
): Promise<{ userId: string; item: ConversationListItemDTO }[]> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!conversation) return [];

  let participants = conversation.participants.map((p) => p.userId);
  if (userIds) participants = participants.filter((id) => userIds.includes(id));

  const rows = await db.participant.findMany({
    where: { conversationId, userId: { in: participants }, leftAt: null },
  });

  return Promise.all(
    rows.map(async (p) => ({
      userId: p.userId,
      item: toListItem(conversation as unknown as ConversationRow, p, await countUnread(db, p.userId, conversationId, p.lastReadAt)),
    })),
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDirectConversation(
  db: PrismaClient,
  userId: string,
  otherUserId: string,
): Promise<{ ok: true; conversation: ConversationDetailDTO; created: boolean } | ServiceError> {
  if (userId === otherUserId) {
    return err(422, "VALIDATION", "You cannot start a conversation with yourself");
  }
  const other = await db.user.findUnique({ where: { id: otherUserId }, select: publicUserSelect });
  if (!other) return err(404, "NOT_FOUND", "User not found");

  const existing = await db.conversation.findFirst({
    where: {
      type: ConversationType.DIRECT,
      AND: [
        { participants: { some: { userId, leftAt: null } } },
        { participants: { some: { userId: otherUserId, leftAt: null } } },
      ],
    },
  });
  if (existing) {
    const detail = await getConversationDetail(db, userId, existing.id);
    if (detail.ok) return { ok: true, conversation: detail.conversation, created: false };
  }

  const conversation = await db.conversation.create({
    data: {
      type: ConversationType.DIRECT,
      createdById: userId,
      participants: {
        create: [
          { userId, role: ParticipantRole.MEMBER },
          { userId: otherUserId, role: ParticipantRole.MEMBER },
        ],
      },
    },
  });
  const detail = await getConversationDetail(db, userId, conversation.id);
  if (!detail.ok) return detail;
  return { ok: true, conversation: detail.conversation, created: true };
}

export async function createGroupConversation(
  db: PrismaClient,
  userId: string,
  name: string,
  participantIds: string[],
  avatarUrl?: string | null,
): Promise<{ ok: true; conversation: ConversationDetailDTO; systemMessage: MessageFull } | ServiceError> {
  const uniqueIds = Array.from(new Set(participantIds.filter((id) => id !== userId)));
  const users = await db.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true },
  });
  if (users.length !== uniqueIds.length) {
    return err(422, "VALIDATION", "Some participants do not exist");
  }

  const me = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!me) return err(401, "UNAUTHORIZED", "Unauthorized");

  const conversation = await db.conversation.create({
    data: {
      type: ConversationType.GROUP,
      name,
      avatarUrl: avatarUrl ?? null,
      createdById: userId,
      participants: {
        create: [
          { userId, role: ParticipantRole.OWNER },
          ...uniqueIds.map((id) => ({ userId: id, role: ParticipantRole.MEMBER })),
        ],
      },
    },
  });

  const systemMessage = await createSystemMessage(
    db,
    conversation.id,
    userId,
    `${me.name} created group "${name}"`,
  );
  const detail = await getConversationDetail(db, userId, conversation.id);
  if (!detail.ok) return detail;
  return { ok: true, conversation: detail.conversation, systemMessage };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface ConversationMutationResult {
  ok: true;
  conversation: ConversationDetailDTO;
  systemMessages: MessageFull[];
  /** Users that should receive a conversation:updated broadcast. */
  affectedUserIds: string[];
}

export async function updateConversation(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  patch: {
    name?: string;
    avatarUrl?: string | null;
    addParticipantIds?: string[];
    removeParticipantIds?: string[];
    isMuted?: boolean;
    isPinned?: boolean;
    isArchived?: boolean;
  },
): Promise<ConversationMutationResult | ServiceError> {
  const participant = await db.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  if (!participant) return err(404, "NOT_FOUND", "Conversation not found");
  if (participant.leftAt) return err(403, "FORBIDDEN", "You are no longer a participant");

  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return err(404, "NOT_FOUND", "Conversation not found");

  const me = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!me) return err(401, "UNAUTHORIZED", "Unauthorized");

  const isGroup = conversation.type === ConversationType.GROUP;
  const isAdmin = participant.role === ParticipantRole.OWNER || participant.role === ParticipantRole.ADMIN;
  const systemMessages: MessageFull[] = [];

  const mutatingGroupInfo =
    patch.name !== undefined || patch.avatarUrl !== undefined ||
    patch.addParticipantIds?.length || patch.removeParticipantIds?.length;

  if (mutatingGroupInfo) {
    if (!isGroup) return err(422, "VALIDATION", "Only group conversations support these changes");
    if (!isAdmin) return err(403, "FORBIDDEN", "Only group admins can perform this action");
  }

  // Participant-level flags (any member).
  const participantData: { isMuted?: boolean; isPinned?: boolean; isArchived?: boolean } = {};
  if (patch.isMuted !== undefined) participantData.isMuted = patch.isMuted;
  if (patch.isPinned !== undefined) participantData.isPinned = patch.isPinned;
  if (patch.isArchived !== undefined) participantData.isArchived = patch.isArchived;
  if (Object.keys(participantData).length > 0) {
    await db.participant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: participantData,
    });
  }

  if (patch.name !== undefined && patch.name !== conversation.name) {
    await db.conversation.update({ where: { id: conversationId }, data: { name: patch.name } });
    systemMessages.push(
      await createSystemMessage(db, conversationId, userId, `${me.name} changed the group name to "${patch.name}"`),
    );
  }

  if (patch.avatarUrl !== undefined) {
    await db.conversation.update({
      where: { id: conversationId },
      data: { avatarUrl: patch.avatarUrl },
    });
    systemMessages.push(
      await createSystemMessage(db, conversationId, userId, `${me.name} changed the group icon`),
    );
  }

  if (patch.addParticipantIds?.length) {
    const uniqueIds = Array.from(new Set(patch.addParticipantIds.filter((id) => id !== userId)));
    const users = await db.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true },
    });
    for (const user of users) {
      const existing = await db.participant.findUnique({
        where: { userId_conversationId: { userId: user.id, conversationId } },
      });
      if (existing && !existing.leftAt) continue; // already a member
      if (existing) {
        await db.participant.update({
          where: { id: existing.id },
          data: { leftAt: null, joinedAt: new Date() },
        });
      } else {
        await db.participant.create({
          data: { userId: user.id, conversationId, role: ParticipantRole.MEMBER },
        });
      }
      systemMessages.push(
        await createSystemMessage(db, conversationId, userId, `${me.name} added ${user.name}`),
      );
    }
  }

  if (patch.removeParticipantIds?.length) {
    const uniqueIds = Array.from(new Set(patch.removeParticipantIds));
    for (const targetId of uniqueIds) {
      if (targetId === userId) {
        return err(422, "VALIDATION", "Use leave conversation instead of removing yourself");
      }
      const target = await db.participant.findUnique({
        where: { userId_conversationId: { userId: targetId, conversationId } },
        include: { user: { select: { name: true } } },
      });
      if (!target || target.leftAt) continue;
      if (target.role === ParticipantRole.OWNER) {
        return err(403, "FORBIDDEN", "The group owner cannot be removed");
      }
      await db.participant.update({ where: { id: target.id }, data: { leftAt: new Date() } });
      systemMessages.push(
        await createSystemMessage(db, conversationId, userId, `${me.name} removed ${target.user.name}`),
      );
    }
  }

  const detail = await getConversationDetail(db, userId, conversationId);
  if (!detail.ok) return detail;

  const active = await db.participant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });
  return {
    ok: true,
    conversation: detail.conversation,
    systemMessages,
    affectedUserIds: active.map((p) => p.userId),
  };
}

export async function leaveConversation(
  db: PrismaClient,
  userId: string,
  conversationId: string,
): Promise<{ ok: true; systemMessages: MessageFull[]; deleted: boolean } | ServiceError> {
  const participant = await db.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  if (!participant) return err(404, "NOT_FOUND", "Conversation not found");
  if (participant.leftAt) return err(422, "VALIDATION", "You already left this conversation");

  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return err(404, "NOT_FOUND", "Conversation not found");
  if (conversation.type !== ConversationType.GROUP) {
    return err(422, "VALIDATION", "You can only leave group conversations");
  }

  const me = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!me) return err(401, "UNAUTHORIZED", "Unauthorized");

  const systemMessages: MessageFull[] = [];
  systemMessages.push(await createSystemMessage(db, conversationId, userId, `${me.name} left`));

  await db.participant.update({
    where: { id: participant.id },
    data: { leftAt: new Date() },
  });

  const remaining = await db.participant.findMany({
    where: { conversationId, leftAt: null },
    orderBy: { joinedAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  if (remaining.length === 0) {
    // Last member left: remove the empty group entirely (documented decision).
    await db.conversation.delete({ where: { id: conversationId } });
    return { ok: true, systemMessages, deleted: true };
  }

  if (participant.role === ParticipantRole.OWNER && remaining.length > 0) {
    // Ownership transfers to the earliest-joined remaining member (documented decision).
    const heir = remaining[0];
    const newRole =
      heir.role === ParticipantRole.ADMIN ? ParticipantRole.OWNER : ParticipantRole.OWNER;
    await db.participant.update({
      where: { id: heir.id },
      data: { role: newRole },
    });
    systemMessages.push(
      await createSystemMessage(db, conversationId, heir.userId, `${heir.user.name} is now the group owner`),
    );
  }

  return { ok: true, systemMessages, deleted: false };
}
