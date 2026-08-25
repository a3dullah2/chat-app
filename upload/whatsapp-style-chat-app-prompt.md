# WhatsApp-Style Fullstack Chat Web App — Comprehensive Build Prompt

> **Instructions for the AI agent:** Read this entire document before writing any code. Implement the application exactly as specified. Where a requirement is ambiguous, choose the most production-grade, widely-used solution and document the decision in the README. Build the phases in §14 in order — each phase must compile, run, and be manually tested before starting the next. Do not silently drop features; if something is infeasible, flag it in the README with a rationale.

---

## 1. Mission

Build a production-quality, real-time messaging web application inspired by **WhatsApp Web**. The app must support user accounts, one-on-one and group conversations, instant message delivery over WebSockets, media sharing (images, video, files, voice notes), typing indicators, delivery/read receipts, online presence, and notifications — wrapped in a polished, responsive, accessible UI with dark mode.

**Non-goals (do NOT build):** end-to-end encryption, voice/video calling, multi-device message sync, native mobile apps, i18n beyond English.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router) | TypeScript strict mode, no `any` |
| Styling | Tailwind CSS + shadcn/ui | Dark mode via `next-themes` |
| Database | PostgreSQL | Via Docker or hosted instance |
| ORM | Prisma | Migrations + seed script required |
| Real-time | Socket.IO | WebSocket with long-polling fallback |
| Auth | JWT in httpOnly cookies | Email/password with bcrypt hashing |
| File storage | Local disk (`/uploads`) behind a static route | Structure must allow swapping in S3 later |
| Client state | TanStack React Query + Zustand | React Query for server state; Zustand for socket/UI state |
| Validation | Zod | Validate every API input and socket payload |
| Testing | Vitest (unit/integration) + Playwright (e2e happy path) | |
| Lint/format | ESLint + Prettier | Zero warnings at delivery |

---

## 3. Architecture Overview

```
Browser (Next.js App Router UI)
   │  REST (JSON, cookie JWT)          WebSocket (Socket.IO)
   ▼                                        ▼
Next.js API Routes  ◄────────────►  Custom Socket.IO Server (same process)
   │                                        │
   ▼                                        ▼
Prisma ORM  ─────────────────►  PostgreSQL
   │
   ▼
Local file storage (/uploads, served via /api/files/[...path])
```

Key architectural decisions the agent MUST follow:

1. **Single Node process** hosting both Next.js and a custom Socket.IO server (custom server or route handler — pick the approach that works with the chosen Next.js version and document it). Socket handlers reuse the same Prisma client and auth middleware as REST routes.
2. **Socket auth**: the JWT is read from the handshake cookie and verified before any event is processed. Unauthenticated sockets are disconnected immediately.
3. **Rooms**: one Socket.IO room per `conversation:<id>`. Users join rooms for all their conversations on connect (and on `conversation:updated` when added to a new chat). Presence is tracked in an in-memory `Map<userId, Set<socketId>>`.
4. **Source of truth is the database.** Sockets only *notify*; the client refetches or merges payloads. On reconnect, the client fetches missed data via REST (never trusts only socket replay).
5. **Optimistic UI**: messages render instantly with a pending state and are reconciled by a server ack keyed on a client-generated `clientId` (UUID).

---

## 4. Project Structure

