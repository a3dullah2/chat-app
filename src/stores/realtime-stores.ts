// Connection + presence + typing state (socket-driven).

"use client";

import { create } from "zustand";

interface ConnectionStore {
  connected: boolean;
  wasEverConnected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  wasEverConnected: false,
  setConnected: (connected) =>
    set((state) => ({ connected, wasEverConnected: state.wasEverConnected || connected })),
}));

export interface PresenceEntry {
  isOnline: boolean;
  lastSeenAt: string;
}

interface PresenceStore {
  online: Record<string, PresenceEntry>;
  setPresence: (userId: string, entry: PresenceEntry) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  online: {},
  setPresence: (userId, entry) =>
    set((state) => ({ online: { ...state.online, [userId]: entry } })),
}));

interface TypingEntry {
  name: string;
  expiresAt: number;
}

interface TypingStore {
  typing: Record<string, Record<string, TypingEntry>>;
  setTyping: (conversationId: string, userId: string, name: string, isTyping: boolean) => void;
  clearConversation: (conversationId: string) => void;
}

export const useTypingStore = create<TypingStore>((set) => ({
  typing: {},
  setTyping: (conversationId, userId, name, isTyping) =>
    set((state) => {
      const conv = { ...(state.typing[conversationId] ?? {}) };
      if (isTyping) {
        conv[userId] = { name, expiresAt: Date.now() + 6000 };
      } else {
        delete conv[userId];
      }
      return { typing: { ...state.typing, [conversationId]: conv } };
    }),
  clearConversation: (conversationId) =>
    set((state) => {
      const typing = { ...state.typing };
      delete typing[conversationId];
      return { typing };
    }),
}));

/** Selector: display names of everyone currently typing in a conversation. */
export function useTypingNames(conversationId: string | null | undefined): string[] {
  const typing = useTypingStore((s) => (conversationId ? s.typing[conversationId] : undefined));
  if (!typing) return [];
  const now = Date.now();
  return Object.values(typing)
    .filter((t) => t.expiresAt > now)
    .map((t) => t.name);
}
