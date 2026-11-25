import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Map as SiteMap } from "maplibre-gl";

type MapWindow = Window & { __sitesMap: SiteMap };

async function camera(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    return [...map.getCenter().toArray(), map.getZoom()].map(value => Number(value.toFixed(3)));
  });
}

// Read rendered features for hit testing. Every camera movement in the journey uses a visible control.
async function visiblePins(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    const canvas = map.getCanvas();
    const box = canvas.getBoundingClientRect();
    return map.queryRenderedFeatures({ layers: ["sites"] }).flatMap(feature => {
      if (feature.geometry.type !== "Point" || !feature.properties.site_id) return [];
      const [lng, lat] = feature.geometry.coordinates;
      const pt = map.project([lng, lat]);
      const x = box.left + pt.x, y = box.top + pt.y;
      return document.elementFromPoint(x, y) === canvas ? [{ id: String(feature.properties.site_id), x, y }] : [];
    });
  });
}

test("enter Phoenix by market label, compare nearby pins and return to the map", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  await page.goto("/?city=all&funnel=universe&stage=in_area");
  const market = page.getByRole("button", { name: /^Phoenix ·/ });
  await expect(market).toBeInViewport({ ratio: 1 });
  await page.waitForFunction(() => (window as unknown as MapWindow).__sitesMap?.loaded());
  const scope = page.locator(".workspace-scope:visible");
  if (!process.env.MAP_PRODUCTION_CHECK) {
    await mkdir("review-shots", { recursive: true });
    const prefix = process.env.MAP_DEPLOYED_PREVIEW ? "deployed-" : "";
    await page.screenshot({ path: `review-shots/${info.project.name}-${prefix}market-overview.png` });
  }
  await scope.click();
  await expect(market).toBeInViewport({ ratio: 1 });
  await expect(market).toBeVisible();
  await market.click();
  await expect(page).toHaveURL(/city=PHX/);
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "positron");
  await page.waitForFunction(() => {
    const map = (window as unknown as MapWindow).__sitesMap;
    return map?.getLayer("sites") && map.isStyleLoaded() && !map.isMoving();
  });
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  for (let i = 0; i < 4 && (await visiblePins(page)).length < 2; i++) {
    await zoomIn.click();
    await page.waitForFunction(() => !(window as unknown as MapWindow).__sitesMap.isMoving());
  }
  await expect.poll(async () => (await visiblePins(page)).length).toBeGreaterThan(1);
  const original = await camera(page);
  let previous: { id: string; x: number; y: number } | undefined;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    await expect.poll(async () => (await visiblePins(page)).length).toBeGreaterThan(1);
    let pins = await visiblePins(page);
    if (previous) {
      const first = previous;
      pins = pins.filter(pin => pin.id !== first.id && Math.hypot(pin.x - first.x, pin.y - first.y) > 22)
        .sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y));
    }
    const pin = pins[0];
    expect(pin).toBeTruthy();
    if (phone) await page.touchscreen.tap(pin.x, pin.y);
    else await page.mouse.click(pin.x, pin.y);
    const preview = page.locator(".map-preview");
    await expect(preview).toBeVisible();
    const id = await preview.getAttribute("data-record");
    expect(id && !ids.includes(id)).toBeTruthy();
    ids.push(id!);
    previous = { ...pin, id: id! };
    await preview.getByRole("button", { name: "Add to comparison" }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(() => camera(page)).toEqual(original);
  }
  const tray = page.getByTestId("compare-tray");
  await expect(tray.getByRole("table")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("compare")?.split("|")).toEqual(ids);
  await tray.getByRole("button", { name: "Close compare" }).click();
  await expect.poll(() => camera(page)).toEqual(original);
  expect(new URL(page.url()).searchParams.get("stage")).toBe("in_area");
});