```
.
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                  # demo users, conversations, messages
├── public/
├── uploads/                     # runtime file storage (gitignored)
├── src/
│   ├── app/                     # App Router pages
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/signup/page.tsx
│   │   ├── (chat)/chat/page.tsx        # main shell (list + pane)
│   │   └── api/
│   │       ├── auth/[...]/route.ts
│   │       ├── users/route.ts
│   │       ├── conversations/route.ts
│   │       ├── conversations/[id]/messages/route.ts
│   │       ├── messages/[id]/route.ts
│   │       ├── upload/route.ts
│   │       └── files/[...path]/route.ts
│   ├── components/
│   │   ├── chat/                # ChatWindow, MessageList, MessageBubble,
│   │   │                        # Composer, VoiceRecorder, TypingIndicator...
│   │   ├── sidebar/             # ChatList, ChatListItem, SearchBar, UserButton
│   │   ├── ui/                  # shadcn/ui primitives
│   │   └── shared/              # Avatar, EmptyState, Skeletons
│   ├── server/                  # server-only modules
│   │   ├── socket.ts            # Socket.IO server + handlers
│   │   ├── presence.ts          # in-memory presence map
│   │   └── auth.ts              # JWT sign/verify, session helpers
│   ├── hooks/                   # useSocket, useConversations, useMessages,
│   │                            # useTyping, usePresence, useSendMessage...
│   ├── lib/                     # prisma client, zod schemas, utils, constants
│   ├── stores/                  # zustand stores (socket, ui, drafts)
│   └── types/                   # shared DTO types (used by client + server)
├── .env.example
├── README.md
└── package.json
```

---

## 5. Environment Variables

Provide `.env.example` with:

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://user:pass@localhost:5432/chatapp` |
| `JWT_SECRET` | Token signing secret (min 32 chars) | random string |
| `NEXT_PUBLIC_APP_URL` | Absolute URL for links/avatars | `http://localhost:3000` |
| `MAX_UPLOAD_MB` | Upload size cap | `25` |
| `SOCKET_PATH` | Optional custom socket path | `/socket.io` |

---

## 6. Database Schema (Prisma — implement verbatim)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ConversationType {
  DIRECT
  GROUP
}

enum ParticipantRole {
  OWNER
  ADMIN
  MEMBER
}

enum MessageType {
  TEXT
  IMAGE
  VIDEO
  AUDIO   // voice notes
  FILE
  SYSTEM  // group events ("Alice added Bob")
}

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  phone        String?  @unique
  passwordHash String
  avatarUrl    String?
  about        String   @default("Hey there! I am using ChatApp.")
  isOnline     Boolean  @default(false)
  lastSeenAt   DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  participants Participant[]
  messages     Message[]
  reactions    Reaction[]
  statuses     MessageStatus[]
}

model Conversation {
  id          String           @id @default(cuid())
  type        ConversationType
  name        String?          // group name; null for DIRECT
  avatarUrl   String?
  createdById String
  createdBy   User             @relation(fields: [createdById], references: [id])
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt  // bump on every new message (list sorting)

  participants Participant[]
  messages     Message[]

  @@index([updatedAt])
}

model Participant {
  id             String          @id @default(cuid())
  userId         String
  conversationId String
  role           ParticipantRole @default(MEMBER)
  lastReadAt     DateTime        @default(now())
  isMuted        Boolean         @default(false)
  isPinned        Boolean        @default(false)
  isArchived     Boolean        @default(false)
  joinedAt       DateTime        @default(now())
  leftAt         DateTime?

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([userId, conversationId])
  @@index([conversationId])
}

model Message {
  id             String      @id @default(cuid())
  conversationId String
  senderId       String
  type           MessageType @default(TEXT)
  text           String?
  replyToId      String?     // quoted message
  editedAt       DateTime?
  deletedAt      DateTime?   // soft delete → "This message was deleted"
  createdAt      DateTime    @default(now())

  conversation Conversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender       User             @relation(fields: [senderId], references: [id])
  replyTo      Message?         @relation("Reply", fields: [replyToId], references: [id])
  replies      Message[]        @relation("Reply")
  attachments  Attachment[]
  reactions    Reaction[]
  statuses     MessageStatus[]

  @@index([conversationId, createdAt])
}

model Attachment {
  id           String   @id @default(cuid())
  messageId    String
  url          String
  mimeType     String
  size         Int       // bytes
  fileName     String
  durationSec  Int?      // voice notes / video
  width        Int?
  height       Int?
  thumbnailUrl String?

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
}

model MessageStatus {
  id        String        @id @default(cuid())
  messageId String
  userId    String        // recipient this status row tracks
  status    MessageStatus @default(SENT)
  updatedAt DateTime      @updatedAt

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId])
}

model Reaction {
  id        String   @id @default(cuid())
  messageId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId, emoji])
}

