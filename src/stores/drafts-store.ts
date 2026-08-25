// Per-conversation composer drafts, persisted to localStorage.

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DraftsStore {
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useDraftsStore = create<DraftsStore>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (conversationId, text) =>
        set((state) => ({ drafts: { ...state.drafts, [conversationId]: text } })),
      clearDraft: (conversationId) =>
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[conversationId];
          return { drafts };
        }),
    }),
    { name: "chatapp-drafts" },
  ),
);
