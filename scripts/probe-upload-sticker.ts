// Probe: upload a personal sticker via multipart form
import { readFileSync } from "node:fs"
const BASE = "http://localhost:3000"

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@chatapp.com", password: "password123" }),
  })
  const cookie = loginRes.headers.get("set-cookie") ?? ""
  const auth = cookie.split(";")[0]

  // Use an existing bundled sticker file as the upload payload
  const filePath = "public/stickers/cats/wink_cat.webp"
  const buf = readFileSync(filePath)
  const file = new File([buf], "wink_cat.webp", { type: "image/webp" })
  const form = new FormData()
  form.append("file", file)
  form.append("emoji", "😉")

  const upRes = await fetch(`${BASE}/api/stickers/upload`, {
    method: "POST",
    headers: { cookie: auth },
    body: form,
  })
  const upBody = await upRes.json()
  console.log(`[POST /api/stickers/upload] ${upRes.status}`)
  console.log(`  ${JSON.stringify(upBody).slice(0, 500)}`)

  // Verify the new sticker appears in the user's sticker packs list
  const listRes = await fetch(`${BASE}/api/stickers`, { headers: { cookie: auth } })
  const listBody = await listRes.json()
  console.log(`[GET /api/stickers] ${listRes.status}`)
  for (const p of listBody.packs ?? []) {
    if (p.slug?.startsWith("my-uploads-")) {
      console.log(`  ✅ Personal pack "${p.name}" (slug=${p.slug}, source=${p.source}) — ${p.stickers?.length} stickers`)
      if (p.stickers?.[0]) {
        console.log(`     first upload: id=${p.stickers[0].id} url=${p.stickers[0].url} emoji=${p.stickers[0].emoji ?? "none"}`)
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
