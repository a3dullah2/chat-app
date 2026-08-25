"use client";

import { Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessageDTO } from "@shared/types";

/** Delivery ticks: clock (pending) → ✗ (failed) → ✓ (sent) → ✓✓ (delivered) → blue ✓✓ (read). */
export function Ticks({
  status,
  pending,
  failed,
  className,
}: {
  status: MessageDTO["status"];
  pending?: boolean;
  failed?: boolean;
  className?: string;
}) {
  if (pending) return <ClockTicks className={className} />;
  if (failed) return <CrossTicks className={className} />;
  if (status === "READ") {
    return <CheckCheck className={cn("h-4 w-4 text-tick-read", className)} aria-label="Read" />;
  }
  if (status === "DELIVERED") {
    return <CheckCheck className={cn("h-4 w-4 opacity-70", className)} aria-label="Delivered" />;
  }
  return <Check className={cn("h-4 w-4 opacity-70", className)} aria-label="Sent" />;
}

function ClockTicks({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("h-4 w-4 opacity-60 animate-spin [animation-duration:3s]", className)}
      aria-label="Sending"
      role="img"
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5 V8 L10.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CrossTicks({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-4 w-4 text-destructive", className)} aria-label="Failed to send" role="img">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
