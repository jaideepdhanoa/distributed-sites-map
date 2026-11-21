import { expect, test } from "@playwright/test";

test("pipeline counts name the set, and score issue is a filter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop funnel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  const all = page.getByTestId("all-stages");
  await expect(all).toBeVisible();
  await expect(all).toContainText("All");
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByTestId("score-issue")).toBeVisible();
});

test("phone pipeline keeps the All chip", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone funnel");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.locator(".phone-step").click();
  await expect(page.getByTestId("all-stages")).toBeVisible();
});
