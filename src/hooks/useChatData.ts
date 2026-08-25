"use client";

import { useCallback } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/client-api";
import { emitAck, getSocket } from "@/lib/socket";
import {
  appendOptimistic,
  mergeMessage,
  setOptimisticState,
  messagesKey,
} from "@/lib/message-cache";
import { messagePreviewFor } from "@/lib/preview";
import type {
  ClientMessage,
  ConversationDetailResponse,
  ConversationsResponse,
  MessagesResponse,
  PublicUserDTO,
} from "@/types";
import type { MessageDTO } from "@shared/types";

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const data = await api<ConversationsResponse>("/api/conversations");
      return data.conversations;
    },
  });
}

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      return api<MessagesResponse>(
        `/api/conversations/${conversationId}/messages?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    gcTime: 5 * 60_000,
    staleTime: 30_000,
  });
}

export interface SendMessageArgs {
  type: string;
  text?: string | null;
  replyToId?: string | null;
  attachmentId?: string | null;
  stickerId?: string | null;
  /** For optimistic rendering of media before the ack lands. */
  attachments?: MessageDTO["attachments"];
  replyTo?: MessageDTO | null;
}

export function useSendMessage(me: PublicUserDTO) {
  const queryClient = useQueryClient();

  const send = useCallback(
    async (conversationId: string, args: SendMessageArgs) => {
      const clientId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const temp: ClientMessage = {
        id: `temp-${clientId}`,
        clientId,
        conversationId,
        senderId: me.id,
        sender: { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null },
        type: args.type,
        text: args.text ?? null,
        replyTo: args.replyTo
          ? {
              id: args.replyTo.id,
              senderName: args.replyTo.sender.name,
              preview: messagePreviewFor(args.replyTo),
              type: args.replyTo.type,
            }
          : null,
        attachments: args.attachments ?? [],
        reactions: [],
        sticker: null,
        status: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      appendOptimistic(queryClient, conversationId, temp);

      // Wire payload shared by both the socket and REST paths.
      const payload = {
        clientId,
        conversationId,
        type: args.type,
        text: args.text ?? null,
        replyToId: args.replyToId ?? null,
        attachmentId: args.attachmentId ?? null,
        stickerId: args.stickerId ?? null,
      };

      let message: MessageDTO | null = null;
      let errorMsg: string | null = null;

      // Prefer the socket path when the socket is already connected (lower
      // latency — the user is also using it for receiving events). The 8s ack
      // timeout is short on purpose: if it slips we fall back to REST.
      const socket = getSocket();
      if (socket.connected) {
        type SendAck = { message: MessageDTO } | { error: string; code: string };
        const ack = await emitAck<SendAck>("message:send", payload, 8000);
        if (ack && "message" in ack && ack.message) {
          message = ack.message;
        } else if (ack && "error" in ack && ack.error) {
          errorMsg = ack.error;
        }
        // null / timeout → fall through to REST.
      }

      // REST fallback: socket wasn't connected, ack timed out, or socket
      // emitted an error. The REST route is idempotent on clientId (replays
      // return the existing message) and itself broadcasts via the socket
      // bridge, so we never lose real-time delivery. This is what stops the
      // "I sent a message and it's gone after logout/login" bug — REST
      // guarantees persistence regardless of the socket connection state.
      if (!message && !errorMsg) {
        try {
          const data = await api<{ message: MessageDTO }>(
            `/api/conversations/${conversationId}/messages`,
            { method: "POST", body: JSON.stringify(payload) },
          );
          message = data.message;
        } catch (err) {
          errorMsg =
            err instanceof ApiClientError ? err.message : "Failed to send message";
        }
      }

      if (message) {
        mergeMessage(queryClient, message);
        return;
      }

      setOptimisticState(queryClient, conversationId, clientId, {
        pending: false,
        failed: true,
      });
      if (errorMsg) toast.error(errorMsg);
    },
    [queryClient, me],
  );

  const retry = useCallback(
    async (message: ClientMessage, replyToId?: string | null, attachmentId?: string | null) => {
      if (!message.clientId) return;
      setOptimisticState(queryClient, message.conversationId, message.clientId, {
        pending: true,
        failed: false,
      });
      const payload = {
        clientId: message.clientId,
        conversationId: message.conversationId,
        type: message.type,
        text: message.text,
        replyToId: replyToId ?? null,
        attachmentId: attachmentId ?? null,
      };

      let result: MessageDTO | null = null;
      let errorMsg: string | null = null;
      const socket = getSocket();
      if (socket.connected) {
        type SendAck = { message: MessageDTO } | { error: string; code: string };
        const ack = await emitAck<SendAck>("message:send", payload, 8000);
        if (ack && "message" in ack && ack.message) result = ack.message;
        else if (ack && "error" in ack && ack.error) errorMsg = ack.error;
      }
      if (!result && !errorMsg) {
        try {
          const data = await api<{ message: MessageDTO }>(
            `/api/conversations/${message.conversationId}/messages`,
            { method: "POST", body: JSON.stringify(payload) },
          );
          result = data.message;
        } catch (err) {
          errorMsg =
            err instanceof ApiClientError ? err.message : "Failed to send message";
        }
      }

      if (result) {
        mergeMessage(queryClient, result);
        return;
      }
      setOptimisticState(queryClient, message.conversationId, message.clientId, {
        pending: false,
        failed: true,
      });
      if (errorMsg) toast.error(errorMsg);
    },
    [queryClient],
  );

  return { send, retry };
}

/** Fetches a window of messages around a message id (search jump). */
export function useHighlightFetch(conversationId: string | null, highlightId: string | null) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!conversationId || !highlightId) return;
    try {
      const res = await api<MessagesResponse>(
        `/api/conversations/${conversationId}/messages?highlight=${encodeURIComponent(highlightId)}&limit=20`,
      );
      queryClient.setQueryData(messagesKey(conversationId), {
        pages: [{ messages: res.messages, nextCursor: res.nextCursor }],
        pageParams: [null],
      });
    } catch {
      toast.error("Could not load the matched message");
    }
  }, [conversationId, highlightId, queryClient]);
}

export function useConversationDetail(conversationId: string | null) {
  return useQuery({
    queryKey: ["conversationDetail", conversationId],
    enabled: !!conversationId,
    queryFn: () =>
      api<ConversationDetailResponse>(`/api/conversations/${conversationId}`).then(
        (d) => d.conversation,
      ),
    staleTime: 60_000,
  });
}
