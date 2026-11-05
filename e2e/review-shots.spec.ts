import { expect, test } from "@playwright/test";
import fs from "node:fs";

const username = process.env.E2E_USERNAME || "";
const password = process.env.E2E_PASSWORD || "";

test.beforeAll(() => {
  if (!username || !password) throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
  fs.mkdirSync("review-shots", { recursive: true });
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".shell");
}

test("desktop deal count and mobile data date", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".summary-chip");
  const chip = page.locator(".summary-chip").first();
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  const text = await chip.innerText();
  expect(box && box.width).toBeGreaterThan(40);
  expect(text.length).toBeGreaterThan(8);
  await page.screenshot({ path: "review-shots/desktop-pipeline.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator(".menu-sheet")).toContainText("Data as of");
  await page.screenshot({ path: "review-shots/mobile-menu.png" });
});