enum MessageStatus {
  SENT
  DELIVERED
  READ
}
```

> Note: the `MessageStatus` enum is declared at the bottom to keep the model block contiguous — place enums anywhere valid in the final file.

**Seed script (`prisma/seed.ts`) must create:** 6 users (password `password123` for all, one named "Demo User" as the login showcase account), 4 direct conversations and 2 group conversations involving the demo user, ≥ 30 messages across them (varying types: text, image placeholder, voice note metadata), varied read states, and reactions. Seeded credentials must be printed in the README.

---

## 7. Authentication & Security Requirements

1. **Signup**: validate name (2–50 chars), email (format + unique), password (min 8 chars, at least one letter + one number). Hash with bcrypt (cost ≥ 10). Auto-login on success.
2. **Login**: friendly, non-enumerating error messages ("Invalid email or password"). Rate-limit to 10 attempts / 15 min / IP.
3. **Session**: JWT (24 h expiry) stored in an **httpOnly, SameSite=Lax** cookie. Middleware protects all `/chat` pages and APIs; unauthenticated API calls return `401 { error: "Unauthorized" }`.
4. **Authorization (critical)**: every message/conversation operation must verify the requesting user is an active `Participant` of that conversation. Return `403` otherwise — never `404` leaks for existing resources the user shouldn't see is acceptable (403 is fine).
5. **Input validation**: Zod schemas on every route + socket handler. Reject unknown fields. Text messages capped at 4096 chars.
6. **Uploads**: whitelist MIME types (image/jpeg, image/png, image/webp, image/gif, video/mp4, video/webm, audio/webm, audio/mp4, audio/mpeg, application/pdf, and common doc types). Enforce `MAX_UPLOAD_MB`. Generate random file names server-side; never trust client filenames for storage paths. Serve uploads only to conversation participants (authorization check in the file-serving route).
7. **Rate limiting**: message send ≤ 20/10 s/user; upload ≤ 10/min/user. Return `429` with `Retry-After`.
8. **XSS**: render message text as plain text (React default); never use `dangerouslySetInnerHTML` on user content.
9. **Passwords/secrets**: nothing sensitive in client bundles or logs.

---

## 8. REST API Specification

All responses are JSON. Errors use the shape `{ "error": "message", "code": "STRING_CODE" }` with proper HTTP status codes.

### Auth
| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/auth/signup` | `{ name, email, password }` | `201 { user }` + sets cookie |
| POST | `/api/auth/login` | `{ email, password }` | `200 { user }` + sets cookie |
| POST | `/api/auth/logout` | — | `204`, clears cookie |
| GET | `/api/auth/me` | — | `200 { user }` |

### Users
| Method | Path | Query/Body | Success |
|---|---|---|---|
| GET | `/api/users` | `?search=` (name/email substring, min 2 chars) | `200 { users: [publicUser] }` (excludes passwordHash, excludes self) |
| PATCH | `/api/users/me` | `{ name?, about?, avatarUrl? }` | `200 { user }` |

### Conversations
| Method | Path | Body/Query | Success |
|---|---|---|---|
| GET | `/api/conversations` | — | `200 { conversations: [...] }` sorted by `updatedAt` desc. Each item: `id, type, name, avatarUrl, lastMessage {preview, createdAt, senderName}, unreadCount, isPinned, isMuted, isArchived, otherParticipant (for DIRECT), participants[]` |
| POST | `/api/conversations` | `{ type: "DIRECT", userId }` **or** `{ type: "GROUP", name, participantIds: [] }` | `201 { conversation }`. DIRECT: reuse existing conversation if one already exists between the two users |
| GET | `/api/conversations/:id` | — | `200 { conversation }` with participants + last 50 messages |
| PATCH | `/api/conversations/:id` | `{ name?, avatarUrl?, addParticipantIds?, removeParticipantIds?, isMuted?, isPinned?, isArchived? }` | `200 { conversation }` (group mutations emit `SYSTEM` messages) |
| POST | `/api/conversations/:id/leave` | — | `204` (group only; owner leaving transfers ownership or requires empty group — pick and document) |

