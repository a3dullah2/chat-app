// Seed script: demo users, conversations, messages, media and reactions.
// Run with: bun prisma/seed.ts   (also wired as `npm run db:reset`)

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const db = new PrismaClient();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const THUMBS_DIR = path.join(UPLOADS_DIR, "thumbs");

// ---------------------------------------------------------------------------
// Media generators (no external assets required)
// ---------------------------------------------------------------------------

async function makeGradientImage(colors: [string, string], label: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  const svg = Buffer.from(
    `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${colors[0]}"/>
          <stop offset="1" stop-color="${colors[1]}"/>
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#g)"/>
      <circle cx="200" cy="180" r="110" fill="rgba(255,255,255,0.28)"/>
      <circle cx="560" cy="420" r="160" fill="rgba(255,255,255,0.18)"/>
      <circle cx="620" cy="140" r="60" fill="rgba(255,255,255,0.35)"/>
      <text x="40" y="560" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="rgba(255,255,255,0.85)">${label}</text>
    </svg>`,
  );
  const buffer = await sharp(svg).png().toBuffer();
  return { buffer, width: 800, height: 600 };
}

/** Pure-JS WAV generator: a pleasant two-tone chime. */
function makeWavChirp(durationSec: number): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = 320 + 140 * Math.sin(2 * Math.PI * 0.8 * t);
    const envelope = Math.min(1, t / 0.06, Math.max(0, (durationSec - t) / 0.12));
    const wave = 0.35 * Math.sin(2 * Math.PI * freq * t) + 0.12 * Math.sin(2 * Math.PI * freq * 2 * t);
    data.writeInt16LE(Math.round(wave * envelope * 32767), i * 2);
  }
  return Buffer.concat([header, data]);
}

