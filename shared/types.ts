// Shared DTO types used by the REST API, the socket service and the client.

export interface PublicUserDTO {
  id: string;
  name: string;
  email?: string;
  phone?: string | null;
  avatarUrl: string | null;
  about?: string;
  isOnline?: boolean;
  lastSeenAt?: string;
}

export interface AttachmentDTO {
  id: string;
  url: string;
  mimeType: string;
  size: number;
  fileName: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}

export interface ReactionGroupDTO {
  emoji: string;
  users: string[]; // display names
  count: number;
  reactedByMe: boolean;
}

export type MessageDeliveryStatus = "SENT" | "DELIVERED" | "READ" | null;

export interface ReplyPreviewDTO {
  id: string;
  senderName: string;
  preview: string;
  type: string;
}

export interface MessageDTO {
  id: string;
  clientId: string | null;
  conversationId: string;
  senderId: string;
  sender: { id: string; name: string; avatarUrl: string | null };
  type: string; // MessageTypeValue
  text: string | null;
  replyTo: ReplyPreviewDTO | null;
  attachments: AttachmentDTO[];
  reactions: ReactionGroupDTO[];
  /** Aggregated delivery status from the current user's (sender's) perspective. */
  status: MessageDeliveryStatus;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ParticipantDTO {
  userId: string;
  role: string; // ParticipantRoleValue
  joinedAt: string;
  user: PublicUserDTO;
}

export interface LastMessagePreview {
  preview: string;
  type: string;
  senderId: string;
  senderName: string;
  createdAt: string;
}

export interface ConversationListItemDTO {
  id: string;
  type: string; // ConversationTypeValue
  name: string | null;
  avatarUrl: string | null;
  updatedAt: string;
  lastMessage: LastMessagePreview | null;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  otherParticipant: PublicUserDTO | null;
  participants: PublicUserDTO[];
}

export interface ConversationDetailDTO extends ConversationListItemDTO {
  createdAt: string;
  createdByName: string | null;
  participantDetails: ParticipantDTO[];
  myRole: string;
}

export interface SearchMessagesResultDTO {
  conversationId: string;
  conversationTitle: string;
  conversationType: string;
  avatarUrl: string | null;
  otherParticipantName: string | null;
  matchCount: number;
  firstMatchMessageId: string;
  preview: string;
}

export interface SendMessageInput {
  clientId: string;
  conversationId: string;
  type: string;
  text?: string | null;
  replyToId?: string | null;
  attachmentId?: string | null;
}

/** Error shape returned by every REST endpoint (spec §8). */
export interface ApiError {
  error: string;
  code: string;
}

export interface SocketUserPayload {
  userId: string;
}
