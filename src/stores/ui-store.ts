// UI state: active conversation, reply/edit targets, lightbox, mobile pane.

"use client";

import { create } from "zustand";
import type { MessageDTO } from "@shared/types";

interface UIState {
  activeConversationId: string | null;
  mobileView: "list" | "chat";
  replyTo: MessageDTO | null;
  editing: MessageDTO | null;
  highlightMessageId: string | null;
  lightbox: { src: string; alt: string } | null;
  infoOpen: boolean;
  newChatOpen: boolean;
  profileOpen: boolean;
  openConversation: (conversationId: string | null) => void;
  backToList: () => void;
  setReplyTo: (message: MessageDTO | null) => void;
  setEditing: (message: MessageDTO | null) => void;
  setHighlightMessageId: (id: string | null) => void;
  setLightbox: (value: { src: string; alt: string } | null) => void;
  setInfoOpen: (open: boolean) => void;
  setNewChatOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeConversationId: null,
  mobileView: "list",
  replyTo: null,
  editing: null,
  highlightMessageId: null,
  lightbox: null,
  infoOpen: false,
  newChatOpen: false,
  profileOpen: false,
  openConversation: (conversationId) =>
    set({
      activeConversationId: conversationId,
      mobileView: conversationId ? "chat" : "list",
      replyTo: null,
      editing: null,
      highlightMessageId: null,
      infoOpen: false,
    }),
  backToList: () => set({ mobileView: "list", infoOpen: false }),
  setReplyTo: (message) => set({ replyTo: message, editing: null }),
  setEditing: (message) => set({ editing: message, replyTo: null }),
  setHighlightMessageId: (id) => set({ highlightMessageId: id }),
  setLightbox: (value) => set({ lightbox: value }),
  setInfoOpen: (open) => set({ infoOpen: open }),
  setNewChatOpen: (open) => set({ newChatOpen: open }),
  setProfileOpen: (open) => set({ profileOpen: open }),
}));
