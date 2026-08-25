// Integration tests for the chat-socket mini-service: handshake auth, the
// real-time event flow (message:new, message:ack, message:status, typing),
// edit/delete, reactions, presence and conversation:sync.
//
// The service is run IN-PROCESS (no spawned child) against the test DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { io as ioclient, type Socket } from "socket.io-client";
import { signJwt } from "../../shared/jwt";
import { JWT_COOKIE, JWT_EXPIRY_SECONDS } from "../../shared/constants";
import { startTestSocketService, TEST_SOCKET_PORT } from "../helpers/socket-service";
import {
  connectTestClient,
  waitForConnect,
  waitForReady,
  drainEvents,
  onceEvent,
  emitAck,
} from "../helpers/socket-client";
import {
  getTestDb,
  resetTestDb,
  dropTestDb,
  createUser,
  createDirectConversation,
  createGroupConversation,
} from "../helpers/test-db";

const db = getTestDb();
const SECRET = process.env.JWT_SECRET || "chatapp-super-secret-jwt-key-for-dev-only-9f8e7d6c5b4a";

let alice: { id: string; name: string; email: string };
let bob: { id: string; name: string; email: string };
let carol: { id: string; name: string; email: string };
let dm: { id: string };
let group: { id: string };

beforeAll(async () => {
  await startTestSocketService();
});

afterAll(async () => {
  const handle = await startTestSocketService();
  await handle.stop();
  await dropTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  [alice, bob, carol] = await Promise.all([
    createUser(db, { name: "Alice", email: "alice@test.com" }),
    createUser(db, { name: "Bob", email: "bob@test.com" }),
    createUser(db, { name: "Carol", email: "carol@test.com" }),
  ]);
  dm = await createDirectConversation(db, alice, bob);
  group = await createGroupConversation(db, alice.id, [bob.id, carol.id], "Test group");
});

/** Connects both sockets and waits for the server's connection handlers to
 * finish (so all room joins are complete before any test event fires). */
async function connectBoth(
  userA: { id: string; email: string },
  userB: { id: string; email: string },
): Promise<{ a: Socket; b: Socket }> {
  const a = connectTestClient(userA.id, userA.email);
  const b = connectTestClient(userB.id, userB.email);
  await Promise.all([
    waitForReady(a, userA.id, db),
    waitForReady(b, userB.id, db),
  ]);
  // Drain the queue so any "presence:update" / "conversation:updated" events
  // fired by the connection handler don't trip the next onceEvent call.
  await Promise.all([
    drainEvents(a, "presence:update", 100),
    drainEvents(b, "presence:update", 100),
    drainEvents(a, "conversation:updated", 100),
    drainEvents(b, "conversation:updated", 100),
  ]);
  return { a, b };
}

function disconnectAll(sockets: Socket[]) {
  for (const s of sockets) {
    try {
      s.disconnect();
    } catch {
      /* ignore */
    }
  }
}

describe("socket handshake auth", () => {
  it("rejects connections without a cookie", async () => {
    const socket = ioclient(`http://127.0.0.1:${TEST_SOCKET_PORT}`, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 3000,
    });
    await expect(waitForConnect(socket, 3000)).rejects.toThrow();
    socket.disconnect();
  });

  it("rejects connections with a forged/expired token", async () => {
    const forged = signJwt({ sub: "no-such-user", email: "x@y.z" }, "wrong-secret", 60);
    const socket = ioclient(`http://127.0.0.1:${TEST_SOCKET_PORT}`, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 3000,
      extraHeaders: { Cookie: `${JWT_COOKIE}=${forged}` },
    });
    await expect(waitForConnect(socket, 3000)).rejects.toThrow();
    socket.disconnect();
  });

  it("accepts connections with a valid token", async () => {
    const socket = connectTestClient(alice.id, alice.email);
    await expect(waitForReady(socket, alice.id, db)).resolves.toBeUndefined();
    socket.disconnect();
  });

  it("rejects connections for a user id that no longer exists", async () => {
    const token = signJwt({ sub: "deleted-user-id", email: "ghost@test.com" }, SECRET, JWT_EXPIRY_SECONDS);
    const socket = ioclient(`http://127.0.0.1:${TEST_SOCKET_PORT}`, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 3000,
      extraHeaders: { Cookie: `${JWT_COOKIE}=${token}` },
    });
    await expect(waitForConnect(socket, 3000)).rejects.toThrow();
    socket.disconnect();
  });
});

