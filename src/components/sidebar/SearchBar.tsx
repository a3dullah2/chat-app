"use client";

import { useState } from "react";
import { Search, X, MessageCircle, Hash } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { Avatar } from "@/components/shared/Avatar";
import { Input } from "@/components/ui/input";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import type { ConversationListItemDTO, SearchResponse } from "@/types";

export function SearchBar({ conversations }: { conversations: ConversationListItemDTO[] }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const openConversation = useUIStore((s) => s.openConversation);
  const setHighlightMessageId = useUIStore((s) => s.setHighlightMessageId);

  // Debounce 300 ms (FR-02 AC1 pattern).
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const onChange = (value: string) => {
    setQuery(value);
    if (timer) clearTimeout(timer);
    setTimer(
      setTimeout(() => {
        setDebounced(value.trim());
      }, 300),
    );
  };

  const active = debounced.length >= 2;

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      api<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced)}`).then((d) => d.results),
    enabled: active,
    staleTime: 10_000,
  });

  const titleMatches = active
    ? conversations.filter((c) => {
        const title =
          c.type === "GROUP" ? c.name ?? "" : c.otherParticipant?.name ?? "";
        return title.toLowerCase().includes(debounced.toLowerCase());
      })
    : [];

  const jumpToMessage = (conversationId: string, messageId: string) => {
    openConversation(conversationId);
    setHighlightMessageId(messageId);
    setQuery("");
    setDebounced("");
  };

  const hasResults = titleMatches.length > 0 || (searchResults?.length ?? 0) > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search chats and messages"
          className="pl-9 pr-8 rounded-full bg-surface-container-high border-transparent focus-visible:border-transparent h-10"
          aria-label="Search chats and messages"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDebounced("");
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring rounded"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {active && (
        <div className="absolute left-0 right-0 top-12 z-30 rounded-[16px] border border-border bg-popover text-popover-foreground shadow-lg max-h-[60vh] overflow-y-auto scrollbar-thin">
          {!hasResults && !isFetching && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No results found</p>
          )}
          {titleMatches.length > 0 && (
            <div className="py-1">
              <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Chats
              </p>
              {titleMatches.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    openConversation(c.id);
                    setQuery("");
                    setDebounced("");
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                >
                  <Avatar
                    name={c.type === "GROUP" ? c.name ?? "Group" : c.otherParticipant?.name ?? "Chat"}
                    src={c.avatarUrl ?? c.otherParticipant?.avatarUrl}
                    size="sm"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">
                      {c.type === "GROUP" ? c.name : c.otherParticipant?.name}
                    </span>
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-badge-unread text-white text-[11px] px-1.5 min-w-5 text-center">
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {(searchResults?.length ?? 0) > 0 && (
            <div className="py-1 border-t border-border">
              <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Messages
              </p>
              {searchResults!.map((r) => (
                <button
                  key={r.conversationId}
                  type="button"
                  onClick={() => jumpToMessage(r.conversationId, r.firstMatchMessageId)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                >
                  <span
                    className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                      "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {r.conversationType === "GROUP" ? (
                      <Hash className="h-4 w-4" aria-hidden />
                    ) : (
                      <MessageCircle className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{r.conversationTitle}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {r.matchCount} message{r.matchCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">{r.preview}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
