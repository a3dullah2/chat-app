"use client";

import { useEffect, useRef } from "react";

import type { ConversationListItemDTO } from "@shared/types";
import { getSocket } from "@/lib/socket";
import { useUIStore } from "@/stores/ui-store";

const APP_TITLE = "ChatApp";

/** Unread total in document.title; resets on focus (FR-10 AC3). */
export function useTitleUnread(conversations: ConversationListItemDTO[] | undefined): void {
  useEffect(() => {
    if (!conversations) return;
    const total = conversations
      .filter((c) => !c.isMuted && !c.isArchived)
      .reduce((sum, c) => sum + c.unreadCount, 0);
    if (!document.hasFocus()) {
      document.title = total > 0 ? `(${total}) ${APP_TITLE}` : APP_TITLE;
    }
  }, [conversations]);

  useEffect(() => {
    const onFocus = () => {
      document.title = APP_TITLE;
      const activeId = useUIStore.getState().activeConversationId;
      if (activeId) {
        getSocket().emit("message:read", { conversationId: activeId });
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}

/** Requests browser notification permission after the first interaction. */
export function useNotificationPermission(): void {
  const requested = useRef(false);
  useEffect(() => {
    const request = () => {
      if (requested.current) return;
      requested.current = true;
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }
      window.removeEventListener("pointerdown", request);
    };
    window.addEventListener("pointerdown", request, { once: true });
    return () => window.removeEventListener("pointerdown", request);
  }, []);
}
