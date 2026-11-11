import { expect, test } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

test("satellite is the default basemap and a switch is remembered", async ({ page }, info) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("basemap-init")) {
      window.localStorage.removeItem("basemap");
      window.sessionStorage.setItem("basemap-init", "1");
    }
  });
  if (info.project.name !== "mobile") await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk");
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "satellite");
  const mobile = info.project.name === "mobile";
  const chooser = mobile ? page.getByTestId("basemap") : page.getByTestId("basemap-desktop");
  if (mobile) await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(chooser).toBeVisible();
  if (!mobile) {
    const close = page.getByRole("button", { name: "Close layers" });
    await expect(close).toHaveCSS("background-color", "rgb(255, 253, 248)");
    await expect(page.locator('.layers input[type="checkbox"]:checked').first()).toHaveCSS("background-color", "rgb(30, 70, 54)");
    const bounds = await chooser.boundingBox();
    expect(bounds && bounds.width > 20 && bounds.height > 20).toBeTruthy();
  }
  await expect(chooser.getByRole("button", { name: "Satellite" })).toHaveClass(/on/);
  if (!mobile) {
    await page.waitForFunction(() => {
      const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean } }).__sitesMap;
      return Boolean(map?.isStyleLoaded());
    });
    await page.evaluate(() => {
      const map = (window as unknown as { __sitesMap: { jumpTo: (camera: { center: [number, number]; zoom: number }) => void } }).__sitesMap;
      map.jumpTo({ center: [-112.2, 33.55], zoom: 12.2 });
    });
  }
  const before = mobile ? null : await page.evaluate(() => {
    const map = (window as unknown as { __sitesMap: { getZoom: () => number; getCenter: () => { lng: number; lat: number } } }).__sitesMap;
    const center = map.getCenter();
    return { zoom: map.getZoom(), lng: center.lng, lat: center.lat };
  });
  await chooser.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "positron");
  if (before) {
    await page.waitForFunction((camera) => {
      const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean; getZoom: () => number; getCenter: () => { lng: number; lat: number } } }).__sitesMap;
      if (!map?.isStyleLoaded()) return false;
      const center = map.getCenter();
      return Math.abs(map.getZoom() - camera.zoom) < 0.25
        && Math.abs(center.lng - camera.lng) < 0.03
        && Math.abs(center.lat - camera.lat) < 0.03;
    }, before);
  }
  await page.reload();
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "positron");
  if (mobile) await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(chooser.getByRole("button", { name: "Map", exact: true })).toHaveClass(/on/);
  await page.evaluate(() => window.localStorage.removeItem("basemap"));
  await page.goto("/?review=1");
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "satellite");
});

test("pipeline list shows unpinned Phoenix deals and the key-number strip", async ({ page }) => {
  const desk = cityPipelineCounts("PHX");
  const withStores = cityPipelineCounts("PHX", { cstore: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list");
  await page.waitForSelector("[data-testid=pipeline-list]");
  const summary = await page.getByTestId("summary-row").boundingBox();
  const controls = await page.locator(".pipeline-list .list-bar").boundingBox();
  expect(summary && controls).toBeTruthy();
  if (summary && controls) expect(controls.y).toBeGreaterThanOrEqual(summary.y + summary.height - 1);
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(desk.deskTotal));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk");
  await page.waitForSelector("[data-pin-count]");
  const pins = await page.locator(".shell").getAttribute("data-pin-count");
  await page.goto("/?funnel=pipeline&pstage=desk&cstore=1");
  await expect(page.locator(".shell")).toHaveAttribute("data-pin-count", pins || "");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean; getSource: (id: string) => { serialize: () => { data?: { features?: unknown[] } } } } }).__sitesMap;
    if (!map?.isStyleLoaded()) return false;
    const data = map.getSource("deals")?.serialize()?.data;
    return Boolean(data && "features" in data && Array.isArray(data.features) && data.features.length >= 1);
  });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list&cstore=1");
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(withStores.deskTotal));
  await expect(page.locator(".no-pin").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("summary-row")).toContainText("Median asking");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&site=PIPE-PHX-0067");
  await page.getByTestId("panel-tab-numbers").click();
  await expect(page.getByTestId("key-strip")).toContainText("Cash flow");
  await expect(page.getByTestId("key-strip")).toContainText("Broker-stated");
  await expect(page.getByTestId("key-strip")).not.toContainText("Package figures not shown");

  await page.goto("/?funnel=pipeline&view=list&site=LAND-PHX-0035");
  await page.getByTestId("panel-tab-numbers").click();
  await expect(page.getByTestId("key-strip")).toContainText("104,100");
  await expect(page.getByTestId("key-strip")).toContainText("Estimated");
  await expect(page.getByTestId("key-strip")).toContainText("Space");
  await expect(page.getByTestId("key-strip")).toContainText("Capacity");
  await expect(page.getByTestId("key-strip")).toContainText("Attractiveness");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&compare=LAND-PHX-0035|PIPE-PHX-0067");
  await expect(page.getByTestId("compare-tray")).toContainText("Compare 2");
  await expect(page.getByTestId("compare-tray")).toContainText("$478,044");
});
