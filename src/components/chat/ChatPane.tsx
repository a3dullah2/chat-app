"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info, Search, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";
import { useMessages, useHighlightFetch, useConversationDetail } from "@/hooks/useChatData";
import { useUIStore } from "@/stores/ui-store";
import { useTypingNames, usePresenceStore } from "@/stores/realtime-stores";
import { Avatar } from "@/components/shared/Avatar";
import { ConnectionBanner } from "@/components/shared/ConnectionBanner";
import { MessagePaneSkeleton } from "@/components/shared/Skeletons";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ChatInfoPanel } from "@/components/chat/ChatInfoPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { lastSeenLabel, typingLabel } from "@shared/format";
import type { ConversationListItemDTO, PublicUserDTO } from "@/types";

interface ChatPaneProps {
  me: PublicUserDTO;
  conversation: ConversationListItemDTO;
}

export function ChatPane({ me, conversation }: ChatPaneProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useMessages(
    conversation.id,
  );

  const backToList = useUIStore((s) => s.backToList);
  const setInfoOpen = useUIStore((s) => s.setInfoOpen);
  const highlightMessageId = useUIStore((s) => s.highlightMessageId);
  const setHighlightMessageId = useUIStore((s) => s.setHighlightMessageId);
  const editing = useUIStore((s) => s.editing);
  const editingKey = editing?.id ?? "none";
  const fetchHighlight = useHighlightFetch(conversation.id, highlightMessageId);

  const [inChatSearch, setInChatSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const handleHighlightDone = useCallback(() => setHighlightMessageId(null), [setHighlightMessageId]);

  const isGroup = conversation.type === "GROUP";
  const title = isGroup ? conversation.name ?? "Group" : conversation.otherParticipant?.name ?? "Chat";
  const avatarUrl = isGroup ? conversation.avatarUrl : conversation.otherParticipant?.avatarUrl;
  const typingNames = useTypingNames(conversation.id);
  const otherId = conversation.otherParticipant?.id;
  const presence = usePresenceStore((s) => (otherId ? s.online[otherId] : undefined));
  const otherParticipant = conversation.otherParticipant;

  // Load the window around a search-jump target.
  useEffect(() => {
    if (conversation.id && highlightMessageId) {
      fetchHighlight();
    }
  }, [conversation.id, highlightMessageId]);

  // Read receipts: mark read when the conversation is open and focused (FR-08).
  const readEmittedFor = useRef<string | null>(null);
  useEffect(() => {
    const emitRead = () => {
      if (document.hasFocus() && !document.hidden) {
        getSocket().emit("message:read", { conversationId: conversation.id });
        readEmittedFor.current = conversation.id;
      }
    };
    emitRead();
    window.addEventListener("focus", emitRead);
    return () => window.removeEventListener("focus", emitRead);
  }, [conversation.id]);

  // Reset unread badge locally as soon as the chat is opened.
  useEffect(() => {
    queryClient.setQueryData<ConversationListItemDTO[]>(["conversations"], (old) =>
      old ? old.map((c) => (c.id === conversation.id ? { ...c, unreadCount: 0 } : c)) : old,
    );
  }, [conversation.id, queryClient]);

  const messages = useMemo(() => {
    const flat = [...(data?.pages ?? [])].reverse().flatMap((p) => p.messages);
    if (inChatSearch.trim().length >= 2) {
      const q = inChatSearch.trim().toLowerCase();
      return flat.filter(
        (m) => (m.text ?? "").toLowerCase().includes(q) || m.sender.name.toLowerCase().includes(q),
      );
    }
    // Pruning strategy (spec §12): cap rendered bubbles at ~180 (6 pages of
    // 30). Older pages stay in the React Query cache and reload on scroll-up.
    return flat.slice(-180);
  }, [data, inChatSearch]);

  const detail = useConversationDetail(conversation.id);

  const subtitle = useMemo(() => {
    if (typingNames.length > 0) return typingLabel(typingNames);
    if (isGroup) {
      const count = conversation.participants.length;
      return `You, ${Math.max(count - 1, 0)} other${count - 1 === 1 ? "" : "s"}`;
    }
    if (otherParticipant) {
      return lastSeenLabel({
        isOnline: presence?.isOnline ?? !!otherParticipant.isOnline,
        lastSeenAt: presence?.lastSeenAt ?? otherParticipant.lastSeenAt,
      });
    }
    return "";
  }, [typingNames, isGroup, conversation.participants.length, otherParticipant, presence]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header — rounded surface bar (Stoat style) */}
      <header className="flex items-center gap-2 shrink-0 mx-2 mt-2 mb-1 px-2 md:px-3 h-12 rounded-[16px] bg-surface-variant text-foreground">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden text-foreground size-9"
          onClick={backToList}
          aria-label="Back to chat list"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-[12px] px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Open conversation info for ${title}`}
        >
          <Avatar name={title} src={avatarUrl} size="md" online={isGroup ? undefined : !!presence?.isOnline} dotRing="ring-surface-variant" />
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-foreground truncate">{title}</span>
            <span
              className={`block text-xs truncate ${typingNames.length > 0 ? "text-primary" : "text-muted-foreground"}`}
            >
              {subtitle}
            </span>
          </span>
        </button>

        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground size-9" aria-label="Search in chat">
              <Search className="h-5 w-5" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2 rounded-[16px]">
            <div className="relative">
              <Input
                value={inChatSearch}
                onChange={(e) => setInChatSearch(e.target.value)}
                placeholder="Search in this chat"
                aria-label="Search messages in this chat"
                autoFocus
                className="pr-8 rounded-[12px] bg-surface-container-high"
              />
              {inChatSearch && (
                <button
                  type="button"
                  onClick={() => setInChatSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear chat search"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            {inChatSearch.trim().length >= 2 && (
              <p className="mt-2 text-xs text-muted-foreground px-1">
                {messages.length} matching message{messages.length === 1 ? "" : "s"}
              </p>
            )}
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-9"
          onClick={() => setInfoOpen(true)}
          aria-label="Conversation info"
        >
          <Info className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <ConnectionBanner />

      {/* Messages */}
      <div className="flex-1 min-h-0 relative">
        {isLoading && data === undefined ? (
          <MessagePaneSkeleton />
        ) : (
          <MessageList
            me={me}
            conversation={conversation}
            messages={messages}
            hasNextPage={!!hasNextPage && inChatSearch.trim().length < 2}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
            highlightMessageId={highlightMessageId}
            onHighlightDone={handleHighlightDone}
            searchFilter={inChatSearch.trim().length >= 2 ? inChatSearch.trim() : null}
          />
        )}
      </div>

      {/* Composer — remounts per conversation/edit so drafts restore cleanly */}
      <Composer
        key={`${conversation.id}:${editingKey}`}
        me={me}
        conversation={conversation}
      />

      {/* Info panel */}
      <ChatInfoPanel
        me={me}
        conversation={conversation}
        detail={detail.data ?? null}
        onDetailRefresh={() => detail.refetch()}
      />
    </div>
  );
}
