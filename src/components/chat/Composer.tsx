"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Smile, X, FileText, Loader2, CornerUpLeft, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { useSendMessage } from "@/hooks/useChatData";
import { useUIStore } from "@/stores/ui-store";
import { useDraftsStore } from "@/stores/drafts-store";
import { VoiceRecorder } from "@/components/chat/VoiceRecorder";
import { EmojiGrid } from "@/components/emoji/EmojiPicker";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAX_TEXT_LENGTH, TYPING_THROTTLE_MS, DEFAULT_MAX_UPLOAD_MB } from "@shared/constants";
import { formatBytes } from "@shared/format";
import { cn } from "@/lib/utils";
import type { AttachmentDTO } from "@shared/types";
import type { ClientMessage, ConversationListItemDTO, PublicUserDTO } from "@/types";

interface PendingUpload {
  localId: string;
  fileName: string;
  mimeType: string;
  size: number;
  progress: number;
  attachmentId?: string;
  previewUrl?: string;
  error?: string;
}

function messageTypeFor(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

export function Composer({
  me,
  conversation,
}: {
  me: PublicUserDTO;
  conversation: ConversationListItemDTO;
}) {
  const { send } = useSendMessage(me);
  const replyTo = useUIStore((s) => s.replyTo);
  const setReplyTo = useUIStore((s) => s.setReplyTo);
  const editing = useUIStore((s) => s.editing);
  const setEditing = useUIStore((s) => s.setEditing);

  const drafts = useDraftsStore((s) => s.drafts);
  const setDraft = useDraftsStore((s) => s.setDraft);
  const clearDraft = useDraftsStore((s) => s.clearDraft);

  const [text, setText] = useState(() =>
    editing ? editing.text ?? "" : useDraftsStore.getState().drafts[conversation.id] ?? "",
  );
  const [attachments, setAttachments] = useState<PendingUpload[]>([]);
  const [recording, setRecording] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const typingLastEmit = useRef(0);
  const typingActive = useRef(false);

  // NOTE: the parent remounts the composer when the conversation (or edit
  // target) changes, so initial state below already reflects the right draft
  // and no setState-in-effect is needed.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Draft persistence (debounced).
  useEffect(() => {
    if (editing) return;
    const timer = setTimeout(() => {
      if (text.trim()) setDraft(conversation.id, text);
      else clearDraft(conversation.id);
    }, 400);
    return () => clearTimeout(timer);
  }, [text, conversation.id, editing]);

  // Auto-grow textarea up to ~6 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (editing) return;
      const now = Date.now();
      if (isTyping) {
        if (now - typingLastEmit.current < TYPING_THROTTLE_MS) return;
        typingLastEmit.current = now;
        typingActive.current = true;
        getSocket().emit("typing:start", { conversationId: conversation.id });
      } else if (typingActive.current) {
        typingActive.current = false;
        getSocket().emit("typing:stop", { conversationId: conversation.id });
      }
    },
    [conversation.id, editing],
  );

  useEffect(() => {
    return () => {
      if (typingActive.current) {
        getSocket().emit("typing:stop", { conversationId: conversation.id });
      }
    };
  }, [conversation.id]);

  // ---------------------------------------------------------------
  // Uploads
  // ---------------------------------------------------------------
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        if (file.size > DEFAULT_MAX_UPLOAD_MB * 1024 * 1024) {
          toast.error(`"${file.name}" is larger than ${DEFAULT_MAX_UPLOAD_MB} MB`);
          continue;
        }
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        setAttachments((prev) => [
          ...prev,
          {
            localId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            progress: 0,
            previewUrl,
          },
        ]);

        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("file", file);
        xhr.open("POST", "/api/upload");
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setAttachments((prev) =>
              prev.map((a) => (a.localId === localId ? { ...a, progress } : a)),
            );
          }
        });
        xhr.addEventListener("load", () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.localId === localId ? { ...a, attachmentId: data.attachment.id, progress: 100 } : a,
                ),
              );
            } else {
              setAttachments((prev) =>
                prev.map((a) => (a.localId === localId ? { ...a, error: data.error ?? "Upload failed" } : a)),
              );
              toast.error(data.error ?? `Upload failed for "${file.name}"`);
            }
          } catch {
            setAttachments((prev) =>
              prev.map((a) => (a.localId === localId ? { ...a, error: "Upload failed" } : a)),
            );
          }
        });
        xhr.addEventListener("error", () => {
          setAttachments((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, error: "Upload failed" } : a)),
          );
        });
        xhr.send(form);
      }
    },
    [],
  );

  // Paste images straight into the composer (FR-05 AC1).
  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  // Drag & drop overlay (window-level so drops anywhere work).
  useEffect(() => {
    let dragDepth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragDepth += 1;
        setDragOver(true);
      }
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      dragDepth = 0;
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  // ---------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------
  const canSend =
    !editing && (text.trim().length > 0 || attachments.some((a) => a.attachmentId && !a.error));

  const doSend = useCallback(async () => {
    if (editing) return;
    const trimmed = text.trim();
    const ready = attachments.filter((a) => a.attachmentId && !a.error);
    if (!trimmed && ready.length === 0) return;

    const replyToId = replyTo?.id ?? null;
    const replyMessage = replyTo;

    emitTyping(false);
    setText("");
    setAttachments([]);
    clearDraft(conversation.id);
    setReplyTo(null);

    if (ready.length === 0) {
      await send(conversation.id, { type: "TEXT", text: trimmed, replyToId, replyTo: replyMessage });
      return;
    }

    // One message per attachment (WhatsApp behaviour); first carries the caption.
    for (let i = 0; i < ready.length; i++) {
      const a = ready[i];
      await send(conversation.id, {
        type: messageTypeFor(a.mimeType),
        text: i === 0 ? trimmed || null : null,
        replyToId: i === 0 ? replyToId : null,
        attachmentId: a.attachmentId,
        replyTo: i === 0 ? replyMessage : null,
        attachments: [
          {
            id: a.attachmentId!,
            url: "#",
            mimeType: a.mimeType,
            size: a.size,
            fileName: a.fileName,
            durationSec: null,
            width: null,
            height: null,
            thumbnailUrl: a.previewUrl ?? null,
          } satisfies AttachmentDTO,
        ],
      });
    }
  }, [editing, text, attachments, replyTo, conversation.id, send, emitTyping, clearDraft, setReplyTo]);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Message cannot be empty");
      return;
    }
    getSocket().emit(
      "message:edit",
      { messageId: editing.id, text: trimmed },
      (res: { error?: string }) => {
        if (res?.error) toast.error(res.error);
      },
    );
    setEditing(null);
    setText("");
  }, [editing, text, setEditing]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      setEditing(null);
      setText("");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (editing) saveEdit();
      else doSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  if (recording) {
    return (
      <VoiceRecorder
        conversationId={conversation.id}
        me={me}
        onCancel={() => setRecording(false)}
        onSent={() => setRecording(false)}
        replyTo={replyTo}
      />
    );
  }

  return (
    <div className="shrink-0 px-2 pb-2 md:px-3 md:pb-3">
      {/* Drag & drop overlay */}
      {dragOver && (
        <div
          className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-[1px] border-4 border-dashed border-primary/60 flex items-center justify-center pointer-events-none"
          role="status"
          aria-label="Drop files to attach"
        >
          <p className="rounded-[16px] bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg">
            Drop files to attach
          </p>
        </div>
      )}

      {/* Reply / edit preview */}
      {(replyTo || editing) && (
        <div className="mb-1.5">
          <div className="flex items-center gap-2 rounded-[16px] bg-surface-container-high px-3 py-2 border-l-4 border-primary">
            {editing ? (
              <Pencil className="h-4 w-4 text-primary shrink-0" aria-hidden />
            ) : (
              <CornerUpLeft className="h-4 w-4 text-primary shrink-0" aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary">
                {editing ? "Editing message" : `Replying to ${replyTo!.sender.name}`}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {editing ? editing.text : replyTo!.text ?? replyTo!.attachments[0]?.fileName ?? "Attachment"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  setEditing(null);
                  setText("");
                } else {
                  setReplyTo(null);
                }
              }}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={editing ? "Cancel edit" : "Cancel reply"}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* Pending attachments */}
      {attachments.length > 0 && (
        <div className="mb-1.5 flex gap-2 overflow-x-auto scrollbar-thin">
          {attachments.map((a) => (
            <div
              key={a.localId}
              className="relative rounded-[12px] bg-surface-container-high p-2 flex items-center gap-2 min-w-[140px]"
            >
              {a.previewUrl ? (
                <img src={a.previewUrl} alt={a.fileName} className="h-12 w-12 rounded-[8px] object-cover" />
              ) : (
                <span className="h-12 w-12 rounded-[8px] bg-primary-container text-primary-container-foreground flex items-center justify-center">
                  <FileText className="h-5 w-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate max-w-[110px]">{a.fileName}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(a.size)}</p>
                {a.error ? (
                  <p className="text-[11px] text-destructive">{a.error}</p>
                ) : a.attachmentId ? (
                  <p className="text-[11px] text-primary">Ready</p>
                ) : (
                  <div
                    className="h-1 rounded-full bg-surface-container-highest overflow-hidden mt-1"
                    role="progressbar"
                    aria-valuenow={a.progress}
                    aria-label={`Uploading ${a.fileName}`}
                  >
                    <div className="h-full bg-primary transition-all" style={{ width: `${a.progress}%` }} />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.localId !== a.localId))}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Remove ${a.fileName}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer bar — one rounded surface like Stoat */}
      <div className="flex items-end gap-1 rounded-[24px] bg-surface-container-high py-1 pl-1 pr-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground shrink-0 size-10 hover:bg-surface-container-highest"
              aria-label="Attach a file"
            >
              <Plus className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="rounded-[16px]">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              Photo or video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => docInputRef.current?.click()}>
              Document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            emitTyping(e.target.value.trim().length > 0);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => emitTyping(false)}
          rows={1}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={editing ? "Edit your message…" : "Type a message"}
          aria-label={editing ? "Edit message text" : "Message text"}
          className="flex-1 min-w-0 resize-none bg-transparent px-2 py-2.5 text-[14px] leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none scrollbar-thin self-center max-h-[120px]"
        />

        {!canSend && !editing && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground shrink-0 size-10 hover:bg-surface-container-highest"
            onClick={() => setRecording(true)}
            aria-label="Record a voice message"
          >
            <Mic className="h-5 w-5" aria-hidden />
          </Button>
        )}

        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground shrink-0 size-10 hover:bg-surface-container-highest"
              aria-label="Insert emoji"
            >
              <Smile className="h-5 w-5" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-auto p-2 rounded-[16px]">
            <EmojiGrid onPick={insertEmoji} />
          </PopoverContent>
        </Popover>

        {editing ? (
          <Button
            size="icon"
            className="shrink-0 h-10 w-10"
            onClick={saveEdit}
            aria-label="Save edited message"
          >
            <Send className="h-5 w-5" aria-hidden />
          </Button>
        ) : canSend ? (
          <Button
            size="icon"
            className="shrink-0 h-10 w-10"
            onClick={doSend}
            aria-label="Send message"
          >
            <Send className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
      </div>
      {attachments.some((a) => !a.attachmentId && !a.error) && (
        <p className="px-2 pt-1.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Uploading attachments… they will be ready to send in a moment.
        </p>
      )}
    </div>
  );
}