### Messages
| Method | Path | Body/Query | Success |
|---|---|---|---|
| GET | `/api/conversations/:id/messages` | `?cursor=<messageId>&limit=30` | `200 { messages: [...], nextCursor: string \| null }` — newest last; cursor pagination for infinite scroll upward |
| POST | `/api/conversations/:id/messages` | `{ clientId, type, text?, replyToId?, attachmentId? }` | `201 { message }` — idempotent on `clientId` (retry-safe) |
| PATCH | `/api/messages/:id` | `{ text }` | `200 { message }` — sender only, within 15 min, TEXT only |
| DELETE | `/api/messages/:id` | `?forEveryone=true\|false` | `204` — `forEveryone`: sender only, soft-delete (render "This message was deleted"); otherwise just hide for requester |
| POST | `/api/messages/:id/reactions` | `{ emoji }` | `201 { reactions }` — toggles: same emoji by same user removes it |
| POST | `/api/conversations/:id/read` | — | `204` — sets `lastReadAt=now`, recalculates unread |

### Upload
| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/upload` | `multipart/form-data { file }` | `201 { attachment: { id, url, mimeType, size, fileName } }` — attachment is created unattached; linked when a message referencing `attachmentId` is sent |

**Message DTO shape** (used consistently in REST and socket payloads):
```jsonc
{
  "id": "cuid",
  "clientId": "client-uuid | null",
  "conversationId": "cuid",
  "senderId": "cuid",
  "sender": { "id": "cuid", "name": "Alice", "avatarUrl": null },
  "type": "TEXT",
  "text": "hello",
  "replyTo": { "id": "cuid", "senderName": "Bob", "preview": "quoted text…", "type": "TEXT" },
  "attachments": [{ "id": "cuid", "url": "/api/files/...", "mimeType": "audio/webm", "size": 51200, "fileName": "voice.webm", "durationSec": 7 }],
  "reactions": [{ "emoji": "👍", "users": ["Alice", "Bob"], "count": 2 }],
  "status": "READ",            // aggregated for the current user's perspective (sender view)
  "editedAt": null,
  "deletedAt": null,
  "createdAt": "2026-08-25T10:00:00.000Z"
}
```

---

## 9. Real-Time Specification (Socket.IO)

**Connection lifecycle**
1. Client connects with `io({ withCredentials: true })`; server verifies JWT from the handshake cookie. Invalid → `connect_error` + disconnect.
2. On connect, server: joins the socket to all rooms `conversation:<id>` for that user's conversations; adds socket to the presence map; sets `user.isOnline = true` (DB); broadcasts `presence:update` to the user's contacts (all users sharing a conversation).
3. On the last socket of a user disconnecting: `isOnline = false`, `lastSeenAt = now()`, broadcast `presence:update`.
4. **Reconnect**: client listens for `connect` and (a) re-authenticates, (b) refetches conversations + active conversation messages since the last known message id (REST), (c) re-renders. Show a "Reconnecting…" banner while disconnected.

**Client → Server events**

| Event | Payload | Behavior / Ack |
|---|---|---|
| `message:send` | `{ clientId, conversationId, type, text?, replyToId?, attachmentId? }` | Validates, persists, broadcasts `message:new` to the room (including sender's other tabs), returns ack `{ message }`. Idempotent on `clientId`. Also emits `conversation:updated` to all participants (reorders chat lists). |
| `message:read` | `{ conversationId }` | Sets `lastReadAt`, updates `MessageStatus` rows to `READ`, emits `message:status` to the room for the sender's clients. |
| `typing:start` | `{ conversationId }` | Broadcasts `typing:update` to the room except sender. Server auto-expires typing state after 5 s of silence. |
| `typing:stop` | `{ conversationId }` | Same, `isTyping: false`. |
| `message:delete` | `{ messageId, forEveryone }` | Authorizes, soft-deletes, emits `message:deleted`. |
| `message:edit` | `{ messageId, text }` | Authorizes (15-min window, TEXT only), emits `message:updated`. |
| `reaction:toggle` | `{ messageId, emoji }` | Toggles, emits `reaction:update` with the full aggregated reaction list. |

**Server → Client events**

| Event | Payload |
|---|---|
| `message:new` | full Message DTO |
| `message:ack` | `{ clientId, message }` — reconciles the optimistic message |
| `message:status` | `{ conversationId, messageId, userId, status }` (batched per read sweep: `{ updates: [...] }` is acceptable) |
| `message:deleted` | `{ messageId, conversationId, deletedAt }` |
| `message:updated` | full Message DTO |
| `reaction:update` | `{ messageId, conversationId, reactions: [{ emoji, users, count }] }` |
| `typing:update` | `{ conversationId, userId, userName, isTyping }` |
| `presence:update` | `{ userId, isOnline, lastSeenAt }` |
| `conversation:updated` | `{ conversation }` — new chat created, group mutated, or list-order change. Client must handle being *added* to a brand-new conversation. |

**Delivery receipts rule**: when a recipient's client receives `message:new` for a conversation, it auto-marks read if the conversation is open and the tab is focused; otherwise it marks delivered (`message:status` → `DELIVERED`). Multiple `MessageStatus` rows per message (one per recipient) are aggregated for the sender into the worst-to-best order SENT < DELIVERED < READ.

---

## 10. Functional Requirements & Acceptance Criteria

Implement every item below. Each AC is testable — treat it as the definition of "done" for that feature.

**FR-01 Auth**
- AC1: Signup/login/logout work with inline validation errors; no page reload.
- AC2: Refreshing `/chat` while logged out redirects to `/login`; while logged in, `/login` redirects to `/chat`.
- AC3: Wrong credentials show one clear error; correct login lands on the chat shell in under 1 s.

**FR-02 User search & profiles**
- AC1: Searching ≥ 2 characters returns matching users (debounced 300 ms, cancel in-flight requests).
- AC2: User can edit name, about text, and avatar (avatar via upload, cropped/square display).

**FR-03 Chat list**
- AC1: Conversations sorted pinned-first, then by most recent activity.
- AC2: Each row shows avatar, title (other user / group name), last-message preview (type-aware: "📷 Photo", "🎤 Voice message (0:07)", "📄 report.pdf"), relative time, unread badge.
- AC3: Starting a DIRECT chat with an existing conversation opens it instead of duplicating.
- AC4: Mute/archive/pin available from a row context menu; changes reflect instantly.

**FR-04 Messaging**
- AC1: Enter sends, Shift+Enter newlines; empty/whitespace messages rejected.
- AC2: Sent messages appear instantly (optimistic) with a clock icon → ✓ on ack → ✓✓ delivered → blue ✓✓ read.
- AC3: Retry button on failed sends; no duplicate messages after retry (clientId idempotency).
- AC4: Infinite scroll upward loads 30 older messages preserving scroll position; no jumps.
- AC5: Date dividers ("Today", "Yesterday", "Aug 12, 2026"); grouping of consecutive messages from one sender (5-min window, avatar shown once).
- AC6: Reply/quote: composer shows quoted preview; bubble renders the quoted block, clickable to scroll to the original.
- AC7: Hover menu per bubble: react, reply, copy text, edit (own, ≤ 15 min, TEXT), delete (for me / for everyone). "Edited" label shown.
- AC8: Deleted-for-everyone renders an italic "This message was deleted" for all participants; deleted-for-me disappears only locally.
- AC9: Emoji reactions (picker with 8 common emoji + full picker): aggregated pill under bubble, e.g. `👍 2`; own reaction highlighted; toggling updates count live for everyone.

**FR-05 Media & voice notes**
- AC1: Attach images/video/files via button and paste (Ctrl+V images) and drag-drop onto the chat window.
- AC2: Images render as thumbnails (max 300 px) with lightbox viewer; videos render inline players; generic files show icon + name + size, downloadable.
- AC3: Voice notes: hold/click mic to record via `MediaRecorder`, live timer + waveform placeholder, cancel or send; playback inline with play/pause, progress bar, duration; audio is `audio/webm`.
- AC4: Uploads show a progress indicator; oversized files (> `MAX_UPLOAD_MB`) are rejected client-side before upload with a toast.

**FR-06 Groups**
- AC1: Create group: pick ≥ 2 participants, name, optional avatar. A `SYSTEM` message "You created group X" is inserted.
- AC2: Group info panel: member list with roles, add/remove members (SYSTEM messages logged), rename, change avatar, leave group.
- AC3: Only OWNER/ADMIN can remove members or edit group info.

**FR-07 Typing indicators & presence**
- AC1: "Alice is typing…" shows within ~300 ms in group (multiple typists: "Alice and Bob are typing…") and in the chat list row.
- AC2: Header shows "online" or "last seen today at HH:MM" (respecting a `privacy` stretch goal is NOT required).
- AC3: Typing state auto-clears after 5 s of inactivity.

**FR-08 Read receipts**
- AC1: Sender's ticks transition SENT → DELIVERED → READ in real time as described in §9.
- AC2: Opening a conversation clears its unread badge for the current user everywhere (all tabs).

**FR-09 Search & organization**
- AC1: Sidebar search filters conversations by title AND full-text matches messages (shows "N messages" hint rows; clicking jumps to conversation with the matched message scrolled into view — a simple highlight is enough).
- AC2: Filter chips: All / Unread / Groups.

**FR-10 Notifications**
- AC1: In-app toast for messages in non-active conversations (clicking opens the chat).
- AC2: Browser notifications via the Notification API when the tab is unfocused (request permission on first interaction; degrade silently if denied).
- AC3: Unread total in `document.title`: `(3) ChatApp`; resets on focus.
- AC4: Muted conversations produce no toasts/notifications and no title count.

---

## 11. UI / UX Specification

**Layout (desktop ≥ 768 px)** — WhatsApp Web structure:
- Left sidebar (360–400 px): header (avatar button → profile drawer; new-chat FAB; menu), search input, filter chips, chat list.
- Right pane: chat header (avatar, title, presence/typing line, search & info buttons), message list, composer.
- Chat background: subtle WhatsApp-like doodle pattern or a clean neutral texture.

**Mobile (< 768 px)**: single pane; list ↔ chat slide transition (translate-x, 200 ms ease); back arrow in chat header; composer sticks above the keyboard-safe area.

**Message bubbles**
- Sent: right-aligned, outgoing color (`#d9fdd3` light / `#005c4b` dark); Received: left-aligned, white / `#202c33`.
- Max width ~65 % of pane; rounded corners (8 px) with a small tail on the outermost bubble of a group.
- Inside: content, then bottom-right meta cluster: time `HH:MM`, ticks (own messages), lock icon not needed.
- SYSTEM messages: centered, small, pill-shaped gray text.

