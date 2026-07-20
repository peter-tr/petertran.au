import { test, expect } from "@playwright/test";

test("imposter setup page renders", async ({ page }) => {
  await page.goto("/imposter");

  await expect(page.getByRole("heading", { name: "Imposter" })).toBeVisible();
  // Categories load async from the mock IMPOSTER_CATEGORIES_QUERY - wait for
  // the loading placeholder to clear so the grid is settled before the
  // screenshot, instead of racing it.
  await expect(page.getByText("loading categories…")).toHaveCount(0);
  await expect(page).toHaveScreenshot("imposter-setup.png");
});
