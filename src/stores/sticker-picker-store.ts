"use client";

import { create } from "zustand";
import type { StickerPackDTO, StickerDTO } from "@shared/types";

/**
 * Per-tab loading state for the picker.
 * Bundled packs + personal packs are loaded once and cached until the
 * user logs out / switches accounts. Future packs (e.g. a Telegram import
 * landing while the picker is open) trigger a refetch.
 */
interface StickerPickerState {
  packs: StickerPackDTO[];
  loading: boolean;
  error: string | null;
  /** Stickers the user has favorited (by stickerId). */
  favoriteIds: Set<string>;
  /** Most-recently-used stickers (newest first). */
  recent: StickerDTO[];
  /** Active tab id — either 'recent' | 'favorites' | a pack id. */
  activeTab: string;

  loadPacks: () => Promise<void>;
  setRecent: (stickers: StickerDTO[]) => void;
  toggleFavorite: (stickerId: string) => Promise<void>;
  loadFavorites: () => Promise<void>;
  loadRecent: () => Promise<void>;
  setActiveTab: (tabId: string) => void;
  /** Returns true if the picker has loaded data at least once. */
  hasHydrated: () => boolean;
}

let _hydrated = false;

export const useStickerPickerStore = create<StickerPickerState>((set, get) => ({
  packs: [],
  loading: false,
  error: null,
  favoriteIds: new Set(),
  recent: [],
  activeTab: "recent",

  hasHydrated: () => _hydrated,

  loadPacks: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/stickers", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        set({ loading: false, error: data.error ?? "Failed to load stickers" });
        return;
      }
      const data = (await res.json()) as { packs: StickerPackDTO[] };
      _hydrated = true;
      // Default to the first bundled pack if there is one, else "recent".
      const firstBundled = data.packs.find((p) => p.ownerId === null);
      const fallbackTab = firstBundled?.id ?? "recent";
      set({
        packs: data.packs,
        loading: false,
        activeTab: get().activeTab || fallbackTab,
      });
      void get().loadRecent();
      void get().loadFavorites();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  setRecent: (stickers) => set({ recent: stickers }),

  loadRecent: async () => {
    try {
      const res = await fetch("/api/stickers/recent", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { stickers: StickerDTO[] };
      set({ recent: data.stickers });
    } catch {
      /* swallow — recent is best-effort */
    }
  },

  loadFavorites: async () => {
    try {
      const res = await fetch("/api/stickers/favorites", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { stickers: StickerDTO[] };
      set({ favoriteIds: new Set(data.stickers.map((s) => s.id)) });
    } catch {
      /* swallow */
    }
  },

  toggleFavorite: async (stickerId) => {
    const isFav = get().favoriteIds.has(stickerId);
    const next = new Set(get().favoriteIds);
    if (isFav) next.delete(stickerId);
    else next.add(stickerId);
    set({ favoriteIds: next });

    // Fire-and-forget; server is source of truth but we optimistically flip.
    try {
      const method = isFav ? "DELETE" : "POST";
      const res = await fetch(`/api/stickers/${stickerId}/favorite`, { method });
      if (!res.ok) {
        // Rollback
        const rollback = new Set(get().favoriteIds);
        if (isFav) rollback.add(stickerId);
        else rollback.delete(stickerId);
        set({ favoriteIds: rollback });
      }
    } catch {
      /* swallow */
    }
  },

  setActiveTab: (tabId) => set({ activeTab: tabId }),
}));
