import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const stickers = await db.message.findMany({
  where: { type: 'STICKER' },
  include: { sticker: true, sender: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
  take: 5,
})
console.log(`STICKER messages in DB: ${stickers.length}`)
for (const m of stickers) {
  console.log(`  - id=${m.id} sender=${m.sender.name} sticker=${m.sticker?.storageKey} at=${m.createdAt.toISOString()}`)
}
await db.$disconnect()
