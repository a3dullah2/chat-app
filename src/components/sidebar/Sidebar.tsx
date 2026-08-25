"use client";

import { useMemo, useState } from "react";
import { MessageSquarePlus, Moon, Sun, LogOut, MessagesSquare } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useUIStore } from "@/stores/ui-store";
import { useTypingNames } from "@/stores/realtime-stores";
import { Avatar } from "@/components/shared/Avatar";
import { ChatListSkeleton } from "@/components/shared/Skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchBar } from "@/components/sidebar/SearchBar";
import { FilterChips } from "@/components/sidebar/FilterChips";
import { ChatList } from "@/components/sidebar/ChatList";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationListItemDTO, PublicUserDTO } from "@/types";

export type ConversationFilter = "all" | "unread" | "groups";

interface SidebarProps {
  me: PublicUserDTO;
  conversations: ConversationListItemDTO[];
  isLoading: boolean;
  onLogout: () => void;
}

export function Sidebar({ me, conversations, isLoading, onLogout }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const setProfileOpen = useUIStore((s) => s.setProfileOpen);
  const setNewChatOpen = useUIStore((s) => s.setNewChatOpen);
  const [filter, setFilter] = useState<ConversationFilter>("all");

  const visibleConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (c.isArchived) return false;
      if (filter === "unread") return c.unreadCount > 0;
      if (filter === "groups") return c.type === "GROUP";
      return true;
    });
  }, [conversations, filter]);

  const totalUnread = useMemo(
    () => conversations.filter((c) => !c.isMuted && !c.isArchived).reduce((s, c) => s + c.unreadCount, 0),
    [conversations],
  );

  return (
    <div className="h-full flex flex-col bg-panel">
      {/* Header — flat, no divider (Stoat style) */}
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Open your profile"
        >
          <Avatar name={me.name} src={me.avatarUrl} size="md" online />
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle dark mode"
            className="text-muted-foreground size-9"
          >
            <Sun className="h-5 w-5 dark:hidden" aria-hidden />
            <Moon className="h-5 w-5 hidden dark:block" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNewChatOpen(true)}
            aria-label="Start a new chat"
            className="text-muted-foreground size-9"
          >
            <MessageSquarePlus className="h-5 w-5" aria-hidden />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-9"
                aria-label="Open menu"
              >
                <MessagesSquare className="h-5 w-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.info(`You have ${totalUnread} unread message${totalUnread === 1 ? "" : "s"}`)
                }
              >
                Unread summary
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Search + filters */}
      <div className="px-3 pb-1 space-y-2 shrink-0">
        <SearchBar conversations={conversations} />
        <FilterChips value={filter} onChange={setFilter} unreadCount={conversations.filter((c) => c.unreadCount > 0 && !c.isArchived).length} />
      </div>

      {/* Category header (Stoat style: uppercase, tracked, muted) */}
      <div className="flex items-center justify-between px-5 pt-3 pb-1 shrink-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conversations
          {visibleConversations.length > 0 && (
            <span className="ml-1.5 font-medium">· {visibleConversations.length}</span>
          )}
        </h2>
      </div>

      {/* Chat list */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <ChatListSkeleton />
        ) : visibleConversations.length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title={conversations.length === 0 ? "Say hello 👋" : "Nothing here"}
            description={
              conversations.length === 0
                ? "You have no chats yet. Start a new conversation to get going."
                : filter === "unread"
                  ? "You're all caught up — no unread messages."
                  : filter === "groups"
                    ? "No group chats yet."
                    : "No conversations match."
            }
          />
        ) : (
          <ChatList conversations={visibleConversations} me={me} />
        )}
      </div>
    </div>
  );
}
