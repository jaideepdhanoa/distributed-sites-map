import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { cityPipelineCounts } from "./pipeline-counts";

async function showFunnel(page: Page, project: string) {
  if (project === "mobile") await page.locator(".phone-step").click();
  await expect(page.locator("nav.funnel")).toBeVisible();
}

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
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toContainText("Magic Hand Car Wash");
  await expect(drawer).toContainText("PHX-U189");
  await expect(drawer).toContainText("Lead source");
  await expect(drawer).toContainText("Census site");
  await expect(drawer).toContainText("County record not reviewed");
  await page.screenshot({ path: `review-shots/${name}-site-panel.png`, fullPage: false });
  await page.goto("/?stage=in_area", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  await expect(page.locator("nav.funnel")).toContainText("Universe");
  await page.screenshot({ path: `review-shots/${name}-universe-bar.png`, fullPage: false });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  const counts = cityPipelineCounts("PHX");
  await expect(page.locator("nav.funnel")).toContainText(`(${counts.deskDeals} deals, ${counts.deskLand} land)`);
  const chipText = async () => page.locator(".summary-chip").first().textContent();
  await expect.poll(chipText).toContain("on the map ·");
  await expect.poll(chipText).toContain("dropped, hidden");
  await page.screenshot({ path: `review-shots/${name}-pipeline.png`, fullPage: false });
  await page.goto("/?newlist=1&site=L-239", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  await expect(page.locator("aside.drawer")).toContainText("Listed, not yet screened");
  await expect(page.locator("aside.drawer")).toContainText("Crexi");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
  await page.screenshot({ path: `review-shots/${name}-unscreened.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&pstage=desk", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (name === "mobile") {
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByTestId("basemap")).toBeVisible();
  } else {
    await expect(page.getByTestId("basemap-desktop")).toBeVisible();
  }
  const layers = page.locator("aside.layers.open");
  await expect(layers).toBeVisible();
  await layers.screenshot({ path: `review-shots/${name}-layers.png` });
});