describe("message:send over socket", () => {
  it("acks with the persisted message and emits message:new to recipients", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const bobNew = onceEvent(bobSocket, "message:new");
    const aliceAck = emitAck(aliceSocket, "message:send", {
      clientId: "sock-send-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "hello from alice",
    });

    const ack = await aliceAck;
    expect(ack.message.text).toBe("hello from alice");
    expect(ack.message.senderId).toBe(alice.id);

    const bobEvent = await bobNew;
    expect(bobEvent.text).toBe("hello from alice");
    expect(bobEvent.senderId).toBe(alice.id);

    const persisted = await db.message.findUnique({ where: { id: ack.message.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.text).toBe("hello from alice");

    disconnectAll([aliceSocket, bobSocket]);
  });

  it("rejects malformed payloads with an ack error", async () => {
    const { a: aliceSocket } = await connectBoth(alice, bob);
    const ack = await emitAck(aliceSocket, "message:send", {
      type: "TEXT",
      text: "bad payload",
    });
    expect(ack.error).toBeTruthy();
    expect(ack.code).toBe("VALIDATION");
    disconnectAll([aliceSocket]);
  });

  it("rejects non-participant sends with a FORBIDDEN ack", async () => {
    const { a: carolSocket } = await connectBoth(carol, alice);
    const ack = await emitAck(carolSocket, "message:send", {
      clientId: "sock-forbidden",
      conversationId: dm.id,
      type: "TEXT",
      text: "intruder",
    });
    expect(ack.code).toBe("FORBIDDEN");
    disconnectAll([carolSocket]);
  });

  it("rate-limits when the same user exceeds 20 messages / 10s", async () => {
    const { a: aliceSocket } = await connectBoth(alice, bob);
    for (let i = 0; i < 20; i++) {
      const ack = await emitAck(aliceSocket, "message:send", {
        clientId: `sock-rate-${i}`,
        conversationId: dm.id,
        type: "TEXT",
        text: `msg-${i}`,
      });
      expect(ack.message).toBeDefined();
    }
    // Drain pending message:new / conversation:updated events before the next send.
    const ack = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-rate-21",
      conversationId: dm.id,
      type: "TEXT",
      text: "one too many",
    });
    expect(ack.code).toBe("RATE_LIMITED");
    disconnectAll([aliceSocket]);
  }, 15_000);

  it("message:ack is emitted to the sender's other tabs", async () => {
    const tab1 = connectTestClient(alice.id, alice.email);
    const tab2 = connectTestClient(alice.id, alice.email);
    await Promise.all([
      waitForReady(tab1, alice.id, db),
      waitForReady(tab2, alice.id, db),
    ]);

    const tab2Ack = onceEvent(tab2, "message:ack");
    await emitAck(tab1, "message:send", {
      clientId: "sock-ack-test",
      conversationId: dm.id,
      type: "TEXT",
      text: "from tab 1",
    });

    const ack = await tab2Ack;
    expect(ack.clientId).toBe("sock-ack-test");
    expect(ack.message.text).toBe("from tab 1");

    disconnectAll([tab1, tab2]);
  });
});

describe("message:status updates", () => {
  it("sends message:status to the conversation when a recipient reads", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const ack = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-read-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "please read me",
    });
    const messageId = ack.message.id;

    // Drain the conversation:updated / message:new queue before listening for status.
    await drainEvents(aliceSocket, "conversation:updated", 100);
    await drainEvents(bobSocket, "conversation:updated", 100);

    const statusEvent = onceEvent(aliceSocket, "message:status");
    bobSocket.emit("message:read", { conversationId: dm.id });

    const status = await statusEvent;
    expect(status.updates[0].messageId).toBe(messageId);
    expect(status.updates[0].status).toBe("READ");

    disconnectAll([aliceSocket, bobSocket]);
  });
});

