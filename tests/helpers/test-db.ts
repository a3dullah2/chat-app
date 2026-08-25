// Test database helper: spins up a fresh, isolated SQLite DB per test file
// (or per test, via `resetTestDb`). The production `db/custom.db` is never
// touched — tests use `db/test.db` plus a unique schema-aware name when
// requested.

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const TEST_DB_PATH = path.join(process.cwd(), "db", "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let _client: PrismaClient | null = null;

/** Returns the shared test Prisma client (creates one on first call). */
export function getTestDb(): PrismaClient {
  if (!_client) {
    // The DATABASE_URL env var is read by Prisma at client construction time,
    // so set it BEFORE instantiating the client.
    process.env.DATABASE_URL = TEST_DB_URL;
    _client = new PrismaClient({
      log: ["error", "warn"],
    });
  }
  return _client;
}

/** Wipes all rows from every table. Call between tests for isolation. */
export async function resetTestDb(): Promise<void> {
  const db = getTestDb();
  // Order respects FK cascades; explicit to be safe across SQLite modes.
  await db.hiddenMessage.deleteMany();
  await db.reaction.deleteMany();
  await db.messageStatus.deleteMany();
  await db.attachment.deleteMany();
  await db.userStickerFavorite.deleteMany();
  await db.userStickerRecent.deleteMany();
  await db.message.deleteMany();
  await db.participant.deleteMany();
  await db.conversation.deleteMany();
  await db.sticker.deleteMany();
  await db.stickerPack.deleteMany();
  await db.user.deleteMany();
}

/** Removes the test DB file entirely (for teardown). */
export async function dropTestDb(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
  for (const ext of ["", "-shm", "-wal"]) {
    const p = `${TEST_DB_PATH}${ext}`;
    try {
      await fs.unlink(p);
    } catch {
      /* ignore missing */
    }
  }
}

/** Convenience: hash a password with the production bcrypt helper. */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.default.hash(password, 4); // low cost factor for fast tests
}

/** Convenience: create a user and return its row. */
export async function createUser(
  db: PrismaClient,
  overrides: Partial<{
    id: string;
    name: string;
    email: string;
    password: string;
    about: string;
    isOnline: boolean;
    avatarUrl: string;
  }> = {},
): Promise<{ id: string; name: string; email: string; passwordHash: string }> {
  const name = overrides.name ?? `User-${Math.random().toString(36).slice(2, 8)}`;
  const email = overrides.email ?? `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@test.com`;
  return db.user.create({
    data: {
      id: overrides.id,
      name,
      email,
      passwordHash: await hashPassword(overrides.password ?? "password123"),
      about: overrides.about ?? "test about",
      isOnline: overrides.isOnline ?? false,
      avatarUrl: overrides.avatarUrl ?? null,
    },
  }) as Promise<{ id: string; name: string; email: string; passwordHash: string }>;
}

/** Create a DIRECT conversation between two users (returns the conversation id). */
export async function createDirectConversation(
  db: PrismaClient,
  userA: { id: string },
  userB: { id: string },
): Promise<{ id: string }> {
  const conv = await db.conversation.create({
    data: {
      type: "DIRECT",
      createdById: userA.id,
      participants: {
        create: [
          { userId: userA.id, role: "MEMBER" },
          { userId: userB.id, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });
  return conv;
}

/** Create a GROUP conversation with the given participants (first is OWNER). */
export async function createGroupConversation(
  db: PrismaClient,
  ownerId: string,
  memberIds: string[],
  name = "Test group",
): Promise<{ id: string }> {
  const conv = await db.conversation.create({
    data: {
      type: "GROUP",
      name,
      createdById: ownerId,
      participants: {
        create: [
          { userId: ownerId, role: "OWNER" },
          ...memberIds.map((id) => ({ userId: id, role: "MEMBER" as const })),
        ],
      },
    },
    select: { id: true },
  });
  return conv;
}