test("map failure immediately exposes the same shortlist and a retry preserves scope", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, kind, ...args) {
      if ((kind === "webgl" || kind === "webgl2") && !sessionStorage.getItem("graphics-restored")) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/?city=PHX&funnel=pipeline&pstage=desk");
  const retry = page.getByRole("button", { name: "Retry map" });
  const list = page.getByTestId("pipeline-list");
  await expect(retry).toBeVisible();
  await expect(list).toBeVisible();
  const count = await page.locator(".workspace-scope:visible small").innerText();
  const scope = new URL(page.url()).search;
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(list).toBeVisible();
  await expect(page.locator(".workspace-scope:visible small")).toHaveText(count);
  expect(new URL(page.url()).search).toBe(scope);
  const rows = list.locator("[data-site-row]");
  for (const index of [0, 1]) await rows.nth(index).getByRole("checkbox").check();
  await list.getByTestId("selection-bar").getByRole("button", { name: "Compare", exact: true }).click();
  const tray = page.getByTestId("compare-tray");
  await expect(tray.getByRole("table")).toBeVisible();
  await tray.getByRole("button", { name: "Close compare" }).click();
  await expect(retry).toBeVisible();
  const row = rows.first();
  const selected = await row.getAttribute("data-site-row");
  await row.locator("button.list-row, td[data-col=site]").first().click();
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", selected!);
  await page.evaluate(() => sessionStorage.setItem("graphics-restored", "1"));
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.waitForFunction(() => (window as unknown as MapWindow).__sitesMap?.getLayer("sites") !== undefined);
  await expect(page.locator("aside.drawer")).toHaveAttribute("data-record", selected!);
  expect(new URL(page.url()).searchParams.get("pstage")).toBe("desk");
});


test("national mapped and missing counts reconcile with the shortlist", async ({ page }) => {
  const locations = [
    { city: "PHX", point: [-112.08, 33.45] }, { city: "LAS", point: [-115.15, 36.17] },
    { city: "MIA", point: [-80.19, 25.76] }, { city: "MIA", point: null },
  ];
  const features = locations.map(({ city, point }, index) => ({
    type: "Feature", geometry: point ? { type: "Point", coordinates: point } : null,
    properties: { site_id: city + "-QA-" + index, city, name: point ? "Test parcel " + index : "Map coverage example",
      origin: "universe", counts_as_site: true, in_area: true, land_only: false },
  }));
  await page.route(/\/api\/data\/sites(?:\?city=[A-Z]+)?$/, route => {
    const city = new URL(route.request().url()).searchParams.get("city");
    return route.fulfill({ json: { type: "FeatureCollection", features: features.filter(f => !city || f.properties.city === city) } });
  });
  await page.goto("/?city=all&funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  for (const market of ["Phoenix", "Las Vegas", "Miami"]) {
    await expect(page.getByRole("button", { name: market + " · 1", exact: true })).toBeVisible();
  }
  const coverage = page.locator(".shortlist-map-coverage:visible");
  await expect(coverage.locator("span")).toHaveText("3 mapped");
  await expect(page.locator(".workspace-scope:visible small")).toHaveText("4 sites");
  await coverage.getByRole("button", { name: "1 needs location" }).click();
  const dialog = page.getByRole("dialog", { name: "Needs location" });
  await expect(dialog.locator("li")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Map coverage example" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).first().click();
  await expect(page.locator("[data-site-row=MIA-QA-3]")).toBeVisible();
});


test("the map key reflects the workspace and enabled layers", async ({ page }) => {
  await page.goto("/?city=PHX&funnel=pipeline&pstage=desk", { waitUntil: "domcontentloaded" });
  const key = page.getByRole("complementary", { name: "Key" });
  const open = key.getByRole("button", { name: "Map key" });
  await open.click();
  await expect(key.getByText("Desk screen", { exact: true })).toBeVisible();
  await expect(key.getByText("Cleared", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const rings = page.getByRole("checkbox", { name: "Depot rings" });
  await rings.click();
  await expect(rings).toBeChecked();
  await page.getByRole("button", { name: "Close layers" }).click();
  if (await open.getAttribute("aria-expanded") !== "true") await open.click();
  await expect(key.getByText("Depot rings", { exact: true })).toBeVisible();
  await page.goto("/?city=PHX&funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  if (await open.getAttribute("aria-expanded") !== "true") await open.click();
  await expect(key.getByText("Cleared", { exact: true })).toBeVisible();
  await expect(key.getByText("Desk screen", { exact: true })).toHaveCount(0);
});
