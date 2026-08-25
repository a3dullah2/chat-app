import { defineConfig } from "@playwright/test";

// E2E happy path (spec §13). Run locally against a seeded dev server:
//   bun run db:reset && bun run dev &   (plus the socket service + gateway)
//   bunx playwright install chromium
//   bun run e2e
// Skip with: SKIP_E2E=1 bun run e2e

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    // Use the gateway as the E2E baseURL so the socket.io path
    // /?XTransformPort=3003 is proxied to the chat-socket mini-service.
    // Without the gateway, the socket path would 404 against Next.js.
    baseURL: process.env.E2E_BASE_URL || "http://localhost:81",
    trace: "off",
  },
});