function makePdf(title: string, lines: string[]): Buffer {
  const contentLines = [
    "BT /F1 22 Tf 56 760 Td (" + escapePdf(title) + ") Tj ET",
    ...lines.map((line, i) => `BT /F1 12 Tf 56 ${730 - i * 20} Td (${escapePdf(line)}) Tj ET`),
  ].join("\n");
  const stream = Buffer.from(contentLines, "latin1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function saveFile(buffer: Buffer, ext: string): Promise<string> {
  const storageKey = `${crypto.randomBytes(16).toString("hex")}${ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, storageKey), buffer);
  return storageKey;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

async function main() {
  console.log("🌱 Seeding ChatApp database…");

  await fs.mkdir(THUMBS_DIR, { recursive: true });

  // Wipe (order matters for FKs; cascades help but be explicit).
  await db.hiddenMessage.deleteMany();
  await db.reaction.deleteMany();
  await db.messageStatus.deleteMany();
  await db.attachment.deleteMany();
  await db.message.deleteMany();
  await db.participant.deleteMany();
  await db.conversation.deleteMany();
  await db.userStickerFavorite.deleteMany();
  await db.userStickerRecent.deleteMany();
  await db.sticker.deleteMany();
  await db.stickerPack.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);
  const passwordHash2 = await bcrypt.hash("password123", 10);

  const [demo, alice, bob, carol, david, emma] = await Promise.all([
    db.user.create({
      data: {
        name: "Demo User",
        email: "demo@chatapp.com",
        passwordHash,
        about: "Just here for the vibes ✨",
        isOnline: false,
        lastSeenAt: new Date(now - 20 * 60 * 1000),
      },
    }),
    db.user.create({
      data: { name: "Alice Johnson", email: "alice@chatapp.com", passwordHash: passwordHash2, about: "Coffee first ☕", lastSeenAt: new Date(now - 5 * 60 * 1000) },
    }),
    db.user.create({
      data: { name: "Bob Smith", email: "bob@chatapp.com", passwordHash: passwordHash2, about: "Cyclist. Dad joke connoisseur.", lastSeenAt: new Date(now - 3 * HOUR) },
    }),
    db.user.create({
      data: { name: "Carol Williams", email: "carol@chatapp.com", passwordHash: passwordHash2, about: "PM @ Phoenix — shipping is my cardio", lastSeenAt: new Date(now - 26 * HOUR) },
    }),
    db.user.create({
      data: { name: "David Lee", email: "david@chatapp.com", passwordHash: passwordHash2, about: "Photos, film cams and mountains", lastSeenAt: new Date(now - 2 * DAY) },
    }),
    db.user.create({
      data: { name: "Emma Martinez", email: "emma@chatapp.com", passwordHash: passwordHash2, about: "Design systems & dog memes", lastSeenAt: new Date(now - 50 * 60 * 1000) },
    }),
  ]);
  console.log(`   users: 6 (demo@chatapp.com / password123)`);

  // --------------------------- media assets ---------------------------
  const img1 = await makeGradientImage(["#0f766e", "#22d3ee"], "Sunrise at the lake");
  const img2 = await makeGradientImage(["#9d174d", "#f59e0b"], "Campfire night");
  const img3 = await makeGradientImage(["#312e81", "#a78bfa"], "Trail map selfie");
  const voice1 = makeWavChirp(6);
  const voice2 = makeWavChirp(3);
  const pdfBuffer = makePdf("Weekend Trip — Itinerary", [
    "Saturday 08:00 — Meet at the trailhead parking lot",
    "Saturday 09:00 — Start the ascent (east ridge route)",
    "Saturday 13:00 — Lunch at the lake",
    "Sunday 10:00 — Waterfall hike + picnic",
    "Sunday 17:00 — Drive back",
    "",
    "Packing list: boots, headlamp, layers, snacks, 2L water.",
  ]);

  const keyImg1 = await saveFile(img1.buffer, ".png");
  const keyImg1b = await saveFile(img1.buffer, ".png"); // same picture shared in a second chat
  const keyImg2 = await saveFile(img2.buffer, ".png");
  const keyImg3 = await saveFile(img3.buffer, ".png");
  const keyVoice1 = await saveFile(voice1, ".wav");
  const keyVoice2 = await saveFile(voice2, ".wav");
  const keyPdf = await saveFile(pdfBuffer, ".pdf");
  const keyPdf2 = await saveFile(pdfBuffer, ".pdf"); // same doc shared in a second chat

  // Thumbnails for the images.
  const thumbs: Record<string, string | null> = {};
  for (const [key, buffer] of [
    [keyImg1, img1.buffer],
    [keyImg1b, img1.buffer],
    [keyImg2, img2.buffer],
    [keyImg3, img3.buffer],
  ] as const) {
    await sharp(buffer).resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(THUMBS_DIR, `${key}.webp`));
    thumbs[key] = `/api/files/${key}?thumb=1`;
  }

  const attachmentData = (key: string, mime: string, fileName: string, size: number, extra: Partial<{ durationSec: number; width: number; height: number; thumbnailUrl: string | null }> = {}) => ({
    storageKey: key,
    url: `/api/files/${key}`,
    mimeType: mime,
    size,
    fileName,
    ...extra,
  });

  // --------------------------- conversations ---------------------------
  const mk = (senderId: string, conversationId: string, type: string, text: string | null, createdAt: number, extra: Partial<{
    clientId: string | null; replyToId: string | null; attachments: { create: any[] };
  }> = {}) =>
    ({ senderId, conversationId, type, text, createdAt: new Date(createdAt), ...extra });

  // --- 1. DIRECT Demo <-> Alice (rich: text, image, voice, reply, reactions, fully read)
  const convAlice = await db.conversation.create({
    data: { type: "DIRECT", createdById: demo.id, createdAt: new Date(now - 6 * DAY) },
  });
  // --- 2. DIRECT Demo <-> Bob (voice note + pdf, 2 unread for demo)
  const convBob = await db.conversation.create({
    data: { type: "DIRECT", createdById: bob.id, createdAt: new Date(now - 2 * DAY) },
  });
  // --- 3. DIRECT Demo <-> Carol (short, read)
  const convCarol = await db.conversation.create({
    data: { type: "DIRECT", createdById: carol.id, createdAt: new Date(now - 30 * HOUR) },
  });
  // --- 4. DIRECT Demo <-> David (1 unread)
  const convDavid = await db.conversation.create({
    data: { type: "DIRECT", createdById: demo.id, createdAt: new Date(now - 20 * HOUR) },
  });
  // --- 5. GROUP Weekend Trip (Demo owner + Alice + Bob + David)
  const convTrip = await db.conversation.create({
    data: { type: "GROUP", name: "Weekend Trip 🏔️", createdById: demo.id, createdAt: new Date(now - 5 * DAY) },
  });
  // --- 6. GROUP Project Phoenix (Carol owner + Demo + Bob + Emma)
  const convPhoenix = await db.conversation.create({
    data: { type: "GROUP", name: "Project Phoenix", createdById: carol.id, createdAt: new Date(now - 8 * DAY) },
  });

  await db.participant.createMany({
    data: [
      { userId: demo.id, conversationId: convAlice.id, role: "MEMBER", lastReadAt: new Date(now) },
      { userId: alice.id, conversationId: convAlice.id, role: "MEMBER", lastReadAt: new Date(now) },
      { userId: demo.id, conversationId: convBob.id, role: "MEMBER", lastReadAt: new Date(now - 4 * HOUR) },
      { userId: bob.id, conversationId: convBob.id, role: "MEMBER", lastReadAt: new Date(now - 30 * 60 * 1000) },
      { userId: demo.id, conversationId: convCarol.id, role: "MEMBER", lastReadAt: new Date(now) },
      { userId: carol.id, conversationId: convCarol.id, role: "MEMBER", lastReadAt: new Date(now - 20 * HOUR) },
      { userId: demo.id, conversationId: convDavid.id, role: "MEMBER", lastReadAt: new Date(now - 8 * HOUR) },
      { userId: david.id, conversationId: convDavid.id, role: "MEMBER", lastReadAt: new Date(now - 6 * HOUR) },
      { userId: demo.id, conversationId: convTrip.id, role: "OWNER", isPinned: true, lastReadAt: new Date(now - 26 * HOUR) },
      { userId: alice.id, conversationId: convTrip.id, role: "MEMBER", lastReadAt: new Date(now - 25 * HOUR) },
      { userId: bob.id, conversationId: convTrip.id, role: "ADMIN", lastReadAt: new Date(now - 3 * HOUR) },
      { userId: david.id, conversationId: convTrip.id, role: "MEMBER", lastReadAt: new Date(now - 24 * HOUR) },
      { userId: carol.id, conversationId: convPhoenix.id, role: "OWNER", isMuted: false, lastReadAt: new Date(now - 10 * HOUR) },
      { userId: demo.id, conversationId: convPhoenix.id, role: "MEMBER", lastReadAt: new Date(now - 12 * HOUR) },
      { userId: bob.id, conversationId: convPhoenix.id, role: "MEMBER", lastReadAt: new Date(now - 9 * HOUR) },
      { userId: emma.id, conversationId: convPhoenix.id, role: "MEMBER", lastReadAt: new Date(now - 8 * HOUR) },
    ],
  });

  // --------------------------- messages ---------------------------
  // Helper: create message + attachment rows + status rows.
  async function message(
    conversationId: string,
    senderId: string,
    type: string,
    text: string | null,
    createdAt: number,
    opts: {
      attachment?: ReturnType<typeof attachmentData> & { uploadedById?: string };
      replyToId?: string | null;
      statuses?: { userId: string; status: string }[];
    } = {},
  ) {
    const created = await db.message.create({
      data: {
        conversationId,
        senderId,
        type,
        text,
        createdAt: new Date(createdAt),
        replyToId: opts.replyToId ?? null,
        attachments: opts.attachment
          ? { create: [{ ...opts.attachment, uploadedById: opts.attachment.uploadedById ?? senderId }] }
          : undefined,
      },
    });
    if (opts.statuses?.length) {
      await db.messageStatus.createMany({
        data: opts.statuses.map((s) => ({ messageId: created.id, userId: s.userId, status: s.status })),
      });
    }
    return created;
  }

  const othersOf = (conversationId: string, senderId: string, all: string[]) =>
    all
      .filter((id) => id !== senderId)
      .map((userId) => ({ userId, status: "READ" as string }));

  // --- Alice direct (fully read, spread over 2 days)
  const aAll = [demo.id, alice.id];
  const aliceMsgs: { id: string }[] = [];
  const aliceScript: Array<[string, string, string | null, number, object?]> = [
    [alice.id, "TEXT", "Hey! Are you still around this weekend?", now - 6 * DAY + HOUR],
    [demo.id, "TEXT", "Yep, totally free Saturday 🎉", now - 6 * DAY + 1.2 * HOUR],
    [alice.id, "TEXT", "Amazing. I found this lake route, looks stunning", now - 6 * DAY + 1.4 * HOUR],
    [alice.id, "IMAGE", "Sunrise at the lake — from last year", now - 6 * DAY + 1.5 * HOUR, { attachment: attachmentData(keyImg1, "image/png", "sunrise-lake.png", img1.buffer.length, { width: 800, height: 600, thumbnailUrl: thumbs[keyImg1] }) }],
    [demo.id, "TEXT", "Whoa, that view 😍 count me in", now - 6 * DAY + 2 * HOUR],
    [alice.id, "AUDIO", null, now - 6 * DAY + 2.5 * HOUR, { attachment: attachmentData(keyVoice1, "audio/wav", "voice-message.wav", voice1.length, { durationSec: 6 }) }],
    [demo.id, "TEXT", "Haha yes exactly my thoughts", now - 6 * DAY + 2.7 * HOUR],
    [demo.id, "TEXT", "Should we make it a group thing? I'll ask the others", now - 6 * DAY + 3 * HOUR],
    [alice.id, "TEXT", "Great idea — David has that big tent too", now - 6 * DAY + 3.1 * HOUR],
  ];
  for (const [senderId, type, text, at, opts] of aliceScript) {
    const m = await message(convAlice.id, senderId, type, text, at, {
      ...(opts as object),
      statuses: othersOf(convAlice.id, senderId, aAll),
    });
    aliceMsgs.push(m);
  }
  // Reply + reactions on the direct chat.
  const replyTarget = aliceMsgs[3];
  await message(convAlice.id, demo.id, "TEXT", "This spot — bookmarking it for Saturday", now - 6 * DAY + 2.2 * HOUR, {
    replyToId: replyTarget.id,
    statuses: [{ userId: alice.id, status: "READ" }],
  });
  await db.reaction.createMany({
    data: [
      { messageId: aliceMsgs[3].id, userId: demo.id, emoji: "😍" },
      { messageId: aliceMsgs[5].id, userId: demo.id, emoji: "😂" },
      { messageId: aliceMsgs[2].id, userId: alice.id, emoji: "👍" },
    ],
  });

  // --- Bob direct (2 unread for demo, delivered-only for demo's last message)
  const bAll = [demo.id, bob.id];
  await message(convBob.id, bob.id, "TEXT", "Quick one — do you still have the headlamp I lent you?", now - 2 * DAY + 2 * HOUR, {
    statuses: [{ userId: demo.id, status: "READ" }],
  });
  await message(convBob.id, demo.id, "TEXT", "Yes! It's charging right now", now - 2 * DAY + 2.5 * HOUR, {
    statuses: [{ userId: bob.id, status: "READ" }],
  });
  await message(convBob.id, bob.id, "AUDIO", null, now - 2 * DAY + 3 * HOUR, {
    attachment: attachmentData(keyVoice2, "audio/wav", "voice-message.wav", voice2.length, { durationSec: 3 }),
    statuses: [{ userId: demo.id, status: "READ" }],
  });
  await message(convBob.id, demo.id, "TEXT", "😂 you sound very serious about this headlamp", now - 2 * DAY + 3.2 * HOUR, {
    statuses: [{ userId: bob.id, status: "READ" }],
  });
  await message(convBob.id, bob.id, "FILE", "Itinerary draft — take a look", now - 3 * HOUR, {
    attachment: attachmentData(keyPdf, "application/pdf", "trip-itinerary.pdf", pdfBuffer.length),
    statuses: [{ userId: demo.id, status: "DELIVERED" }],
  });
  await message(convBob.id, bob.id, "TEXT", "Also: waterproof boots. Forecast says rain 🌧️", now - 2.5 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }],
  });

  // --- Carol direct (read)
  await message(convCarol.id, carol.id, "TEXT", "Sent you the Phoenix retro notes — no rush", now - 30 * HOUR, {
    statuses: [{ userId: demo.id, status: "READ" }],
  });
  await message(convCarol.id, demo.id, "TEXT", "Got them, will read tonight 👍", now - 28 * HOUR, {
    statuses: [{ userId: carol.id, status: "READ" }],
  });

  // --- David direct (1 unread)
  await message(convDavid.id, demo.id, "TEXT", "David! Trip this weekend — you in?", now - 20 * HOUR, {
    statuses: [{ userId: david.id, status: "READ" }],
  });
  await message(convDavid.id, david.id, "TEXT", "Absolutely. I'll bring the camera and the big tent 🏕️", now - 7 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }],
  });

  // --- Weekend Trip group (system + rich, several unread for demo)
  const tAll = [demo.id, alice.id, bob.id, david.id];
  await message(convTrip.id, demo.id, "SYSTEM", `${demo.name} created group "Weekend Trip 🏔️"`, now - 5 * DAY, {});
  await message(convTrip.id, demo.id, "TEXT", "Welcome everyone! Alice found an incredible lake route 🏔️", now - 5 * DAY + 10 * 60 * 1000, {
    statuses: tAll.filter((id) => id !== demo.id).map((userId) => ({ userId, status: "READ" })),
  });
  const tripIntro = await message(convTrip.id, alice.id, "IMAGE", "The lake last year", now - 5 * DAY + 30 * 60 * 1000, {
    attachment: attachmentData(keyImg1b, "image/png", "sunrise-lake.png", img1.buffer.length, { width: 800, height: 600, thumbnailUrl: thumbs[keyImg1b] }),
    statuses: tAll.filter((id) => id !== alice.id).map((userId) => ({ userId, status: "READ" })),
  });
  await db.reaction.createMany({
    data: [
      { messageId: tripIntro.id, userId: demo.id, emoji: "😍" },
      { messageId: tripIntro.id, userId: bob.id, emoji: "😍" },
      { messageId: tripIntro.id, userId: david.id, emoji: "🔥" },
    ],
  });
  await message(convTrip.id, bob.id, "TEXT", "I can drive — 4 seats + trunk space", now - 4 * DAY, {
    statuses: tAll.filter((id) => id !== bob.id).map((userId) => ({ userId, status: "READ" })),
  });
  await message(convTrip.id, david.id, "SYSTEM", `${demo.name} added ${emma.name}`, now - 4 * DAY + HOUR, {});
  await db.participant.create({
    data: { userId: emma.id, conversationId: convTrip.id, role: "MEMBER", lastReadAt: new Date(now - 25 * HOUR) },
  });
  await message(convTrip.id, emma.id, "TEXT", "Hi all! Bringing the dog — hope that's ok 🐶", now - 26 * HOUR, {
    statuses: [{ userId: demo.id, status: "READ" }, { userId: alice.id, status: "READ" }, { userId: bob.id, status: "READ" }, { userId: david.id, status: "DELIVERED" }],
  });
  await message(convTrip.id, bob.id, "IMAGE", "Campfire from the recce trip", now - 25 * HOUR, {
    attachment: attachmentData(keyImg2, "image/png", "campfire-night.png", img2.buffer.length, { width: 800, height: 600, thumbnailUrl: thumbs[keyImg2] }),
    statuses: [{ userId: demo.id, status: "READ" }, { userId: alice.id, status: "DELIVERED" }, { userId: emma.id, status: "READ" }, { userId: david.id, status: "SENT" }],
  });
  await message(convTrip.id, alice.id, "TEXT", "Leaving the pdf itinerary here for everyone", now - 4 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: bob.id, status: "READ" }, { userId: emma.id, status: "DELIVERED" }, { userId: david.id, status: "SENT" }],
  });
  await message(convTrip.id, alice.id, "FILE", "Full itinerary with driving times", now - 3.8 * HOUR, {
    attachment: attachmentData(keyPdf2, "application/pdf", "trip-itinerary.pdf", pdfBuffer.length),
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: bob.id, status: "READ" }, { userId: emma.id, status: "DELIVERED" }, { userId: david.id, status: "SENT" }],
  });
  await message(convTrip.id, bob.id, "TEXT", "Rain check on the boots — forecast changed to sun ☀️", now - 1.2 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: alice.id, status: "DELIVERED" }, { userId: emma.id, status: "SENT" }, { userId: david.id, status: "SENT" }],
  });
  await message(convTrip.id, alice.id, "IMAGE", "Trail selfie at the viewpoint", now - 40 * 60 * 1000, {
    attachment: attachmentData(keyImg3, "image/png", "trail-selfie.png", img3.buffer.length, { width: 800, height: 600, thumbnailUrl: thumbs[keyImg3] }),
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: bob.id, status: "SENT" }, { userId: emma.id, status: "SENT" }, { userId: david.id, status: "SENT" }],
  });

  // --- Project Phoenix group (work chat, muted for demo? no — normal, some unread)
  const pAll = [carol.id, demo.id, bob.id, emma.id];
  await message(convPhoenix.id, carol.id, "SYSTEM", `${carol.name} created group "Project Phoenix"`, now - 8 * DAY, {});
  await message(convPhoenix.id, carol.id, "TEXT", "Kickoff notes are in the drive. Sprint 1 starts Monday.", now - 8 * DAY + HOUR, {
    statuses: pAll.filter((id) => id !== carol.id).map((userId) => ({ userId, status: "READ" })),
  });
  const retro = await message(convPhoenix.id, bob.id, "TEXT", "Retro board: 3 things that went well, 2 to improve. Thoughts?", now - 11 * HOUR, {
    statuses: [{ userId: carol.id, status: "READ" }, { userId: demo.id, status: "READ" }, { userId: emma.id, status: "DELIVERED" }],
  });
  await db.reaction.createMany({
    data: [{ messageId: retro.id, userId: carol.id, emoji: "👍" }, { messageId: retro.id, userId: demo.id, emoji: "👍" }],
  });
  await message(convPhoenix.id, emma.id, "TEXT", "I'll run the design critique on Wednesday 🎨", now - 10 * HOUR, {
    statuses: [{ userId: carol.id, status: "READ" }, { userId: demo.id, status: "READ" }, { userId: bob.id, status: "DELIVERED" }],
  });
  await message(convPhoenix.id, carol.id, "TEXT", "@demo can you own the metrics dashboard slice?", now - 2 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: bob.id, status: "READ" }, { userId: emma.id, status: "DELIVERED" }],
  });
  await message(convPhoenix.id, carol.id, "TEXT", "Also standup moves to 9:30 from tomorrow", now - 1.5 * HOUR, {
    statuses: [{ userId: demo.id, status: "DELIVERED" }, { userId: bob.id, status: "DELIVERED" }, { userId: emma.id, status: "SENT" }],
  });

  // Bump conversation timestamps to their newest message.
  for (const conv of [convAlice, convBob, convCarol, convDavid, convTrip, convPhoenix]) {
    const latest = await db.message.findFirst({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "desc" },
    });
    await db.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: latest?.createdAt ?? new Date() },
    });
  }

  // -----------------------------------------------------------------
  // Bundled sticker packs (emojis, cats, hearts) — 26 stickers total.
  // -----------------------------------------------------------------
  interface BundledStickerSpec { name: string; emoji: string; }
  interface BundledPackSpec { slug: string; name: string; stickers: BundledStickerSpec[]; }

  const BUNDLED_PACKS: BundledPackSpec[] = [
    {
      slug: "emojis",
      name: "Emojis",
      stickers: [
        { name: "happy", emoji: "😀" },
        { name: "laugh", emoji: "😂" },
        { name: "heart_eyes", emoji: "😍" },
        { name: "cool", emoji: "😎" },
        { name: "think", emoji: "🤔" },
        { name: "cry", emoji: "😭" },
        { name: "angry", emoji: "😡" },
        { name: "sleep", emoji: "😴" },
        { name: "mind_blown", emoji: "🤯" },
        { name: "party", emoji: "🥳" },
        { name: "eyes", emoji: "👀" },
        { name: "pray", emoji: "🙏" },
      ],
    },
    {
      slug: "cats",
      name: "Cats",
      stickers: [
        { name: "happy_cat", emoji: "😺" },
        { name: "grumpy_cat", emoji: "😾" },
        { name: "love_cat", emoji: "😻" },
        { name: "sleepy_cat", emoji: "😴" },
        { name: "wink_cat", emoji: "😼" },
        { name: "shocked_cat", emoji: "🙀" },
        { name: "sad_cat", emoji: "😿" },
        { name: "nerd_cat", emoji: "🤓" },
      ],
    },
    {
      slug: "hearts",
      name: "Hearts",
      stickers: [
        { name: "red_heart", emoji: "❤️" },
        { name: "pink_heart", emoji: "💕" },
        { name: "purple_heart", emoji: "💜" },
        { name: "blue_heart", emoji: "💙" },
        { name: "green_heart", emoji: "💚" },
        { name: "broken_heart", emoji: "💔" },
      ],
    },
  ];

  let stickerCount = 0;
  for (const pack of BUNDLED_PACKS) {
    const stickers = pack.stickers.map((s, i) => ({
      storageKey: `stickers/${pack.slug}/${s.name}.webp`,
      mime: "image/webp",
      width: 256,
      height: 256,
      emoji: s.emoji,
      sortOrder: i,
    }));
    const created = await db.stickerPack.create({
      data: {
        slug: pack.slug,
        name: pack.name,
        source: "BUNDLED",
        ownerId: null,
        stickers: { create: stickers },
      },
      include: { stickers: { select: { id: true, sortOrder: true } } },
    });
    const cover = created.stickers.find((s) => s.sortOrder === 0) ?? created.stickers[0];
    if (cover) {
      await db.stickerPack.update({
        where: { id: created.id },
        data: { coverStickerId: cover.id },
      });
    }
    stickerCount += created.stickers.length;
  }

  const [userCount, messageCount, packCount] = await Promise.all([
    db.user.count(),
    db.message.count(),
    db.stickerPack.count(),
  ]);
  console.log(`   conversations: 6 (4 direct + 2 groups incl. demo user)`);
  console.log(`   messages: ${messageCount} (text, image, voice, file, system)`);
  console.log(`   users: ${userCount}`);
  console.log(`   sticker packs: ${packCount} (bundled, ${stickerCount} stickers)`);
  console.log("✅ Seed complete. Log in with demo@chatapp.com / password123");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