describe("typing indicators", () => {
  it("broadcasts typing:start and typing:stop", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const bobTypingStart = onceEvent(bobSocket, "typing:update");
    aliceSocket.emit("typing:start", { conversationId: dm.id });
    const startPayload = await bobTypingStart;
    expect(startPayload.userId).toBe(alice.id);
    expect(startPayload.isTyping).toBe(true);

    const bobTypingStop = onceEvent(bobSocket, "typing:update");
    aliceSocket.emit("typing:stop", { conversationId: dm.id });
    const stopPayload = await bobTypingStop;
    expect(stopPayload.isTyping).toBe(false);

    disconnectAll([aliceSocket, bobSocket]);
  });

  it("ignores typing events from non-participants", async () => {
    const { a: aliceSocket, b: carolSocket } = await connectBoth(alice, carol);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no event expected")), 1000),
    );
    const bobTyping = onceEvent(aliceSocket, "typing:update").catch(() => null);
    carolSocket.emit("typing:start", { conversationId: dm.id });
    await expect(Promise.race([bobTyping, timeout])).rejects.toThrow();

    disconnectAll([aliceSocket, carolSocket]);
  });
});

describe("message:edit over socket", () => {
  it("edits a message and broadcasts message:updated to participants", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const sendAck = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-edit-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "original",
    });
    const messageId = sendAck.message.id;
    await drainEvents(bobSocket, "conversation:updated", 100);

    const bobUpdated = onceEvent(bobSocket, "message:updated");
    const editAck = emitAck(aliceSocket, "message:edit", { messageId, text: "edited" });

    const ack = await editAck;
    expect(ack.message.text).toBe("edited");
    expect(ack.message.editedAt).not.toBeNull();

    const bobEvent = await bobUpdated;
    expect(bobEvent.text).toBe("edited");

    disconnectAll([aliceSocket, bobSocket]);
  });

  it("rejects edits by other users", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const sendAck = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-edit-2",
      conversationId: dm.id,
      type: "TEXT",
      text: "alice wrote",
    });
    await drainEvents(bobSocket, "conversation:updated", 100);

    const ack = await emitAck(bobSocket, "message:edit", {
      messageId: sendAck.message.id,
      text: "bob hijacked",
    });
    expect(ack.code).toBe("FORBIDDEN");

    disconnectAll([aliceSocket, bobSocket]);
  });
});

describe("message:delete over socket", () => {
  it("delete-for-everyone broadcasts message:deleted to the room", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const sendAck = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-del-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "to delete",
    });
    const messageId = sendAck.message.id;
    await drainEvents(bobSocket, "conversation:updated", 100);

    const bobDeleted = onceEvent(bobSocket, "message:deleted");
    await emitAck(aliceSocket, "message:delete", { messageId, forEveryone: true });

    const bobEvent = await bobDeleted;
    expect(bobEvent.messageId).toBe(messageId);
    expect(bobEvent.deletedAt).toBeTruthy();

    const after = await db.message.findUnique({ where: { id: messageId } });
    expect(after!.deletedAt).not.toBeNull();
    expect(after!.text).toBeNull();

    disconnectAll([aliceSocket, bobSocket]);
  });

  it("delete-for-me only drops the message for the requesting user", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const sendAck = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-del-2",
      conversationId: dm.id,
      type: "TEXT",
      text: "to delete for me",
    });
    const messageId = sendAck.message.id;
    await drainEvents(bobSocket, "conversation:updated", 100);

    const bobDeleted = onceEvent(bobSocket, "message:deleted");
    await emitAck(bobSocket, "message:delete", { messageId, forEveryone: false });
    const bobEvent = await bobDeleted;
    expect(bobEvent.messageId).toBe(messageId);

    // Alice does NOT receive a delete event.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no event expected")), 500),
    );
    const aliceDeleted = onceEvent(aliceSocket, "message:deleted").catch(() => null);
    await expect(Promise.race([aliceDeleted, timeout])).rejects.toThrow();

    disconnectAll([aliceSocket, bobSocket]);
  });
});

