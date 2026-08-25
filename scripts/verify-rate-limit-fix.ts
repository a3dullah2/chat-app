// Verify rate-limit fix:
//   1. Re-importing an already-imported pack (Animals) succeeds without consuming quota
//   2. A new pack import works
//   3. Re-imports return alreadyImported: true
const BASE = "http://localhost:3000"

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@chatapp.com", password: "password123" }),
  })
  const cookie = loginRes.headers.get("set-cookie") ?? ""
  const auth = cookie.split(";")[0]

  // 1. Re-import Animals (already in library) — should be free (no quota burn)
  console.log("[1] Re-importing Animals (already in library):")
  const r1 = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ packLink: "https://t.me/addstickers/Animals" }),
  })
  const b1 = await r1.json()
  console.log(`  ${r1.status} — ${JSON.stringify(b1).slice(0, 200)}`)

  // 2. Re-import bongo_cat (already in library) — also should be free
  console.log("[2] Re-importing bongo_cat (already in library):")
  const r2 = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ packLink: "https://t.me/addstickers/bongo_cat" }),
  })
  const b2 = await r2.json()
  console.log(`  ${r2.status} — ${JSON.stringify(b2).slice(0, 200)}`)

  // 3. Now try the user's actual pack: HMPDFT
  console.log("[3] Trying user's actual pack: HMPDFT")
  const r3 = await fetch(`${BASE}/api/stickers/import-telegram`, {
    method: "POST",
    headers: { cookie: auth, "content-type": "application/json" },
    body: JSON.stringify({ packLink: "https://t.me/addstickers/HMPDFT" }),
  })
  const b3 = await r3.json()
  console.log(`  ${r3.status} — ${JSON.stringify(b3).slice(0, 400)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
