// Central socket event wiring: cache updates, presence, typing, notifications.

"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MessageDTO, ConversationListItemDTO, PublicUserDTO } from "@shared/types";
import { getSocket, destroySocket } from "@/lib/socket";
import {
  mergeMessage,
  removeMessage,
  patchMessage,
  patchReactions,
  messagesKey,
  type MessagesCache,
} from "@/lib/message-cache";
import { useUIStore } from "@/stores/ui-store";
import { useConnectionStore, usePresenceStore, useTypingStore } from "@/stores/realtime-stores";
import { messagePreviewFor } from "@/lib/preview";

type NewMessagePayload = MessageDTO;

export function useSocketEvents(me: PublicUserDTO): void {
  const queryClient = useQueryClient();
  const meRef = useRef(me);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    const socket = getSocket();
    const ui = useUIStore.getState;

    // ------------------------------------------------------------------
    // Connection lifecycle
    // ------------------------------------------------------------------
    const onConnect = () => {
      useConnectionStore.getState().setConnected(true);
      // Reconnect flow: refetch conversations + active conversation messages
      // (REST is the source of truth — never trust socket replay only).
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      const activeId = ui().activeConversationId;
      if (activeId) {
        queryClient.invalidateQueries({ queryKey: ["messages", activeId] });
      }
    };
    const onDisconnect = () => {
      useConnectionStore.getState().setConnected(false);
    };

    // ------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------
    let readSweepTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReadSweep = (conversationId: string) => {
      if (readSweepTimer) clearTimeout(readSweepTimer);
      readSweepTimer = setTimeout(() => {
        getSocket().emit("message:read", { conversationId });
      }, 350);
    };

    const onNewMessage = (dto: NewMessagePayload) => {
      mergeMessage(queryClient, dto);

      // Sender stopped typing once their message lands.
      useTypingStore.getState().setTyping(dto.conversationId, dto.senderId, dto.sender.name, false);

      const active = ui().activeConversationId;
      const isActive = active === dto.conversationId;
      const focused = typeof document !== "undefined" && document.hasFocus() && !document.hidden;

      if (isActive && focused) {
        scheduleReadSweep(dto.conversationId);
        return;
      }

      // Notification rules (FR-10): skip own + muted conversations.
      if (dto.senderId === meRef.current.id || dto.type === "SYSTEM") return;
      const conversations = queryClient.getQueryData<ConversationListItemDTO[]>(["conversations"]);
      const conv = conversations?.find((c) => c.id === dto.conversationId);
      if (conv?.isMuted) return;

      const preview = messagePreviewFor(dto);
      const title =
        conv?.type === "GROUP" ? `${dto.sender.name} · ${conv.name ?? "Group"}` : dto.sender.name;

      toast(title, {
        description: preview,
        duration: 4000,
        onDismiss: () => undefined,
        action: {
          label: "Open",
          onClick: () => ui().openConversation(dto.conversationId),
        },
      });

      if (
        typeof document !== "undefined" &&
        document.hidden &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const notification = new Notification(title, { body: preview, tag: dto.id });
          notification.onclick = () => {
            window.focus();
            ui().openConversation(dto.conversationId);
            notification.close();
          };
        } catch {
          // Degrade silently when the Notification API is unavailable.
        }
      }
    };

    const onAck = (payload: { clientId: string; message: MessageDTO }) => {
      mergeMessage(queryClient, payload.message);
    };

    const onStatus = (payload: {
      conversationId: string;
      updates: { messageId: string; status: string }[];
    }) => {
      for (const update of payload.updates) {
        patchMessage(queryClient, payload.conversationId, update.messageId, {
          status: update.status as MessageDTO["status"],
        });
      }
    };

    const onUpdated = (dto: MessageDTO) => {
      mergeMessage(queryClient, dto);
    };

    const onDeleted = (payload: { messageId: string; conversationId: string }) => {
      // "Delete for everyone" arrives as message:updated (soft-delete DTO)
      // followed by message:deleted — keep the "This message was deleted"
      // placeholder in that case. "Delete for me" removes the bubble locally.
      const cache = queryClient.getQueryData<MessagesCache>(
        messagesKey(payload.conversationId),
      );
      const existing = cache?.pages
        ?.flatMap((page) => page.messages)
        .find((m) => m.id === payload.messageId);
      if (existing?.deletedAt) return;
      removeMessage(queryClient, payload.conversationId, payload.messageId);
    };

    const onReaction = (payload: {
      messageId: string;
      conversationId: string;
      reactions: MessageDTO["reactions"];
    }) => {
      patchReactions(queryClient, payload.conversationId, payload.messageId, payload.reactions);
    };

    // ------------------------------------------------------------------
    // Typing + presence + conversations
    // ------------------------------------------------------------------
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const onTyping = (payload: {
      conversationId: string;
      userId: string;
      userName: string;
      isTyping: boolean;
    }) => {
      useTypingStore.getState().setTyping(
        payload.conversationId,
        payload.userId,
        payload.userName,
        payload.isTyping,
      );
      const key = `${payload.conversationId}:${payload.userId}`;
      const existing = typingTimers.get(key);
      if (existing) clearTimeout(existing);
      if (payload.isTyping) {
        // Client-side safety expiry (server also expires after 5 s).
        typingTimers.set(
          key,
          setTimeout(() => {
            useTypingStore
              .getState()
              .setTyping(payload.conversationId, payload.userId, payload.userName, false);
            typingTimers.delete(key);
          }, 6500),
        );
      }
    };

    const onPresence = (payload: { userId: string; isOnline: boolean; lastSeenAt: string }) => {
      usePresenceStore
        .getState()
        .setPresence(payload.userId, { isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt });
    };

    const onConversationUpdated = (payload: { conversation: ConversationListItemDTO }) => {
      const conversation = payload.conversation;
      const isNew = !queryClient
        .getQueryData<ConversationListItemDTO[]>(["conversations"])
        ?.some((c) => c.id === conversation.id);

      queryClient.setQueryData<ConversationListItemDTO[]>(["conversations"], (old) => {
        const list = old ?? [];
        const filtered = list.filter((c) => c.id !== conversation.id);
        filtered.push(conversation);
        filtered.sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
        return filtered;
      });

      if (isNew) {
        // Join the room for a brand-new conversation (e.g. added to a group).
        socket.emit("conversation:sync", { conversationId: conversation.id });
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:new", onNewMessage);
    socket.on("message:ack", onAck);
    socket.on("message:status", onStatus);
    socket.on("message:updated", onUpdated);
    socket.on("message:deleted", onDeleted);
    socket.on("reaction:update", onReaction);
    socket.on("typing:update", onTyping);
    socket.on("presence:update", onPresence);
    socket.on("conversation:updated", onConversationUpdated);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message:new", onNewMessage);
      socket.off("message:ack", onAck);
      socket.off("message:status", onStatus);
      socket.off("message:updated", onUpdated);
      socket.off("message:deleted", onDeleted);
      socket.off("reaction:update", onReaction);
      socket.off("typing:update", onTyping);
      socket.off("presence:update", onPresence);
      socket.off("conversation:updated", onConversationUpdated);
      if (readSweepTimer) clearTimeout(readSweepTimer);
      for (const timer of typingTimers.values()) clearTimeout(timer);
      destroySocket();
    };
  }, [queryClient]);
}
