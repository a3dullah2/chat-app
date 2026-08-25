// Repro via the gateway (port 81) — the exact path the browser uses.
import { io as ioc } from "socket.io-client";
import { fetch } from "undici";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:81";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie");
  return setCookie;
}

async function getConversations(cookie: string) {
  const res = await fetch(`${GATEWAY}/api/conversations`, { headers: { cookie } });
  if (!res.ok) throw new Error(`conversations failed: ${res.status}`);
  return (await res.json() as { conversations: { id: string; name?: string | null; type: string }[] }).conversations;
}

async function listMessages(cookie: string, conversationId: string) {
  const res = await fetch(`${GATEWAY}/api/conversations/${conversationId}/messages?limit=50`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`messages failed: ${res.status}`);
  return (await res.json() as { messages: { id: string; text: string | null; senderId: string; createdAt: string }[] }).messages;
}

async function logout(cookie: string) {
  await fetch(`${GATEWAY}/api/auth/logout`, { method: "POST", headers: { cookie } });
}

async function checkDBForClientId(clientId: string): Promise<boolean> {
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

  const cookieHeader = await login(email, password);
  const cookie = cookieHeader.split(";")[0];
  console.log("[step1] login OK. cookie:", cookie.slice(0, 50) + "...");

  const convs = await getConversations(cookie);
  const conv = convs[0];
  if (!conv) throw new Error("no conversations");
  console.log("[step2] using conversation:", conv.id, conv.name ?? conv.type);

  // Connect socket through the GATEWAY using the exact same options as the UI:
  //   io("/?XTransformPort=3003", ...)
  // which the browser resolves relative to the page origin — the gateway on :81.
  console.log("[step3] connecting socket via gateway:", `${GATEWAY}/?XTransformPort=3003`);
  const socket = ioc(`${GATEWAY}/?XTransformPort=3003`, {
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    forceNew: true,
    autoConnect: true,
    extraHeaders: { cookie },
  });

  let connected = false;
  await new Promise<void>((resolve) => {
    socket.on("connect", () => {
      console.log("[step3] socket CONNECTED via gateway. id:", socket.id);
      connected = true;
      resolve();
    });
    socket.on("connect_error", (err) => {
      console.error("[step3] connect_error:", err.message, err.data ?? "");
      resolve();
    });
    setTimeout(() => {
      console.error("[step3] socket TIMEOUT (5s)");
      resolve();
    }, 5000);
  });
  if (!connected) {
    console.log("[RESULT] ❌ socket cannot connect via the gateway → confirms the bug");
  }

  const clientId = `repro-gw-${Date.now()}`;
  console.log("[step4] sending message:send via gateway socket. clientId:", clientId);
  const ack = await new Promise<{ message?: unknown; error?: string }>((resolve) => {
    socket.timeout(15000).emit(
      "message:send",
      {
        clientId,
        conversationId: conv.id,
        type: "TEXT",
        text: "gateway repro test message",
        replyToId: null,
        attachmentId: null,
      },
      (_err: unknown, response: { message?: unknown; error?: string }) => {
        resolve(response ?? { error: "no response" });
      },
    );
  });
  console.log("[step4] ack:", JSON.stringify(ack).slice(0, 220));

  const persisted = await checkDBForClientId(clientId);
  console.log("[step5] persisted in DB:", persisted);

  socket.disconnect();
  await logout(cookie);
  console.log("[step6] logged out");

  await new Promise((r) => setTimeout(r, 500));

  const cookieHeader2 = await login(email, password);
  const cookie2 = cookieHeader2.split(";")[0];
  const messages = await listMessages(cookie2, conv.id);
  const found = messages.find((m) => m.text === "gateway repro test message");
  console.log("[step7] visible after re-login:", !!found);

  if (!found) {
    console.log("[RESULT] ❌ BUG CONFIRMED via gateway path");
  } else if (!connected) {
    console.log("[RESULT] ⚠ socket connection failed but message still visible?? (race?)");
  } else {
    console.log("[RESULT] ✓ Cannot reproduce — message persists");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(2);
});
