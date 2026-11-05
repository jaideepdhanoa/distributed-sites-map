import { expect, test } from "@playwright/test";
import fs from "node:fs";

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

test("save review screenshots from the local build", async ({ page }, info) => {
  const name = info.project.name;
  await page.goto("/?stage=land&listed=yes&site=PHX-U180", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await expect(page.locator("aside.drawer")).toContainText("Lead source");
  await page.screenshot({ path: `review-shots/${name}-card.png`, fullPage: false });
  if (name === "mobile") {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator(".menu-sheet")).toContainText("Data as of");
    await page.screenshot({ path: `review-shots/${name}-menu.png` });
  } else {
    await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".summary-chip");
    await page.screenshot({ path: `review-shots/${name}-pipeline.png` });
    await page.goto("/?stage=cleared&table=1", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".dock");
    await page.screenshot({ path: `review-shots/${name}-table.png` });
  }
});
