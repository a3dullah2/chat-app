"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api } from "@/lib/client-api";
import { useSocketEvents } from "@/hooks/useSocketEvents";
import { useConversations } from "@/hooks/useChatData";
import { useTitleUnread, useNotificationPermission } from "@/hooks/useNotifications";
import { useUIStore } from "@/stores/ui-store";
import { usePresenceStore } from "@/stores/realtime-stores";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatPane } from "@/components/chat/ChatPane";
import { NewChatDialog } from "@/components/sidebar/NewChatDialog";
import { ProfileDialog } from "@/components/sidebar/ProfileDialog";
import { Lightbox } from "@/components/chat/Lightbox";
import { EmptyState } from "@/components/shared/EmptyState";
import { ChatListSkeleton } from "@/components/shared/Skeletons";
import { ChatErrorBoundary } from "@/components/chat/ChatErrorBoundary";
import { cn } from "@/lib/utils";
import type { PublicUserDTO } from "@/types";

export function ChatApp({ me }: { me: PublicUserDTO }) {
  const queryClient = useQueryClient();
  useSocketEvents(me);
  useNotificationPermission();

  const { data: conversations, isLoading } = useConversations();
  useTitleUnread(conversations);

  const activeConversationId = useUIStore((s) => s.activeConversationId);
  const mobileView = useUIStore((s) => s.mobileView);
  const setPresence = usePresenceStore((s) => s.setPresence);

  const activeConversation = useMemo(
    () => conversations?.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  // Seed the presence store from the conversation list.
  useEffect(() => {
    if (!conversations) return;
    for (const conversation of conversations) {
      if (conversation.otherParticipant) {
        setPresence(conversation.otherParticipant.id, {
          isOnline: !!conversation.otherParticipant.isOnline,
          lastSeenAt: conversation.otherParticipant.lastSeenAt ?? new Date(0).toISOString(),
        });
      }
    }
  }, [conversations, setPresence]);

  // Ctrl/Cmd+K opens the new chat dialog (keyboard-friendly).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useUIStore.getState().setNewChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    queryClient.clear();
    queryClient.setQueryData(["me"], null);
  };

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-background md:gap-2 md:p-2">
      {/* Sidebar — a rounded floating panel like Stoat's channel list */}
      <div
        className={cn(
          "absolute md:relative inset-0 z-20 md:z-auto h-full w-full md:w-[300px] lg:w-[320px] shrink-0",
          "bg-panel md:rounded-[28px] overflow-hidden transition-transform duration-200 ease-out",
          "md:translate-x-0",
          mobileView === "chat" ? "-translate-x-full" : "translate-x-0",
        )}
      >
        <Sidebar me={me} conversations={conversations ?? []} isLoading={isLoading} onLogout={logout} />
      </div>

      {/* Chat surface — rounded panel on the shell backdrop */}
      <div
        className={cn(
          "relative flex-1 min-w-0 h-full flex-col bg-chat-bg md:rounded-[28px] overflow-hidden",
          mobileView === "chat" ? "flex" : "hidden md:flex",
        )}
      >
        {isLoading && activeConversationId ? (
          <ChatListSkeleton />
        ) : activeConversation ? (
          <ChatErrorBoundary key={activeConversation.id}>
            <ChatPane me={me} conversation={activeConversation} />
          </ChatErrorBoundary>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title={isLoading ? "" : "No chat selected"}
            description={
              isLoading
                ? ""
                : "Pick a conversation on the left or start a new one to say hello."
            }
          />
        )}
      </div>

      <NewChatDialog />
      <ProfileDialog me={me} />
      <Lightbox />
    </div>
  );
}
