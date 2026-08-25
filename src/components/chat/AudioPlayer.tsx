"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Pause, Play } from "lucide-react";
import { formatDuration } from "@shared/format";
import type { AttachmentDTO } from "@shared/types";
import { cn } from "@/lib/utils";

// Only one voice note plays at a time.
interface PlayingStore {
  playingId: string | null;
  setPlaying: (id: string | null) => void;
}
const usePlayingStore = create<PlayingStore>((set) => ({
  playingId: null,
  setPlaying: (id) => set({ playingId: id }),
}));

/** Static waveform placeholder bars (deterministic per message). */
function barsFor(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) | 0;
  const bars: number[] = [];
  let state = Math.abs(hash) || 42;
  for (let i = 0; i < 28; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bars.push(20 + (state % 80));
  }
  return bars;
}

export function AudioPlayer({ attachment, messageId }: { attachment: AttachmentDTO; messageId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setLocalPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const playingId = usePlayingStore((s) => s.playingId);
  const setPlaying = usePlayingStore((s) => s.setPlaying);
  const bars = useMemo(() => barsFor(messageId), [messageId]);
  const duration = attachment.durationSec ?? 0;

  // Pause when another voice note starts playing.
  useEffect(() => {
    if (playingId !== messageId && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [playingId, messageId]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setPlaying(messageId);
      setLocalPlaying(true);
      audio.play().catch(() => {
        setLocalPlaying(false);
        setPlaying(null);
      });
    } else {
      audio.pause();
      setLocalPlaying(false);
      setPlaying(null);
    }
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;
    setCurrent(audio.currentTime);
    setProgress(audio.currentTime / audio.duration);
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  };

  return (
    <div
      className="flex items-center gap-2.5 py-0.5"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label="Voice message player"
    >
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={() => {
          setLocalPlaying(false);
          setPlaying(null);
          setProgress(0);
          setCurrent(0);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 ml-0.5" aria-hidden />}
      </button>

      <div
        className="flex-1 min-w-[140px] cursor-pointer"
        onClick={seek}
        role="slider"
        aria-label="Seek voice message"
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            const audio = audioRef.current;
            if (audio) audio.currentTime += (e.key === "ArrowRight" ? 5 : -5);
          }
        }}
      >
        <div className="flex items-center gap-[2px] h-8">
          {bars.map((height, i) => {
            const filled = i / bars.length <= progress;
            return (
              <span
                key={i}
                aria-hidden
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  filled ? "bg-primary" : "bg-muted-foreground/35",
                )}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      </div>

      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
        {formatDuration(playing || current > 0 ? current : duration)}
      </span>
    </div>
  );
}
