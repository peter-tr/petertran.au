import { test, expect } from "@playwright/test";

test("home hero renders", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator(".hero");
  await expect(hero.getByRole("heading")).toBeVisible();
  // Wait for the mock HERO_QUERY response to land - otherwise the terminal
  // panel can still read "connecting…" when the screenshot is taken.
  await expect(hero.locator(".terminal-status")).toHaveText(/live/);
  await expect(hero).toHaveScreenshot("portfolio-hero.png");
});
