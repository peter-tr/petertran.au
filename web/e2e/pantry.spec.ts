import { test, expect } from "@playwright/test";

test("pantry page renders", async ({ page }) => {
  await page.goto("/pantry");

  await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
  // Inventory/shopping-list/settings all load async from the mock API -
  // without waiting for a real row, the screenshot can land before that
  // fetch resolves and capture the pre-load empty state instead (only
  // looked "safe" before because the seed shopping list happened to be
  // empty too, so an empty capture matched the real, loaded page anyway).
  // Scoped to each row's own name class - a plain text match also hits the
  // "Milk"/"Eggs" buttons in the unrelated Manual Add common-items list.
  await expect(page.locator(".pantry-item-name", { hasText: "Milk" })).toBeVisible();
  await expect(page.locator(".pantry-shopping-item-name", { hasText: "Eggs" })).toBeVisible();
  await expect(page).toHaveScreenshot("pantry-home.png");
});
