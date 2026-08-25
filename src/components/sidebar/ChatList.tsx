"use client";

import { memo } from "react";
import {
  Pin,
  PinOff,
  BellOff,
  Bell,
  Archive,
  ArchiveRestore,
  CheckCheck,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/shared/Avatar";
import { useUIStore } from "@/stores/ui-store";
import { useTypingNames, usePresenceStore } from "@/stores/realtime-stores";
import { listTimestamp } from "@shared/format";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { ConversationListItemDTO, PublicUserDTO } from "@/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface ChatListProps {
  conversations: ConversationListItemDTO[];
  me: PublicUserDTO;
}

export function ChatList({ conversations, me }: ChatListProps) {
  const activeConversationId = useUIStore((s) => s.activeConversationId);
  const openConversation = useUIStore((s) => s.openConversation);

  return (
    <ul className="py-1" aria-label="Conversations">
      {conversations.map((conversation) => (
        <ChatListItem
          key={conversation.id}
          conversation={conversation}
          me={me}
          active={conversation.id === activeConversationId}
          onOpen={() => openConversation(conversation.id)}
        />
      ))}
    </ul>
  );
}

interface ChatListItemProps {
  conversation: ConversationListItemDTO;
  me: PublicUserDTO;
  active: boolean;
  onOpen: () => void;
}

export const ChatListItem = memo(function ChatListItem({
  conversation,
  me,
  active,
  onOpen,
}: ChatListItemProps) {
  const queryClient = useQueryClient();
  const isGroup = conversation.type === "GROUP";
  const title = isGroup ? conversation.name ?? "Group" : conversation.otherParticipant?.name ?? "Chat";
  const avatarUrl = isGroup ? conversation.avatarUrl : conversation.otherParticipant?.avatarUrl;
  const typingNames = useTypingNames(conversation.id);
  const otherId = conversation.otherParticipant?.id;
  const presence = usePresenceStore((s) => (otherId ? s.online[otherId] : undefined));
  const online = isGroup ? undefined : presence?.isOnline ?? !!conversation.otherParticipant?.isOnline;

  const last = conversation.lastMessage;
  const isOwnLast = last?.senderId === me.id;
  const time = last ? listTimestamp(new Date(last.createdAt)) : "";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["conversations"] });

  const patchConversation = async (patch: Record<string, unknown>) => {
    try {
      await api(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      refresh();
    } catch (error) {
      toast.error((error as Error).message || "Could not update the conversation");
    }
  };

  const markRead = () => {
    getSocket().emit("message:read", { conversationId: conversation.id });
    refresh();
  };

  const leaveGroup = async () => {
    try {
      await api(`/api/conversations/${conversation.id}/leave`, { method: "POST" });
      if (useUIStore.getState().activeConversationId === conversation.id) {
        useUIStore.getState().openConversation(null);
      }
      refresh();
      toast.success(`You left "${title}"`);
    } catch (error) {
      toast.error((error as Error).message || "Could not leave the group");
    }
  };

  const preview = typingNames.length > 0
    ? null
    : last
      ? `${isOwnLast ? "You: " : ""}${last.type === "SYSTEM" && last.senderId === me.id ? last.preview.replace(/^\S+\s/, "You ") : last.preview}`
      : "Tap to start the conversation";

  return (
    <li className="px-2 py-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={onOpen}
            aria-current={active ? "true" : undefined}
            aria-label={`Open chat with ${title}${conversation.unreadCount ? `, ${conversation.unreadCount} unread` : ""}`}
            className={cn(
              "w-full flex items-center gap-3 px-2.5 py-2 text-left rounded-[16px] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
              active ? "bg-surface-container-highest" : "hover:bg-surface-container",
            )}
          >
            <Avatar name={title} src={avatarUrl} size="lg" online={online} />
            <span className="flex-1 min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className={cn(
                  "text-[14.5px] truncate",
                  conversation.unreadCount > 0 ? "font-semibold text-foreground" : "font-medium text-foreground",
                )}>{title}</span>
                <span className={cn("text-[11px] shrink-0", conversation.unreadCount > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                  {time}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 mt-0.5">
                {typingNames.length > 0 ? (
                  <span className="text-[13px] text-primary truncate">
                    {isGroup ? `${typingNames[0]} is typing…` : "typing…"}
                  </span>
                ) : (
                  <span className={cn(
                    "text-[13px] truncate",
                    conversation.unreadCount > 0 ? "text-foreground/90" : "text-muted-foreground",
                  )}>{preview}</span>
                )}
                <span className="flex items-center gap-1.5 shrink-0">
                  {conversation.isPinned && (
                    <Pin className="h-3.5 w-3.5 text-muted-foreground" aria-label="Pinned" />
                  )}
                  {conversation.isMuted && (
                    <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Muted" />
                  )}
                  {conversation.unreadCount > 0 && (
                    <span className="rounded-full bg-badge-unread text-white text-[11px] font-medium px-1.5 min-w-5 text-center">
                      {conversation.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {conversation.unreadCount > 0 && (
            <ContextMenuItem onClick={markRead}>
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark as read
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => patchConversation({ isPinned: !conversation.isPinned })}>
            {conversation.isPinned ? (
              <>
                <PinOff className="h-4 w-4" aria-hidden />
                Unpin chat
              </>
            ) : (
              <>
                <Pin className="h-4 w-4" aria-hidden />
                Pin chat
              </>
            )}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => patchConversation({ isMuted: !conversation.isMuted })}>
            {conversation.isMuted ? (
              <>
                <Bell className="h-4 w-4" aria-hidden />
                Unmute notifications
              </>
            ) : (
              <>
                <BellOff className="h-4 w-4" aria-hidden />
                Mute notifications
              </>
            )}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => patchConversation({ isArchived: !conversation.isArchived })}>
            {conversation.isArchived ? (
              <>
                <ArchiveRestore className="h-4 w-4" aria-hidden />
                Unarchive chat
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" aria-hidden />
                Archive chat
              </>
            )}
          </ContextMenuItem>
          {isGroup && (
            <ContextMenuItem onClick={leaveGroup} className="text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4" aria-hidden />
              Leave group
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
});
