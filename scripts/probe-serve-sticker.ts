const BASE = "http://localhost:3000"
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@chatapp.com", password: "password123" }),
})
const cookie = loginRes.headers.get("set-cookie") ?? ""
const auth = cookie.split(";")[0]
const res = await fetch(`${BASE}/api/files/daaa724cdda045498bc7ec6571ecf539.webp`, {
  headers: { cookie: auth },
})
console.log(`HTTP ${res.status} content-type=${res.headers.get("content-type")} content-length=${res.headers.get("content-length")}`)
if (res.ok) {
  const buf = await res.arrayBuffer()
  console.log(`Got ${buf.byteLength} bytes`)
} else {
  console.log(`Error body: ${await res.text()}`)
}
