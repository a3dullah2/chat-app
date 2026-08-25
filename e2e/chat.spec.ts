import { expect, test } from "@playwright/test";

/**
 * Happy-path E2E (spec §13):
 * signup → search user → send message → second browser context receives it in
 * real time → reply → ticks turn blue (READ).
 *
 * Prerequisites: a freshly seeded database (`bun run db:reset`) and the dev
 * server + socket mini-service running. Skip in CI with SKIP_E2E=1.
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("real-time chat between two users", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  // --- Alice signs up (fresh account; seed users remain untouched) ---
  await alice.goto("/");
  await alice.getByRole("tab", { name: "Sign up" }).click();
  await alice.getByLabel("Name").fill(`E2E Alice ${Date.now()}`);
  await alice.getByLabel("Email").fill(`e2e-alice-${Date.now()}@chatapp.com`);
  await alice.locator("#signup-password").fill("password123");
  await alice.getByRole("button", { name: "Create account" }).click();
  await expect(alice.getByText("Say hello", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // --- Bob logs in with the seeded demo account ---
  await bob.goto("/");
  await bob.getByLabel("Email").fill("demo@chatapp.com");
  await bob.locator("#login-password").fill("password123");
  await bob.getByRole("button", { name: "Log in" }).click();
  await expect(bob.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // --- Alice searches for the demo user and starts a DIRECT chat ---
  await alice.getByLabel("Start a new chat").click();
  await alice.getByLabel("Search people").fill("Demo User");
  await alice.getByRole("button", { name: /Demo User/ }).first().click();

  // --- Alice sends a message ---
  const messageText = `Hello from e2e ${Date.now()}`;
  await alice.getByLabel("Message text").fill(messageText);
  await alice.getByLabel("Send message").click();
  await expect(alice.getByText(messageText).first()).toBeVisible();

  // --- Bob receives it in real time and replies ---
  await expect(bob.getByText(messageText).first()).toBeVisible({ timeout: 15_000 });
  await bob.getByText(messageText).first().click(); // open the conversation
  const replyText = `Reply from demo ${Date.now()}`;
  await bob.getByLabel("Message text").fill(replyText);
  await bob.getByLabel("Send message").click();

  // --- Alice sees the reply and focuses the tab → ticks turn blue (READ) ---
  await expect(alice.getByText(replyText).first()).toBeVisible({ timeout: 15_000 });
  await alice.bringToFront();
  // Scroll Alice's original message back into view (the list auto-scrolls to
  // the bottom when the reply arrived, pushing her message above the fold).
  const aliceMessage = alice.getByText(messageText).first();
  await aliceMessage.scrollIntoViewIfNeeded();
  // The Read tick should appear next to Alice's own message.
  await expect(
    alice.locator("svg[aria-label='Read']").first(),
  ).toBeVisible({ timeout: 15_000 });

  await aliceContext.close();
  await bobContext.close();
});
