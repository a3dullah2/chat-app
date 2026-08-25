import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const packs = await db.stickerPack.findMany({ include: { stickers: { select: { id: true, storageKey: true, emoji: true } } } })
console.log(`Sticker packs: ${packs.length}`)
for (const p of packs) {
  console.log(`  - [${p.source}] ${p.slug} "${p.name}" — ${p.stickers.length} stickers`)
  console.log(`    example: ${p.stickers[0]?.storageKey} emoji=${p.stickers[0]?.emoji ?? 'none'}`)
}
const totalStickers = await db.sticker.count()
console.log(`Total stickers in DB: ${totalStickers}`)
await db.$disconnect()
