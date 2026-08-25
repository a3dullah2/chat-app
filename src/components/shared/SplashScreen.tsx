"use client";

import { MessageCircle } from "lucide-react";

export function SplashScreen() {
  return (
    <div className="h-dvh w-full flex flex-col items-center justify-center gap-4 bg-background">
      <div className="relative">
        <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <MessageCircle className="h-8 w-8 text-primary-foreground" aria-hidden />
        </div>
        <span className="absolute inset-0 -m-2 rounded-full border-2 border-primary/30 animate-ping" />
      </div>
      <p className="text-sm text-muted-foreground">Loading ChatApp…</p>
    </div>
  );
}
