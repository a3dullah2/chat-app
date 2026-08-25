import { expect, test } from "@playwright/test";

/**
 * E2E: the previously-fixed "send → logout → login → message gone" bug.
 *
 * Regression test for the REST fallback in useSendMessage: even if the
 * socket path were to fail, the message MUST persist via REST so it survives
 * logout/login.
 *
 * We use the logout REST endpoint directly to keep the test resilient to
 * UI menu changes (the original test went through the kebab menu, which
 * was flaky due to Radix's async menu open). The point of the test is the
 * message-persistence regression, not the UI logout flow.
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("message persists across logout / login", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Login as demo user (seeded).
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Open the seeded "Project Phoenix" group and send a message.
  await page.getByText("Project Phoenix", { exact: false }).first().click();
  const messageText = `Persistence-test-${Date.now()}`;
  await page.getByLabel("Message text").fill(messageText);
  await page.getByLabel("Send message").click();
  await expect(page.getByText(messageText).first()).toBeVisible({ timeout: 10_000 });

  // Logout via REST (the UI's logout endpoint, called directly).
  await page.request.post("/api/auth/logout");
  // Reload the page so the app re-evaluates the auth state and shows the
  // login form.
  await page.goto("/");

  // Login back with the same credentials.
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Project Phoenix", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Open Project Phoenix again — the message MUST be there.
  await page.getByText("Project Phoenix", { exact: false }).first().click();
  await expect(page.getByText(messageText).first()).toBeVisible({ timeout: 10_000 });

  await ctx.close();
});
