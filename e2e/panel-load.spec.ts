import { expect, test, type Page } from "@playwright/test";
import { sampleStatement } from "../lib/pnl/fixture";

const PIPE = "PIPE-LAS-0011";
const SITE = "LAS-U858";
const LAND = "LAND-PHX-0007";
const OTHER = "PIPE-ZZZ-0001";

function sheetQuery(page: Page) {
  return (page.viewportSize()?.width ?? 1440) < 768 ? "&sheet=full" : "";
}

test("overview tiles hold a skeleton until the P&L arrives", async ({ page }) => {
  let release = () => {};
  let gate = Promise.resolve();
  let held = true;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/data/financials/${PIPE}`, async (route) => {
    if (held) await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ pnl: sampleStatement(), pnlDemo: true }),
    });
  });

  async function tileHeights(record: string) {
    return page.locator(`aside.drawer[data-record='${record}']`).evaluate((node) => {
      const box = (id: string) => {
        const el = node.querySelector(`[data-testid='${id}']`);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      return {
        revenue: box("overview-revenue"),
        cash: box("overview-cash"),
        stripRevenue: box("revenue-tile"),
        stripCash: box("cash-flow-tile"),
        summaryRevenue: box("summary-revenue"),
        summaryCash: box("summary-cash"),
      };
    });
  }

  async function assertLoading(record: string, summary: boolean) {
    const drawer = page.locator(`aside.drawer[data-record='${record}']`);
    await drawer.waitFor({ state: "attached", timeout: 45_000 });
    const tiles = [
      drawer.getByTestId("overview-revenue"),
      drawer.getByTestId("overview-cash"),
      drawer.getByTestId("revenue-tile"),
      drawer.getByTestId("cash-flow-tile"),
    ];
    if (summary) tiles.push(drawer.getByTestId("summary-revenue"), drawer.getByTestId("summary-cash"));
    await expect(tiles[0].getByTestId("figure-loading")).toBeVisible();
    for (const tile of tiles) {
      await expect(tile).not.toContainText("—");
      await expect(tile).not.toContainText("Not on file");
      await expect(tile).not.toContainText("Not in package");
    }
  }

  const suffix = `${sheetQuery(page)}`;
  try {
    await page.goto(`/?funnel=pipeline&site=${PIPE}${suffix}`, { waitUntil: "domcontentloaded" });
    await assertLoading(PIPE, true);
    const loadingHeights = await tileHeights(PIPE);
    held = false;
    release();
    const loaded = page.locator(`aside.drawer[data-record='${PIPE}']`);
    await expect(loaded.getByTestId("overview-revenue").locator("strong")).toHaveText("$1,000,000");
    await expect(loaded.getByTestId("overview-cash").locator("strong")).toHaveText("$520,000");
    await expect(loaded.getByTestId("revenue-tile").locator("strong")).toHaveText("$1,000,000");
    await expect(loaded.getByTestId("cash-flow-tile").locator("strong")).toHaveText("$520,000");
    const loadedHeights = await tileHeights(PIPE);
    expect(loadedHeights).toEqual(loadingHeights);
    await page.getByRole("tab", {name:"Financials",exact:true}).click();
    await expect(loaded.getByTestId("financials-entry")).toContainText("$1,000,000 revenue");

    held = true;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.goto(`/?funnel=pipeline&site=${SITE}${suffix}`, { waitUntil: "domcontentloaded" });
    await assertLoading(SITE, false);
    const siteLoadingHeights = await tileHeights(SITE);
    held = false;
    release();
    const site = page.locator(`aside.drawer[data-record='${SITE}']`);
    await expect(site.getByTestId("overview-revenue").locator("strong")).toHaveText("$1,000,000");
    await expect(site.getByTestId("overview-cash").locator("strong")).toHaveText("$520,000");
    const siteLoadedHeights = await tileHeights(SITE);
    expect(siteLoadedHeights).toEqual(siteLoadingHeights);
    await page.getByRole("tab", {name:"Financials",exact:true}).click();
    await expect(site.getByTestId("financials-entry")).toContainText("SDE $520,000");
  } finally {
    held = false;
    release();
  }
});

function queueItem(siteId: string, name: string, at: string) {
  return {
    siteId,
    city: siteId.includes("LAS") ? "LAS" : "PHX",
    reasons: [{ at, summary: "Sample note.", type: "note" }],
    snapshot: { name, city: siteId.includes("LAS") ? "LAS" : "PHX", lng: -112.07, lat: 33.45 },
  };
}

async function installReview(page: Page) {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as Record<string, unknown>;
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify({ ...body, actionsEnabled: true }),
    });
  });
  await page.route("**/api/queue**", async (route) => {
    const market = new URL(route.request().url()).searchParams.get("market") || "";
    const linked = queueItem(PIPE, "Linked sample", "2026-01-02T00:00:00.000Z");
    const other = queueItem(OTHER, "Other sample", "2026-11-01T00:00:00.000Z");
    const items = market === "all" ? [other, linked] : [other];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });
}

test("Open in Review focuses this deal and its linked site", async ({ page }) => {
  await installReview(page);
  const suffix = sheetQuery(page);
  await page.goto(`/?funnel=pipeline&site=${PIPE}${suffix}`, { waitUntil: "domcontentloaded" });
  const drawer = page.locator(`aside.drawer[data-record='${PIPE}']`);
  await drawer.waitFor({ state: "attached", timeout: 45_000 });
  await drawer.getByRole("button", { name: "Open in Review" }).click();
  await expect(page.getByTestId("review-position")).toContainText("1 of 1");
  await expect(page.locator(".review-row.on")).toHaveAttribute("data-site", PIPE);
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", new RegExp(`^(${PIPE}|${SITE})$`));
  await expect(page.locator(`[data-site='${OTHER}']`)).toHaveCount(0);

  await page.goto(`/?funnel=pipeline&site=${SITE}${suffix}`, { waitUntil: "domcontentloaded" });
  const siteDrawer = page.locator(`aside.drawer[data-record='${SITE}']`);
  await siteDrawer.waitFor({ state: "attached", timeout: 45_000 });
  await siteDrawer.getByRole("button", { name: "Open in Review" }).click();
  await expect(page.getByTestId("review-position")).toContainText("1 of 1");
  await expect(page.locator(".review-row.on")).toHaveAttribute("data-site", PIPE);
  await expect(page.locator(`[data-site='${OTHER}']`)).toHaveCount(0);
});

test("Open in Review on a land panel does not jump to another site", async ({ page }) => {
  await installReview(page);
  const suffix = sheetQuery(page);
  await page.goto(`/?funnel=pipeline&site=${LAND}${suffix}`, { waitUntil: "domcontentloaded" });
  const drawer = page.locator(`aside.drawer[data-record='${LAND}']`);
  await drawer.waitFor({ state: "attached", timeout: 45_000 });
  await drawer.getByRole("button", { name: "Open in Review" }).click();
  const empty = page.getByTestId("review-site-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("No review items for");
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", LAND);
  await expect(page.locator(".review-row.on")).toHaveCount(0);
  await expect(page.locator(`[data-site='${OTHER}']`)).toHaveCount(0);
});
