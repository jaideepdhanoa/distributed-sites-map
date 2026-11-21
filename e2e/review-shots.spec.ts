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
  await page.goto("/?funnel=universe&stage=in_area&site=PHX-U189", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toContainText("Magic Hand Car Wash");
  await expect(drawer).toContainText("Lead source");
  await expect(drawer).toContainText("Census site");
  await expect(drawer).toContainText("County record not reviewed");
  await page.screenshot({ path: `review-shots/${name}-site-panel.png`, fullPage: false });
  if (name === "mobile") {
    await page.goto("/?funnel=universe&stage=in_area&site=PHX-U189&sheet=full", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("aside.drawer");
  }
  const record = page.locator("aside.drawer");
  await record.locator("summary.disclosure", { hasText: "Record" }).click();
  await expect(record).toContainText("PHX-U189");
  await page.goto("/?funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  await expect(page.locator("nav.funnel")).toContainText("Universe");
  await page.screenshot({ path: `review-shots/${name}-universe-bar.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  const counts = cityPipelineCounts("PHX");
  const desk = page.locator("nav.funnel .step").filter({ hasText: "Desk screen" });
  await expect(desk.locator("strong")).toHaveText(String(counts.deskDeals));
  await expect(page.getByTestId("land-beside-desk")).toHaveCount(0);
  const chipText = async () => page.locator(".summary-chip").first().textContent();
  await expect.poll(chipText).toContain("on the map ·");
  await expect.poll(chipText).toContain("dropped, hidden");
  await page.screenshot({ path: `review-shots/${name}-pipeline.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pipeline-list");
  if (name !== "mobile") {
    await expect(page.locator(".pipeline-list thead th")).toHaveCount(9);
    const overflow = await page.locator(".pipeline-list .list-scroll").evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } else {
    await expect(page.getByTestId("phone-cards")).toBeVisible();
    await expect(page.getByTestId("search-area")).toHaveCount(0);
    const cardGaps = await page.locator("[data-testid=phone-cards] button.list-row").first().evaluate((node) => {
      const stage = node.querySelector(".phone-card-stage")?.getBoundingClientRect();
      const meta = node.querySelector(".phone-card-meta")?.getBoundingClientRect();
      const sep = node.querySelector(".phone-sep");
      const sepStyle = sep ? getComputedStyle(sep) : null;
      return {
        stageGap: stage && meta ? meta.top - stage.bottom : -1,
        sepSpace: sepStyle ? parseFloat(sepStyle.marginLeft) + parseFloat(sepStyle.marginRight) : 0,
        bareMissing: /Not on file/.test(node.textContent || ""),
      };
    });
    expect(cardGaps.stageGap).toBeGreaterThanOrEqual(4);
    expect(cardGaps.sepSpace).toBeGreaterThanOrEqual(12);
    expect(cardGaps.bareMissing).toBe(false);
  }
  await page.screenshot({ path: `review-shots/${name}-list.png`, fullPage: false });
  await page.goto("/?funnel=universe&view=list&city=PHX", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".list-pane");
  if (name !== "mobile") {
    await expect(page.locator(".list-pane thead")).toContainText("County check");
    await expect(page.getByTestId("type-chip").first()).toBeVisible();
  } else {
    await expect(page.getByTestId("phone-cards")).toBeVisible();
    await expect(page.getByTestId("type-chip").first()).toBeVisible();
  }
  await page.screenshot({ path: `review-shots/${name}-universe-list.png`, fullPage: false });
  await page.goto("/?newlist=1&city=PHX&site=L-239", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  await expect(page.locator("aside.drawer")).toContainText("Listed, not yet screened");
  await expect(page.locator("aside.drawer")).toContainText("Crexi");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
  await page.screenshot({ path: `review-shots/${name}-unscreened.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX&pstage=desk", { waitUntil: "domcontentloaded" });
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
  const closeLayers = page.getByRole("button", { name: "Close layers" });
  if (await closeLayers.isVisible()) await closeLayers.click();
  await page.goto(`/?funnel=pipeline&site=PIPE-MIA-0080${name === "mobile" ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  const stars = page.locator("aside.drawer");
  await expect(stars).toContainText("Stars & Stripes");
  await expect(stars).toContainText("Financial screen");
  const step = stars.getByTestId("workbook-step");
  await expect(step).toBeVisible();
  const more = step.getByRole("button", { name: "Show full note" });
  if (await more.count()) await more.click();
  await expect(step).toContainText("POS/car counts");
  await expect(stars).toContainText("Last contact Nov 6");
  await page.locator(".drawer-scroll").evaluate((node) => { node.scrollTop = 0; });
  await expect(stars.locator("h2")).toBeInViewport();
  await page.screenshot({ path: `review-shots/${name}-mia-0080.png`, fullPage: false });
});
