// Helper for socket integration tests: connects a socket.io-client to the
// test service with a real JWT cookie and resolves/rejects acks as promises.

import { io as ioclient, type Socket } from "socket.io-client";
import { signJwt } from "../../shared/jwt";
import { JWT_COOKIE, JWT_EXPIRY_SECONDS } from "../../shared/constants";
import { TEST_SOCKET_PORT } from "./socket-service";

const SECRET = process.env.JWT_SECRET || "chatapp-super-secret-jwt-key-for-dev-only-9f8e7d6c5b4a";

/** Issues a real JWT for a user id (so the test socket service accepts it). */
export function issueTestToken(userId: string, email: string): string {
  return signJwt({ sub: userId, email }, SECRET, JWT_EXPIRY_SECONDS);
}

/** Returns a Promise that resolves when the socket emits `event` (or rejects on ack timeout). */
export function onceEvent(socket: Socket, event: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: any) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

/** Promisifies a socket.emit with ack. */
export function emitAck(socket: Socket, event: string, payload: unknown, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack: any) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

/** Connects a fresh socket client authenticated as `userId`. */
export function connectTestClient(userId: string, email: string): Socket {
  const token = issueTestToken(userId, email);
  return ioclient(`http://127.0.0.1:${TEST_SOCKET_PORT}`, {
    transports: ["websocket"],
    // socket.io-client sends cookies via the `extraHeaders` option, but to
    // match the real handshake we set the Cookie header manually.
    extraHeaders: { Cookie: `${JWT_COOKIE}=${token}` },
    // Avoid auto-reconnect delays during tests.
    reconnection: false,
    timeout: 5000,
  });
}

/** Resolves when the socket is fully connected (or rejects on connect_error). */
export function waitForConnect(socket: Socket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
    if (socket.connected) {
      clearTimeout(t);
      resolve();
      return;
    }
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    socket.once("connect_error", (err: Error) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/** Resolves when the socket is fully connected AND the server's connection
 * handler has finished joining rooms + setting isOnline. Polls the DB. */
export async function waitForReady(
  socket: Socket,
  userId: string,
  db: { user: { findUnique: (args: { where: { id: string } }) => Promise<{ isOnline?: boolean } | null> } },
  timeoutMs = 5000,
): Promise<void> {
  await waitForConnect(socket, timeoutMs);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (user?.isOnline) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`user ${userId} never became isOnline after ${timeoutMs}ms`);
}

/** Drains pending `event` emissions on the socket so subsequent `onceEvent`
 * calls only see events emitted AFTER this call. */
export function drainEvents(socket: Socket, event: string, timeoutMs = 200): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {/* swallow */};
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, timeoutMs);
  });
}
