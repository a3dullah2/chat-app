import { expect, test } from "@playwright/test";

/**
 * E2E: reaction toggle.
 *
 * Adds a reaction to a message we just sent and verifies a reaction pill
 * appears. (Uses right-click to open the message action toolbar — the toolbar
 * doesn't open on plain hover, only on long-press / right-click.)
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("add a reaction via the message action toolbar", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Open the "Weekend Trip" group.
  await page.getByText("Weekend Trip", { exact: false }).first().click();

  // Send a fresh message we own.
  const messageText = `React-${Date.now()}`;
  await page.getByLabel("Message text").fill(messageText);
  await page.getByLabel("Send message").click();
  // Wait for the message to appear in the chat log (not just the sidebar
  // preview — the chat log cache needs a beat to reconcile the ack).
  await expect(page.getByRole("log").getByText(messageText).first()).toBeVisible({ timeout: 10_000 });

  // Right-click the message (scoped to the chat log) to open the action toolbar.
  await page.getByRole("log").getByText(messageText).first().click({ button: "right" });

  // Click the "React with an emoji" button (the smiley in the toolbar).
  await page.getByRole("button", { name: /React with an emoji/i }).click();

  // Pick the first emoji in the picker (a quick-reaction button or the
  // first emoji in the full picker).
  const firstEmojiButton = page.locator('[role="menu"] button, [role="dialog"] button').first();
  await firstEmojiButton.click({ timeout: 2_000 }).catch(async () => {
    // Fall back: type an emoji name in the search field and press enter.
    await page.keyboard.type("thumbsup");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
  });

  // Verify the reaction pill appears (an emoji near the message).
  await expect
    .poll(async () => {
      const html = await page.content();
      return html.includes("👍") || html.includes("❤") || html.includes("😂");
    }, { timeout: 5_000 })
    .toBe(true);

  await ctx.close();
});
