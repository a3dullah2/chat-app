// Service-level tests for conversation-service.ts.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getConversationList,
  getConversationDetail,
  createDirectConversation,
  createGroupConversation,
  updateConversation,
  leaveConversation,
  conversationListItemsForUsers,
  personalizeSystemText,
  type ConversationMutationResult,
} from "@shared/conversation-service";
import { ConversationType, ParticipantRole, MessageType } from "@shared/constants";
import {
  getTestDb,
  resetTestDb,
  dropTestDb,
  createUser,
  createDirectConversation as makeDirect,
  createGroupConversation as makeGroup,
} from "../helpers/test-db";

const db = getTestDb();

let alice: { id: string; name: string };
let bob: { id: string; name: string };
let carol: { id: string; name: string };
let david: { id: string; name: string };

beforeAll(() => {});

afterAll(async () => {
  await dropTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  [alice, bob, carol, david] = await Promise.all([
    createUser(db, { name: "Alice", email: "alice@test.com" }),
    createUser(db, { name: "Bob", email: "bob@test.com" }),
    createUser(db, { name: "Carol", email: "carol@test.com" }),
    createUser(db, { name: "David", email: "david@test.com" }),
  ]);
});

type Ok<T> = Extract<T, { ok: true }>;
function ok<T extends { ok: boolean }>(r: T): r is Ok<T> {
  return r.ok;
}
function err(r: any): boolean {
  return r !== null && typeof r === "object" && r.ok === false;
}

