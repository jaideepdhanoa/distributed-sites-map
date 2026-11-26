import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { PIPELINE_COLUMNS } from "../lib/keyNumbers";
import { defaultLayout } from "../lib/listLayout";

const widths = [1280, 1440];
const lists = [
  { name: "phoenix", path: "/?view=list&funnel=pipeline" },
  { name: "las-vegas", path: "/?view=list&funnel=pipeline&city=LAS" },
  { name: "miami", path: "/?view=list&funnel=pipeline&city=MIA" },
  { name: "universe", path: "/?view=list&funnel=universe" },
];

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

async function blockLayoutWrites(page: Page, layout?: unknown) {
  await page.route("**/api/list/layout**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(layout ? { stored: true, layout } : { stored: false, layout: null }),
    });
  });
  await page.addInitScript(() => {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith("list-layout:v1:")) window.localStorage.removeItem(key);
    }
  });
}

async function openList(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=sheet-grid] tbody tr.list-row");
  await expect.poll(async () => page.getByTestId("sheet-grid").getAttribute("data-pane-width")).not.toBe("0");
}

test("chip notes have no native title on an ancestor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop tooltips");
  await blockLayoutWrites(page);
  await page.goto("/?funnel=pipeline&view=list&cols=site,stage,county,score&cats=wash|lube|auto|land", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=list-score]");
  async function ancestorTitles(testId: string) {
    const chip = page.getByTestId(testId).first();
    await expect(chip).toBeVisible();
    return chip.evaluate((node) => {
      const found: string[] = [];
      let current: Element | null = node;
      while (current) {
        const title = current.getAttribute("title");
        if (title) found.push(title);
        current = current.parentElement;
      }
      return found;
    });
  }
  expect(await ancestorTitles("list-score")).toEqual([]);
  expect(await ancestorTitles("county-chip")).toEqual([]);
  const grid = page.getByTestId("sheet-grid");
  for (let step = 0; step < 12 && await page.getByTestId("land-paused").count() === 0; step += 1) {
    await grid.evaluate((node) => { (node as HTMLElement).scrollTop += 480; });
  }
  expect(await page.getByTestId("land-paused").count()).toBeGreaterThan(0);
  expect(await ancestorTitles("land-paused")).toEqual([]);
  const paused = page.getByTestId("land-paused").first();
  await paused.scrollIntoViewIfNeeded();
  await paused.hover();
  const pausedTip = page.getByTestId("land-paused-tip");
  await expect(pausedTip).toBeVisible();
  await expect(pausedTip).toHaveText("Land is paused since Nov 20, 2026. No sourcing or follow-up while the freeze is on.");
  const tipBox = await pausedTip.boundingBox();
  const viewport = page.viewportSize();
  expect(tipBox).toBeTruthy();
  expect(tipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual((viewport?.width || 1440) + 1);
  await page.goto("/?funnel=universe&view=list&city=PHX", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("columns-button")).toBeVisible();
  await expect(page.locator(".list-pane .row-check input.check").first()).toBeVisible();
  const heads = await page.locator(".list-pane thead th").allTextContents();
  const stage = heads.findIndex((text) => text.includes("Stage"));
  const county = heads.findIndex((text) => text.includes("County check"));
  const score = heads.findIndex((text) => text.includes("Score"));
  expect(county).toBe(stage + 1);
  expect(score).toBeGreaterThan(county);
});

async function headerProblems(page: Page) {
  return page.getByTestId("sheet-grid").evaluate((scroll) => {
    const scroller = scroll as HTMLElement;
    scroller.scrollLeft = 0;
    const problems: string[] = [];
    scroller.querySelectorAll("thead th[data-col]").forEach((th) => {
      const label = th.querySelector("button.sort-header:not(.col-grip):not(.col-filter):not(.col-pin):not(.col-resize)") as HTMLElement | null;
      const text = (label?.textContent || "").replace(/[↑↓]/g, "").trim();
      const id = th.getAttribute("data-col") || "column";
      if (!text) {
        problems.push(`${id} blank`);
        return;
      }
      if (!label || label.clientWidth < 8 || label.scrollWidth > label.clientWidth + 2) problems.push(`${id} truncated`);
    });
    const site = scroller.querySelector("thead th[data-col='site']") as HTMLElement | null;
    const sticky = site ? getComputedStyle(site).position === "sticky" : false;
    return { problems, sticky, overflow: scroller.scrollWidth - scroller.clientWidth };
  });
}

test("desktop list headers stay whole and the sheet can scroll", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop list");
  await blockLayoutWrites(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const list of lists.filter((item) => item.name === "phoenix" || item.name === "universe")) {
      await openList(page, list.path);
      const headers = await headerProblems(page);
      expect(headers.problems, `${list.name} at ${width}`).toEqual([]);
      expect(headers.sticky, `${list.name} site`).toBe(true);
      if (width === 1280) expect(headers.overflow, `${list.name} scrolls`).toBeGreaterThan(4);
      const stuck = await page.getByTestId("sheet-grid").evaluate((scroll) => {
        const scroller = scroll as HTMLElement;
        scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const site = scroller.querySelector("thead th[data-col='site']") as HTMLElement;
        const pane = scroller.getBoundingClientRect();
        return Math.abs(site.getBoundingClientRect().left - pane.left) <= 2;
      });
      expect(stuck, `${list.name} site sticks`).toBe(true);
      if (width === 1280 && list.name === "phoenix") await page.screenshot({ path: "review-shots/list-fill-1280.png" });
      if (width === 1440 && list.name === "phoenix") await page.screenshot({ path: "review-shots/list-fill-1440.png" });
    }
  }
});

test("a saved narrow layout is raised to the header floors", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "saved layout");
  const allowed = PIPELINE_COLUMNS.map((column) => column.id);
  const hidden = PIPELINE_COLUMNS.filter((column) => "optional" in column && column.optional).map((column) => column.id);
  const layout = {
    ...defaultLayout(allowed, ["site"], hidden),
    touched: true,
    widths: {
      site: 200,
      stage: 90,
      score: 40,
      asking: 70,
      openLand: 40,
      capacity: 40,
      traffic: 50,
      cashFlow: 50,
    },
  };
  await blockLayoutWrites(page, layout);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openList(page, "/?view=list&funnel=pipeline");
  const headers = await headerProblems(page);
  expect(headers.problems).toEqual([]);
  expect(headers.sticky).toBe(true);
  expect(headers.overflow).toBeGreaterThan(4);
});
