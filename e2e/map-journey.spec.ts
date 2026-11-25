import { expect, test, type Page } from "@playwright/test";
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
  const scope = page.locator(".workspace-scope:visible");
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
      if (kind === "webgl" || kind === "webgl2") return null;
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
});
