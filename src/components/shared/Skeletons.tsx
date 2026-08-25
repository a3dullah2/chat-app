"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ChatListSkeleton() {
  return (
    <div className="p-2 space-y-1" aria-label="Loading conversations">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
          <Skeleton className="h-12 w-12 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function MessagePaneSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6 max-w-[65%]" aria-label="Loading messages">
      <Skeleton className="h-16 w-3/5 rounded-lg self-start" />
      <Skeleton className="h-10 w-2/5 rounded-lg self-start" />
      <Skeleton className="h-12 w-1/2 rounded-lg self-end" />
      <Skeleton className="h-20 w-2/3 rounded-lg self-start" />
      <Skeleton className="h-10 w-1/3 rounded-lg self-end" />
      <Skeleton className="h-14 w-3/5 rounded-lg self-start" />
    </div>
  );
}
