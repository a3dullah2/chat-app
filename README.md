# ChatApp — Real-Time Messenger with a Stoat-Inspired Theme

A production-quality, real-time messaging web application, originally built to a WhatsApp-style build specification (`upload/whatsapp-style-chat-app-prompt.md`) and since **restyled to match [Stoat](https://stoat.chat)** (the open-source chat platform, formerly Revolt). It supports user accounts, direct and group conversations, instant delivery over Socket.IO, media sharing (images, video, files, voice notes), typing indicators, delivery/read receipts, presence, and notifications — wrapped in a clean Material 3 theme with flat message rows and dark mode.

### Design language (Stoat)

The theme is generated from Stoat's own design system (`stoatchat/for-web`):

- **Colors:** Material 3 *tonal-spot* scheme from Stoat's default accent `#5470ec` (light `#505b92` / dark `#b9c3ff` primary), full M3 surface-container ramp, outline-variant borders, error/badge reds, and Stoat's presence palette (`#3ABF7E` online).
- **Layout:** rounded 28px floating panels on a neutral shell (`#191919` dark / `#e9e7ef` light), flat Discord-style message rows (36px avatar gutter, colored usernames, timestamps), a 24px-radius composer bar, and a 48px rounded chat header.
- **Type & shape:** Inter, 14px message text, pill (M3) buttons, 4/8/12/16/28px corner-radius scale.

---

## Architecture Overview

```
Browser (Next.js App Router UI, single "/" route)
   │  REST (JSON, httpOnly-cookie JWT)         WebSocket (Socket.IO)
   ▼                                              ▼
Next.js API Routes  ──── internal emit bridge ──►  Chat-socket mini-service (port 3003)
   │                                              (Socket.IO + presence + typing)
   ▼                                              ▼
Prisma ORM  ────────────────────────────────►  SQLite (WAL) — single source of truth
   │
   ▼
Local file storage (/uploads) served via /api/files/<storageKey> (participant-only)
```

**Key decisions (per spec §3):**

1. **Two processes sharing one database.** The Next.js app hosts the REST API; a dedicated Socket.IO service (`mini-services/chat-socket`) handles realtime. The sandbox gateway exposes one port, so the browser connects to the socket service through the gateway (`io('/?XTransformPort=3003')`). REST mutations broadcast through an authenticated internal HTTP bridge (`127.0.0.1:3004/internal/emit`), so a message sent via REST still reaches every connected client instantly.
2. **Socket auth:** the JWT is read from the handshake cookie and verified before any event is processed; unauthenticated sockets are rejected.
3. **Rooms:** one Socket.IO room per `conversation:<id>` plus a personal room `user:<id>` per socket. Sockets join all their conversation rooms on connect, and re-sync when added to a new conversation. Presence lives in an in-memory `Map<userId, Set<socketId>>`.
4. **The database is the source of truth.** Sockets only notify; on reconnect the client refetches conversations and the active message window via REST (never trusting socket replay alone).
5. **Optimistic UI:** messages render instantly with a clock icon and are reconciled by a server ack keyed on a client-generated `clientId` (UUID). Retries reuse the same `clientId`, and the server is idempotent on it — no duplicates.

---

## Quick Start

```bash
# 1. Install dependencies
npm install            # or: bun install
cd mini-services/chat-socket && bun install && cd ../..

# 2. Configure the environment (.env is already provided for the sandbox;
#    copy .env.example when deploying elsewhere and fill it in)
cp .env.example .env

# 3. Create the schema + demo data
npm run db:reset       # wipes and reseeds with demo users/chats/media

# 4. Run the app + the realtime service
npm run dev            # Next.js on :3000
cd mini-services/chat-socket && bun run dev   # Socket.IO on :3003 (+ bridge :3004)

# 5. Run the test suites
npm run test           # Vitest unit tests
npm run e2e            # Playwright happy path (see e2e/README notes below)
```

Log in with **demo@chatapp.com / password123**.

> **Postgres alternative:** this deployment runs on SQLite (see *Deviations*). To use PostgreSQL locally, point `DATABASE_URL` at a Postgres instance (a `docker-compose.yml` with Postgres 16 is included), switch `provider = "postgresql"` in `prisma/schema.prisma`, and re-run `prisma db push` + the seed. No application code changes are required — all queries go through Prisma.

---

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Database connection string (SQLite file in this deployment) | `file:/home/z/my-project/db/custom.db` |
| `JWT_SECRET` | Token signing secret (min 32 chars in production) | random string |
| `NEXT_PUBLIC_APP_URL` | Absolute URL for links/avatars | `http://localhost:3000` |
| `MAX_UPLOAD_MB` | Upload size cap (default 25) | `25` |
| `INTERNAL_SOCKET_TOKEN` | Shared secret for the REST → socket emit bridge | random string |

`SOCKET_PATH` from the spec is not configurable in this deployment: the gateway routes websocket traffic by the `XTransformPort` query parameter with a fixed path (`/`), which the socket service must honor.

---

## Seeded Demo Accounts

All seeded users share the password **`password123`**.

| Name | Email | Notes |
|---|---|---|
| Demo User | `demo@chatapp.com` | The showcase account — 4 direct chats + 2 groups |
| Alice Johnson | `alice@chatapp.com` | Rich direct history (images, voice note, replies, reactions) |
| Bob Smith | `bob@chatapp.com` | Voice note + PDF itinerary, 2 unread for demo |
| Carol Williams | `carol@chatapp.com` | Short read history; owner of Project Phoenix |
| David Lee | `david@chatapp.com` | 1 unread message |
| Emma Martinez | `emma@chatapp.com` | Added to the trip group with a SYSTEM message |

The seed creates 6 users, 4 direct + 2 group conversations, 37 messages (text, images, voice notes, a PDF, system events), varied read states, reactions, and generated media (gradient PNGs with webp thumbnails, WAV voice notes, a hand-built PDF). Re-run `npm run db:reset` at any time for a reproducible state.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Next.js in dev mode (port 3000) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:push` | Push the Prisma schema |
| `npm run db:seed` / `npm run db:reset` | Wipe + reseed demo data |
| `npm run test` | Vitest unit tests (46 tests) |
| `npm run e2e` | Playwright happy-path test (skip with `SKIP_E2E=1`) |
| `npm run lint` | ESLint (zero warnings) |

---

## Feature Checklist (spec §10)

- **FR-01 Auth** — signup/login/logout with inline validation, non-enumerating errors, httpOnly JWT cookies (24 h), login rate limit 10/15 min/IP.
- **FR-02 Users & profiles** — debounced search (300 ms), profile editing with avatar upload.
- **FR-03 Chat list** — pinned-first + activity ordering, type-aware previews ("📷 Photo", "🎤 Voice message (0:07)", "📄 report.pdf"), unread badges, context menu (pin/mute/archive/mark-read/leave), DIRECT reuse.
- **FR-04 Messaging** — Enter/Shift+Enter, optimistic sends (clock → ✓ → ✓✓ → blue ✓✓), retry without duplicates, infinite scroll-up (30/page), date dividers + 5-minute sender grouping, replies with jump-to-quote, hover/long-press actions, edit (15 min, own, TEXT), delete for me/everyone with placeholder.
- **FR-05 Media & voice** — attach/paste/drag-drop, image thumbnails + lightbox, inline video, file cards with download, MediaRecorder voice notes with timer/waveform/cancel, upload progress, client-side size rejection.
- **FR-06 Groups** — create with ≥2 participants + SYSTEM messages, info panel with roles, member add/remove (admin-only), rename, leave with ownership transfer to the earliest-joined member (empty groups are deleted).
- **FR-07 Typing & presence** — multi-typist labels in header and chat list, 5 s auto-expiry, online/last-seen subtitles.
- **FR-08 Read receipts** — SENT→DELIVERED→READ aggregation (worst-to-best across recipients), blue ticks in real time, unread cleared across tabs.
- **FR-09 Search** — sidebar title + full-text message search ("N messages" rows) with scroll-to-match + highlight, All/Unread/Groups filters.
- **FR-10 Notifications** — in-app toasts with Open action, browser notifications (permission requested on first interaction, degrade silently), `(N) ChatApp` title counter reset on focus, muted chats excluded everywhere.

---

## Security

- JWT (HS256) in httpOnly, SameSite=Lax cookies; the socket handshake verifies the same cookie.
- Zod schemas (strict objects) on every REST route and socket handler; 4096-char message cap.
- Authorization: every conversation/message operation verifies active participation — `403` for existing-but-forbidden resources, `404` for missing ones.
- Uploads: MIME whitelist + `MAX_UPLOAD_MB` enforcement, random server-side storage names, participant-only file serving with authorization checks, webp thumbnails.
- Rate limits: 20 messages/10 s/user, 10 uploads/min/user, 10 login attempts/15 min/IP — all return `429` + `Retry-After`.
- XSS: message text renders as plain text via React; no `dangerouslySetInnerHTML` on user content anywhere.

---

## Testing

- **Unit (Vitest, `tests/unit/`)**: JWT sign/verify (tamper, expiry, wrong secret), Zod schemas (strictness, password policy), status aggregation, reaction aggregation, previews, date-divider/grouping logic, rate limiter window behavior.
- **Integration**: exercised live during development — 401/403/404 paths, non-participant access, `clientId` idempotency (verified: identical response for a replayed send), cursor pagination (ascending pages, no overlap), rate limiting (exactly 20 then 429; 10 then 429).
- **E2E (Playwright, `e2e/chat.spec.ts`)**: signup → search user → send → second browser context receives in real time → reply → ticks turn blue. Requires a running dev server + socket service and seeded DB; skip in CI with `SKIP_E2E=1`. (Not executed in this sandbox because it needs two interactive browser contexts; the same flow was verified manually end-to-end through the gateway with a two-session browser harness.)

---

## Deviations from the Spec (and why)

| Spec | This build | Rationale |
|---|---|---|
| PostgreSQL + Docker Compose | **SQLite (WAL)**; a `docker-compose.yml` for Postgres is included for self-hosting | The deployment sandbox provides a single SQLite database and no Docker daemon. All data access goes through Prisma, so switching to Postgres is a schema-provider change only. |
| Single Node process hosting Next.js + custom Socket.IO server | **Separate socket mini-service** (port 3003) behind the sandbox gateway, plus an authenticated internal emit bridge (port 3004) | The environment's gateway exposes one port and routes websocket traffic via `?XTransformPort=3003`; Next.js route handlers cannot host the socket server in this topology. REST and sockets still share the same Prisma client code, auth, and database. |
| Multi-page routes (`/login`, `/signup`, `/chat`) | **Single `/` route** with client-side auth gating | The platform only exposes the root route. Login/signup/chat are full views within one page; the same auth guards run on every API route. |
| Prisma enums | **String columns + Zod validation** | SQLite has no native enums; validation happens at every entry point. |
| `SOCKET_PATH` env | Fixed path `/` | Required by the gateway routing contract (see Environment Variables). |
| `Attachment.messageId` required | **Nullable** + `uploadedById`/`storageKey` fields | The spec's own upload flow creates attachments before a message exists; the extra fields enable authorization before linking and safe on-disk naming. |
| `HiddenMessage` model added | New table | Implements "delete for me" (FR-04 AC8), which the spec's schema couldn't express. |
| `Message.clientId` column (unique) added | New column | Required for the spec's retry-safe idempotent sends. |
| Prisma schema verbatim | Missing back-relations added (`Reaction.user`, `MessageStatus.user`, `User.conversationsCreated`, `Message.hiddenBy`) | The schema as written in the spec does not pass Prisma validation. |
| Next.js middleware protecting `/chat` | Per-route auth guards + client gate | No page routes exist to protect in the single-route deployment; the security outcome is identical. |

## Known Limitations

- Presence, typing state, and rate-limit counters are in-memory per process — they reset on service restart and are not shared between the REST and socket processes (documented acceptable for this scale).
- Delivery receipts mark `DELIVERED` when a recipient has an active socket (server-side detection) rather than tracking client render.
- Image thumbnails are generated server-side with `sharp`; videos have no server-side poster frames.
- Browser-notification playback of voice notes requires a real user gesture (headless autoplay policies); verified manually.
- The e2e suite targets a locally running stack and is skipped in CI via `SKIP_E2E=1`.
