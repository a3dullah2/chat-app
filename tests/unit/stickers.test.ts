// Unit tests for the sticker feature's pure helpers:
//   - Telegram pack link parser
//   - messagePreview for STICKER (and unchanged types)
//   - sendMessage STICKER branch (validation + access + recent-trimming)

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  TELEGRAM_PACK_LINK_RE,
  MAX_RECENT_STICKERS,
  MAX_STICKER_SIZE_BYTES,
  STICKER_MIME_TYPES,
  StickerSource,
  MessageType,
} from "@shared/constants";
import { messagePreview } from "@shared/dto";
import { sendMessage } from "@shared/message-service";
import { telegramImportSchema, firstIssue } from "@shared/validation";
import { getTestDb, resetTestDb } from "../helpers/test-db";

// ---------------------------------------------------------------------------
// Telegram pack link parser
// ---------------------------------------------------------------------------

describe("Telegram pack link regex", () => {
  const valid = [
    "https://t.me/addstickers/CatName",
    "http://t.me/addstickers/MyPack123",
    "https://telegram.me/addstickers/An_iMA_Name",
    "https://t.me/addstickers/a",
  ];
  for (const link of valid) {
    it(`accepts ${link}`, () => {
      expect(TELEGRAM_PACK_LINK_RE.test(link)).toBe(true);
    });
  }

  const invalid = [
    "https://t.me/addstickers/", // missing name
    "https://t.me/addstickers/with-dash", // dashes not allowed
    "https://t.me/addstickers/with space",
    "https://evil.com/addstickers/CatName", // wrong host
    "https://t.me/AddStickers/CatName", // case-sensitive path
    "javascript:alert(1)",
    "",
    "not a url",
  ];
  for (const link of invalid) {
    it(`rejects ${link || "<empty>"}`, () => {
      expect(TELEGRAM_PACK_LINK_RE.test(link)).toBe(false);
    });
  }
});

