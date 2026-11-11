import { expect, test } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

const username = process.env.E2E_USERNAME || "";
const password = process.env.E2E_PASSWORD || "";

test.beforeAll(() => {
  if (!username || !password) throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
});

test("list rows match map pins for each city, step, and filter", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".shell");
  const cities = ["", "city=LAS&", "city=MIA&"];
  const steps = ["universe", "in_area", "land", "county", "cleared"];
  const filters = ["", "tier=L4", "listed=yes", "q=wash"];
  for (const city of cities) {
    for (const step of steps) {
      for (const filter of filters) {
        const query = `${city}funnel=universe&stage=${step}${filter ? `&${filter}` : ""}`;
        await page.goto(`/?${query}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".shell");
        const pins = await page.locator(".shell").getAttribute("data-pin-count");
        await page.goto(`/?${query}&view=list`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".shell.list-open");
        const rows = await page.locator(".shell").getAttribute("data-list-count");
        expect(rows, query).toBe(pins);
      }
    }
    await page.goto(`/?${city}funnel=pipeline&pstage=desk`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    const pins = Number(await page.locator(".shell").getAttribute("data-pin-count"));
    await page.goto(`/?${city}funnel=pipeline&pstage=desk&view=list`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell.list-open");
    const rows = Number(await page.locator(".shell").getAttribute("data-list-count"));
    expect(rows).toBeGreaterThanOrEqual(pins);
    if (!city) expect(rows).toBe(cityPipelineCounts("PHX").deskTotal);
  }
});
