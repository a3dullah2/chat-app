"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

// Stoat-like vivid default avatar colours.
const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-fuchsia-500",
  "bg-red-500",
  "bg-cyan-600",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl" | "msg";
  online?: boolean;
  className?: string;
  /** Ring colour for the presence dot (should match the surface behind it). */
  dotRing?: string;
}

const SIZES: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-11 w-11 text-[15px]",
  xl: "h-24 w-24 text-3xl",
  msg: "h-9 w-9 text-[13px]",
};

export function Avatar({ name, src, size = "md", online, className, dotRing = "ring-panel" }: AvatarProps) {
  const color = useMemo(() => colorFor(name || "?"), [name]);
  const dotSize = size === "xl" ? "h-5 w-5" : size === "sm" || size === "msg" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {src ? (

        <img
          src={src}
          alt={name}
          className={cn("rounded-full object-cover bg-surface-container-high", SIZES[size])}
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "rounded-full flex items-center justify-center font-semibold text-white select-none",
            color,
            SIZES[size],
          )}
        >
          {initialsOf(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          aria-label={online ? "online" : "offline"}
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2",
            dotRing,
            dotSize,
            online ? "bg-presence-online" : "bg-presence-offline",
          )}
        />
      )}
    </span>
  );
}
