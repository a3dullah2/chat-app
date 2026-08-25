// Socket.IO client manager.
// In production: connects through the gateway via io("/?XTransformPort=3003")
//   — the gateway routes this to the chat-socket mini-service on :3003.
// In dev (no gateway): connects directly to http://localhost:3003 when
//   NEXT_PUBLIC_SOCKET_URL is set, or falls back to the gateway path.

"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Returns the socket.io URL for the current environment.
 * - Production: `/?XTransformPort=3003` (gateway-routed).
 * - Dev (when NEXT_PUBLIC_SOCKET_URL is set): that URL directly.
 * - Dev (fallback): same gateway path; works when a Caddy/gateway is running.
 */
function socketUrl(): string {
  const direct = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (direct) return direct;
  return "/?XTransformPort=3003";
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(socketUrl(), {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      forceNew: true,
      autoConnect: true,
    });
  }
  return socket;
}

export function destroySocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitAck<T>(
  event: string,
  payload: unknown,
  timeoutMs = 12000,
): Promise<T | { error: string; code: string } | null> {
  return new Promise((resolve) => {
    const socket = getSocket();
    let settled = false;

    // Always arm the timeout, even when the socket isn't connected yet. The
    // previous behavior waited indefinitely for `connect` before arming the
    // timeout, which produced promises that never resolved when the socket
    // never connected (e.g. flaky gateway, blocked cookies). That left
    // optimistic messages stuck as "pending" forever. Returning `null` lets
    // callers (e.g. useSendMessage) fall back to a more reliable path.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    socket.emit(event, payload, (response: T | { error: string; code: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}