**Composer**
- Multiline auto-growing input (max ~6 lines), emoji button (picker), attach button (menu: Photo/Video, Document), mic button (morphs to send while recording; trash to cancel).

**States (mandatory, no feature may ship without them)**
- Loading: skeleton rows for chat list; spinner + skeleton bubbles for message pane.
- Empty: no chats ("Say hello 👋"), no messages in chat ("Start the conversation"), no search results.
- Error: toast system (top-right) with auto-dismiss 4 s + retry where applicable; error boundary around the chat pane.
- Offline/reconnecting: amber banner under the header; queued sends show a paused clock icon.

**Theming**: light + dark (default follows system, manual toggle persisted in `localStorage`). Semantic Tailwind tokens (`background`, `surface`, `primary`, `muted-foreground`, etc.) — no raw hex outside the theme file.

**Accessibility**: full keyboard navigation (focus ring visible), `aria-label`s on all icon buttons, `role="log"` + `aria-live="polite"` on the message list, no keyboard traps in modals (focus trap + Escape to close), color contrast AA.

---

## 12. Performance & Reliability Requirements

- Chat list initial load < 500 ms on seeded data; message pane < 300 ms.
- Message windows render at most ~60 DOM bubbles; older ones virtualized or pruned (document chosen approach).
- Images: serve thumbnails (generate ≤ 320 px webp on upload server-side or via `sharp` if available; otherwise document a client-side approach) — full file only in lightbox.
- React: memoize message rows; never re-render the whole list on each keystroke (composer state isolated from list state).
- Socket: batch typing events (throttle to 1 emit / 1.5 s), batch read receipts.
- No memory leaks: sockets cleaned up on unmount; presence map entries removed on last disconnect.
- Correctness under flakiness: duplicate `message:new` (same id) must not duplicate in UI (dedupe by id); out-of-order acks handled via clientId map.

