import { expect, test, type Page } from "@playwright/test";

type Spot = { x: number; y: number; id: string; count: number };

async function ready(page: Page) {
  await page.waitForSelector(".maplibregl-canvas");
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded?: () => boolean } }).__sitesMap;
    return Boolean(map?.isStyleLoaded?.());
  });
}

async function jump(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(({ center, zoom }) => {
    const map = (window as unknown as {
      __sitesMap: {
        jumpTo: (camera: { center: [number, number]; zoom: number }) => void;
        once: (name: string, fn: () => void) => void;
      };
    }).__sitesMap;
    return new Promise<void>((resolve) => {
      const stop = window.setTimeout(resolve, 2500);
      map.once("idle", () => {
        window.clearTimeout(stop);
        resolve();
      });
      map.jumpTo({ center, zoom });
    });
  }, { center, zoom });
}

async function spots(page: Page): Promise<{ pins: Spot[]; groups: Spot[]; zoom: number }> {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __sitesMap: {
        getZoom: () => number;
        project: (coords: [number, number]) => { x: number; y: number };
        queryRenderedFeatures: (options: { layers: string[] }) => { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[];
      };
    }).__sitesMap;
    const pins: Spot[] = [];
    const seen = new Set<string>();
    for (const feature of map.queryRenderedFeatures({ layers: ["sites", "deals-pipe", "deals-land", "offmarket", "focus-pin", "pin-singles"] })) {
      if (feature.properties?.point_count || feature.geometry?.type !== "Point" || !feature.geometry.coordinates) continue;
      const id = String(feature.properties?.site_id || feature.properties?.deal_id || "");
      const key = id || feature.geometry.coordinates.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const point = map.project([feature.geometry.coordinates[0], feature.geometry.coordinates[1]]);
      pins.push({ x: point.x, y: point.y, id, count: 1 });
    }
    const groups: Spot[] = [];
    const grouped = new Set<string>();
    for (const feature of map.queryRenderedFeatures({ layers: ["clusters"] })) {
      const id = String(feature.properties?.cluster_id || "");
      if (!id || grouped.has(id) || feature.geometry?.type !== "Point" || !feature.geometry.coordinates) continue;
      grouped.add(id);
      const point = map.project([feature.geometry.coordinates[0], feature.geometry.coordinates[1]]);
      groups.push({ x: point.x, y: point.y, id, count: Number(feature.properties?.point_count) || 0 });
    }
    return { pins, groups, zoom: map.getZoom() };
  });
}

function overlapping(pins: Spot[]) {
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      const gap = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y);
      if (gap < 28) return true;
    }
  }
  return false;
}

async function countryGroups(page: Page, kind: "deal" | "site") {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".stage-map");
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number; isMoving: () => boolean; queryRenderedFeatures: (options: { layers: string[] }) => unknown[] } }).__sitesMap;
    const count = Number(shell?.getAttribute("data-group-count") || "0");
    return Boolean(map && !map.isMoving() && map.getZoom() < 8 && count > 0 && map.queryRenderedFeatures({ layers: ["clusters"] }).length > 0);
  });
  const view = await spots(page);
  const counted = await page.evaluate(async () => {
    const shell = document.querySelector(".stage-map");
    const map = (window as unknown as {
      __sitesMap: {
        getSource: (id: string) => { getData: () => Promise<{ features?: { properties?: { pin_kind?: string } }[] }> };
        queryRenderedFeatures: (options: { layers: string[] }) => unknown[];
      };
    }).__sitesMap;
    const data = await map.getSource("pins").getData();
    const features = data.features || [];
    const cityPins = map.queryRenderedFeatures({ layers: ["sites", "deals-pipe", "deals-land", "offmarket"] }).length;
    return {
      group: Number(shell?.getAttribute("data-group-count") || "0"),
      source: features.length,
      kinds: [...new Set(features.map((feature) => feature.properties?.pin_kind || ""))],
      cityPins,
    };
  });
  expect(view.zoom).toBeLessThan(8);
  expect(view.groups.length).toBeGreaterThan(0);
  expect(overlapping(view.pins)).toBe(false);
  expect(counted.cityPins).toBe(0);
  expect(counted.kinds.includes("deal")).toBe(kind === "deal");
  expect(counted.kinds.every((item) => (kind === "deal" ? item === "deal" : item === "site" || item === "off"))).toBe(true);
  expect(counted.source + (await page.locator(".stage-map").getAttribute("data-solo") ? 1 : 0)).toBe(counted.group);
  return view;
}

