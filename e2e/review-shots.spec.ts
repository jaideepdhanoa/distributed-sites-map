import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { cityPipelineCounts } from "./pipeline-counts";

async function waitForBasemap(page: Page) {
  await page.waitForSelector(".maplibregl-canvas");
  await page.evaluate(() => new Promise<void>((resolve) => {
    const map = (window as unknown as { __sitesMap?: { resize: () => void; once: (name: string, fn: () => void) => void } }).__sitesMap;
    if (!map) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    map.resize();
    map.once("idle", finish);
    setTimeout(finish, 2500);
  }));
}

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

test("save review screenshots from the local build", async ({ page }, info) => {
  const name = info.project.name;
  await page.goto("/?stage=in_area&site=PHX-U189", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  await expect(page.locator("aside.drawer")).toContainText("Lead source");
  await expect(page.locator("aside.drawer")).toContainText("Off-market");
  await expect(page.locator("aside.drawer")).toContainText("County record not reviewed");
  await page.screenshot({ path: `review-shots/${name}-site-panel.png`, fullPage: false });
  await page.goto("/?stage=in_area", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".funnel");
  await waitForBasemap(page);
  await expect(page.locator(".funnel")).toContainText("Universe");
  await page.screenshot({ path: `review-shots/${name}-universe-bar.png`, fullPage: false });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".funnel");
  await waitForBasemap(page);
  const counts = cityPipelineCounts("PHX");
  await expect(page.locator(".funnel")).toContainText(`(${counts.deskDeals} deals, ${counts.deskLand} land)`);
  const chipText = async () => page.locator(".summary-chip").first().textContent();
  await expect.poll(chipText).toContain(`${counts.activeDeals} deals + ${counts.activeLand} land sites`);
  await expect.poll(chipText).toContain(`${counts.droppedDeals} dropped deals + ${counts.droppedLand} dropped land sites`);
  await page.screenshot({ path: `review-shots/${name}-pipeline.png`, fullPage: false });
  await page.goto("/?newlist=1&site=L-239", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  await expect(page.locator("aside.drawer")).toContainText("Listed, not yet screened");
  await expect(page.locator("aside.drawer")).toContainText("Crexi");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
  await page.screenshot({ path: `review-shots/${name}-unscreened.png`, fullPage: false });
});
