// Probe sticker APIs end-to-end as the demo user
const BASE = "http://localhost:3000"

async function main() {
  // 1. Login as demo
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@chatapp.com", password: "password123" }),
  })
  const cookie = loginRes.headers.get("set-cookie") ?? ""
  const auth = cookie.split(";")[0]
  console.log(`[login] ${loginRes.status} — cookie: ${auth.slice(0, 25)}...`)

  // 2. GET /api/stickers (list available packs: bundled + own)
  const listRes = await fetch(`${BASE}/api/stickers`, { headers: { cookie: auth } })
  const listBody = await listRes.json()
  console.log(`[GET /api/stickers] ${listRes.status}`)
  console.log(`  packs: ${listBody.packs?.length ?? 0}`)
  for (const p of listBody.packs ?? []) {
    console.log(`    - ${p.slug} "${p.name}" [${p.source}] — ${p.stickerCount ?? p.stickers?.length} stickers`)
    if (p.stickers?.[0]) {
      console.log(`        first sticker: id=${p.stickers[0].id} url=${p.stickers[0].url} emoji=${p.stickers[0].emoji ?? "none"}`)
    }
  }

  // 3. GET /api/stickers/recent (should be empty initially)
  const recentRes = await fetch(`${BASE}/api/stickers/recent`, { headers: { cookie: auth } })
  const recentBody = await recentRes.json()
  console.log(`[GET /api/stickers/recent] ${recentRes.status} — stickers: ${recentBody.stickers?.length ?? 0}`)

  // 4. GET /api/stickers/favorites (should be empty initially)
  const favRes = await fetch(`${BASE}/api/stickers/favorites`, { headers: { cookie: auth } })
  const favBody = await favRes.json()
  console.log(`[GET /api/stickers/favorites] ${favRes.status} — stickers: ${favBody.stickers?.length ?? 0}`)

  // 5. Pick a sticker and favorite it
  const firstStickerId = listBody.packs?.[0]?.stickers?.[0]?.id
  if (firstStickerId) {
    const favPostRes = await fetch(`${BASE}/api/stickers/${firstStickerId}/favorite`, {
      method: "POST",
      headers: { cookie: auth, "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const favPostBody = await favPostRes.json()
    console.log(`[POST /api/stickers/${firstStickerId}/favorite] ${favPostRes.status} — ${JSON.stringify(favPostBody)}`)

    // And unfavorite (DELETE)
    const favDelRes = await fetch(`${BASE}/api/stickers/${firstStickerId}/favorite`, {
      method: "DELETE",
      headers: { cookie: auth },
    })
    console.log(`[DELETE /api/stickers/${firstStickerId}/favorite] ${favDelRes.status}`)
  }

  // 6. Try Telegram import — invalid input (empty body)
  const tgRes = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  console.log(`[POST /api/stickers/import-telegram (empty body)] ${tgRes.status} — ${JSON.stringify((await tgRes.json())).error ?? "ok"}`)

  // 7. Try Telegram import — real pack link (uses TELEGRAM_BOT_TOKEN)
  const tgRes2 = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ packLink: "https://t.me/addstickers/AniClanDemo" }),
  })
  const tgBody2 = await tgRes2.json()
  console.log(`[POST /api/stickers/import-telegram (AniClanDemo)] ${tgRes2.status}`)
  console.log(`  ${JSON.stringify(tgBody2).slice(0, 600)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
