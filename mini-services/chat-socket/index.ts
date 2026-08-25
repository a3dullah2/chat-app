// ChatApp Socket.IO mini-service.
// - Auth via the JWT cookie set by the Next.js app (handshake verification).
// - One room per conversation + one personal room per user.
// - In-memory presence + typing state.
// - Internal HTTP emit bridge (port 3004) used by the Next.js REST routes.

import { createServer, type IncomingMessage } from "node:http";
import { Server } from "socket.io";
import "./env";
import { db } from "./db";
import { verifyJwt, readCookie, getJwtSecret } from "../../shared/jwt";
import {
  JWT_COOKIE,
  RATE_LIMITS,
  TYPING_TIMEOUT_MS,
  MessageDeliveryStatus,
} from "../../shared/constants";
import { messageLimiter } from "../../shared/rate-limit";
import {
  sendMessage,
  markConversationRead,
  editMessage,
  deleteMessage,
  toggleReaction,
  assertParticipant,
} from "../../shared/message-service";
import { toMessageDTO } from "../../shared/dto";
import {
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  reactionSchema,
  conversationIdSchema,
} from "../../shared/validation";
import {
  presence,
  isUserOnline,
  handleNewMessage,
  handleMessageUpdated,
  emitReactionUpdate,
  emitStatusUpdate,
  emitConversationUpdated,
  loadMessage,
  broadcastPresence,
} from "./broadcasts";

const SOCKET_PORT = 3003;
const BRIDGE_PORT = 3004;
const INTERNAL_TOKEN = process.env.INTERNAL_SOCKET_TOKEN || "chatapp-internal-emit-dev-token";

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — the gateway forwards /?XTransformPort=<port> here.
  path: "/",
  cors: { origin: true, credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // events are small; files go over REST
});

// ---------------------------------------------------------------------------
// Typing state: conversationId -> userId -> { name, timer }
// ---------------------------------------------------------------------------

const typingStates = new Map<string, Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>>();

function broadcastTyping(conversationId: string, userId: string, userName: string, isTyping: boolean) {
  io.to(`conversation:${conversationId}`).emit("typing:update", {
    conversationId,
    userId,
    userName,
    isTyping,
  });
}

function setTyping(conversationId: string, userId: string, userName: string, isTyping: boolean) {
  let convMap = typingStates.get(conversationId);
  if (!convMap) {
    convMap = new Map();
    typingStates.set(conversationId, convMap);
  }
  const existing = convMap.get(userId);
  if (existing) clearTimeout(existing.timer);

  if (isTyping) {
    // Auto-expire after 5 s of silence (spec FR-07 AC3).
    const timer = setTimeout(() => {
      const map = typingStates.get(conversationId);
      if (map?.delete(userId)) {
        broadcastTyping(conversationId, userId, userName, false);
      }
    }, TYPING_TIMEOUT_MS);
    convMap.set(userId, { name: userName, timer });
  } else {
    convMap.delete(userId);
  }
  broadcastTyping(conversationId, userId, userName, isTyping);
}

// ---------------------------------------------------------------------------
// Socket auth middleware (JWT from the handshake cookie)
// ---------------------------------------------------------------------------

io.use(async (socket, next) => {
  const token = readCookie(socket.handshake.headers.cookie, JWT_COOKIE);
  if (!token) return next(new Error("Unauthorized"));
  const payload = verifyJwt(token, getJwtSecret());
  if (!payload) return next(new Error("Unauthorized"));

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true },
  });
  if (!user) return next(new Error("Unauthorized"));

  socket.data.userId = user.id;
  socket.data.userName = user.name;
  next();
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

