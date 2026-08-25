import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const pack = await db.stickerPack.findFirst({
  where: { name: { contains: "Hatsune" } },
  include: { stickers: { take: 5 } },
})
if (!pack) { console.log("Pack not found"); process.exit(1) }
console.log(`Pack: ${pack.name} — ${pack.stickers.length} stickers (showing first 5)`)
for (const s of pack.stickers) {
  console.log(`  - id=${s.id} storageKey=${s.storageKey} mime=${s.mime} ${s.width}x${s.height} emoji=${s.emoji ?? "none"}`)
}
await db.$disconnect()
