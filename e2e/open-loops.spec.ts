import { expect, test } from "@playwright/test";

async function stayed(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { __loopsStay?: number }).__loopsStay);
}

test("open loops closes from a deep link and from the menu without reloading", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "phone width and desktop are both exercised here");

  await page.setViewportSize({ width: 405, height: 800 });
  await page.goto("/?loops=1", { waitUntil: "domcontentloaded" });
  const panel = page.getByTestId("open-loops");
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __loopsStay?: number }).__loopsStay = 1;
  });
  await page.getByRole("button", { name: "Close open loops" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loops=/);
  expect(await stayed(page)).toBe(1);

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Open loops" }).click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/[?&]loops=1/);
  await page.getByRole("button", { name: "Close open loops" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loops=/);
  expect(await stayed(page)).toBe(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?loops=1", { waitUntil: "domcontentloaded" });
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __loopsStay?: number }).__loopsStay = 1;
  });
  await page.getByRole("button", { name: "Close open loops" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loops=/);
  expect(await stayed(page)).toBe(1);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Open loops" }).click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/[?&]loops=1/);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loops=/);
  expect(await stayed(page)).toBe(1);
});
