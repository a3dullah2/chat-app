"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Crown, LogOut, Search, Shield, Trash2, UserPlus, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { Avatar } from "@/components/shared/Avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useUIStore } from "@/stores/ui-store";
import { ParticipantRole } from "@shared/constants";
import { cn } from "@/lib/utils";
import type { ConversationDetailDTO, PublicUserDTO, UsersResponse } from "@/types";
import type { ConversationListItemDTO } from "@shared/types";

interface ChatInfoPanelProps {
  me: PublicUserDTO;
  conversation: ConversationListItemDTO;
  detail: ConversationDetailDTO | null;
  onDetailRefresh: () => void;
}

export function ChatInfoPanel({ me, conversation, detail, onDetailRefresh }: ChatInfoPanelProps) {
  const queryClient = useQueryClient();
  const infoOpen = useUIStore((s) => s.infoOpen);
  const setInfoOpen = useUIStore((s) => s.setInfoOpen);
  const openConversation = useUIStore((s) => s.openConversation);

  const isGroup = conversation.type === "GROUP";
  const title = isGroup ? conversation.name ?? "Group" : conversation.otherParticipant?.name ?? "Chat";
  const avatarUrl = isGroup ? conversation.avatarUrl : conversation.otherParticipant?.avatarUrl;

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);

  const myRole = detail?.myRole ?? ParticipantRole.MEMBER;
  const isAdmin = myRole === ParticipantRole.OWNER || myRole === ParticipantRole.ADMIN;

  const { data: userResults } = useQuery({
    queryKey: ["users", `add-${addSearch}`],
    queryFn: () =>
      api<UsersResponse>(`/api/users?search=${encodeURIComponent(addSearch)}`).then((d) => d.users),
    enabled: showAddMember && addSearch.trim().length >= 2,
    staleTime: 15_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    onDetailRefresh();
  };

  const patchConversation = async (patch: Record<string, unknown>, successMessage?: string) => {
    try {
      await api(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await refresh();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error((error as Error).message || "Update failed");
    }
  };

  const renameGroup = async () => {
    const name = (nameDraft ?? "").trim();
    if (!name) return;
    await patchConversation({ name }, "Group renamed");
    setNameDraft(null);
  };

  const addMember = async (userId: string) => {
    await patchConversation({ addParticipantIds: [userId] }, "Member added");
    setAddSearch("");
  };

  const removeMember = async (userId: string, name: string) => {
    await patchConversation({ removeParticipantIds: [userId] }, `${name} removed`);
  };

  const leaveGroup = async () => {
    try {
      await api(`/api/conversations/${conversation.id}/leave`, { method: "POST" });
      setInfoOpen(false);
      openConversation(null);
      await refresh();
      toast.success(`You left "${title}"`);
    } catch (error) {
      toast.error((error as Error).message || "Could not leave the group");
    }
  };

  const memberIds = useMemo(() => new Set(detail?.participantDetails.map((p) => p.userId) ?? []), [detail]);

  return (
    <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
      <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border bg-panel-header">
          <SheetTitle>{isGroup ? "Group info" : "Contact info"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Identity block */}
          <div className="flex flex-col items-center gap-2 p-6 bg-panel">
            <Avatar name={title} src={avatarUrl} size="xl" />
            <h3 className="text-lg font-semibold text-foreground text-center">{title}</h3>
            <p className="text-sm text-muted-foreground text-center">
              {isGroup
                ? `Group · ${detail?.participantDetails.length ?? conversation.participants.length} members`
                : conversation.otherParticipant?.email}
            </p>
            {!isGroup && conversation.otherParticipant?.about && (
              <p className="text-sm text-muted-foreground text-center mt-1 italic">
                “{conversation.otherParticipant.about}”
              </p>
            )}
          </div>

          {/* Settings */}
          <div className="p-4 space-y-4 bg-panel mt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="mute-switch">Mute notifications</Label>
              <Switch
                id="mute-switch"
                checked={conversation.isMuted}
                onCheckedChange={(checked) => patchConversation({ isMuted: checked })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label htmlFor="pin-switch">Pin chat</Label>
              <Switch
                id="pin-switch"
                checked={conversation.isPinned}
                onCheckedChange={(checked) => patchConversation({ isPinned: checked })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label htmlFor="archive-switch">Archive chat</Label>
              <Switch
                id="archive-switch"
                checked={conversation.isArchived}
                onCheckedChange={(checked) => patchConversation({ isArchived: checked })}
              />
            </div>
          </div>

          {isGroup && (
            <>
              {/* Rename */}
              {isAdmin && (
                <div className="p-4 bg-panel mt-2">
                  <Label htmlFor="group-name-input" className="mb-2 block">
                    Group name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="group-name-input"
                      value={nameDraft ?? conversation.name ?? ""}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="Group name"
                      maxLength={60}
                    />
                    <Button
                      size="sm"
                      onClick={renameGroup}
                      disabled={!nameDraft || nameDraft.trim() === conversation.name}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Save
                    </Button>
                  </div>
                </div>
              )}

              {/* Members */}
              <div className="p-4 bg-panel mt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">
                    {detail?.participantDetails.length ?? conversation.participants.length} members
                  </p>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary"
                      onClick={() => setShowAddMember((v) => !v)}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Add member
                    </Button>
                  )}
                </div>

                {showAddMember && (
                  <div className="mb-3 space-y-2 rounded-lg border border-border p-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                      <Input
                        value={addSearch}
                        onChange={(e) => setAddSearch(e.target.value)}
                        placeholder="Search people to add"
                        className="pl-9"
                        aria-label="Search people to add to the group"
                      />
                    </div>
                    {addSearch.trim().length >= 2 && (
                      <ul className="max-h-40 overflow-y-auto scrollbar-thin">
                        {(userResults ?? [])
                          .filter((u) => !memberIds.has(u.id))
                          .map((user) => (
                            <li key={user.id}>
                              <button
                                type="button"
                                onClick={() => addMember(user.id)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                              >
                                <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm truncate">{user.name}</span>
                                  <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
                                </span>
                                <UserPlus className="h-4 w-4 text-primary" aria-hidden />
                              </button>
                            </li>
                          ))}
                        {(userResults ?? []).filter((u) => !memberIds.has(u.id)).length === 0 && (
                          <li className="text-xs text-muted-foreground px-2 py-2">
                            No new people found
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}

                <ul className="space-y-1">
                  {(detail?.participantDetails ?? []).map((p) => {
                    const isOwner = p.role === ParticipantRole.OWNER;
                    const canRemove =
                      isAdmin && !isOwner && p.userId !== me.id;
                    return (
                      <li
                        key={p.userId}
                        className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/50"
                      >
                        <Avatar name={p.user.name} src={p.user.avatarUrl} size="md" online={p.user.isOnline} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-foreground truncate">
                            {p.user.name}
                            {p.userId === me.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {isOwner ? "Group owner" : p.role === ParticipantRole.ADMIN ? "Admin" : "Member"}
                          </span>
                        </span>
                        {isOwner && <Crown className="h-4 w-4 text-amber-500" aria-label="Group owner" />}
                        {!isOwner && p.role === ParticipantRole.ADMIN && (
                          <Shield className="h-4 w-4 text-muted-foreground" aria-label="Admin" />
                        )}
                        {canRemove && (
                          <button
                            type="button"
                            onClick={() => removeMember(p.userId, p.user.name)}
                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`Remove ${p.user.name} from the group`}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Leave */}
              <div className="p-4 bg-panel mt-2">
                <Button
                  variant="ghost"
                  className={cn("w-full text-destructive hover:text-destructive hover:bg-destructive/10")}
                  onClick={leaveGroup}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  Leave group
                </Button>
              </div>
            </>
          )}

          {!isGroup && conversation.otherParticipant && (
            <div className="p-4 bg-panel mt-2 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  About
                </p>
                <p className="text-sm text-foreground">{conversation.otherParticipant.about}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Email
                </p>
                <p className="text-sm text-foreground font-mono">{conversation.otherParticipant.email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <Trash2 className="h-3 w-3" aria-hidden /> Danger zone
                </p>
                <p className="text-xs text-muted-foreground">
                  Use the chat list context menu to archive this conversation.
                </p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