describe("reaction:toggle over socket", () => {
  it("adds a reaction and broadcasts reaction:update to the room", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const sendAck = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-react-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "react to me",
    });
    const messageId = sendAck.message.id;
    await drainEvents(bobSocket, "conversation:updated", 100);

    // Alice listens for the broadcast that Bob triggers by reacting.
    const aliceUpdate = onceEvent(aliceSocket, "reaction:update");
    const ack = await emitAck(bobSocket, "reaction:toggle", { messageId, emoji: "👍" });
    expect(ack.reactions).toHaveLength(1);
    expect(ack.reactions[0].emoji).toBe("👍");
    expect(ack.reactions[0].reactedByMe).toBe(true);

    // Alice receives the broadcast (she didn't react -> reactedByMe=false).
    const aliceEvent = await aliceUpdate;
    expect(aliceEvent.reactions[0].emoji).toBe("👍");
    expect(aliceEvent.reactions[0].reactedByMe).toBe(false);
    expect(aliceEvent.reactions[0].count).toBe(1);

    disconnectAll([aliceSocket, bobSocket]);
  });
});

describe("presence", () => {
  it("sets isOnline=true on connect", async () => {
    const aliceSocket = connectTestClient(alice.id, alice.email);
    await waitForReady(aliceSocket, alice.id, db);

    const fetched = await db.user.findUnique({ where: { id: alice.id } });
    expect(fetched!.isOnline).toBe(true);

    disconnectAll([aliceSocket]);
  });

  it("sets isOnline=false on full disconnect and broadcasts presence:update", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    // Drain Alice's connect-broadcast so we catch the disconnect-broadcast.
    await drainEvents(bobSocket, "presence:update", 100);

    const bobPresence = onceEvent(bobSocket, "presence:update");
    aliceSocket.disconnect();
    const event = await bobPresence;
    expect(event.userId).toBe(alice.id);
    expect(event.isOnline).toBe(false);

    const fetched = await db.user.findUnique({ where: { id: alice.id } });
    expect(fetched!.isOnline).toBe(false);

    disconnectAll([bobSocket]);
  });
});

describe("conversation:sync", () => {
  it("lets a client rejoin a conversation room after a new conversation is created", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    // Create a NEW conversation (REST flow would call conversation:sync).
    const newConv = await createDirectConversation(db, alice, carol);

    // Alice's existing socket isn't in conversation:<newConv.id> yet.
    // She asks the server to join it. (conversation:sync has no ack —
    // we give it a beat to complete.)
    aliceSocket.emit("conversation:sync", { conversationId: newConv.id });
    await new Promise((r) => setTimeout(r, 150));

    // Carol connects and sends a message in the new conversation.
    const carolSocket = connectTestClient(carol.id, carol.email);
    await waitForReady(carolSocket, carol.id, db);
    const aliceNew = onceEvent(aliceSocket, "message:new");
    await emitAck(carolSocket, "message:send", {
      clientId: "sock-sync-1",
      conversationId: newConv.id,
      type: "TEXT",
      text: "from carol",
    });
    const aliceEvent = await aliceNew;
    expect(aliceEvent.text).toBe("from carol");

    disconnectAll([aliceSocket, bobSocket, carolSocket]);
  });
});

describe("message:send duplicate (clientId idempotency)", () => {
  it("returns the same message on a duplicate send and skips delivery fan-out", async () => {
    const { a: aliceSocket, b: bobSocket } = await connectBoth(alice, bob);

    const ack1 = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-dup-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "first",
    });
    // Drain the conversation:updated from the first send.
    await drainEvents(bobSocket, "conversation:updated", 100);

    let bobNewCount = 0;
    const listener = () => { bobNewCount++; };
    bobSocket.on("message:new", listener);

    const ack2 = await emitAck(aliceSocket, "message:send", {
      clientId: "sock-dup-1",
      conversationId: dm.id,
      type: "TEXT",
      text: "duplicate",
    });
    expect(ack2.message.id).toBe(ack1.message.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(bobNewCount).toBe(0);

    bobSocket.off("message:new", listener);
    disconnectAll([aliceSocket, bobSocket]);
  });
});
