const BASE = "http://localhost:3000"
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@chatapp.com", password: "password123" }),
})
const cookie = loginRes.headers.get("set-cookie") ?? ""
const auth = cookie.split(";")[0]

// Try several well-known Telegram sticker pack names
const candidates = ["Peach", "Animals", "bongo_cat", "Weeb", "WhiteCat", "Anikitty", "PepeTheFrog", "AdvenTime", "FAMOUS", "CrazyPk"]
for (const name of candidates) {
  const res = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ packLink: `https://t.me/addstickers/${name}` }),
  })
  const body = await res.json()
  if (res.status === 200) {
    console.log(`✅ ${name}: ${res.status} — ${JSON.stringify(body).slice(0, 250)}`)
    break
  } else if (body.error?.includes?.("STICKERSET_INVALID")) {
    console.log(`❌ ${name}: invalid pack`)
  } else {
    console.log(`⚠️  ${name}: ${res.status} — ${JSON.stringify(body).slice(0, 200)}`)
  }
}