io.on("connection", async (socket) => {
  const userId: string = socket.data.userId;
  const userName: string = socket.data.userName;

  socket.join(`user:${userId}`);
  const participations = await db.participant.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });
  for (const p of participations) {
    socket.join(`conversation:${p.conversationId}`);
  }

  const wasOffline = !isUserOnline(userId);
  let sockets = presence.get(userId);
  if (!sockets) {
    sockets = new Set();
    presence.set(userId, sockets);
  }
  sockets.add(socket.id);

  if (wasOffline) {
    // updateMany tolerates a missing row (e.g. user deleted during a reseed).
    await db.user.updateMany({ where: { id: userId }, data: { isOnline: true } });
    await broadcastPresence(io, userId, true);
  }

  // ------------------------------------------------------------------
  // message:send
  // ------------------------------------------------------------------
  socket.on("message:send", async (raw: unknown, ack?: (res: unknown) => void) => {
    try {
      const parsed = sendMessageSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ error: "Invalid message payload", code: "VALIDATION" });
        return;
      }
      const rl = messageLimiter.check(`msg:${userId}`, RATE_LIMITS.message.limit, RATE_LIMITS.message.windowMs);
      if (!rl.allowed) {
        ack?.({ error: "You are sending messages too quickly", code: "RATE_LIMITED", retryAfter: rl.retryAfterSec });
        return;
      }
      const result = await sendMessage(db, userId, parsed.data);
      if (!result.ok) {
        ack?.({ error: result.error, code: result.code });
        return;
      }
      await handleNewMessage(io, result.message, { isDuplicate: result.duplicate });
      ack?.({
        message: toMessageDTO(result.message, userId),
      });
    } catch (error) {
      console.error("message:send failed", error);
      ack?.({ error: "Internal server error", code: "INTERNAL" });
    }
  });

  // ------------------------------------------------------------------
  // message:read
  // ------------------------------------------------------------------
  socket.on("message:read", async (raw: unknown) => {
    try {
      const parsed = conversationIdSchema.safeParse(raw);
      if (!parsed.success) return;
      const result = await markConversationRead(db, userId, parsed.data.conversationId);
      if (!result.ok) return;
      emitStatusUpdate(io, parsed.data.conversationId, result.updates);
      // Unread badge reset for the reader's other tabs.
      await emitConversationUpdated(io, parsed.data.conversationId, [userId]);
    } catch (error) {
      console.error("message:read failed", error);
    }
  });

  // ------------------------------------------------------------------
  // typing
  // ------------------------------------------------------------------
  socket.on("typing:start", async (raw: unknown) => {
    const parsed = conversationIdSchema.safeParse(raw);
    if (!parsed.success) return;
    const member = await assertParticipant(db, userId, parsed.data.conversationId);
    if (!member || member.leftAt) return;
    setTyping(parsed.data.conversationId, userId, userName, true);
  });

  socket.on("typing:stop", async (raw: unknown) => {
    const parsed = conversationIdSchema.safeParse(raw);
    if (!parsed.success) return;
    setTyping(parsed.data.conversationId, userId, userName, false);
  });

  // ------------------------------------------------------------------
  // message:edit
  // ------------------------------------------------------------------
  socket.on("message:edit", async (raw: unknown, ack?: (res: unknown) => void) => {
    try {
      const parsed = editMessageSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ error: "Invalid edit payload", code: "VALIDATION" });
        return;
      }
      const result = await editMessage(db, userId, parsed.data.messageId, parsed.data.text);
      if (!result.ok) {
        ack?.({ error: result.error, code: result.code });
        return;
      }
      await handleMessageUpdated(io, result.message);
      ack?.({ message: toMessageDTO(result.message, userId) });
    } catch (error) {
      console.error("message:edit failed", error);
      ack?.({ error: "Internal server error", code: "INTERNAL" });
    }
  });

  // ------------------------------------------------------------------
  // message:delete
  // ------------------------------------------------------------------
  socket.on("message:delete", async (raw: unknown, ack?: (res: unknown) => void) => {
    try {
      const parsed = deleteMessageSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ error: "Invalid delete payload", code: "VALIDATION" });
        return;
      }
      const result = await deleteMessage(db, userId, parsed.data.messageId, parsed.data.forEveryone);
      if (!result.ok) {
        ack?.({ error: result.error, code: result.code });
        return;
      }
      if (parsed.data.forEveryone) {
        await handleMessageUpdated(io, result.message);
        io.to(`conversation:${result.message.conversationId}`).emit("message:deleted", {
          messageId: result.message.id,
          conversationId: result.message.conversationId,
          deletedAt: result.message.deletedAt?.toISOString() ?? new Date().toISOString(),
        });
        await emitConversationUpdated(io, result.message.conversationId);
      } else {
        // Deleted for me: only this socket should drop the message.
        socket.emit("message:deleted", {
          messageId: result.message.id,
          conversationId: result.message.conversationId,
          deletedAt: new Date().toISOString(),
        });
      }
      ack?.({ ok: true });
    } catch (error) {
      console.error("message:delete failed", error);
      ack?.({ error: "Internal server error", code: "INTERNAL" });
    }
  });

  // ------------------------------------------------------------------
  // reaction:toggle
  // ------------------------------------------------------------------
  socket.on("reaction:toggle", async (raw: unknown, ack?: (res: unknown) => void) => {
    try {
      const parsed = reactionSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ error: "Invalid reaction payload", code: "VALIDATION" });
        return;
      }
      const result = await toggleReaction(db, userId, parsed.data.messageId, parsed.data.emoji);
      if (!result.ok) {
        ack?.({ error: result.error, code: result.code });
        return;
      }
      await emitReactionUpdate(io, parsed.data.messageId);
      ack?.({ reactions: result.reactions });
    } catch (error) {
      console.error("reaction:toggle failed", error);
      ack?.({ error: "Internal server error", code: "INTERNAL" });
    }
  });

  // ------------------------------------------------------------------
  // Rooms are re-synced when the client is added to a new conversation.
  // ------------------------------------------------------------------
  socket.on("conversation:sync", async (raw: unknown) => {
    try {
      const parsed = conversationIdSchema.safeParse(raw);
      if (!parsed.success) return;
      const member = await assertParticipant(db, userId, parsed.data.conversationId);
      if (!member || member.leftAt) return;
      socket.join(`conversation:${parsed.data.conversationId}`);
    } catch (error) {
      console.error("conversation:sync failed", error);
    }
  });

  // ------------------------------------------------------------------
  // Disconnect
  // ------------------------------------------------------------------
  socket.on("disconnect", async () => {
    const sockets = presence.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        presence.delete(userId);
        await db.user.updateMany({
          where: { id: userId },
          data: { isOnline: false, lastSeenAt: new Date() },
        });
        await broadcastPresence(io, userId, false);
        // Clear this user's typing state everywhere.
        for (const [conversationId, map] of typingStates) {
          const entry = map.get(userId);
          if (entry) {
            clearTimeout(entry.timer);
            map.delete(userId);
            broadcastTyping(conversationId, userId, entry.name, false);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Internal emit bridge (port 3004) — lets the Next.js REST routes broadcast.
// ---------------------------------------------------------------------------

interface BridgeBody {
  action:
    | "newMessage"
    | "messageUpdated"
    | "messageDeleted"
    | "reactionUpdate"
    | "statusUpdate"
    | "conversationUpdated";
  messageId?: string;
  conversationId?: string;
  deletedAt?: string;
  updates?: { messageId: string; status: string }[];
  userIds?: string[];
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

const bridgeServer = createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || !url.startsWith("/internal/emit")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const token = req.headers["x-internal-token"];
  if (token !== INTERNAL_TOKEN) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    const body = JSON.parse((await readBody(req as never)).toString("utf8")) as BridgeBody;
    switch (body.action) {
      case "newMessage": {
        if (!body.messageId) break;
        const message = await loadMessage(body.messageId);
        if (message) await handleNewMessage(io, message);
        break;
      }
      case "messageUpdated": {
        if (!body.messageId) break;
        const message = await loadMessage(body.messageId);
        if (message) await handleMessageUpdated(io, message);
        break;
      }
      case "messageDeleted": {
        if (!body.messageId || !body.conversationId) break;
        const payload = {
          messageId: body.messageId,
          conversationId: body.conversationId,
          deletedAt: body.deletedAt ?? new Date().toISOString(),
        };
        if (body.userIds?.length) {
          // e.g. "delete for me" — only the requesting user drops the message.
          for (const uid of body.userIds) io.to(`user:${uid}`).emit("message:deleted", payload);
        } else {
          io.to(`conversation:${body.conversationId}`).emit("message:deleted", payload);
        }
        break;
      }
      case "reactionUpdate": {
        if (body.messageId) await emitReactionUpdate(io, body.messageId);
        break;
      }
      case "statusUpdate": {
        if (body.conversationId && body.updates) {
          emitStatusUpdate(io, body.conversationId, body.updates);
        }
        break;
      }
      case "conversationUpdated": {
        if (body.conversationId) {
          await emitConversationUpdated(io, body.conversationId, body.userIds);
        }
        break;
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error("bridge error", error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Bridge error" }));
  }
});

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[chat-socket] Socket.IO server listening on :${SOCKET_PORT}`);
});

bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log(`[chat-socket] internal emit bridge listening on 127.0.0.1:${BRIDGE_PORT}`);
});

async function shutdown() {
  console.log("[chat-socket] shutting down");
  io.close();
  bridgeServer.close();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { io };