test("All view groups nearby pins, and a group opens onto its pins", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "desktop click");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=universe&city=all&stage=all", { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.getByRole("button", { name: /^Phoenix ·/ })).toBeVisible();
  await jump(page, [-112.05, 33.48], 7.2);
  await countryGroups(page, "site");

  await page.goto("/?funnel=pipeline&city=all", { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.getByRole("button", { name: /^Phoenix ·/ })).toBeVisible();
  await jump(page, [-112.05, 33.48], 7.2);
  const pipeline = await countryGroups(page, "deal");
  const mapBox = await page.locator(".map").boundingBox();
  expect(mapBox).toBeTruthy();
  const ranked = [...pipeline.groups].sort((a, b) => b.count - a.count);
  let point: { x: number; y: number } | null = null;
  for (const group of ranked) {
    const x = mapBox!.x + group.x;
    const y = mapBox!.y + group.y;
    const hit = await page.evaluate(({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return node ? String(node.className) : "";
    }, { x, y });
    if (hit.includes("maplibregl-canvas")) {
      point = { x, y };
      break;
    }
  }
  expect(point, "a cluster is visible on the map").toBeTruthy();
  const before = pipeline.zoom;
  await page.mouse.click(point!.x, point!.y);
  await page.mouse.move(8, 8);
  await page.waitForFunction((zoom) => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number } }).__sitesMap;
    const tip = document.querySelector(".map-tip-fixed");
    const summary = tip?.getAttribute("data-hidden") !== "1" && (tip?.textContent?.includes("County record") || tip?.textContent?.includes("Desk screen"));
    return Boolean(map && map.getZoom() > zoom + 0.25 && !summary);
  }, before);
});

test("city zoom shows separate pins, and a deep link stays one pin", async ({ page }, info) => {
  if (info.project.name !== "mobile") await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=universe&city=PHX&stage=all", { waitUntil: "domcontentloaded" });
  await ready(page);
  await jump(page, [-111.9, 33.46], 10.6);
  const city = await spots(page);
  expect(city.zoom).toBeGreaterThanOrEqual(10);
  expect(city.groups.length).toBe(0);
  expect(city.pins.length).toBeGreaterThan(0);

  await page.goto("/?funnel=universe&stage=all&site=PHX-U189", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.waitForFunction(() => {
    const map = (window as unknown as {
      __sitesMap?: {
        getZoom: () => number;
        queryRenderedFeatures: (options: { layers: string[] }) => { properties?: Record<string, unknown> }[];
      };
    }).__sitesMap;
    if (!map || map.getZoom() < 11) return false;
    const hits = map.queryRenderedFeatures({ layers: ["focus-pin", "sites"] });
    return hits.some((feature) => feature.properties?.site_id === "PHX-U189" && !feature.properties.point_count);
  });
  const solo = await page.locator(".stage-map").getAttribute("data-solo");
  expect(solo).toBe("PHX-U189");
});

test("phone bubbles clear the sheet and stay large enough to tap", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.goto("/?funnel=pipeline&city=all", { waitUntil: "domcontentloaded" });
  await ready(page);
  await jump(page, [-112.05, 33.48], 7.2);
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number; queryRenderedFeatures: (options: { layers: string[] }) => unknown[] } }).__sitesMap;
    return Boolean(map && map.getZoom() < 10 && map.queryRenderedFeatures({ layers: ["clusters"] }).length > 0);
  });
  const size = await page.locator(".stage-map").getAttribute("data-cluster-px");
  expect(Number(size)).toBeGreaterThanOrEqual(44);
  const covered = await page.evaluate(() => {
    const map = (window as unknown as {
      __sitesMap: {
        getContainer: () => HTMLElement;
        project: (coords: [number, number]) => { x: number; y: number };
        queryRenderedFeatures: (options: { layers: string[] }) => { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[];
      };
    }).__sitesMap;
    const peek = document.querySelector(".phone-peek");
    if (!peek || getComputedStyle(peek).display === "none") return { groups: 0, hits: -1 };
    const top = peek.getBoundingClientRect().top;
    const origin = map.getContainer().getBoundingClientRect();
    const seen = new Set<string>();
    let hits = 0;
    for (const feature of map.queryRenderedFeatures({ layers: ["clusters"] })) {
      const id = String(feature.properties?.cluster_id || "");
      if (!id || seen.has(id) || feature.geometry?.type !== "Point" || !feature.geometry.coordinates) continue;
      seen.add(id);
      const point = map.project([feature.geometry.coordinates[0], feature.geometry.coordinates[1]]);
      if (origin.top + point.y + 22 > top + 1) hits += 1;
    }
    return { groups: seen.size, hits };
  });
  expect(covered.hits).toBe(0);
  expect(covered.groups).toBeGreaterThan(0);
});
