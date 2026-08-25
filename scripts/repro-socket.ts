// Repro: simulate the client UI flow via socket.io and verify message persistence.
// Connects through the gateway or directly to the socket service.

import { io as ioc } from "socket.io-client";
import { fetch } from "undici";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  // Set-Cookie lives on res.headers[ 'set-cookie' ]
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie");
  return setCookie;
}

async function getConversations(cookie: string) {
  const res = await fetch(`${APP_URL}/api/conversations`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`conversations failed: ${res.status}`);
  return (await res.json() as { conversations: { id: string; name?: string | null; type: string }[] }).conversations;
}

async function listMessages(cookie: string, conversationId: string) {
  const res = await fetch(`${APP_URL}/api/conversations/${conversationId}/messages?limit=50`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`messages failed: ${res.status}`);
  return (await res.json() as { messages: { id: string; text: string | null; senderId: string; createdAt: string }[] }).messages;
}

async function logout(cookie: string) {
  await fetch(`${APP_URL}/api/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
}

async function checkDBForClientId(clientId: string): Promise<boolean> {
  // Use a separate Prisma check (the script is run with bun; prisma is in the project).
  // Inline dynamic import to keep the file self-contained.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const m = await db.message.findUnique({ where: { clientId }, select: { id: true, text: true } });
    return !!m;
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const email = "demo@chatapp.com";
  const password = "password123";

  // 1. login
  const cookieHeader = await login(email, password);
  const cookie = cookieHeader.split(";")[0]; // just the name=value
  console.log("[step1] logged in. cookie:", cookie.slice(0, 40) + "...");

  // 2. pick a conversation
  const convs = await getConversations(cookie);
  const conv = convs[0];
  if (!conv) throw new Error("no conversations");
  console.log("[step2] using conversation:", conv.id, conv.name ?? conv.type);

  // 3. connect socket with the cookie
  const socket = ioc("http://localhost:3003/", {
    // go directly to the socket service (bypassing the gateway) to isolate issues
    path: "/",
    transports: ["websocket", "polling"],
    withCredentials: true,
    extraHeaders: { cookie },
    forceNew: true,
    autoConnect: true,
  });

  const ok = await new Promise<boolean>((resolve) => {
    socket.on("connect", () => {
      console.log("[step3] socket connected. id:", socket.id);
      resolve(true);
    });
    socket.on("connect_error", (err) => {
      console.error("[step3] connect_error:", err.message);
      resolve(false);
    });
    setTimeout(() => {
      console.error("[step3] socket connect TIMEOUT");
      resolve(false);
    }, 5000);
  });
  if (!ok) {
    process.exit(1);
  }

  // 4. send a message via socket
  const clientId = `repro-socket-${Date.now()}`;
  console.log("[step4] sending message via socket. clientId:", clientId);
  const ack = await new Promise<{ message?: unknown; error?: string }>((resolve) => {
    socket.timeout(15000).emit("message:send", {
      clientId,
      conversationId: conv.id,
      type: "TEXT",
      text: "socket repro test message",
      replyToId: null,
      attachmentId: null,
    }, (_err: unknown, response: { message?: unknown; error?: string }) => {
      resolve(response ?? { error: "no response" });
    });
  });
  console.log("[step4] ack:", JSON.stringify(ack).slice(0, 200));

  // 5. check DB persistence
  const persisted = await checkDBForClientId(clientId);
  console.log("[step5] message persisted in DB:", persisted);

  // 6. simulate logout + relogin
  socket.disconnect();
  await logout(cookie);
  console.log("[step6] logged out");

  // wait a moment
  await new Promise((r) => setTimeout(r, 500));

  // 7. relogin and list messages
  const cookieHeader2 = await login(email, password);
  const cookie2 = cookieHeader2.split(";")[0];
  const messages = await listMessages(cookie2, conv.id);
  const found = messages.find((m) => m.text === "socket repro test message");
  console.log("[step7] message visible after re-login:", !!found, found ? JSON.stringify(found) : "MISSING");

  if (!found) {
    console.log("[RESULT] ❌ BUG CONFIRMED: message sent via socket is NOT visible after logout/login");
    console.log("[RESULT]    DB persistence:", persisted, "; UI-visible:", !!found);
  } else {
    console.log("[RESULT] ✓ Cannot reproduce — message is visible after re-login");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(2);
});