---

## 13. Testing Requirements

- **Unit (Vitest)**: auth helpers (hash/verify, JWT), Zod schemas, unread-count calculation, reaction aggregation, cursor pagination logic, date-divider grouping util.
- **Integration**: API route tests for auth happy path + 401/403/422 cases; conversation authorization (non-participant gets 403); message idempotency on clientId.
- **E2E (Playwright, happy path)**: signup → search user → send message → second browser context receives it in real time → reply → ticks turn blue. Keep it in `e2e/` with instructions; it may be skipped in CI via env flag.
- Seed + `npm run db:reset` script (drop → migrate → seed) for reproducible test states.

---

## 14. Build Phases (execute in order)

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Scaffold Next.js + TS + Tailwind + shadcn/ui, Prisma, Docker-compose Postgres, env files, lint | `npm run dev` boots; DB connects; CI-green lint |
| 1 | Auth (signup/login/logout/me), middleware, auth pages with validation | FR-01 ACs pass |
| 2 | Users search, conversations CRUD, REST messages with pagination, chat list + message pane rendering (no sockets — refetch on interval as stopgap) | FR-02/03 (except live), FR-04 AC1/4/5 (REST) |
| 3 | Socket.IO server: auth handshake, rooms, `message:send/new/ack`, presence map, reconnect flow; replace polling | Two browser tabs chat live; FR-07 AC2, FR-08 AC1 |
| 4 | Uploads + attachments + image/video/file rendering + voice notes | FR-05 ACs pass |
| 5 | Typing, read receipts, reactions, replies, edit/delete, SYSTEM messages | FR-06/07/08 complete |
| 6 | Groups (create, info panel, member management), pin/mute/archive, search + filters, notifications | FR-03/06/09/10 |
| 7 | Dark mode, empty/error/loading states, a11y pass, perf memoization, title unread counter | §11 + §12 checklists |
| 8 | Tests, seed script, README, final QA sweep | §15 definition of done |

