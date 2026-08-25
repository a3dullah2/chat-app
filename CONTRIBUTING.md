# Contributing to ChatApp

First off — thank you for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to ChatApp. These are
guidelines, not rules — use your best judgment.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Reporting Bugs](#reporting-bugs)

## Code of Conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
By participating, you agree to uphold this code. Please report unacceptable
behavior by opening a private issue.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/chat-app.git
   cd chat-app
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/a3dullah2/chat-app.git
   ```
4. Install dependencies:
   ```bash
   bun install
   cd mini-services/chat-socket && bun install && cd ../..
   ```
5. Copy the example env and seed the database:
   ```bash
   cp .env.example .env
   bun run db:reset
   ```
6. Start the dev servers (in two terminals):
   ```bash
   bun run dev                                  # Next.js on :3000
   cd mini-services/chat-socket && bun run dev  # Socket.IO on :3003
   ```

Log in with **demo@chatapp.com / password123**.

## Development Workflow

1. Make sure you're on `main` and up to date:
   ```bash
   git checkout main
   git pull upstream main
   ```
2. Create a feature branch:
   ```bash
   git checkout -b feat/<short-description>
   # or: fix/<short-description>, chore/<short-description>
   ```
3. Make your changes. Keep commits focused and atomic.
4. Run the full quality gate locally:
   ```bash
   bun run lint
   bun run test
   bun run e2e    # requires running dev stack + seeded DB; SKIP_E2E=1 to skip
   ```
5. Push to your fork:
   ```bash
   git push origin feat/<short-description>
   ```
6. Open a pull request against `a3dullah2/chat-app:main`.

## Coding Standards

- **TypeScript everywhere** — no `any` without an inline justification comment.
- **Strict Zod schemas** on every REST route and Socket.IO handler. Validate
  at the boundary, then trust the types.
- **Prisma for all data access** — no raw SQL outside of `prisma/`.
- **Authorization first** — every conversation / message / attachment
  operation must verify active participation before mutating state.
- **Optimistic UI** — render instantly, reconcile on server ack keyed on the
  client-generated `clientId`. The server is idempotent on `clientId`.
- **No `dangerouslySetInnerHTML`** on user content, ever.
- Follow the existing file layout:
  - `src/app/` — Next.js App Router routes & API handlers
  - `src/components/` — React components (shadcn/ui-based)
  - `src/hooks/` — Custom hooks
  - `src/lib/` — Server-side libraries (auth, prisma, validation, rate-limits)
  - `src/stores/` — Zustand state stores
  - `src/types/` — Shared TypeScript types
  - `mini-services/chat-socket/` — Standalone Socket.IO service
  - `prisma/` — Schema, migrations, seed
  - `tests/` — Vitest unit & integration tests
  - `e2e/` — Playwright end-to-end specs

## Testing

- **Unit tests (`tests/unit/`)** — pure functions: JWT, Zod schemas,
  status/reaction aggregation, rate limiter windows. Run with `bun run test`.
- **Integration tests (`tests/integration/`)** — REST API paths: 401/403/404,
  `clientId` idempotency, cursor pagination, rate limiting.
- **E2E tests (`e2e/*.spec.ts`)** — Playwright flows through the real UI.
  Requires a running dev stack + seeded DB; skip with `SKIP_E2E=1` in CI.

When adding a feature, add tests:

- Pure logic → unit test.
- New REST route or socket handler → integration test covering happy path +
  auth failure + validation failure.
- New user-visible flow → Playwright spec.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`chore`, `ci`, `build`.

Examples:

```
feat(chat): add message pinning within a conversation
fix(auth): prevent demo-account user ID from regenerating on each login
docs(readme): add production deployment guide
test(e2e): cover message edit within 15-min window
```

## Pull Requests

- Keep PRs small and focused — ideally under ~400 lines of diff.
- Reference the issue: `Closes #123` or `Refs #123`.
- Fill in the PR template (self-review checklist, screenshots for UI changes).
- Make sure CI is green before requesting review.
- Don't force-push after review unless asked; new commits are easier to follow.

## Reporting Bugs

Use the **Bug report** GitHub issue template. Always include:

1. Repro steps (numbered, specific).
2. Expected vs actual behavior.
3. Browser + OS, or server runtime.
4. Console / server logs (redact secrets).
5. Screenshots or screen recordings if visual.

Thanks again — happy shipping! 🚀
