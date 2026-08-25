<div align="center">

# 💬 ChatApp

### A production-grade real-time messenger with a Stoat-inspired theme

A WhatsApp-style chat platform: accounts, direct & group chats, instant delivery over Socket.IO, media sharing, typing indicators, delivery/read receipts, presence, and notifications — wrapped in a clean Material 3 theme with dark mode.

[![CI](https://github.com/a3dullah2/chat-app/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/a3dullah2/chat-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Made with Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-6-5a67d8.svg)](https://www.prisma.io/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101.svg)](https://socket.io/)
[![Tests Passing](https://img.shields.io/badge/tests-passing-success.svg)](tests/)

[✨ Features](#-features) · [🚀 Quick Start](#-quick-start) · [🏗️ Architecture](#-architecture) · [🧪 Testing](#-testing) · [📖 Docs](#-documentation) · [🤝 Contributing](#-contributing)

</div>

---

## ✨ Features

| | | |
|---|---|---|
| 🔐 **Auth** — JWT (HS256) in httpOnly cookies, signup/login/logout with inline validation, login rate-limit (10 / 15 min / IP). | 👥 **Users & profiles** — debounced search (300 ms), profile editing with avatar upload. | 💬 **Chat list** — pinned-first + activity ordering, type-aware previews ("📷 Photo", "🎤 Voice message (0:07)"), unread badges, context menu (pin/mute/archive/mark-read/leave). |
| ✉️ **Messaging** — Enter/Shift+Enter, optimistic sends (clock → ✓ → ✓✓ → blue ✓✓), retry without duplicates, infinite scroll-up (30/page), date dividers + sender grouping, replies with jump-to-quote, edit (15-min, own, TEXT), delete for me/everyone. | 🖼️ **Media & voice** — attach / paste / drag-drop, image thumbnails + lightbox, inline video, file cards with download, MediaRecorder voice notes with timer/waveform/cancel, upload progress. | 👨‍👩‍👧 **Groups** — create with ≥2 participants + SYSTEM messages, info panel with roles, member add/remove (admin-only), rename, leave with ownership transfer; empty groups auto-deleted. |
| ⌨️ **Typing & presence** — multi-typist labels in header and chat list, 5 s auto-expiry, online/last-seen subtitles. | ✅ **Read receipts** — SENT → DELIVERED → READ aggregation (worst-to-best), blue ticks in real time, unread cleared across tabs. | 🔔 **Notifications** — in-app toasts with Open action, browser notifications (permission requested on first interaction), `(N) ChatApp` title counter, muted chats excluded. |
| 🏷️ **Stickers** — 3 bundled packs (Emojis, Cats, Hearts), Telegram pack import via `t.me/addstickers/<name>`, personal uploads, Recent + Favorites quick-access tabs, 160×160 no-bubble message rendering, Lottie animations for `.tgs` stickers, click-to-send from composer. | | |

## 🚀 Quick Start

> Requires **Bun ≥ 1.1** (or Node ≥ 20) and a Unix-like environment. The dev stack uses **SQLite**; see [Postgres alternative](#-postgres-alternative) for self-hosting.

```bash
# 1. Install dependencies
bun install
cd mini-services/chat-socket && bun install && cd ../..

# 2. Configure the environment
cp .env.example .env

# 3. Create the schema + demo data
bun run db:reset

# 4. Run the app + the realtime service (two terminals)
bun run dev                                  # Next.js on :3000
cd mini-services/chat-socket && bun run dev  # Socket.IO on :3003 (+ bridge :3004)

# 5. (Optional) Run the test suites
bun run test   # Vitest unit tests
bun run e2e    # Playwright happy path
```

Log in with **`demo@chatapp.com` / `password123`**.

## 🏗️ Architecture

```
Browser (Next.js App Router UI, single "/" route)
   │  REST (JSON, httpOnly-cookie JWT)         WebSocket (Socket.IO)
   ▼                                              ▼
Next.js API Routes  ──── internal emit bridge ──►  Chat-socket mini-service (:3003)
   │                                              (Socket.IO + presence + typing)
   ▼                                              ▼
Prisma ORM  ──────────────────────────────────►  SQLite (WAL) — single source of truth
   │
   ▼
Local file storage (/uploads) served via /api/files/<storageKey> (participant-only)
```

**Key decisions:**

1. **Two processes sharing one database.** Next.js hosts the REST API; a dedicated Socket.IO service (`mini-services/chat-socket`) handles realtime. REST mutations broadcast through an authenticated internal HTTP bridge (`127.0.0.1:3004/internal/emit`), so messages sent via REST still reach every connected client instantly.
2. **Socket auth:** the JWT is read from the handshake cookie and verified before any event is processed; unauthenticated sockets are rejected.
3. **Rooms:** one Socket.IO room per `conversation:<id>` plus a personal room `user:<id>` per socket. Presence lives in an in-memory `Map<userId, Set<socketId>>`.
4. **Database is the source of truth.** Sockets only notify; on reconnect the client refetches via REST (never trusting socket replay alone).
5. **Optimistic UI:** messages render instantly with a clock icon and reconcile on a server ack keyed on a client-generated `clientId`. Retries reuse the same `clientId`, and the server is idempotent on it — no duplicates.

## 🎨 Design Language (Stoat)

The theme is generated from [Stoat's](https://stoat.chat) design system (`stoatchat/for-web`):

- **Colors:** Material 3 *tonal-spot* scheme from Stoat's accent `#5470ec` (light `#505b92` / dark `#b9c3ff`), full M3 surface-container ramp, error/badge reds, presence palette (`#3ABF7E` online).
- **Layout:** 28 px floating panels on a neutral shell (`#191919` dark / `#e9e7ef` light), Discord-style flat message rows (36 px avatar gutter, colored usernames, timestamps), 24 px-radius composer, 48 px-radius chat header.
- **Type & shape:** Inter, 14 px body, pill (M3) buttons, 4 / 8 / 12 / 16 / 28 px corner-radius scale.

## 🧪 Testing

| Suite | Tool | Path | What it covers |
|---|---|---|---|
| Unit | Vitest | `tests/unit/` | JWT sign/verify (tamper, expiry, wrong secret), Zod schemas (strictness, password policy), status & reaction aggregation, previews, date-divider/grouping logic, rate-limiter windows. |
| Integration | Vitest + supertest-style | `tests/integration/` | 401/403/404 paths, non-participant access, `clientId` idempotency, cursor pagination (no overlap), rate limiting (exactly 20 → 429; 10 → 429). |
| E2E | Playwright | `e2e/*.spec.ts` | chat happy path, dark-mode toggle, edit/delete flow, mobile layout, persistence across reloads, reactions, search. Skip in CI via `SKIP_E2E=1`. |

```bash
bun run test     # Vitest unit tests
bun run test:watch
bun run e2e      # requires running dev stack + seeded DB
bun run lint     # ESLint — zero warnings
```

## 🔐 Security

- JWT (HS256) in httpOnly, `SameSite=Lax` cookies; the socket handshake verifies the same cookie.
- **Zod schemas** (strict objects) on every REST route and socket handler; 4096-char message cap.
- **Authorization:** every conversation/message operation verifies active participation — `403` for existing-but-forbidden, `404` for missing.
- **Uploads:** MIME whitelist + `MAX_UPLOAD_MB` enforcement, random server-side storage names, participant-only serving, webp thumbnails via `sharp`.
- **Rate limits:** 20 messages/10 s/user, 10 uploads/min/user, 10 login attempts/15 min/IP — all `429` + `Retry-After`.
- **XSS:** message text renders as plain text via React; no `dangerouslySetInnerHTML` on user content anywhere.

> 🛡️ Found a security issue? Please **do not** open a public issue. Use GitHub's **[private security advisory](https://github.com/a3dullah2/chat-app/security/advisories/new)** flow instead.

## ⚙️ Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Connection string (SQLite file or Postgres URL) | `file:./db/custom.db` |
| `JWT_SECRET` | Token signing secret (≥ 32 chars in production) | random string |
| `NEXT_PUBLIC_APP_URL` | Absolute URL for links / avatars | `http://localhost:3000` |
| `MAX_UPLOAD_MB` | Upload size cap (default 25) | `25` |
| `INTERNAL_SOCKET_TOKEN` | Shared secret for the REST → socket emit bridge | random string |
| `TELEGRAM_BOT_TOKEN` | Optional. Bot token from [@BotFather](https://t.me/BotFather) for sticker pack imports | `1234567890:ABCdef…` |

> ⚠️ **Never commit `.env`.** The repo ships a sanitized `.env.example` — copy it locally and fill in real values. Rotate any dev secrets before going to production.

## 🌱 Seeded Demo Accounts

All seeded users share the password **`password123`**.

| Name | Email | Notes |
|---|---|---|
| Demo User | `demo@chatapp.com` | The showcase account — 4 direct chats + 2 groups |
| Alice Johnson | `alice@chatapp.com` | Rich direct history (images, voice note, replies, reactions) |
| Bob Smith | `bob@chatapp.com` | Voice note + PDF itinerary, 2 unread for demo |
| Carol Williams | `carol@chatapp.com` | Short read history; owner of Project Phoenix |
| David Lee | `david@chatapp.com` | 1 unread message |
| Emma Martinez | `emma@chatapp.com` | Added to the trip group with a SYSTEM message |

The seed creates **6 users, 4 direct + 2 group conversations, 37 messages** (text, images, voice notes, a PDF, system events), varied read states, reactions, and generated media (gradient PNGs + webp thumbnails, WAV voice notes, a hand-built PDF). Re-run `bun run db:reset` at any time for a reproducible state.

## 📜 Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Start Next.js in dev mode (port 3000) |
| `bun run build` / `bun start` | Production build / serve |
| `bun run db:push` | Push the Prisma schema |
| `bun run db:seed` / `bun run db:reset` | Seed demo data / wipe + reseed |
| `bun run test` | Vitest unit tests |
| `bun run test:watch` | Vitest in watch mode |
| `bun run e2e` | Playwright happy path (skip with `SKIP_E2E=1`) |
| `bun run lint` | ESLint (zero warnings) |

## 📖 Documentation

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, branch workflow, commit conventions, PR checklist.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — Contributor Covenant 2.1.
- **[Architecture](#-architecture)** — process topology, socket auth, rooms, idempotent optimistic UI.
- **[Security](#-security)** — JWT, Zod, authz, uploads, rate limits, XSS.
- **[Feature checklist](#-features)** — every spec requirement mapped to the implementation.

## 📦 Postgres Alternative

This deployment runs on SQLite. To use PostgreSQL locally:

1. Point `DATABASE_URL` at a Postgres instance (a `docker-compose.yml` with Postgres 16 is included).
2. Switch `provider = "postgresql"` in `prisma/schema.prisma`.
3. Re-run `prisma db push` + `bun run db:seed`.

No application code changes are required — all queries go through Prisma.

## 🤝 Contributing

Pull requests are welcome! Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it covers branching, commit conventions, the PR checklist, and how to add tests for new features.

```bash
# Quick start for contributors
git clone https://github.com/<your-username>/chat-app.git
cd chat-app
bun install
cp .env.example .env
bun run db:reset
bun run dev
```

For bug reports and feature requests, use the [issue templates](https://github.com/a3dullah2/chat-app/issues/new/choose). For questions and ideas, use [Discussions](https://github.com/a3dullah2/chat-app/discussions).

## 📝 Deviations from the Spec

| Spec | This build | Rationale |
|---|---|---|
| PostgreSQL + Docker Compose | SQLite (WAL); `docker-compose.yml` for Postgres included | Sandbox provides only SQLite; all data access via Prisma so swapping is a schema-provider change only. |
| Single Node process | Separate socket mini-service (:3003) + authenticated emit bridge (:3004) | Gateway routes websocket traffic via `?XTransformPort=3003`; Next.js route handlers can't host the socket server in this topology. |
| Multi-page routes (`/login`, `/signup`, `/chat`) | Single `/` route with client-side auth gating | Platform only exposes the root route; same auth guards run on every API route. |
| Prisma enums | String columns + Zod validation | SQLite has no native enums; validation happens at every entry point. |
| `SOCKET_PATH` env | Fixed path `/` | Required by the gateway routing contract. |
| `Attachment.messageId` required | Nullable + `uploadedById` / `storageKey` fields | Spec's upload flow creates attachments before a message exists. |
| `HiddenMessage` model added | New table | Implements "delete for me" (FR-04 AC8). |
| `Message.clientId` unique column added | New column | Required for retry-safe idempotent sends. |
| Prisma schema verbatim | Missing back-relations added | The schema as written in the spec does not pass Prisma validation. |
| Next.js middleware protecting `/chat` | Per-route auth guards + client gate | No page routes to protect; security outcome is identical. |

## ⚠️ Known Limitations

- Presence, typing state, and rate-limit counters are in-memory per process — they reset on service restart and are not shared between the REST and socket processes (acceptable at this scale).
- Delivery receipts mark `DELIVERED` when a recipient has an active socket (server-side detection) rather than tracking client render.
- Image thumbnails are generated server-side with `sharp`; videos have no server-side poster frames.
- Browser-notification playback of voice notes requires a real user gesture (headless autoplay policies).
- The e2e suite targets a locally running stack and is skipped in CI via `SKIP_E2E=1`.

## 📄 License

[MIT](LICENSE) © 2026 [a3dullah2](https://github.com/a3dullah2)

---

<div align="center">

<sub>Built with ❤️ using Next.js, Prisma, Socket.IO, and the Stoat design system.</sub><br>
<sub>If this project is useful to you, consider ⭐ starring the repo — it helps others find it.</sub>

</div>
