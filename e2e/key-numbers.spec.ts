import { expect, test } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

test("a bare visit opens Pipeline, and an explicit Universe link still opens Universe", async ({ page }, info) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("funnel-mode");
    window.localStorage.removeItem("funnel-mode-version");
  });
  if (info.project.name !== "mobile") await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const mobile = info.project.name === "mobile";
  if (mobile) {
    await expect(page.locator(".phone-step")).toContainText("All deals");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Pipeline", exact: true })).toHaveClass(/on/);
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Close menu" }).click();
    await page.locator(".phone-step").click();
  } else {
    await expect(page.getByRole("button", { name: "Pipeline", exact: true }).first()).toHaveClass(/on/);
  }
  await expect(page.locator("nav.funnel")).toBeVisible();
  await expect(page.locator("nav.funnel")).toContainText("Desk screen");
  await expect(page.locator("nav.funnel")).not.toContainText("Spare land");
  if (mobile) await page.getByRole("button", { name: "Close steps" }).click();
  if (mobile) await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator("aside.layers.open")).toContainText("Universe sites");
  await page.goto("/?funnel=universe", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (mobile) {
    await expect(page.locator(".phone-step")).toContainText("Spare land");
    await page.locator(".phone-step").click();
  } else {
    await expect(page.getByRole("button", { name: "Universe", exact: true }).first()).toHaveClass(/on/);
  }
  await expect(page.locator("nav.funnel")).toContainText("Spare land");
});

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
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean } }).__sitesMap;
    return Boolean(map?.isStyleLoaded());
  });
  await page.evaluate(() => {
    const map = (window as unknown as { __sitesMap: { jumpTo: (camera: { center: [number, number]; zoom: number }) => void } }).__sitesMap;
    map.jumpTo({ center: [-112.2, 33.55], zoom: 12.2 });
  });
  const readCamera = () => page.evaluate(() => {
    const map = (window as unknown as { __sitesMap: { getZoom: () => number; getCenter: () => { lng: number; lat: number } } }).__sitesMap;
    const center = map.getCenter();
    return { zoom: map.getZoom(), lng: center.lng, lat: center.lat };
  });
  const before = await readCamera();
  const stillThere = async () => {
    await page.waitForTimeout(1200);
    const camera = await readCamera();
    expect(Math.abs(camera.zoom - before.zoom)).toBeLessThan(0.25);
    expect(Math.abs(camera.lng - before.lng)).toBeLessThan(0.03);
    expect(Math.abs(camera.lat - before.lat)).toBeLessThan(0.03);
  };
  await chooser.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "positron");
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean } }).__sitesMap;
    return Boolean(map?.isStyleLoaded());
  });
  await stillThere();
  await chooser.getByRole("button", { name: "Satellite", exact: true }).click();
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "satellite");
  await page.waitForFunction(() => {
    const map = (window as unknown as { __sitesMap?: { isStyleLoaded: () => boolean } }).__sitesMap;
    return Boolean(map?.isStyleLoaded());
  });
  await stillThere();
  await chooser.getByRole("button", { name: "Map", exact: true }).click();
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
  await expect(page.getByTestId("card-numbers")).toContainText("Cash flow");
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
