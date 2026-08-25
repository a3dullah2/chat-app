// Client-side types (server DTOs + client-only UI states).

import type {
  AttachmentDTO,
  ConversationDetailDTO,
  ConversationListItemDTO,
  MessageDTO,
  PublicUserDTO,
  ReactionGroupDTO,
  SearchMessagesResultDTO,
} from "@shared/types";

export type {
  AttachmentDTO,
  ConversationDetailDTO,
  ConversationListItemDTO,
  MessageDTO,
  PublicUserDTO,
  ReactionGroupDTO,
  SearchMessagesResultDTO,
};

/** A message with optimistic-send UI state. */
export interface ClientMessage extends MessageDTO {
  pending?: boolean;
  failed?: boolean;
}

/** Attachment being uploaded (progress UI in the composer). */
export interface PendingAttachment {
  localId: string;
  fileName: string;
  mimeType: string;
  size: number;
  progress: number; // 0-100
  attachmentId?: string; // set once uploaded
  previewUrl?: string; // local object URL for image previews
  error?: string;
}

export interface SearchResponse {
  results: SearchMessagesResultDTO[];
}

export interface UsersResponse {
  users: PublicUserDTO[];
}

export interface ConversationsResponse {
  conversations: ConversationListItemDTO[];
}

export interface MessagesResponse {
  messages: MessageDTO[];
  nextCursor: string | null;
}

export interface ConversationDetailResponse {
  conversation: ConversationDetailDTO;
  messages: MessageDTO[];
  nextCursor: string | null;
}

export interface UploadResponse {
  attachment: {
    id: string;
    url: string;
    mimeType: string;
    size: number;
    fileName: string;
    width?: number | null;
    height?: number | null;
    thumbnailUrl?: string | null;
  };
}
