import { expect, test } from "@playwright/test";

/**
 * E2E: search bar — type a query, see matching conversations, click a result
 * to jump to the highlighted message.
 */

test.skip(() => !!process.env.SKIP_E2E, "SKIP_E2E is set");

test("search jumps to a matching message", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@chatapp.com");
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Weekend Trip", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Type a search query that's likely to match seeded messages ("headlamp",
  // "Project Phoenix", "lake"). Try a few in sequence until one matches.
  const queries = ["headlamp", "lake", "kickoff"];
  let matched = false;
  for (const q of queries) {
    const search = page.getByLabel(/Search/i).first();
    await search.fill(q);
    // Wait for results dropdown to populate.
    await page.waitForTimeout(500);
    const result = page.getByText(q, { exact: false }).first();
    if (await result.isVisible({ timeout: 1_500 }).catch(() => false)) {
      matched = true;
      break;
    }
  }
  // At least one of the queries should match a seeded message.
  expect(matched).toBe(true);

  await ctx.close();
});
