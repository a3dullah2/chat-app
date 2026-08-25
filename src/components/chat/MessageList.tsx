"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { buildListItems } from "@shared/format";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MessageDTO } from "@shared/types";
import type { ConversationListItemDTO, PublicUserDTO } from "@/types";

interface MessageListProps {
  me: PublicUserDTO;
  conversation: ConversationListItemDTO;
  messages: MessageDTO[];
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  highlightMessageId: string | null;
  onHighlightDone: () => void;
  searchFilter: string | null;
}

export function MessageList({
  me,
  conversation,
  messages,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  highlightMessageId,
  onHighlightDone,
  searchFilter,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const isGroup = conversation.type === "GROUP";
  const items = useMemo(
    () => buildListItems(messages, { isGroup }),
    [messages, isGroup],
  );

  const firstId = messages[0]?.id ?? null;
  const lastId = messages[messages.length - 1]?.id ?? null;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Keep scroll pinned to the bottom when new messages arrive (if the user is
  // already near the bottom), otherwise show the jump-to-bottom button.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (prevLastIdRef.current !== lastId) {
      const appended = lastId !== null && prevLastIdRef.current !== null;
      if (stickToBottomRef.current || !appended) {
        scrollToBottom(appended ? "smooth" : "auto");
      }
      prevLastIdRef.current = lastId;
    }
  }, [lastId]);

  // Preserve the viewport when older messages are prepended (infinite scroll).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevFirstIdRef.current !== firstId && prevFirstIdRef.current !== null) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) {
        el.scrollTop += delta;
      }
    }
    prevFirstIdRef.current = firstId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [firstId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 150;
    setShowJumpButton(distanceFromBottom > 400);
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Jump to the highlighted message (sidebar search).
  useEffect(() => {
    if (!highlightMessageId) return;
    if (messages.length === 0) return; // still loading — keep waiting
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-mid="${highlightMessageId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
      el.classList.add("message-flash");
      const timer = setTimeout(() => {
        el.classList.remove("message-flash");
        onHighlightDone();
      }, 1800);
      return () => clearTimeout(timer);
    }
    onHighlightDone();
  }, [highlightMessageId, messages.length, onHighlightDone]);

  // Scroll to bottom when switching conversations.
  useEffect(() => {
    stickToBottomRef.current = true;
    prevFirstIdRef.current = null;
    prevLastIdRef.current = null;
    scrollToBottom("auto");
  }, [conversation.id]);

  if (messages.length === 0) {
    return (
      <div className="absolute inset-0">
        <EmptyState
          icon={MessageSquare}
          title={searchFilter ? "No matching messages" : "Start the conversation"}
          description={
            searchFilter
              ? "Try a different search term."
              : "Say hi — messages are delivered instantly, with read receipts when they open them."
          }
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={`Messages in ${conversation.type === "GROUP" ? conversation.name ?? "group" : "chat"}`}
        className="h-full overflow-y-auto scrollbar-thin px-1 md:px-2 py-4 pb-6"
      >
        {isFetchingNextPage && (
          <div className="flex justify-center py-2" aria-label="Loading older messages">
            <span className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
          </div>
        )}
        {!hasNextPage && messages.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground py-2 px-4">
            This is the beginning of your conversation
          </p>
        )}
        <div className="max-w-3xl mx-auto flex flex-col">
          {items.map((item) =>
            item.kind === "divider" ? (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className="text-[11px] font-medium text-muted-foreground shrink-0">
                  {item.label}
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
            ) : (
              <MessageBubble
                key={item.id}
                me={me}
                conversation={conversation}
                message={item.message}
                isFirstOfGroup={item.isFirstOfGroup}
                isLastOfGroup={item.isLastOfGroup}
                showSender={item.showSender}
              />
            ),
          )}
        </div>
      </div>

      {showJumpButton && (
        <Button
          size="icon"
          variant="secondary"
          className={cn(
            "absolute bottom-4 right-4 md:right-6 z-10 rounded-full shadow-lg",
            "bg-surface-container-high text-muted-foreground hover:text-foreground",
          )}
          onClick={() => scrollToBottom("smooth")}
          aria-label="Scroll to latest messages"
        >
          <ChevronDown className="h-5 w-5" aria-hidden />
        </Button>
      )}
    </div>
  );
}
