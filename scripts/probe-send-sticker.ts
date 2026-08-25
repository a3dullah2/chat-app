// Probe: send a STICKER message in a real conversation
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

  // 2. List sticker packs to find a sticker id
  const listRes = await fetch(`${BASE}/api/stickers`, { headers: { cookie: auth } })
  const listBody = await listRes.json()
  const sticker = listBody.packs?.[0]?.stickers?.[0]
  if (!sticker) {
    console.error("No sticker found!")
    process.exit(1)
  }
  console.log(`Using sticker: ${sticker.id} (${sticker.url}) from pack "${listBody.packs[0].name}"`)

  // 3. Get demo user's conversations
  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: auth } })
  const me = (await meRes.json()).data
  const convsRes = await fetch(`${BASE}/api/conversations`, { headers: { cookie: auth } })
  const convsBody = await convsRes.json()
  const conversations = convsBody.data ?? convsBody.conversations ?? convsBody
  const conv = conversations[0]
  if (!conv) {
    console.error("No conversations!")
    process.exit(1)
  }
  console.log(`Sending in conversation: ${conv.id} (${conv.name ?? conv.type})`)

  // 4. POST a STICKER message
  const clientId = `probe-sticker-${Date.now()}`
  const sendRes = await fetch(`${BASE}/api/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ type: "STICKER", stickerId: sticker.id, clientId }),
  })
  const sendBody = await sendRes.json()
  console.log(`[POST /messages STICKER] ${sendRes.status}`)
  console.log(`  ${JSON.stringify(sendBody).slice(0, 500)}`)

  // 5. Fetch the conversation's messages — newest first, see if our sticker is there
  const msgsRes = await fetch(`${BASE}/api/conversations/${conv.id}/messages?limit=3`, { headers: { cookie: auth } })
  const msgsBody = await msgsRes.json()
  console.log(`[GET /messages?limit=3] ${msgsRes.status}`)
  const messages = msgsBody.data?.messages ?? msgsBody.messages ?? []
  for (const m of messages) {
    if (m.type === "STICKER") {
      console.log(`  ✅ STICKER message persisted! id=${m.id} stickerId=${m.sticker?.id} stickerUrl=${m.sticker?.url}`)
    } else {
      console.log(`  - ${m.type} message id=${m.id} text=${(m.text ?? "").slice(0, 50)}`)
    }
  }

  // 6. Check recent — the just-sent sticker should now appear in /api/stickers/recent
  const recentRes = await fetch(`${BASE}/api/stickers/recent`, { headers: { cookie: auth } })
  const recentBody = await recentRes.json()
  console.log(`[GET /api/stickers/recent] ${recentRes.status} — stickers: ${recentBody.stickers?.length}`)
  for (const s of recentBody.stickers ?? []) {
    console.log(`  - recent: ${s.id} url=${s.url} packName="${s.packName}"`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
