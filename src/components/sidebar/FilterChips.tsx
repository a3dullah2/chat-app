"use client";

import { cn } from "@/lib/utils";
import type { ConversationFilter } from "@/components/sidebar/Sidebar";

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "groups", label: "Groups" },
];

export function FilterChips({
  value,
  onChange,
  unreadCount,
}: {
  value: ConversationFilter;
  onChange: (value: ConversationFilter) => void;
  unreadCount: number;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter conversations">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          aria-pressed={value === f.value}
          onClick={() => onChange(f.value)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === f.value
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90",
          )}
        >
          {f.label}
          {f.value === "unread" && unreadCount > 0 && (
            <span className="ml-1.5 inline-block rounded-full bg-badge-unread text-white text-[10px] px-1.5 min-w-4 text-center">
              {unreadCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
