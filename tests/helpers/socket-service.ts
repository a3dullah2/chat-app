// Runs the chat-socket service IN-PROCESS (no spawned child).
//
// Spawning a child service in vitest was unstable — vitest's fork lifecycle
// seemed to reap the child at unexpected times. In-process mode is simpler
// and shares the test process's lifecycle cleanly.

import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Server as SocketServer } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { verifyJwt, readCookie, getJwtSecret } from "../../shared/jwt";
import {
  JWT_COOKIE,
  RATE_LIMITS,
  TYPING_TIMEOUT_MS,
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
} from "../../mini-services/chat-socket/broadcasts";

export const TEST_SOCKET_PORT = 3903;
export const TEST_BRIDGE_PORT = 3904;
export const TEST_INTERNAL_TOKEN = "test-internal-socket-token";

export interface InProcessSocketHandle {
  io: SocketServer;
  httpServer: HttpServer;
  socketPort: number;
  bridgePort: number;
  bridgeToken: string;
  ready: Promise<void>;
  stop: () => Promise<void>;
}

let _current: InProcessSocketHandle | null = null;

export async function startTestSocketService(): Promise<InProcessSocketHandle> {
  if (_current) return _current;

  const db = new PrismaClient();
  const httpServer = createServer();
  const io = new Server(httpServer, {
    path: "/",
    cors: { origin: true, credentials: true },
    pingTimeout: 5000,
    pingInterval: 10000,
    maxHttpBufferSize: 1e6,
  });

  // Typing state.
  type TypingEntry = { name: string; timer: ReturnType<typeof setTimeout> };
  const typingStates = new Map<string, Map<string, TypingEntry>>();

  function broadcastTyping(
    conversationId: string,
    userId: string,
    userName: string,
    isTyping: boolean,
  ) {
    io.to(`conversation:${conversationId}`).emit("typing:update", {
      conversationId,
      userId,
      userName,
      isTyping,
    });
  }

  function setTyping(
    conversationId: string,
    userId: string,
    userName: string,
    isTyping: boolean,
  ) {
    let convMap = typingStates.get(conversationId);
    if (!convMap) {
      convMap = new Map();
      typingStates.set(conversationId, convMap);
    }
    const existing = convMap.get(userId);
    if (existing) clearTimeout(existing.timer);
    if (isTyping) {
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

  // Auth middleware.
  io.use(async (socket, next) => {
    try {
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
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", async (socket) => {
    const userId: string = socket.data.userId;
    const userName: string = socket.data.userName;

    socket.join(`user:${userId}`);
    const parts = await db.participant.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });
    for (const p of parts) socket.join(`conversation:${p.conversationId}`);

    const wasOffline = !isUserOnline(userId);
    let sockets = presence.get(userId);
    if (!sockets) {
      sockets = new Set();
      presence.set(userId, sockets);
    }
    sockets.add(socket.id);

    if (wasOffline) {
      await db.user.updateMany({ where: { id: userId }, data: { isOnline: true } });
      await broadcastPresence(io, userId, true);
    }

    socket.on("message:send", async (raw: unknown, ack?: (r: unknown) => void) => {
      try {
        const p = sendMessageSchema.safeParse(raw);
        if (!p.success) {
          ack?.({ error: "Invalid message payload", code: "VALIDATION" });
          return;
        }
        const rl = messageLimiter.check(
          `msg:${userId}`,
          RATE_LIMITS.message.limit,
          RATE_LIMITS.message.windowMs,
        );
        if (!rl.allowed) {
          ack?.({
            error: "rate-limited",
            code: "RATE_LIMITED",
            retryAfter: rl.retryAfterSec,
          });
          return;
        }
        const r = await sendMessage(db, userId, p.data);
        if (!r.ok) {
          ack?.({ error: r.error, code: r.code });
          return;
        }
        await handleNewMessage(io, r.message, { isDuplicate: r.duplicate });
        ack?.({ message: toMessageDTO(r.message, userId) });
      } catch (e) {
        console.error("message:send", e);
        ack?.({ error: "Internal server error", code: "INTERNAL" });
      }
    });

    socket.on("message:read", async (raw: unknown) => {
      try {
        const p = conversationIdSchema.safeParse(raw);
        if (!p.success) return;
        const r = await markConversationRead(db, userId, p.data.conversationId);
        if (!r.ok) return;
        emitStatusUpdate(io, p.data.conversationId, r.updates);
        await emitConversationUpdated(io, p.data.conversationId, [userId]);
      } catch (e) {
        console.error("message:read", e);
      }
    });

    socket.on("typing:start", async (raw: unknown) => {
      const p = conversationIdSchema.safeParse(raw);
      if (!p.success) return;
      const member = await assertParticipant(db, userId, p.data.conversationId);
      if (!member || member.leftAt) return;
      setTyping(p.data.conversationId, userId, userName, true);
    });

    socket.on("typing:stop", async (raw: unknown) => {
      const p = conversationIdSchema.safeParse(raw);
      if (!p.success) return;
      setTyping(p.data.conversationId, userId, userName, false);
    });

    socket.on("message:edit", async (raw: unknown, ack?: (r: unknown) => void) => {
      try {
        const p = editMessageSchema.safeParse(raw);
        if (!p.success) {
          ack?.({ error: "Invalid edit payload", code: "VALIDATION" });
          return;
        }
        const r = await editMessage(db, userId, p.data.messageId, p.data.text);
        if (!r.ok) {
          ack?.({ error: r.error, code: r.code });
          return;
        }
        await handleMessageUpdated(io, r.message);
        ack?.({ message: toMessageDTO(r.message, userId) });
      } catch (e) {
        console.error("message:edit", e);
        ack?.({ error: "Internal server error", code: "INTERNAL" });
      }
    });

    socket.on("message:delete", async (raw: unknown, ack?: (r: unknown) => void) => {
      try {
        const p = deleteMessageSchema.safeParse(raw);
        if (!p.success) {
          ack?.({ error: "Invalid delete payload", code: "VALIDATION" });
          return;
        }
        const r = await deleteMessage(db, userId, p.data.messageId, p.data.forEveryone);
        if (!r.ok) {
          ack?.({ error: r.error, code: r.code });
          return;
        }
        if (p.data.forEveryone) {
          await handleMessageUpdated(io, r.message);
          io.to(`conversation:${r.message.conversationId}`).emit("message:deleted", {
            messageId: r.message.id,
            conversationId: r.message.conversationId,
            deletedAt: r.message.deletedAt?.toISOString() ?? new Date().toISOString(),
          });
          await emitConversationUpdated(io, r.message.conversationId);
        } else {
          socket.emit("message:deleted", {
            messageId: r.message.id,
            conversationId: r.message.conversationId,
            deletedAt: new Date().toISOString(),
          });
        }
        ack?.({ ok: true });
      } catch (e) {
        console.error("message:delete", e);
        ack?.({ error: "Internal server error", code: "INTERNAL" });
      }
    });

    socket.on("reaction:toggle", async (raw: unknown, ack?: (r: unknown) => void) => {
      try {
        const p = reactionSchema.safeParse(raw);
        if (!p.success) {
          ack?.({ error: "Invalid reaction payload", code: "VALIDATION" });
          return;
        }
        const r = await toggleReaction(db, userId, p.data.messageId, p.data.emoji);
        if (!r.ok) {
          ack?.({ error: r.error, code: r.code });
          return;
        }
        await emitReactionUpdate(io, p.data.messageId);
        ack?.({ reactions: r.reactions });
      } catch (e) {
        console.error("reaction:toggle", e);
        ack?.({ error: "Internal server error", code: "INTERNAL" });
      }
    });

    socket.on("conversation:sync", async (raw: unknown) => {
      const p = conversationIdSchema.safeParse(raw);
      if (!p.success) return;
      const member = await assertParticipant(db, userId, p.data.conversationId);
      if (!member || member.leftAt) return;
      socket.join(`conversation:${p.data.conversationId}`);
    });

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
          for (const [convId, map] of typingStates) {
            const e = map.get(userId);
            if (e) {
              clearTimeout(e.timer);
              map.delete(userId);
              broadcastTyping(convId, userId, e.name, false);
            }
          }
        }
      }
    });
  });

  // Internal emit bridge (so REST routes can broadcast via the same flow).
  const bridgeServer = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.startsWith("/health")) {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (req.method !== "POST" || !url.startsWith("/internal/emit")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    const tok = req.headers["x-internal-token"];
    if (tok !== TEST_INTERNAL_TOKEN) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const b = JSON.parse(body);
      switch (b.action) {
        case "newMessage":
          if (b.messageId) {
            const m = await loadMessage(b.messageId);
            if (m) await handleNewMessage(io, m);
          }
          break;
        case "messageUpdated":
          if (b.messageId) {
            const m = await loadMessage(b.messageId);
            if (m) await handleMessageUpdated(io, m);
          }
          break;
        case "messageDeleted":
          if (b.messageId && b.conversationId) {
            const payload = {
              messageId: b.messageId,
              conversationId: b.conversationId,
              deletedAt: b.deletedAt ?? new Date().toISOString(),
            };
            if (b.userIds?.length) {
              for (const u of b.userIds) io.to(`user:${u}`).emit("message:deleted", payload);
            } else {
              io.to(`conversation:${b.conversationId}`).emit("message:deleted", payload);
            }
          }
          break;
        case "reactionUpdate":
          if (b.messageId) await emitReactionUpdate(io, b.messageId);
          break;
        case "statusUpdate":
          if (b.conversationId && b.updates) {
            emitStatusUpdate(io, b.conversationId, b.updates);
          }
          break;
        case "conversationUpdated":
          if (b.conversationId) {
            await emitConversationUpdated(io, b.conversationId, b.userIds);
          }
          break;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Bridge error" }));
    }
  });

  const ready = new Promise<void>((resolve) => {
    let httpDone = false;
    let bridgeDone = false;
    const check = () => {
      if (httpDone && bridgeDone) resolve();
    };
    httpServer.listen(TEST_SOCKET_PORT, "127.0.0.1", () => {
      httpDone = true;
      check();
    });
    bridgeServer.listen(TEST_BRIDGE_PORT, "127.0.0.1", () => {
      bridgeDone = true;
      check();
    });
  });

  _current = {
    io,
    httpServer,
    socketPort: TEST_SOCKET_PORT,
    bridgePort: TEST_BRIDGE_PORT,
    bridgeToken: TEST_INTERNAL_TOKEN,
    ready,
    stop: async () => {
      if (!_current) return;
      _current = null;
      await new Promise<void>((r) => {
        io.close(() => {
          httpServer.close(() => r());
        });
      });
      // Don't disconnect db here — it's a separate PrismaClient instance, and
      // the test DB lifecycle is owned by tests/helpers/test-db.ts.
      try {
        await db.$disconnect();
      } catch {
        /* ignore */
      }
      try {
        bridgeServer.close();
      } catch {
        /* ignore */
      }
    },
  };

  await ready;
  return _current;
}
