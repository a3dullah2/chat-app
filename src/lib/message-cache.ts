// React Query cache mutations for the messages infinite query.
// Socket events funnel through here so the UI stays consistent.

"use client";

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { MessageDTO, ReactionGroupDTO } from "@shared/types";
import type { MessagesResponse } from "@/types";

export const messagesKey = (conversationId: string) => ["messages", conversationId] as const;

export type MessagesCache = InfiniteData<MessagesResponse> | undefined;

const MAX_PAGES = 6; // ~180 bubbles kept in the DOM (pruning, see README §performance)

function mapPages(cache: NonNullable<MessagesCache>, fn: (msgs: MessageDTO[]) => MessageDTO[]): NonNullable<MessagesCache> {
  return {
    ...cache,
    pages: cache.pages.map((page) => ({ ...page, messages: fn(page.messages) })),
  };
}

/** Upserts a message (by id, or by clientId for optimistic reconciliation). */
export function mergeMessage(queryClient: QueryClient, dto: MessageDTO): void {
  queryClient.setQueryData<MessagesCache>(messagesKey(dto.conversationId), (cache) => {
    if (!cache || cache.pages.length === 0) return cache;

    for (const page of cache.pages) {
      const idx = page.messages.findIndex((m) => m.id === dto.id);
      if (idx !== -1) {
        const messages = [...page.messages];
        messages[idx] = dto;
        return { ...cache, pages: cache.pages.map((p) => (p === page ? { ...p, messages } : p)) };
      }
    }

    // Replace an optimistic temp message carrying the same clientId.
    for (const page of cache.pages) {
      const idx = page.messages.findIndex(
        (m) => m.id.startsWith("temp-") && m.clientId != null && m.clientId === dto.clientId,
      );
      if (idx !== -1) {
        const messages = [...page.messages];
        messages[idx] = dto;
        return { ...cache, pages: cache.pages.map((p) => (p === page ? { ...p, messages } : p)) };
      }
    }

    // Append to the newest page (pages[0] is always the live window).
    const first = cache.pages[0];
    const isFirstPageLive = cache.pages.length === 1 || true;
    void isFirstPageLive;
    const messages = [...first.messages, dto];
    const pages = cache.pages.map((p) => (p === first ? { ...p, messages } : p));
    return { ...cache, pages };
  });
}

/** Appends an optimistic (pending) message. */
export function appendOptimistic(queryClient: QueryClient, conversationId: string, message: MessageDTO): void {
  queryClient.setQueryData<MessagesCache>(messagesKey(conversationId), (cache) => {
    if (!cache || cache.pages.length === 0) return cache;
    const first = cache.pages[0];
    const messages = [...first.messages, message];
    return {
      ...cache,
      pages: cache.pages.map((p) => (p === first ? { ...p, messages } : p)),
    };
  });
}

/** Marks an optimistic message failed / pending again (retry). */
export function setOptimisticState(
  queryClient: QueryClient,
  conversationId: string,
  clientId: string,
  state: { pending?: boolean; failed?: boolean },
): void {
  queryClient.setQueryData<MessagesCache>(messagesKey(conversationId), (cache) => {
    if (!cache) return cache;
    return mapPages(cache, (messages) =>
      messages.map((m) => (m.clientId === clientId && m.id.startsWith("temp-") ? { ...m, ...state } : m)),
    );
  });
}

export function removeMessage(queryClient: QueryClient, conversationId: string, messageId: string): void {
  queryClient.setQueryData<MessagesCache>(messagesKey(conversationId), (cache) => {
    if (!cache) return cache;
    return mapPages(cache, (messages) => messages.filter((m) => m.id !== messageId));
  });
}

export function patchMessage(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  patch: Partial<MessageDTO>,
): void {
  queryClient.setQueryData<MessagesCache>(messagesKey(conversationId), (cache) => {
    if (!cache) return cache;
    return mapPages(cache, (messages) =>
      messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    );
  });
}

export function patchReactions(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  reactions: ReactionGroupDTO[],
): void {
  patchMessage(queryClient, conversationId, messageId, { reactions });
}

/** Keeps at most MAX_PAGES pages to bound DOM size (pruning strategy). */
export function pruneMessagePages(cache: MessagesCache): MessagesCache {
  if (!cache || cache.pages.length <= MAX_PAGES) return cache;
  return { ...cache, pages: cache.pages.slice(0, MAX_PAGES) };
}