describe("createDirectConversation", () => {
  it("creates a new DIRECT conversation between two users", async () => {
    const r = await createDirectConversation(db, alice.id, bob.id);
    expect(ok(r)).toBe(true);
    expect((r as any).created).toBe(true);
    expect((r as any).conversation.type).toBe(ConversationType.DIRECT);
    expect((r as any).conversation.participantDetails).toHaveLength(2);
  });

  it("reuses an existing DIRECT conversation (idempotent) instead of creating a duplicate", async () => {
    const first = await createDirectConversation(db, alice.id, bob.id);
    const second = await createDirectConversation(db, alice.id, bob.id);
    expect(ok(first) && ok(second)).toBe(true);
    expect((first as any).conversation.id).toBe((second as any).conversation.id);
    expect((second as any).created).toBe(false);
    const count = await db.conversation.count({ where: { type: ConversationType.DIRECT } });
    expect(count).toBe(1);
  });

  it("422s when the user tries to create a conversation with themselves", async () => {
    const r = await createDirectConversation(db, alice.id, alice.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("404s when the other user doesn't exist", async () => {
    const r = await createDirectConversation(db, alice.id, "no-such-user");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });
});

describe("createGroupConversation", () => {
  it("creates a GROUP conversation with the owner + the listed members", async () => {
    const r = await createGroupConversation(db, alice.id, "Project Phoenix", [bob.id, carol.id]);
    expect(ok(r)).toBe(true);
    expect((r as any).conversation.type).toBe(ConversationType.GROUP);
    expect((r as any).conversation.name).toBe("Project Phoenix");
    expect((r as any).conversation.participantDetails).toHaveLength(3);

    const me = (r as any).conversation.participantDetails.find((p: any) => p.userId === alice.id);
    expect(me.role).toBe(ParticipantRole.OWNER);
  });

  it("creates a SYSTEM message announcing the group creation", async () => {
    const r = await createGroupConversation(db, alice.id, "Just us", [bob.id]);
    expect(ok(r)).toBe(true);
    expect((r as any).systemMessage.type).toBe(MessageType.SYSTEM);
    expect((r as any).systemMessage.text).toContain("created group");
  });

  it("422s when some participant ids don't exist", async () => {
    const r = await createGroupConversation(db, alice.id, "Bad", [bob.id, "no-such"]);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("deduplicates the member list (Bob appears once even if listed twice)", async () => {
    const r = await createGroupConversation(db, alice.id, "Dedup", [bob.id, bob.id, carol.id]);
    expect(ok(r)).toBe(true);
    expect((r as any).conversation.participantDetails).toHaveLength(3);
  });
});

describe("getConversationList", () => {
  beforeEach(async () => {
    await makeDirect(db, alice, bob);
    await makeDirect(db, alice, carol);
    await makeGroup(db, alice.id, [bob.id, carol.id], "Group 1");
  });

  it("returns all conversations the user participates in", async () => {
    const list = await getConversationList(db, alice.id);
    expect(list).toHaveLength(3);
  });

  it("returns an empty array when the user has no conversations", async () => {
    const list = await getConversationList(db, david.id);
    expect(list).toEqual([]);
  });

  it("returns an empty array when the user doesn't exist", async () => {
    const list = await getConversationList(db, "no-such-user");
    expect(list).toEqual([]);
  });

  it("orders pinned-first, then by updatedAt desc", async () => {
    // Pin the group.
    await db.participant.updateMany({
      where: { userId: alice.id, conversationId: { in: await db.conversation.findMany({ select: { id: true }, where: { type: "GROUP" } }).then((r) => r.map((c) => c.id)) } },
      data: { isPinned: true },
    });
    const list = await getConversationList(db, alice.id);
    const pinned = list.filter((i) => i.isPinned);
    expect(pinned.length).toBeGreaterThan(0);
    // Pinned entries must come first.
    for (let i = 0; i < pinned.length; i++) {
      expect(list[i].isPinned).toBe(true);
    }
  });
});

describe("getConversationDetail", () => {
  beforeEach(async () => {
    await makeDirect(db, alice, bob);
  });

  it("returns the conversation with participant details", async () => {
    const conv = await db.conversation.findFirst({ where: { type: ConversationType.DIRECT } });
    const r = await getConversationDetail(db, alice.id, conv!.id);
    expect(ok(r)).toBe(true);
    expect((r as any).conversation.id).toBe(conv!.id);
    expect((r as any).conversation.participantDetails).toHaveLength(2);
  });

  it("404s when the conversation doesn't exist", async () => {
    const r = await getConversationDetail(db, alice.id, "no-such-id");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });

  it("404s when the user is not a participant", async () => {
    const conv = await db.conversation.findFirst({ where: { type: ConversationType.DIRECT } });
    const r = await getConversationDetail(db, david.id, conv!.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });

  it("403s when the user previously left", async () => {
    const group = await makeGroup(db, alice.id, [bob.id, carol.id], "G");
    // Bob leaves.
    await leaveConversation(db, bob.id, group.id);
    const r = await getConversationDetail(db, bob.id, group.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });
});

describe("updateConversation", () => {
  let group: { id: string };

  beforeEach(async () => {
    group = await makeGroup(db, alice.id, [bob.id, carol.id], "Original");
  });

  it("lets the owner rename the group + emits a SYSTEM message", async () => {
    const r = await updateConversation(db, alice.id, group.id, { name: "Renamed" });
    expect(ok(r)).toBe(true);
    expect((r as any).conversation.name).toBe("Renamed");
    expect((r as any).systemMessages.length).toBeGreaterThan(0);
    expect((r as any).systemMessages[0].text).toContain("Renamed");
  });

  it("403s when a non-admin tries to rename", async () => {
    const r = await updateConversation(db, bob.id, group.id, { name: "Hijacked" });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(403);
  });

  it("422s when trying to rename a DIRECT conversation", async () => {
    const dm = await makeDirect(db, alice, bob);
    const r = await updateConversation(db, alice.id, dm.id, { name: "nope" });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("lets any member mute/pin/archive themselves", async () => {
    const r = await updateConversation(db, bob.id, group.id, { isMuted: true, isPinned: true, isArchived: true });
    expect(ok(r)).toBe(true);
    const p = await db.participant.findUnique({
      where: { userId_conversationId: { userId: bob.id, conversationId: group.id } },
    });
    expect(p!.isMuted).toBe(true);
    expect(p!.isPinned).toBe(true);
    expect(p!.isArchived).toBe(true);
    // No SYSTEM messages emitted for personal flags.
    expect((r as any).systemMessages).toHaveLength(0);
  });

  it("adds and removes participants (with SYSTEM messages)", async () => {
    const r = await updateConversation(db, alice.id, group.id, { addParticipantIds: [david.id] });
    expect(ok(r)).toBe(true);
    const sysTexts = (r as any).systemMessages.map((m: any) => m.text);
    expect(sysTexts.some((t: string) => t.includes("added"))).toBe(true);
    expect((r as any).affectedUserIds).toContain(david.id);

    // Now remove David.
    const r2 = await updateConversation(db, alice.id, group.id, { removeParticipantIds: [david.id] });
    expect(ok(r2)).toBe(true);
    const davidRow = await db.participant.findUnique({
      where: { userId_conversationId: { userId: david.id, conversationId: group.id } },
    });
    expect(davidRow!.leftAt).not.toBeNull();
  });

  it("422s when trying to remove yourself (use leave instead)", async () => {
    const r = await updateConversation(db, alice.id, group.id, { removeParticipantIds: [alice.id] });
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("403s when trying to remove the group owner", async () => {
    const r = await updateConversation(db, alice.id, group.id, { removeParticipantIds: [alice.id] });
    // Alice is the owner and trying to remove herself -> 422 (above). Let's
    // test a different scenario: an admin tries to remove the owner.
    await db.participant.update({
      where: { userId_conversationId: { userId: bob.id, conversationId: group.id } },
      data: { role: ParticipantRole.ADMIN },
    });
    // Alice is owner; if bob (admin) tries to remove alice -> 403.
    const r2 = await updateConversation(db, bob.id, group.id, { removeParticipantIds: [alice.id] });
    expect(err(r2)).toBe(true);
    expect((r2 as any).status).toBe(403);
  });

  it("re-adds a previously-left participant without duplicating the row", async () => {
    await updateConversation(db, alice.id, group.id, { addParticipantIds: [david.id] });
    await leaveConversation(db, david.id, group.id);
    const r = await updateConversation(db, alice.id, group.id, { addParticipantIds: [david.id] });
    expect(ok(r)).toBe(true);
    const davidRows = await db.participant.findMany({
      where: { userId: david.id, conversationId: group.id },
    });
    expect(davidRows).toHaveLength(1);
    expect(davidRows[0].leftAt).toBeNull();
  });
});

describe("leaveConversation", () => {
  let group: { id: string };

  beforeEach(async () => {
    group = await makeGroup(db, alice.id, [bob.id, carol.id], "G");
  });

  it("marks the participant as left and emits a system message", async () => {
    const r = await leaveConversation(db, bob.id, group.id);
    expect(ok(r)).toBe(true);
    expect((r as any).deleted).toBe(false);
    const p = await db.participant.findUnique({
      where: { userId_conversationId: { userId: bob.id, conversationId: group.id } },
    });
    expect(p!.leftAt).not.toBeNull();
    expect((r as any).systemMessages[0].text).toContain("left");
  });

  it("422s when trying to leave a DIRECT conversation", async () => {
    const dm = await makeDirect(db, alice, bob);
    const r = await leaveConversation(db, alice.id, dm.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("422s when the user has already left", async () => {
    await leaveConversation(db, bob.id, group.id);
    const r = await leaveConversation(db, bob.id, group.id);
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(422);
  });

  it("deletes the conversation when the last member leaves", async () => {
    await leaveConversation(db, bob.id, group.id);
    await leaveConversation(db, carol.id, group.id);
    const r = await leaveConversation(db, alice.id, group.id);
    expect(ok(r)).toBe(true);
    expect((r as any).deleted).toBe(true);
    const stillThere = await db.conversation.findUnique({ where: { id: group.id } });
    expect(stillThere).toBeNull();
  });

  it("transfers ownership to the earliest-joined remaining member when the owner leaves", async () => {
    const r = await leaveConversation(db, alice.id, group.id);
    expect(ok(r)).toBe(true);
    // Bob joined before carol (insert order). Bob becomes the new OWNER.
    const bobRow = await db.participant.findUnique({
      where: { userId_conversationId: { userId: bob.id, conversationId: group.id } },
    });
    expect(bobRow!.role).toBe(ParticipantRole.OWNER);
    const sysTexts = (r as any).systemMessages.map((m: any) => m.text);
    expect(sysTexts.some((t: string) => t.includes("is now the group owner"))).toBe(true);
  });

  it("404s when the conversation doesn't exist", async () => {
    const r = await leaveConversation(db, alice.id, "no-such-id");
    expect(err(r)).toBe(true);
    expect((r as any).status).toBe(404);
  });
});

describe("conversationListItemsForUsers", () => {
  beforeEach(async () => {
    await makeDirect(db, alice, bob);
  });

  it("returns per-user list items for active participants", async () => {
    const conv = await db.conversation.findFirst();
    const items = await conversationListItemsForUsers(db, conv!.id);
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.userId);
    expect(ids).toContain(alice.id);
    expect(ids).toContain(bob.id);
  });

  it("returns an empty array when the conversation doesn't exist", async () => {
    const items = await conversationListItemsForUsers(db, "no-such-id");
    expect(items).toEqual([]);
  });

  it("filters to the requested userIds when provided", async () => {
    const conv = await db.conversation.findFirst();
    const items = await conversationListItemsForUsers(db, conv!.id, [alice.id]);
    expect(items).toHaveLength(1);
    expect(items[0].userId).toBe(alice.id);
  });
});

describe("personalizeSystemText", () => {
  it("replaces a quoted actor name with 'You'", () => {
    expect(personalizeSystemText('"Alice" added Bob', "Alice")).toBe("You added Bob");
  });

  it("replaces a bare actor name prefix with 'You'", () => {
    expect(personalizeSystemText("Alice changed the group name", "Alice")).toBe(
      "You changed the group name",
    );
  });

  it("returns the text unchanged when the actor name doesn't match", () => {
    expect(personalizeSystemText("Alice added Bob", "Bob")).toBe("Alice added Bob");
  });

  it("returns the text unchanged when the actor name is empty", () => {
    expect(personalizeSystemText("Alice added Bob", "")).toBe("Alice added Bob");
  });
});