describe("telegramImportSchema", () => {
  it("accepts a canonical Telegram pack link", () => {
    const parsed = telegramImportSchema.safeParse({
      packLink: "https://t.me/addstickers/CatName",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-Telegram URL with a friendly message", () => {
    const parsed = telegramImportSchema.safeParse({
      packLink: "https://example.com/not-telegram",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstIssue(parsed.error)).toMatch(/valid Telegram sticker link/i);
    }
  });

  it("trims whitespace before validation", () => {
    const parsed = telegramImportSchema.safeParse({
      packLink: "  https://t.me/addstickers/CatName  ",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty packLink", () => {
    const parsed = telegramImportSchema.safeParse({ packLink: "" });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sticker constants
// ---------------------------------------------------------------------------

describe("Sticker constants", () => {
  it("MAX_RECENT_STICKERS is 24 (matches spec)", () => {
    expect(MAX_RECENT_STICKERS).toBe(24);
  });

  it("MAX_STICKER_SIZE_BYTES is 500 KB", () => {
    expect(MAX_STICKER_SIZE_BYTES).toBe(512 * 1024);
  });

  it("STICKER_MIME_TYPES includes WebP, PNG, GIF, and Lottie JSON", () => {
    expect(STICKER_MIME_TYPES.has("image/webp")).toBe(true);
    expect(STICKER_MIME_TYPES.has("image/png")).toBe(true);
    expect(STICKER_MIME_TYPES.has("image/gif")).toBe(true);
    expect(STICKER_MIME_TYPES.has("application/lottie+json")).toBe(true);
  });

  it("STICKER_MIME_TYPES excludes non-sticker MIME types", () => {
    expect(STICKER_MIME_TYPES.has("application/pdf")).toBe(false);
    expect(STICKER_MIME_TYPES.has("video/mp4")).toBe(false);
    expect(STICKER_MIME_TYPES.has("text/plain")).toBe(false);
  });

  it("StickerSource has the three documented values", () => {
    expect(StickerSource.BUNDLED).toBe("BUNDLED");
    expect(StickerSource.TELEGRAM_IMPORT).toBe("TELEGRAM_IMPORT");
    expect(StickerSource.USER_UPLOAD).toBe("USER_UPLOAD");
  });

  it("MessageType has STICKER", () => {
    expect(MessageType.STICKER).toBe("STICKER");
  });
});

// ---------------------------------------------------------------------------
// messagePreview — STICKER branch
// ---------------------------------------------------------------------------

describe("messagePreview — STICKER branch", () => {
  it("renders '😀 Sticker' when the sticker has an emoji", () => {
    expect(messagePreview("STICKER", null, [], false, "😀")).toBe("😀 Sticker");
  });

  it("renders '🏷️ Sticker' when the sticker has no emoji", () => {
    expect(messagePreview("STICKER", null, [], false, null)).toBe("🏷️ Sticker");
    expect(messagePreview("STICKER", null, [], false, undefined)).toBe("🏷️ Sticker");
  });

  it("renders the deleted placeholder when deleted", () => {
    expect(messagePreview("STICKER", null, [], true, "😀")).toBe("🚫 Message deleted");
  });

  it("does not leak sticker text when present (STICKER messages have no text body)", () => {
    // Even if text is somehow present, the preview is the sticker label.
    expect(messagePreview("STICKER", "ignored", [], false, "🥳")).toBe("🥳 Sticker");
  });
});

// ---------------------------------------------------------------------------
// sendMessage — STICKER branch (integration with test DB)
// ---------------------------------------------------------------------------

describe("sendMessage — STICKER branch", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    await resetTestDb();
  });

  async function seedConversationAndUser(db: ReturnType<typeof getTestDb>) {
    const user = await db.user.create({
      data: { name: "Alice", email: "alice@test.com", passwordHash: "x" },
    });
    const conv = await db.conversation.create({
      data: { type: "DIRECT", createdById: user.id },
    });
    await db.participant.create({
      data: { userId: user.id, conversationId: conv.id, role: "OWNER" },
    });
    return { user, conv };
  }

  async function seedBundledPack(db: ReturnType<typeof getTestDb>, ownerId: string | null = null) {
    const pack = await db.stickerPack.create({
      data: {
        slug: ownerId ? `my-uploads-${ownerId}` : "emojis",
        name: "Emojis",
        source: ownerId ? "USER_UPLOAD" : "BUNDLED",
        ownerId,
        stickers: {
          create: [
            { storageKey: "stickers/emojis/happy.webp", mime: "image/webp", sortOrder: 0, emoji: "😀" },
            { storageKey: "stickers/emojis/laugh.webp", mime: "image/webp", sortOrder: 1, emoji: "😂" },
          ],
        },
      },
      include: { stickers: true },
    });
    return pack;
  }

  it("requires stickerId for STICKER messages", async () => {
    const db = getTestDb();
    const { user, conv } = await seedConversationAndUser(db);
    const result = await sendMessage(db, user.id, {
      clientId: "client-no-sticker-id",
      conversationId: conv.id,
      type: "STICKER",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe("VALIDATION");
      expect(result.error).toMatch(/stickerId is required/i);
    }
  });

  it("rejects a non-existent sticker with 404", async () => {
    const db = getTestDb();
    const { user, conv } = await seedConversationAndUser(db);
    const result = await sendMessage(db, user.id, {
      clientId: "client-bad-sticker",
      conversationId: conv.id,
      type: "STICKER",
      stickerId: "does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
    }
  });

  it("sends a STICKER message using a bundled sticker", async () => {
    const db = getTestDb();
    const { user, conv } = await seedConversationAndUser(db);
    const pack = await seedBundledPack(db);
    const stickerId = pack.stickers[0].id;

    const result = await sendMessage(db, user.id, {
      clientId: "client-sticker-1",
      conversationId: conv.id,
      type: "STICKER",
      stickerId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("STICKER");
      expect(result.message.stickerId).toBe(stickerId);
      expect(result.message.text).toBeNull();
    }
  });

  it("populates the user's Recent list on send and trims to 24", async () => {
    const db = getTestDb();
    const { user, conv } = await seedConversationAndUser(db);
    // Seed 30 bundled stickers so we can test the trim.
    const pack = await db.stickerPack.create({
      data: {
        slug: "big-pack",
        name: "Big Pack",
        source: "BUNDLED",
        ownerId: null,
        stickers: {
          create: Array.from({ length: 30 }, (_, i) => ({
            storageKey: `stickers/big/${i}.webp`,
            mime: "image/webp",
            sortOrder: i,
            emoji: "😀",
          })),
        },
      },
      include: { stickers: { orderBy: { sortOrder: "asc" } } },
    });

    // Send all 30 stickers (different clientIds).
    for (let i = 0; i < 30; i++) {
      await sendMessage(db, user.id, {
        clientId: `client-sticker-${i}`,
        conversationId: conv.id,
        type: "STICKER",
        stickerId: pack.stickers[i].id,
      });
    }

    const recent = await db.userStickerRecent.findMany({
      where: { userId: user.id },
      orderBy: { lastUsedAt: "desc" },
    });
    expect(recent.length).toBe(MAX_RECENT_STICKERS);
    // The last 24 sent should be retained (newest first).
    expect(recent[0].stickerId).toBe(pack.stickers[29].id);
    expect(recent[23].stickerId).toBe(pack.stickers[6].id);
    // The first 6 sent should be pruned.
    for (let i = 0; i < 6; i++) {
      expect(recent.find((r) => r.stickerId === pack.stickers[i].id)).toBeUndefined();
    }
  });

  it("forbids sending a sticker from another user's personal pack", async () => {
    const db = getTestDb();
    const owner = await db.user.create({
      data: { name: "Owner", email: "owner@test.com", passwordHash: "x" },
    });
    const intruder = await db.user.create({
      data: { name: "Intruder", email: "intruder@test.com", passwordHash: "x" },
    });
    const conv = await db.conversation.create({
      data: { type: "DIRECT", createdById: owner.id },
    });
    await db.participant.create({ data: { userId: owner.id, conversationId: conv.id, role: "OWNER" } });
    await db.participant.create({ data: { userId: intruder.id, conversationId: conv.id, role: "MEMBER" } });

    // Owner has a personal pack; intruder tries to use a sticker from it.
    const pack = await db.stickerPack.create({
      data: {
        slug: `my-uploads-${owner.id}`,
        name: "Owner's Pack",
        source: "USER_UPLOAD",
        ownerId: owner.id,
        stickers: { create: [{ storageKey: "abc123.webp", mime: "image/webp", sortOrder: 0, emoji: "😀" }] },
      },
      include: { stickers: true },
    });

    const result = await sendMessage(db, intruder.id, {
      clientId: "client-intruder",
      conversationId: conv.id,
      type: "STICKER",
      stickerId: pack.stickers[0].id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("is idempotent on clientId for STICKER messages", async () => {
    const db = getTestDb();
    const { user, conv } = await seedConversationAndUser(db);
    const pack = await seedBundledPack(db);
    const stickerId = pack.stickers[0].id;

    const first = await sendMessage(db, user.id, {
      clientId: "client-sticker-idem",
      conversationId: conv.id,
      type: "STICKER",
      stickerId,
    });
    expect(first.ok).toBe(true);

    const second = await sendMessage(db, user.id, {
      clientId: "client-sticker-idem",
      conversationId: conv.id,
      type: "STICKER",
      stickerId,
    });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.message.id).toBe(first.message.id);
    }
  });
});
