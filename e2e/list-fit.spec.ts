import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { PIPELINE_COLUMNS } from "../lib/keyNumbers";
import { defaultLayout } from "../lib/listLayout";

const widths = [1280, 1920];
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

function readGrid() {
  const scroll = document.querySelector("[data-testid=sheet-grid]");
  const table = scroll?.querySelector("table");
  if (!scroll || !table) return { missing: true as const };
  const scrollBox = scroll.getBoundingClientRect();
  const tableBox = table.getBoundingClientRect();
  const map = table.querySelector("thead th:last-child")?.getBoundingClientRect();
  const problems: string[] = [];
  const wrapCells = [...table.querySelectorAll("tbody td[data-wrap='text']")];
  let wrapped = 0;
  for (const cell of wrapCells) {
    const td = cell as HTMLElement;
    const col = td.getAttribute("data-col") || "cell";
    const paint = getComputedStyle(td);
    if (paint.textOverflow === "ellipsis") problems.push(`${col} cell ellipsis`);
    const bits = [...td.querySelectorAll(".metric-label, .nda-chip, .stage-pill, .metric-label button, .metric-label a")];
    if (!bits.length && td.scrollWidth > td.clientWidth + 2) problems.push(`${col} text clipped`);
    for (const bit of bits) {
      const el = bit as HTMLElement;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis") problems.push(`${col} label ellipsis`);
      if (el.scrollWidth > el.clientWidth + 2) problems.push(`${col} label clipped`);
      if (!el.classList.contains("metric-label")) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      if (tops.size > 1) wrapped += 1;
    }
  }
  const bars = [...table.querySelectorAll("tbody .metric")].flatMap((metric) => {
    const label = metric.querySelector(".metric-label");
    const strip = metric.querySelector(".range-strip");
    if (!label || !strip) return [];
    const labelBox = label.getBoundingClientRect();
    const stripBox = strip.getBoundingClientRect();
    return [{
      under: stripBox.top + 1 >= labelBox.bottom - 1,
      gap: Math.round(stripBox.top - labelBox.bottom),
      align: Math.abs(stripBox.left - labelBox.left),
    }];
  });
  return {
    missing: false as const,
    gap: Math.abs(Math.round((scrollBox.left + scroll.clientWidth) - tableBox.right)),
    overflow: scroll.scrollWidth - scroll.clientWidth,
    map: map ? Math.round(map.width) : 0,
    problems: [...new Set(problems)].slice(0, 8),
    wrapped,
    bars: bars.slice(0, 12),
    site: Math.round(table.querySelector("thead th[data-col='site']")?.getBoundingClientRect().width || 0),
    cash: Math.round(table.querySelector("thead th[data-col='cashFlow']")?.getBoundingClientRect().width || 0),
  };
}

test("chip notes have no native title on an ancestor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop tooltips");
  await page.goto("/?funnel=pipeline&view=list&cats=wash|lube|auto|land", { waitUntil: "domcontentloaded" });
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

test("desktop lists fill the pane and wrap clipped values", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop list");
  await blockLayoutWrites(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const list of lists) {
      await openList(page, list.path);
      let wrapped = 0;
      for (const ratio of [0, 0.45, 1]) {
        await page.getByTestId("sheet-grid").evaluate((node, at) => {
          const scroller = node as HTMLElement;
          scroller.scrollTop = at * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        }, ratio);
        const fit = await page.evaluate(readGrid);
        expect(fit.missing, list.name).toBe(false);
        if (fit.missing) continue;
        expect(fit.gap, `${list.name} at ${width}`).toBeLessThanOrEqual(4);
        expect(fit.overflow, `${list.name} at ${width}`).toBeLessThanOrEqual(4);
        expect(fit.map, `${list.name} map column`).toBeGreaterThanOrEqual(96);
        expect(fit.map, `${list.name} map column`).toBeLessThanOrEqual(140);
        expect(fit.problems, `${list.name} at ${width}`).toEqual([]);
        for (const bar of fit.bars) {
          expect(bar.under, `${list.name} bar`).toBe(true);
          expect(bar.gap, `${list.name} bar gap`).toBeLessThanOrEqual(8);
          expect(bar.align, `${list.name} bar align`).toBeLessThanOrEqual(2);
        }
        wrapped += fit.wrapped;
      }
      if (width === 1280 && list.name === "phoenix") {
        expect(wrapped).toBeGreaterThan(0);
        await page.screenshot({ path: "review-shots/list-fill-1280.png" });
      }
      if (width === 1920 && list.name === "phoenix") {
        await page.screenshot({ path: "review-shots/list-fill-1920.png" });
      }
    }
  }
});

test("a saved layout keeps its columns and the last flexible one fills the pane", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "saved layout");
  const allowed = PIPELINE_COLUMNS.map((column) => column.id);
  const hidden = PIPELINE_COLUMNS.filter((column) => "optional" in column && column.optional).map((column) => column.id);
  const layout = {
    ...defaultLayout(allowed, ["site"], hidden),
    touched: true,
    widths: {
      site: 200,
      stage: 140,
      score: 100,
      asking: 150,
      openLand: 110,
      capacity: 130,
      traffic: 100,
      cashFlow: 140,
    },
  };
  await blockLayoutWrites(page, layout);
  await page.setViewportSize({ width: 1920, height: 900 });
  await openList(page, "/?view=list&funnel=pipeline");
  const fit = await page.evaluate(readGrid);
  expect(fit.missing).toBe(false);
  if (fit.missing) return;
  expect(fit.gap).toBeLessThanOrEqual(4);
  expect(fit.site).toBeGreaterThanOrEqual(280);
  expect(fit.site).toBeLessThanOrEqual(290);
  expect(fit.cash).toBeGreaterThan(400);
  expect(fit.map).toBeLessThanOrEqual(140);
});