After each phase: run the app, manually verify the exit criteria, fix regressions before continuing.

---

## 15. Deliverables & Definition of Done

1. Complete runnable codebase in the repo root (`npm install && npm run db:reset && npm run dev` works from scratch with only `.env` filled in).
2. `docker-compose.yml` for Postgres (or documented hosted-DB alternative).
3. Prisma schema + migrations + seed with demo credentials in README.
4. `README.md` containing: architecture overview (with the diagram from §3), setup steps, env var table, seeded demo accounts, scripts (`dev`, `build`, `start`, `db:reset`, `test`, `e2e`), known limitations, and any documented deviations from this spec.
5. All FRs implemented with their acceptance criteria passing; §16 checklist fully green.

## 16. Final Quality Checklist (verify before declaring done)

- [ ] All 10 FRs implemented; every acceptance criterion manually verified
- [ ] No `any` types; ESLint + Prettier clean; no console.log in production code paths
- [ ] Unauthenticated API → 401; non-participant access → 403 (tested)
- [ ] Duplicate sends, retry after failure, and reconnect-with-missed-messages all work
- [ ] Dark mode complete: no hardcoded colors, all states themed
- [ ] Keyboard-only walkthrough possible: login → open chat → send message
- [ ] Uploads enforce size + MIME whitelist; served only to participants
- [ ] Unread counts consistent across sidebar, title, and multiple tabs
- [ ] `npm run build` succeeds; production build boots and works
- [ ] README complete; a new developer can run the app in < 5 minutes

