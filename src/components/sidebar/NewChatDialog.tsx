"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Hash, Loader2, Search, Users } from "lucide-react";
import { api } from "@/lib/client-api";
import { Avatar } from "@/components/shared/Avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import type { ConversationDetailDTO, PublicUserDTO, UsersResponse } from "@/types";

type Tab = "direct" | "group";

export function NewChatDialog() {
  const open = useUIStore((s) => s.newChatOpen);
  const setOpen = useUIStore((s) => s.setNewChatOpen);
  const openConversation = useUIStore((s) => s.openConversation);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("direct");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<PublicUserDTO[]>([]);
  const [busy, setBusy] = useState(false);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setDebounced(value.trim()), 300));
  };

  const enabled = debounced.length >= 2;
  const { data: users, isFetching } = useQuery({
    queryKey: ["users", debounced],
    queryFn: () =>
      api<UsersResponse>(`/api/users?search=${encodeURIComponent(debounced)}`).then((d) => d.users),
    enabled,
    staleTime: 15_000,
  });

  const close = () => {
    setOpen(false);
    setTab("direct");
    setSearch("");
    setDebounced("");
    setGroupName("");
    setSelected([]);
  };

  const startDirect = async (userId: string) => {
    setBusy(true);
    try {
      const data = await api<{ conversation: ConversationDetailDTO }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ type: "DIRECT", userId }),
      });
      // Invalidate the conversation list cache so the sidebar shows the new
      // chat immediately, even if the socket-based conversation:updated event
      // hasn't arrived yet (or the socket is down — REST is the source of
      // truth, the socket event is a real-time optimization).
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      openConversation(data.conversation.id);
      close();
    } catch (error) {
      toast.error((error as Error).message || "Could not start the chat");
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Give your group a name");
      return;
    }
    if (selected.length < 2) {
      toast.error("Pick at least 2 participants");
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ conversation: ConversationDetailDTO }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          type: "GROUP",
          name: groupName.trim(),
          participantIds: selected.map((u) => u.id),
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      openConversation(data.conversation.id);
      close();
    } catch (error) {
      toast.error((error as Error).message || "Could not create the group");
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (user: PublicUserDTO) => {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user],
    );
  };

  const body = useMemo(() => {
    if (!enabled) {
      return (
        <p className="px-2 py-10 text-sm text-muted-foreground text-center">
          Type at least 2 characters to search for people by name or email.
        </p>
      );
    }
    if (isFetching) {
      return (
        <div className="flex justify-center py-10" aria-label="Searching users">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      );
    }
    if (!users || users.length === 0) {
      return (
        <p className="px-2 py-10 text-sm text-muted-foreground text-center">No people found</p>
      );
    }
    return (
      <ul className="max-h-72 overflow-y-auto scrollbar-thin -mx-1 px-1">
        {users.map((user) => {
          const isSelected = selected.some((u) => u.id === user.id);
          return (
            <li key={user.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (tab === "direct" ? startDirect(user.id) : toggleSelected(user))}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left disabled:opacity-50"
              >
                <Avatar name={user.name} src={user.avatarUrl} size="md" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground truncate">{user.name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{user.about}</span>
                </span>
                {tab === "group" && (
                  <span
                    className={cn(
                      "h-5 w-5 rounded-full border flex items-center justify-center shrink-0",
                      isSelected ? "bg-primary border-primary" : "border-muted-foreground/40",
                    )}
                    aria-hidden
                  >
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }, [enabled, isFetching, users, selected, tab, busy]);

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tab === "direct" ? (
              <>
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                New chat
              </>
            ) : (
              <>
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                New group
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Chat type">
          {(
            [
              { value: "direct", label: "New chat" },
              { value: "group", label: "New group" },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                tab === t.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:opacity-90",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "group" && (
          <div className="space-y-2">
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                className="pl-9"
                aria-label="Group name"
                maxLength={60}
              />
            </div>
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-xs px-2 py-0.5"
                  >
                    {u.name}
                    <button
                      type="button"
                      onClick={() => toggleSelected(u)}
                      className="hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring rounded-full"
                      aria-label={`Remove ${u.name} from selection`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search people by name or email"
          aria-label="Search people"
          autoFocus
        />

        <div className="flex-1 min-h-0">{body}</div>

        {tab === "group" && (
          <Button onClick={createGroup} disabled={busy || selected.length < 2 || !groupName.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Create group ({selected.length} selected)
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
