"use client";

import { memo, useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  Smile,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { mergeMessage, setOptimisticState } from "@/lib/message-cache";
import { useUIStore } from "@/stores/ui-store";
import { Avatar } from "@/components/shared/Avatar";
import { Ticks } from "@/components/shared/Ticks";
import { AudioPlayer } from "@/components/chat/AudioPlayer";
import { EmojiGrid, QUICK_EMOJIS } from "@/components/emoji/EmojiPicker";
import { formatTime, formatBytes } from "@shared/format";
import { EDIT_WINDOW_MS } from "@shared/constants";
import { cn } from "@/lib/utils";
import type { MessageDTO } from "@shared/types";
import type { ClientMessage, ConversationListItemDTO, PublicUserDTO } from "@/types";

// Username accent colours (Stoat colours usernames per user).
const SENDER_COLORS = [
  "text-rose-500 dark:text-rose-300",
  "text-amber-600 dark:text-amber-300",
  "text-emerald-600 dark:text-emerald-300",
  "text-sky-600 dark:text-sky-300",
  "text-violet-600 dark:text-violet-300",
  "text-teal-600 dark:text-teal-300",
];

function senderColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

interface MessageBubbleProps {
  me: PublicUserDTO;
  conversation: ConversationListItemDTO;
  message: ClientMessage;
  isFirstOfGroup: boolean;
  isLastOfGroup: boolean;
  showSender: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  me,
  conversation,
  message,
  isFirstOfGroup,
  isLastOfGroup,
}: MessageBubbleProps) {
  const queryClient = useQueryClient();
  const setReplyTo = useUIStore((s) => s.setReplyTo);
  const setEditing = useUIStore((s) => s.setEditing);
  const setLightbox = useUIStore((s) => s.setLightbox);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reactBarOpen, setReactBarOpen] = useState(false);
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const mine = message.senderId === me.id;
  const isGroup = conversation.type === "GROUP";
  const deleted = message.deletedAt !== null;
  const pending = !!message.pending;
  const failed = !!message.failed;
  const canEdit =
    mine && message.type === "TEXT" && !deleted && !pending && !failed &&
    Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
  const canDeleteForEveryone = mine && !deleted && !pending && !failed;

  const toggleReaction = useCallback(
    (emoji: string) => {
      getSocket().emit("reaction:toggle", { messageId: message.id, emoji });
      setReactBarOpen(false);
      setFullPickerOpen(false);
      setActionsOpen(false);
    },
    [message.id],
  );

  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("message-flash");
      setTimeout(() => el.classList.remove("message-flash"), 1800);
    } else {
      toast.info("That message is further back — scroll up to load it");
    }
  }, []);

  const deleteMessage = useCallback(
    (forEveryone: boolean) => {
      getSocket().emit(
        "message:delete",
        { messageId: message.id, forEveryone },
        (res: { error?: string }) => {
          if (res?.error) toast.error(res.error);
        },
      );
      setActionsOpen(false);
    },
    [message.id],
  );

  const retry = useCallback(() => {
    if (!message.clientId) return;
    setOptimisticState(queryClient, message.conversationId, message.clientId, {
      pending: true,
      failed: false,
    });
    getSocket().emit(
      "message:send",
      {
        clientId: message.clientId,
        conversationId: message.conversationId,
        type: message.type,
        text: message.text,
        replyToId: message.replyTo?.id ?? null,
        attachmentId: message.attachments[0]?.id ?? null,
      },
      (res: { message?: MessageDTO; error?: string }) => {
        if (res?.error) {
          setOptimisticState(queryClient, message.conversationId, message.clientId, {
            pending: false,
            failed: true,
          });
          toast.error(res.error);
        } else if (res?.message) {
          mergeMessage(queryClient, res.message);
        }
      },
    );
  }, [message, queryClient]);

  const copyText = useCallback(() => {
    if (message.text) {
      navigator.clipboard
        .writeText(message.text)
        .then(() => toast.success("Copied to clipboard"))
        .catch(() => toast.error("Could not copy"));
    }
    setActionsOpen(false);
  }, [message.text]);

  const startLongPress = useCallback(() => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setActionsOpen(true);
    }, 450);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // -------------------------------------------------------------------
  // SYSTEM messages: compact muted line
  // -------------------------------------------------------------------
  if (message.type === "SYSTEM") {
    return (
      <div className="flex justify-center py-1.5 px-4" data-mid={message.id}>
        <span className="text-[12px] text-muted-foreground text-center max-w-[80%]">
          {message.text}
        </span>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // STICKER messages: 160×160 image, no bubble, no caption (Telegram style)
  // -------------------------------------------------------------------
  if (message.type === "STICKER" && message.sticker && !deleted) {
    return (
      <div
        className={cn(
          "group relative w-full rounded-[12px] transition-colors",
          isFirstOfGroup ? "mt-3" : "mt-px",
          !actionsOpen && "hover:bg-surface-container",
        )}
        data-mid={message.id}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onContextMenu={(e) => {
          e.preventDefault();
          setActionsOpen(true);
        }}
      >
        {/* Hover / long-press action toolbar — same as text messages */}
        {menuOpen && (
          <div
            className="absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-full border border-border/60 bg-surface-container-high px-1 py-0.5 shadow-lg"
            role="toolbar"
            aria-label="Sticker actions"
          >
            <button
              type="button"
              onClick={() => {
                setReactBarOpen((v) => !v);
                setFullPickerOpen(false);
              }}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="React with an emoji"
              aria-expanded={reactBarOpen || fullPickerOpen}
            >
              <Smile className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyTo(message);
                setActionsOpen(false);
              }}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Reply to this sticker"
            >
              <CornerUpLeft className="h-4 w-4" aria-hidden />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setActionsOpen((v) => !v)}
                className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-label="More sticker actions"
                aria-expanded={actionsOpen}
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
              </button>
              {actionsOpen && (
                <div
                  className="absolute top-8 right-0 z-20 w-48 rounded-[16px] border border-border bg-popover text-popover-foreground shadow-lg py-1.5"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => deleteMessage(false)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete for me
                  </button>
                  {canDeleteForEveryone && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => deleteMessage(true)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-destructive hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                    >
                      <Ban className="h-4 w-4" aria-hidden />
                      Delete for everyone
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex w-full px-3 md:px-4 py-0.5">
          {/* Avatar gutter (group only; otherwise just spacer) */}
          <div className="w-[54px] shrink-0 flex justify-end pr-2 pt-0.5">
            {isFirstOfGroup ? (
              <Avatar name={message.sender.name} src={message.sender.avatarUrl} size="msg" />
            ) : (
              <span
                className={cn(
                  "text-[10.5px] leading-5 text-muted-foreground/80 transition-opacity",
                  isLastOfGroup ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                {timeLabel}
              </span>
            )}
          </div>

          <div className={cn("flex-1 min-w-0 pr-4 flex flex-col", mine ? "items-end" : "items-start")}>
            {isFirstOfGroup && (
              <div className="flex items-baseline gap-2 flex-wrap min-w-0 mb-0.5">
                <span
                  className={cn(
                    "text-[14px] font-semibold truncate max-w-[60%]",
                    mine ? "text-primary" : senderColor(message.senderId),
                  )}
                >
                  {mine ? "You" : message.sender.name}
                </span>
                <span className="text-[11px] text-muted-foreground/80 shrink-0">{timeLabel}</span>
                {mine && !pending && !failed && (
                  <Ticks status={message.status} className="h-3.5 w-3.5 shrink-0 -ml-1" />
                )}
                {failed && (
                  <button
                    type="button"
                    onClick={retry}
                    className="flex items-center gap-1 text-[11px] text-destructive hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded"
                    aria-label="Retry sending this sticker"
                  >
                    <Trash2 className="h-3 w-3 rotate-45" aria-hidden />
                    Retry
                  </button>
                )}
              </div>
            )}
            {/* Sticker image: 160×160 desktop, 120×120 mobile, no bubble */}
            <img
              src={message.sticker.url}
              alt={message.sticker.emoji ? `${message.sticker.emoji} sticker` : "Sticker"}
              draggable={false}
              loading="lazy"
              className="w-[120px] h-[120px] md:w-[160px] md:h-[160px] object-contain select-none pointer-events-auto"
            />
            {message.reactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 relative z-[1] max-w-[200px]">
                {message.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => toggleReaction(r.emoji)}
                    title={r.users.join(", ")}
                    aria-label={`${r.emoji} reaction, ${r.count}. ${r.reactedByMe ? "You reacted — click to remove" : "Click to react"}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-ring",
                      r.reactedByMe
                        ? "bg-primary-container border-primary/40 text-primary-container-foreground"
                        : "bg-surface-container-high border-transparent text-foreground hover:bg-surface-container-highest",
                    )}
                  >
                    <span aria-hidden>{r.emoji}</span>
                    {r.count > 1 && <span className="font-medium text-[11px]">{r.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const timeLabel = formatTime(new Date(message.createdAt));
  const menuOpen = actionsOpen || reactBarOpen || fullPickerOpen;

  return (
    <div
      className={cn(
        "group relative w-full rounded-[12px] transition-colors",
        isFirstOfGroup ? "mt-3" : "mt-px",
        !menuOpen && "hover:bg-surface-container",
        failed && "text-destructive",
        pending && "text-muted-foreground",
      )}
      data-mid={message.id}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onContextMenu={(e) => {
        e.preventDefault();
        setActionsOpen(true);
      }}
    >
      {/* Hover / long-press action toolbar (top-right, Stoat style) */}
      {menuOpen && (
        <div
          className="absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-full border border-border/60 bg-surface-container-high px-1 py-0.5 shadow-lg"
          role="toolbar"
          aria-label="Message actions"
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setReactBarOpen((v) => !v);
                setFullPickerOpen(false);
              }}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="React with an emoji"
              aria-expanded={reactBarOpen || fullPickerOpen}
            >
              <Smile className="h-4 w-4" aria-hidden />
            </button>
            {reactBarOpen && !fullPickerOpen && (
              <div
                className="absolute bottom-9 right-0 z-20 flex items-center gap-0.5 rounded-full border border-border/60 bg-surface-container-high px-1 py-0.5 shadow-lg"
                role="menu"
                aria-label="Quick reactions"
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => toggleReaction(emoji)}
                    className="h-8 w-8 rounded-full flex items-center justify-center text-lg hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFullPickerOpen(true)}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="More emojis"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
            {fullPickerOpen && (
              <div
                className="absolute bottom-9 right-0 z-30 rounded-[16px] border border-border bg-popover text-popover-foreground shadow-xl p-2"
                role="dialog"
                aria-label="Emoji picker"
              >
                <EmojiGrid onPick={toggleReaction} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyTo(message);
              setActionsOpen(false);
            }}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Reply to this message"
          >
            <CornerUpLeft className="h-4 w-4" aria-hidden />
          </button>
          {message.type === "TEXT" && !deleted && (
            <button
              type="button"
              onClick={copyText}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Copy message text"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="More message actions"
              aria-expanded={actionsOpen}
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
            {actionsOpen && (
              <div
                className="absolute top-8 right-0 z-20 w-48 rounded-[16px] border border-border bg-popover text-popover-foreground shadow-lg py-1.5"
                role="menu"
              >
                {canEdit && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setEditing(message);
                      setActionsOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit message
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => deleteMessage(false)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete for me
                </button>
                {canDeleteForEveryone && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => deleteMessage(true)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-destructive hover:bg-accent focus-visible:bg-accent focus-visible:outline-none text-left"
                  >
                    <Ban className="h-4 w-4" aria-hidden />
                    Delete for everyone
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row */}
      <div className="flex w-full px-3 md:px-4 py-0.5">
        {/* Left gutter: avatar on group head, time on hover for tails */}
        <div className="w-[54px] shrink-0 flex justify-end pr-2 pt-0.5">
          {isFirstOfGroup ? (
            <Avatar name={message.sender.name} src={message.sender.avatarUrl} size="msg" />
          ) : (
            <span
              className={cn(
                "text-[10.5px] leading-5 text-muted-foreground/80 transition-opacity",
                isLastOfGroup ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {timeLabel}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-4">
          {/* Quoted reply */}
          {message.replyTo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                scrollToMessage(message.replyTo!.id);
              }}
              className="flex items-center gap-2 w-full text-left mb-1 rounded-[8px] border-l-2 border-primary bg-surface-container-high/70 px-2 py-1 focus-visible:outline-2 focus-visible:outline-ring max-w-full"
              aria-label="Jump to quoted message"
            >
              <span className="flex flex-col min-w-0">
                <span className="block text-[11.5px] font-semibold text-primary truncate">
                  {message.replyTo.senderName}
                </span>
                <span className="block text-[11.5px] text-muted-foreground truncate">
                  {message.replyTo.preview}
                </span>
              </span>
            </button>
          )}

          {/* Header line: username + time + delivery */}
          {isFirstOfGroup && (
            <div className="flex items-baseline gap-2 flex-wrap min-w-0">
              <span
                className={cn(
                  "text-[14px] font-semibold truncate max-w-[60%]",
                  mine ? "text-primary" : senderColor(message.senderId),
                )}
              >
                {mine ? "You" : message.sender.name}
              </span>
              <span className="text-[11px] text-muted-foreground/80 shrink-0">{timeLabel}</span>
              {message.editedAt && !deleted && (
                <span className="text-[11px] text-muted-foreground/70 shrink-0">(edited)</span>
              )}
              {mine && !pending && !failed && (
                <Ticks status={message.status} className="h-3.5 w-3.5 shrink-0 -ml-1" />
              )}
              {failed && (
                <button
                  type="button"
                  onClick={retry}
                  className="flex items-center gap-1 text-[11px] text-destructive hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded"
                  aria-label="Retry sending this message"
                >
                  <Trash2 className="h-3 w-3 rotate-45" aria-hidden />
                  Retry
                </button>
              )}
            </div>
          )}

          <MessageContent
            message={message}
            onOpenImage={(src, alt) => setLightbox({ src, alt })}
          />

          {/* Reaction pills */}
          {message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 relative z-[1]">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => toggleReaction(r.emoji)}
                  title={r.users.join(", ")}
                  aria-label={`${r.emoji} reaction, ${r.count}. ${r.reactedByMe ? "You reacted — click to remove" : "Click to react"}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-ring",
                    r.reactedByMe
                      ? "bg-primary-container border-primary/40 text-primary-container-foreground"
                      : "bg-surface-container-high border-transparent text-foreground hover:bg-surface-container-highest",
                  )}
                >
                  <span aria-hidden>{r.emoji}</span>
                  {r.count > 1 && <span className="font-medium text-[11px]">{r.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function MessageContent({
  message,
  onOpenImage,
}: {
  message: ClientMessage;
  onOpenImage: (src: string, alt: string) => void;
}) {
  const deleted = message.deletedAt !== null;

  if (deleted) {
    return (
      <p className="italic text-muted-foreground text-[13.5px] flex items-center gap-1.5">
        <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
        This message was deleted
      </p>
    );
  }

  const attachment = message.attachments[0];

  switch (message.type) {
    case "IMAGE":
      return (
        <span className="block">
          {attachment && (

            <img
              src={attachment.thumbnailUrl ?? attachment.url}
              alt={message.text || attachment.fileName}
              loading="lazy"
              onClick={(e) => {
                e.stopPropagation();
                onOpenImage(attachment.url, message.text || attachment.fileName);
              }}
              className="rounded-[12px] max-w-[min(420px,100%)] w-full cursor-zoom-in object-cover my-0.5"
            />
          )}
          {message.text && <span className="block whitespace-pre-wrap break-words mt-1">{message.text}</span>}
        </span>
      );
    case "VIDEO":
      return (
        <span className="block">
          {attachment && (
            <video
              src={attachment.url}
              controls
              preload="metadata"
              className="rounded-[12px] max-w-[min(420px,100%)] w-full my-0.5"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {message.text && <span className="block whitespace-pre-wrap break-words mt-1">{message.text}</span>}
        </span>
      );
    case "AUDIO":
      return (
        <span className="block max-w-[360px]">
          {attachment && <AudioPlayer attachment={attachment} messageId={message.id} />}
        </span>
      );
    case "FILE":
      return (
        <span className="block">
          {attachment && (
            <a
              href={attachment.url}
              download={attachment.fileName}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-3 rounded-[12px] bg-surface-container-high p-2.5 hover:bg-surface-container-highest transition-colors focus-visible:outline-2 focus-visible:outline-ring max-w-[360px]"
              aria-label={`Download ${attachment.fileName}`}
            >
              <span className="h-10 w-10 rounded-full bg-primary-container text-primary-container-foreground flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium truncate max-w-[180px]">
                  {attachment.fileName}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
              </span>
              <Download className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            </a>
          )}
        </span>
      );
    default:
      return <p className="whitespace-pre-wrap break-words">{message.text}</p>;
  }
}
