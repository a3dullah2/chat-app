"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useConnectionStore } from "@/stores/realtime-stores";

/**
 * Amber banner shown while the socket is disconnected.
 *
 * Two cases:
 * - The socket was connected before and dropped (reconnecting…).
 * - The socket never connected within `INITIAL_GRACE_MS` of mounting (we
 *   don't want to flash a banner on a fast page load, but if 4 s pass with
 *   no socket the user should know — message sends will fall back to REST
 *   but live updates won't arrive).
 */
const INITIAL_GRACE_MS = 4000;

export function ConnectionBanner() {
  const connected = useConnectionStore((s) => s.connected);
  const wasEverConnected = useConnectionStore((s) => s.wasEverConnected);
  const [pastGrace, setPastGrace] = useState(false);

  useEffect(() => {
    if (connected) return;
    const t = setTimeout(() => setPastGrace(true), INITIAL_GRACE_MS);
    return () => clearTimeout(t);
  }, [connected]);

  const showReconnecting = wasEverConnected && !connected;
  const showNeverConnected = !wasEverConnected && !connected && pastGrace;
  const show = showReconnecting || showNeverConnected;
  if (!show) return null;

  return (
    <div
      role="status"
      className="w-full bg-surface-container-highest text-foreground text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-2 border-b border-border"
    >
      <WifiOff className="h-3.5 w-3.5 text-destructive" aria-hidden />
      {showReconnecting
        ? "Reconnecting… Messages you send are queued and will be delivered when the connection returns."
        : "Connecting to the live service… Your messages still send via the server, but real-time updates may be delayed."}
    </div>
  );
}
