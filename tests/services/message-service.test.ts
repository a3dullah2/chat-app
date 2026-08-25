// Service-level tests for message-service.ts (no HTTP layer).
// Each test gets a freshly-wiped test DB and creates the minimal fixtures
// needed to exercise one code path.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  listMessages,
  markConversationRead,
  searchMessages,
  assertParticipant,
  requireParticipant,
  markDelivered,
  type ServiceError,
} from "@shared/message-service";
import { MessageType, MessageDeliveryStatus, EDIT_WINDOW_MS } from "@shared/constants";
import { getTestDb, resetTestDb, dropTestDb, createUser, createDirectConversation, createGroupConversation } from "../helpers/test-db";

const db = getTestDb();

let alice: { id: string; name: string };
let bob: { id: string; name: string };
let carol: { id: string; name: string };
let dm: { id: string };
let group: { id: string };

beforeAll(async () => {
  // Schema is set up by the global setup file.
});

afterAll(async () => {
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

type SendInput = Parameters<typeof sendMessage>[2];

function ok<T>(r: T | ServiceError): r is T {
  return r !== null && typeof r === "object" && (r as any).ok !== false;
}

function err(r: any): r is ServiceError {
  return r !== null && typeof r === "object" && r.ok === false;
}

describe("sendMessage — happy path", () => {
  it("creates a message, sets recipient statuses to SENT, bumps conversation.updatedAt", async () => {
    const before = await db.conversation.findUnique({ where: { id: dm.id } });
    await new Promise((r) => setTimeout(r, 10));
    const result = await sendMessage(db, alice.id, {
      clientId: "client-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "hello world",
    });
    expect(ok(result)).toBe(true);
    expect((result as any).duplicate).toBe(false);
    expect((result as any).message.text).toBe("hello world");
    expect((result as any).message.senderId).toBe(alice.id);

    // One MessageStatus row for Bob at SENT.
    const statuses = await db.messageStatus.findMany({ where: { messageId: (result as any).message.id } });
    expect(statuses).toHaveLength(1);
    expect(statuses[0].userId).toBe(bob.id);
    expect(statuses[0].status).toBe(MessageDeliveryStatus.SENT);

    // Conversation bumped.
    const after = await db.conversation.findUnique({ where: { id: dm.id } });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it("bumps conversation.updatedAt so the list reorders", async () => {
    const r1 = await sendMessage(db, alice.id, {
      clientId: "c-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "first",
    });
    // Wait so the second bump has a distinct timestamp.
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await sendMessage(db, alice.id, {
      clientId: "c-2",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "second",
    });
    const conv = await db.conversation.findUnique({ where: { id: dm.id } });
    expect(conv!.updatedAt.getTime()).toBeGreaterThanOrEqual((r2 as any).message.createdAt.getTime());
    expect((r2 as any).message.createdAt.getTime()).toBeGreaterThanOrEqual((r1 as any).message.createdAt.getTime());
  });
});

describe("sendMessage — idempotency on clientId", () => {
  it("returns the same message when the same clientId is sent twice by the same user", async () => {
    const payload: SendInput = {
      clientId: "dup-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "dup",
    };
    const first = await sendMessage(db, alice.id, payload);
    const second = await sendMessage(db, alice.id, payload);
    expect(ok(first) && ok(second)).toBe(true);
    expect((first as any).message.id).toBe((second as any).message.id);
    expect((second as any).duplicate).toBe(true);

    // Only one row was created.
    const count = await db.message.count({ where: { clientId: "dup-1" } });
    expect(count).toBe(1);
  });

  it("rejects when a different user reuses the same clientId (CONFLICT)", async () => {
    const payload: SendInput = {
      clientId: "dup-2",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "dup-bob",
    };
    const first = await sendMessage(db, alice.id, payload);
    const second = await sendMessage(db, bob.id, payload);
    expect(ok(first)).toBe(true);
    expect(err(second)).toBe(true);
    expect((second as any).code).toBe("CONFLICT");
  });
});

describe("sendMessage — authorization", () => {
  it("404s on a missing conversation", async () => {
    const r = await sendMessage(db, alice.id, {
      clientId: "x",
      conversationId: "no-such-conv",
      type: MessageType.TEXT,
      text: "x",
    });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });

  it("403s when the sender is not a participant", async () => {
    // Carol is not in the DM between Alice and Bob.
    const r = await sendMessage(db, carol.id, {
      clientId: "x",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "intruder",
    });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });
});

describe("sendMessage — validation", () => {
  it("422s when text is empty for TEXT messages", async () => {
    const r = await sendMessage(db, alice.id, {
      clientId: "x",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "   ",
    });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("422s when attachmentId is missing for a media message", async () => {
    const r = await sendMessage(db, alice.id, {
      clientId: "x",
      conversationId: dm.id,
      type: MessageType.IMAGE,
    });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("403s when the attachment belongs to a different user", async () => {
    const attachment = await db.attachment.create({
      data: {
        uploadedById: bob.id,
        storageKey: "abc123.png",
        url: "/api/files/abc123.png",
        mimeType: "image/png",
        size: 100,
        fileName: "x.png",
      },
    });
    const r = await sendMessage(db, alice.id, {
      clientId: "x",
      conversationId: dm.id,
      type: MessageType.IMAGE,
      attachmentId: attachment.id,
    });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("409s when the attachment is already linked to another message", async () => {
    const attachment = await db.attachment.create({
      data: {
        uploadedById: alice.id,
        storageKey: "abc456.png",
        url: "/api/files/abc456.png",
        mimeType: "image/png",
        size: 100,
        fileName: "x.png",
      },
    });
    // First send links it.
    const first = await sendMessage(db, alice.id, {
      clientId: "first-with-attachment",
      conversationId: dm.id,
      type: MessageType.IMAGE,
      attachmentId: attachment.id,
    });
    expect(ok(first)).toBe(true);
    // Second send with the same attachment -> 409.
    const second = await sendMessage(db, alice.id, {
      clientId: "second-with-attachment",
      conversationId: dm.id,
      type: MessageType.IMAGE,
      attachmentId: attachment.id,
    });
    expect(err(second)).toBe(true);
    expect((second as any).status).toBe(409);
  });
});

describe("editMessage", () => {
  async function send(senderId: string, text: string, clientId: string) {
    return sendMessage(db, senderId, {
      clientId,
      conversationId: dm.id,
      type: MessageType.TEXT,
      text,
    });
  }

  it("edits the message text and sets editedAt within the edit window", async () => {
    const sent = await send(alice.id, "hello", "edit-1");
    const r = await editMessage(db, alice.id, (sent as any).message.id, "hello edited");
    expect(ok(r)).toBe(true);
    expect((r as any).message.text).toBe("hello edited");
    expect((r as any).message.editedAt).not.toBeNull();
  });

  it("403s when a different user tries to edit", async () => {
    const sent = await send(alice.id, "hello", "edit-2");
    const r = await editMessage(db, bob.id, (sent as any).message.id, "hijacked");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("422s when editing a non-text message", async () => {
    const attachment = await db.attachment.create({
      data: { uploadedById: alice.id, storageKey: "img.png", url: "/x", mimeType: "image/png", size: 10, fileName: "x.png" },
    });
    const sent = await sendMessage(db, alice.id, {
      clientId: "img-msg",
      conversationId: dm.id,
      type: MessageType.IMAGE,
      attachmentId: attachment.id,
    });
    const r = await editMessage(db, alice.id, (sent as any).message.id, "caption");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("422s when editing a deleted message", async () => {
    const sent = await send(alice.id, "to be deleted", "edit-3");
    await deleteMessage(db, alice.id, (sent as any).message.id, true);
    const r = await editMessage(db, alice.id, (sent as any).message.id, "after delete");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("403s when editing outside the edit window", async () => {
    const sent = await send(alice.id, "old", "edit-4");
    // Backdate the message createdAt to outside the edit window.
    const old = new Date(Date.now() - EDIT_WINDOW_MS - 1000);
    await db.message.update({ where: { id: (sent as any).message.id }, data: { createdAt: old } });
    const r = await editMessage(db, alice.id, (sent as any).message.id, "too late");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("404s when the message id doesn't exist", async () => {
    const r = await editMessage(db, alice.id, "no-such-id", "x");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });
});

describe("deleteMessage", () => {
  async function send(text: string, clientId: string) {
    return sendMessage(db, alice.id, {
      clientId,
      conversationId: dm.id,
      type: MessageType.TEXT,
      text,
    });
  }

  it("delete-for-everyone nulls text, sets deletedAt, preserves the row", async () => {
    const sent = await send("to delete", "del-1");
    const r = await deleteMessage(db, alice.id, (sent as any).message.id, true);
    expect(ok(r)).toBe(true);
    expect((r as any).message.deletedAt).not.toBeNull();
    expect((r as any).message.text).toBeNull();
    // Row still exists in the DB.
    const stillThere = await db.message.findUnique({ where: { id: (sent as any).message.id } });
    expect(stillThere).not.toBeNull();
  });

  it("delete-for-everyone 403s for non-senders", async () => {
    const sent = await send("alice's msg", "del-2");
    const r = await deleteMessage(db, bob.id, (sent as any).message.id, true);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("delete-for-me hides only for the requesting user (HiddenMessage)", async () => {
    const sent = await send("alice's msg", "del-3");
    const r = await deleteMessage(db, bob.id, (sent as any).message.id, false);
    expect(ok(r)).toBe(true);
    // Bob has a HiddenMessage row.
    const hidden = await db.hiddenMessage.findUnique({
      where: { messageId_userId: { messageId: (sent as any).message.id, userId: bob.id } },
    });
    expect(hidden).not.toBeNull();
    // Alice has no hidden row.
    const hiddenAlice = await db.hiddenMessage.findMany({
      where: { messageId: (sent as any).message.id, userId: alice.id },
    });
    expect(hiddenAlice).toHaveLength(0);
    // Original message still has text.
    const stillThere = await db.message.findUnique({ where: { id: (sent as any).message.id } });
    expect(stillThere!.text).toBe("alice's msg");
  });

  it("delete-for-me is idempotent (second call succeeds)", async () => {
    const sent = await send("to delete", "del-4");
    const first = await deleteMessage(db, bob.id, (sent as any).message.id, false);
    const second = await deleteMessage(db, bob.id, (sent as any).message.id, false);
    expect(ok(first) && ok(second)).toBe(true);
  });

  it("403s when a non-participant tries to delete-for-me", async () => {
    const sent = await send("alice's msg", "del-5");
    const r = await deleteMessage(db, carol.id, (sent as any).message.id, false);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("404s when the message id doesn't exist", async () => {
    const r = await deleteMessage(db, alice.id, "no-such-id", true);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });
});

describe("toggleReaction", () => {
  async function send(text: string, clientId: string) {
    return sendMessage(db, alice.id, {
      clientId,
      conversationId: dm.id,
      type: MessageType.TEXT,
      text,
    });
  }

  it("adds and removes a reaction (idempotent toggle)", async () => {
    const sent = await send("react to me", "react-1");
    const r1 = await toggleReaction(db, bob.id, (sent as any).message.id, "👍");
    expect(ok(r1)).toBe(true);
    expect((r1 as any).reactions[0].count).toBe(1);
    expect((r1 as any).reactions[0].reactedByMe).toBe(true);

    const r2 = await toggleReaction(db, bob.id, (sent as any).message.id, "👍");
    expect(ok(r2)).toBe(true);
    expect((r2 as any).reactions).toHaveLength(0);
  });

  it("supports multiple users reacting with the same emoji", async () => {
    const sent = await send("multi react", "react-2");
    await toggleReaction(db, bob.id, (sent as any).message.id, "🔥");
    const r2 = await toggleReaction(db, alice.id, (sent as any).message.id, "🔥");
    expect((r2 as any).reactions[0].count).toBe(2);
    expect((r2 as any).reactions[0].reactedByMe).toBe(true);
  });

  it("403s when a non-participant reacts", async () => {
    const sent = await send("intruder test", "react-3");
    const r = await toggleReaction(db, carol.id, (sent as any).message.id, "👍");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("422s when reacting to a deleted message", async () => {
    const sent = await send("to delete", "react-4");
    await deleteMessage(db, alice.id, (sent as any).message.id, true);
    const r = await toggleReaction(db, bob.id, (sent as any).message.id, "👍");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });
});

describe("listMessages — pagination & ordering", () => {
  beforeEach(async () => {
    // Create 5 messages in a deterministic order.
    for (let i = 0; i < 5; i++) {
      await sendMessage(db, alice.id, {
        clientId: `page-${i}`,
        conversationId: dm.id,
        type: MessageType.TEXT,
        text: `msg-${i}`,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it("returns messages oldest-first (newest last)", async () => {
    const r = await listMessages(db, alice.id, dm.id, { limit: 50 });
    expect(ok(r)).toBe(true);
    const texts = (r as any).messages.map((m: any) => m.text);
    expect(texts).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
  });

  it("honors the limit and returns a nextCursor", async () => {
    const r = await listMessages(db, alice.id, dm.id, { limit: 2 });
    expect(ok(r)).toBe(true);
    expect((r as any).messages).toHaveLength(2);
    expect((r as any).nextCursor).not.toBeNull();
  });

  it("returns older messages on the next page using the cursor", async () => {
    const r1 = await listMessages(db, alice.id, dm.id, { limit: 2 });
    const r2 = await listMessages(db, alice.id, dm.id, { limit: 2, cursor: (r1 as any).nextCursor });
    expect(ok(r2)).toBe(true);
    // No overlap between pages.
    const ids1 = (r1 as any).messages.map((m: any) => m.id);
    const ids2 = (r2 as any).messages.map((m: any) => m.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("clamps the limit to [1, MAX_MESSAGE_PAGE_SIZE]", async () => {
    const r1 = await listMessages(db, alice.id, dm.id, { limit: 0 });
    expect((r1 as any).messages).toHaveLength(1);
    const r2 = await listMessages(db, alice.id, dm.id, { limit: 9999 });
    // All 5 fit because MAX_MESSAGE_PAGE_SIZE=100 in our env.
    expect((r2 as any).messages).toHaveLength(5);
  });
});

describe("listMessages — highlight window", () => {
  beforeEach(async () => {
    for (let i = 0; i < 10; i++) {
      await sendMessage(db, alice.id, {
        clientId: `hl-${i}`,
        conversationId: dm.id,
        type: MessageType.TEXT,
        text: `hl-msg-${i}`,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it("centers the window around the highlighted message", async () => {
    const all = await listMessages(db, alice.id, dm.id, { limit: 50 });
    const targetId = all.messages![5].id;
    const r = await listMessages(db, alice.id, dm.id, { limit: 3, highlight: targetId });
    expect(ok(r)).toBe(true);
    // The highlight must be present.
    expect((r as any).messages.map((m: any) => m.id)).toContain(targetId);
  });

  it("404s when the highlight id doesn't exist", async () => {
    const r = await listMessages(db, alice.id, dm.id, { limit: 3, highlight: "no-such-id" });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });
});

describe("listMessages — delete-for-me filter", () => {
  it("omits messages hidden by the requesting user", async () => {
    const m1 = await sendMessage(db, alice.id, { clientId: "h-1", conversationId: dm.id, type: MessageType.TEXT, text: "first" });
    const m2 = await sendMessage(db, alice.id, { clientId: "h-2", conversationId: dm.id, type: MessageType.TEXT, text: "second" });
    await deleteMessage(db, bob.id, (m1 as any).message.id, false);
    const r = await listMessages(db, bob.id, dm.id, { limit: 50 });
    expect((r as any).messages.map((m: any) => m.text)).toEqual(["second"]);
    // Alice still sees both.
    const rAlice = await listMessages(db, alice.id, dm.id, { limit: 50 });
    expect((rAlice as any).messages.map((m: any) => m.text)).toEqual(["first", "second"]);
  });
});

describe("markConversationRead", () => {
  it("advances SENT/DELIVERED rows to READ for the reader", async () => {
    const sent = await sendMessage(db, alice.id, {
      clientId: "read-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "please read me",
    });
    // Default status is SENT.
    const before = await db.messageStatus.findUnique({
      where: { messageId_userId: { messageId: (sent as any).message.id, userId: bob.id } },
    });
    expect(before?.status).toBe(MessageDeliveryStatus.SENT);

    const r = await markConversationRead(db, bob.id, dm.id);
    expect(ok(r)).toBe(true);
    expect((r as any).updates).toHaveLength(1);
    expect((r as any).updates[0].status).toBe(MessageDeliveryStatus.READ);

    const after = await db.messageStatus.findUnique({
      where: { messageId_userId: { messageId: (sent as any).message.id, userId: bob.id } },
    });
    expect(after?.status).toBe(MessageDeliveryStatus.READ);
  });

  it("only advances statuses for messages NOT sent by the reader", async () => {
    const sentByAlice = await sendMessage(db, alice.id, {
      clientId: "self-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "alice wrote",
    });
    const r = await markConversationRead(db, alice.id, dm.id);
    // Alice's own messages don't get a status row for herself.
    const statuses = await db.messageStatus.findMany({ where: { messageId: (sentByAlice as any).message.id } });
    expect(statuses.filter((s) => s.userId === alice.id)).toHaveLength(0);
    // No updates emitted for Alice's own messages.
    expect((r as any).updates).toHaveLength(0);
  });

  it("updates lastReadAt on the participant row", async () => {
    const before = await db.participant.findUnique({
      where: { userId_conversationId: { userId: bob.id, conversationId: dm.id } },
    });
    expect(before).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    await markConversationRead(db, bob.id, dm.id);
    const after = await db.participant.findUnique({
      where: { userId_conversationId: { userId: bob.id, conversationId: dm.id } },
    });
    expect(after!.lastReadAt.getTime()).toBeGreaterThan(before!.lastReadAt.getTime());
  });

  it("403s when the reader is not a participant", async () => {
    const r = await markConversationRead(db, carol.id, dm.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });
});

describe("markDelivered", () => {
  it("advances SENT rows to DELIVERED for online recipients only", async () => {
    const sent = await sendMessage(db, alice.id, {
      clientId: "del-1",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "deliver me",
    });
    const updates = await markDelivered(db, [(sent as any).message.id], [bob.id]);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe(MessageDeliveryStatus.DELIVERED);
    const after = await db.messageStatus.findUnique({
      where: { messageId_userId: { messageId: (sent as any).message.id, userId: bob.id } },
    });
    expect(after?.status).toBe(MessageDeliveryStatus.DELIVERED);
  });

  it("is a no-op when there are no messages or users", async () => {
    expect(await markDelivered(db, [], [bob.id])).toEqual([]);
    expect(await markDelivered(db, ["x"], [])).toEqual([]);
  });

  it("does not downgrade already-READ rows", async () => {
    const sent = await sendMessage(db, alice.id, {
      clientId: "del-2",
      conversationId: dm.id,
      type: MessageType.TEXT,
      text: "deliver me",
    });
    // Bob reads first.
    await markConversationRead(db, bob.id, dm.id);
    // Now markDelivered should NOT downgrade the row.
    await markDelivered(db, [(sent as any).message.id], [bob.id]);
    const after = await db.messageStatus.findUnique({
      where: { messageId_userId: { messageId: (sent as any).message.id, userId: bob.id } },
    });
    expect(after?.status).toBe(MessageDeliveryStatus.READ);
  });
});

describe("searchMessages", () => {
  beforeEach(async () => {
    await sendMessage(db, alice.id, { clientId: "s-1", conversationId: dm.id, type: MessageType.TEXT, text: "hello world" });
    await sendMessage(db, alice.id, { clientId: "s-2", conversationId: dm.id, type: MessageType.TEXT, text: "hello again" });
    await sendMessage(db, alice.id, { clientId: "s-3", conversationId: group.id, type: MessageType.TEXT, text: "different chat hello" });
  });

  it("groups matches by conversation with counts", async () => {
    const results = await searchMessages(db, alice.id, "hello");
    expect(results).toHaveLength(2);
    const dmHit = results.find((r) => r.conversationId === dm.id)!;
    expect(dmHit.matchCount).toBe(2);
    const groupHit = results.find((r) => r.conversationId === group.id)!;
    expect(groupHit.matchCount).toBe(1);
  });

  it("excludes deleted messages", async () => {
    const all = await listMessages(db, alice.id, dm.id, { limit: 50 });
    const first = all.messages![0];
    await deleteMessage(db, alice.id, first.id, true);
    const results = await searchMessages(db, alice.id, "hello");
    const dmHit = results.find((r) => r.conversationId === dm.id);
    expect(dmHit?.matchCount).toBe(1);
  });
});

describe("assertParticipant / requireParticipant", () => {
  it("returns the participant row when the user is a member", async () => {
    const r = await assertParticipant(db, alice.id, dm.id);
    expect(r).not.toBeNull();
    expect(r!.leftAt).toBeNull();
  });

  it("returns null when the user is not a member", async () => {
    expect(await assertParticipant(db, carol.id, dm.id)).toBeNull();
  });

  it("requireParticipant returns 404 on missing conversation", async () => {
    const r = await requireParticipant(db, alice.id, "no-such-conv");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });

  it("requireParticipant returns 403 when the user is not a member", async () => {
    const r = await requireParticipant(db, carol.id, dm.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });
});
