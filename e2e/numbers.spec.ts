import { expect, test } from "@playwright/test";

test("pipeline counts name the set, and score issue is a filter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop funnel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-scope").click();
  const all = page.getByTestId("all-stages");
  await expect(all).toBeVisible();
  await expect(all).toContainText("All");
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByTestId("score-issue")).toBeVisible();
  await expect(page.getByTestId("land-beside-desk")).toHaveCount(0);
  await expect(page.locator("nav.funnel")).not.toContainText("+0 land");
});

test("the Phoenix chip matches All after Phoenix is selected", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop market chips");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-scope").click();
  const phoenix = page.getByTestId("market-PHX");
  await expect(phoenix).toBeVisible();
  await phoenix.click();
  await expect(page).toHaveURL(/[?&]city=PHX(?:&|$)/);
  const numberIn = async (locator: ReturnType<typeof page.getByTestId>) => {
    const text = await locator.innerText();
    return Number(text.replace(/,/g, "").match(/\d+/)?.[0] || "NaN");
  };
  await expect.poll(async () => numberIn(page.getByTestId("all-stages").locator("strong"))).toBeGreaterThan(0);
  const all = await numberIn(page.getByTestId("all-stages").locator("strong"));
  const chip = await numberIn(phoenix);
  expect(chip).toBe(all);
});

test("phone pipeline keeps the All chip", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone funnel");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.locator(".phone-step").click();
  const all = page.getByTestId("all-stages");
  await expect(all).toBeVisible();
  const clipped = await all.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(clipped).toBe(false);
  await page.goto("/?funnel=pipeline&view=list", { waitUntil: "domcontentloaded" });
  const rowClipped = await page.locator("[data-testid=summary-row]").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [...node.children].some((child) => child.getBoundingClientRect().right > box.right + 1);
  });
  expect(rowClipped).toBe(false);
});
