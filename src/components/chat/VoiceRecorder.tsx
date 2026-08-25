"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSendMessage } from "@/hooks/useChatData";
import { formatDuration } from "@shared/format";
import { Button } from "@/components/ui/button";
import type { MessageDTO, PublicUserDTO } from "@/types";

interface VoiceRecorderProps {
  conversationId: string;
  me: PublicUserDTO;
  onCancel: () => void;
  onSent: () => void;
  replyTo: MessageDTO | null;
}

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function VoiceRecorder({ conversationId, me, onCancel, onSent, replyTo }: VoiceRecorderProps) {
  const { send } = useSendMessage(me);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    cancelledRef.current = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = pickAudioMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = async () => {
          stream?.getTracks().forEach((track) => track.stop());
          if (cancelledRef.current) return;

          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size < 512) {
            toast.error("Recording was too short");
            onSent();
            return;
          }

          setSending(true);
          try {
            // Upload then send the AUDIO message (duration passed via form field).
            const durationSec = Math.max(1, Math.round(secondsRef.current));
            const form = new FormData();
            const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
            form.append("file", blob, `voice-note.${ext}`);
            form.append("durationSec", String(durationSec));

            const res = await fetch("/api/upload", { method: "POST", body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Upload failed");

            await send(conversationId, {
              type: "AUDIO",
              attachmentId: data.attachment.id,
              replyToId: replyTo?.id ?? null,
              replyTo,
              attachments: [
                {
                  id: data.attachment.id,
                  url: "#",
                  mimeType: data.attachment.mimeType,
                  size: data.attachment.size,
                  fileName: data.attachment.fileName,
                  durationSec,
                  width: null,
                  height: null,
                  thumbnailUrl: null,
                },
              ],
            });
            onSent();
          } catch (error) {
            toast.error((error as Error).message || "Could not send the voice note");
          } finally {
            setSending(false);
          }
        };

        recorder.start(250);
        timerRef.current = setInterval(() => {
          setSeconds((s) => s + 1);
        }, 1000);
      } catch {
        toast.error("Microphone access was denied");
        onCancel();
      }
    };

    start();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const secondsRef = useRef(0);
  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  const stop = (cancelled: boolean) => {
    cancelledRef.current = cancelled;
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (cancelled) {
      streamCleanup();
      onCancel();
    }
  };

  const streamCleanup = () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  };

  return (
    <div className="shrink-0 px-2 pb-2 md:px-3 md:pb-3">
      <div className="rounded-[24px] bg-surface-container-high px-3 py-2.5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => stop(true)}
          className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Cancel recording"
          disabled={sending}
        >
          <Trash2 className="h-5 w-5" aria-hidden />
        </button>

        <span className="flex items-center gap-2 text-sm text-foreground font-medium tabular-nums">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive voice-bar" aria-hidden />
          {formatDuration(seconds)}
        </span>

        {/* Waveform placeholder */}
        <div className="flex-1 flex items-center gap-[3px] h-8 overflow-hidden" aria-hidden>
          {Array.from({ length: 32 }).map((_, i) => (
            <span
              key={i}
              className="flex-1 rounded-full bg-primary/60 voice-bar"
              style={{
                height: `${25 + ((i * 37) % 70)}%`,
                animationDelay: `${(i % 8) * 0.12}s`,
              }}
            />
          ))}
        </div>

        <Button
          size="icon"
          className="shrink-0 h-10 w-10"
          onClick={() => stop(false)}
          disabled={sending}
          aria-label="Send voice message"
        >
          <Send className="h-5 w-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
