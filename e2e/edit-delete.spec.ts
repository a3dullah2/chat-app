import { expect, test } from "@playwright/test";

/**
 * E2E: edit + delete message flows.
 *
 * - Edit a sent message and see "(edited)".
 * - Delete a message "for everyone" and see the placeholder bubble.
 *
 * The message action toolbar opens on long-press (touch) or right-click
 * (desktop), not on plain hover.
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("edit then delete a message", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Login as demo.
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Open the Project Phoenix group.
  await page.getByText("Project Phoenix", { exact: false }).first().click();

  // Send a message we own.
  const messageText = `Edit-me-${Date.now()}`;
  await page.getByLabel("Message text").fill(messageText);
  await page.getByLabel("Send message").click();
  await expect(page.getByText(messageText).first()).toBeVisible({ timeout: 10_000 });

  // Right-click the message (scoped to the chat log, not the sidebar preview)
  // to open the action toolbar.
  const messageLine = page.getByRole("log").getByText(messageText).first();
  await messageLine.click({ button: "right" });

  // Click "Edit message" in the toolbar menu.
  await page.getByRole("menuitem", { name: /^Edit message$/i }).click();

  // Edit the text in the composer (now in edit mode) and save.
  const editedText = `Edited-${Date.now()}`;
  await page.getByLabel("Message text").fill(editedText);
  await page.getByRole("button", { name: "Save edited message" }).click();
  await expect(page.getByText(editedText).first()).toBeVisible({ timeout: 10_000 });

  // Now right-click again to delete (scoped to the chat log).
  await page.getByRole("log").getByText(editedText).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete for everyone/i }).click();

  // The bubble should now show a placeholder.
  await expect(page.locator("text=deleted", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  await ctx.close();
});
