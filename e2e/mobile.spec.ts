import { expect, test } from "@playwright/test";

/**
 * E2E: mobile viewport. The chat layout collapses to a single-pane mobile
 * view with a back button. Switching between list and detail should work.
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("mobile layout: list → conversation → back", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // On mobile, the conversation list is the first thing visible.
  const weekend = page.getByText("Weekend Trip", { exact: false }).first();
  await weekend.click();

  // After clicking, the chat pane takes over the viewport. A back button
  // should be present to return to the list.
  await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5_000 });

  // Send a message to confirm the composer is reachable.
  const text = `Mobile-${Date.now()}`;
  await page.getByLabel("Message text").fill(text);
  await page.getByLabel("Send message").click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 5_000 });

  // Press back — the list should be visible again.
  await page.getByRole("button", { name: /Back/i }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 5_000 });

  await ctx.close();
});
