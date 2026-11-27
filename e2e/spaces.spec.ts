import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const password = process.env.E2E_PASSWORD || "e2e-pass-actions";
const site = "PHX-U189";
const shots = "/opt/cursor/artifacts";

async function openAs(page: Page, path: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("contributor");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function markSample(page: Page) {
  return page.evaluate(async (siteId) => {
    const response = await fetch("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        changes: [{
          entity_type: "site_space",
          site_id: siteId,
          expected_version: 0,
          source: "Site aerial",
          payload: {
            center_lng: -112.070527,
            center_lat: 33.407157,
            length_ft: 90,
            width_ft: 60,
            rotation_deg: 12,
            type: "excess_parking",
            layout: "stalls_90",
          },
        }],
      }),
    });
    const body = await response.json() as { error?: string; results?: { entity_id?: string }[] };
    return { status: response.status, id: body.results?.[0]?.entity_id || "", error: body.error || "" };
  }, site);
}

async function closeLayers(page: Page) {
  const layers = page.getByRole("button", { name: "Close layers" });
  if (await layers.isVisible().catch(() => false)) await layers.click();
}

test.beforeAll(() => {
  mkdirSync(shots, { recursive: true });
});

test("desktop summary opens drawing on the main map", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, `/?funnel=universe&panel=numbers&site=${site}`);
  await expect(page.getByTestId("space-summary")).toContainText("No lots drawn yet");
  await expect(page.getByTestId("open-map-spaces")).toBeVisible();
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.reload();
  await expect(page.getByTestId("space-summary")).toContainText("1 lot");
  await expect(page.getByTestId("space-summary")).toContainText("sq ft");
  await expect(page.getByTestId("space-summary")).toContainText("slots");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByTestId("spaces-layer")).toBeChecked();
  await closeLayers(page);
  const preferredBefore = await page.evaluate(() => localStorage.getItem("basemap"));
  await page.getByTestId("open-map-spaces").click();
  await page.getByTestId("mark-space").click();
  await expect(page.getByTestId("space-draw-bar")).toBeVisible();
  await expect(page.locator(".stage-map")).toHaveAttribute("data-basemap", "satellite");
  await expect.poll(() => page.evaluate(() => {
    const map = (window as unknown as { __sitesMap?: { getZoom: () => number } }).__sitesMap;
    return map?.getZoom() ?? -1;
  })).toBeGreaterThanOrEqual(17);
  expect(await page.evaluate(() => localStorage.getItem("basemap"))).toBe(preferredBefore);
  const canvas = page.locator(".stage-map canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __sitesMap?: { project: (lnglat: [number, number]) => { x: number; y: number } } }).__sitesMap;
    return map?.project([-112.070527, 33.407157]) ?? null;
  });
  if (!box || !point) throw new Error("map has no box");
  await page.mouse.move(box.x + point.x + 130, box.y + point.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + point.x + 250, box.y + point.y + 170, { steps: 14 });
  await page.screenshot({ path: `${shots}/space-desktop-draw.png`, animations: "disabled" });
  await page.mouse.up();
  await page.getByTestId("space-finish").click();
  await expect(page.getByTestId("space-summary")).toContainText("2 lots");
  await expect(page.getByTestId("space-popover")).toBeVisible();
  await expect(page.getByTestId("space-estimate")).toContainText("Estimated");
  await page.getByTestId("space-layout").selectOption("pull_through");
  await expect(page.getByTestId("space-estimate")).toContainText("bay");
  const thread = page.getByTestId("space-thread");
  await thread.getByTestId("space-note-body").fill("Please look at the east row. @Rev");
  await page.getByRole("option", { name: "Reviewer" }).click();
  await thread.getByRole("button", { name: "Comment" }).click();
  await expect(thread.getByTestId("space-note")).toContainText("east row");
  await page.screenshot({ path: `${shots}/space-desktop-selected.png`, animations: "disabled" });
  await expect(page.getByTestId("space-draw-bar")).toHaveCount(0);
  await page.getByTestId("space-edit").click();
  await expect(page.getByTestId("space-rotate")).toBeVisible();
  await page.getByTestId("space-delete").click();
  await expect(page.getByTestId("space-delete-ask")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("space-delete-ask")).toHaveCount(0);
  await expect(page.getByTestId("space-summary")).toContainText("2 lots");
});

test("phone mark space uses the full map and can comment", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, `/?funnel=universe&panel=numbers&site=${site}`);
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.reload();
  await expect(page.getByTestId("space-summary")).toContainText("slots");
  await page.getByTestId("open-map-spaces").click();
  await page.getByTestId("mark-space").click();
  await expect(page.getByTestId("space-finish")).toBeVisible();
  await expect(page.getByTestId("space-cancel")).toBeVisible();
  await expect(page.locator("aside.drawer")).toBeHidden();
  await expect(async () => {
    const point = await page.evaluate(() => {
      const map = (window as unknown as {
        __sitesMap?: {
          getZoom: () => number;
          resize: () => void;
          jumpTo: (camera: { center: [number, number]; zoom: number }) => void;
          project: (lnglat: [number, number]) => { x: number; y: number };
          queryRenderedFeatures: (point: [number, number], options: { layers: string[] }) => unknown[];
        };
      }).__sitesMap;
      if (!map) return null;
      if (map.getZoom() <= 17) {
        map.jumpTo({ center: [-112.070527, 33.407157], zoom: 18 });
        return null;
      }
      map.resize();
      map.jumpTo({ center: [-112.070527, 33.407157], zoom: Math.max(map.getZoom(), 18) });
      const projected = map.project([-112.070527, 33.407157]);
      if (!projected || !map?.queryRenderedFeatures([projected.x, projected.y], { layers: ["space-fill"] }).length) return null;
      return { x: projected.x, y: projected.y };
    });
    if (!point) throw new Error("marked space is not under the site yet");
    const mapBox = await page.locator(".stage-map .map").boundingBox();
    if (!mapBox) throw new Error("map has no box");
    const hit = await page.evaluate(({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return node ? `${node.tagName}.${String(node.className)}` : "none";
    }, { x: mapBox.x + point.x, y: mapBox.y + point.y });
    if (!hit.includes("canvas")) throw new Error(`click landed on ${hit}`);
    await page.mouse.click(mapBox.x + point.x, mapBox.y + point.y);
    await expect(page.getByTestId("space-popover")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("space-measure")).toContainText("ft");
  const thread = page.getByTestId("space-thread");
  await thread.getByTestId("space-note-body").fill("The row looks usable from the aerial.");
  await thread.getByRole("button", { name: "Comment" }).click();
  await expect(thread.getByTestId("space-note")).toContainText("usable from the aerial");
  await page.screenshot({ path: `${shots}/space-phone-selected.png`, animations: "disabled" });
  await page.getByTestId("space-cancel").click();
  await expect(page.locator("aside.drawer")).toBeVisible();
});

async function clickSavedLot(page: Page) {
  await expect(async () => {
    const point = await page.evaluate(() => {
      const map = (window as unknown as {
        __sitesMap?: {
          jumpTo: (camera: { center: [number, number]; zoom: number }) => void;
          project: (lnglat: [number, number]) => { x: number; y: number };
          queryRenderedFeatures: (point: [number, number], options: { layers: string[] }) => unknown[];
        };
      }).__sitesMap;
      if (!map) return null;
      map.jumpTo({ center: [-112.070527, 33.407157], zoom: 18 });
      const projected = map.project([-112.070527, 33.407157]);
      if (!map.queryRenderedFeatures([projected.x, projected.y], { layers: ["space-fill"] }).length) return null;
      return { x: projected.x, y: projected.y };
    });
    if (!point) throw new Error("saved lot is not on the map");
    const mapBox = await page.locator(".stage-map .map").boundingBox();
    if (!mapBox) throw new Error("map has no box");
    await page.mouse.click(mapBox.x + point.x, mapBox.y + point.y);
    await expect(page.getByTestId("space-popover")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

test("a saved lot opens its popover outside drawing mode", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, `/?funnel=universe&panel=numbers&site=${site}`);
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.reload();
  await expect(page.getByTestId("space-summary")).toContainText("lot");
  await closeLayers(page);
  await expect(page.getByTestId("space-draw-bar")).toHaveCount(0);
  await clickSavedLot(page);
  const popover = page.getByTestId("space-popover");
  await expect(popover.getByTestId("space-comment")).toBeVisible();
  await expect(popover.getByTestId("space-delete")).toBeVisible();
  await popover.getByRole("button", { name: "Close available lot" }).click();
  await expect(popover).toBeHidden();
  await page.getByTestId("open-map-spaces").click();
  await page.getByTestId("mark-space").click();
  await expect(page.getByTestId("space-draw-bar")).toBeVisible();
  await clickSavedLot(page);
  await expect(page.getByTestId("space-draw-delete")).toBeVisible();
  await expect(page.getByTestId("space-delete")).toBeVisible();
  await page.getByTestId("space-cancel").click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("space-summary")).toContainText("slots");
  await expect(page.getByTestId("space-draw-bar")).toHaveCount(0);
  await clickSavedLot(page);
  await expect(page.getByTestId("space-popover").getByTestId("space-comment")).toBeVisible();
  await expect(page.getByTestId("space-popover").getByTestId("space-delete")).toBeVisible();
});

test("cancel and Escape discard an unfinished lot", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, `/?funnel=universe&panel=numbers&site=${site}`);
  const seeded = await markSample(page);
  expect(seeded.status, seeded.error).toBe(200);
  await page.reload();
  await expect(page.getByTestId("space-summary")).toContainText("sq ft");
  const before = await page.getByTestId("space-summary").innerText();
  await closeLayers(page);
  await page.getByTestId("open-map-spaces").click();
  await page.getByTestId("mark-space").click();
  await expect(page.getByTestId("space-draw-bar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("space-draw-bar")).toHaveCount(0);
  await expect(page.getByTestId("space-summary")).toHaveText(before);
  await page.getByTestId("open-map-spaces").click();
  await page.getByTestId("mark-space").click();
  await page.getByTestId("space-cancel").click();
  await expect(page.getByTestId("space-draw-bar")).toHaveCount(0);
  await expect(page.getByTestId("space-summary")).toHaveText(before);
});

test("remove one saved Draw lot from its site list", async ({ page }) => {
  await openAs(page, `/?funnel=universe&panel=numbers&site=${site}`);
  async function liveIds() {
    const response = await page.request.get("/api/data/spaces?site=" + site);
    expect(response.ok()).toBeTruthy();
    const {spaces} = await response.json();
    return spaces.map((lot: { id: string }) => lot.id).sort();
  }
  const before = await liveIds();
  const added = await markSample(page);
  expect(added.status, added.error).toBe(200);
  await page.reload();
  const list = page.getByTestId("saved-manual-lots");
  await list.locator("summary").click();
  const remove = list.getByRole("button", {name: "Remove " + added.id, exact:true});
  await remove.click();
  await list.getByRole("button", {name:"Cancel", exact:true}).click();
  await expect(remove).toBeVisible();
  expect(await liveIds()).toContain(added.id);
  await remove.click();
  await list.getByRole("button", {name:"Confirm removal of " + added.id, exact:true}).click();
  await expect.poll(liveIds).toEqual(before);
  await expect(remove).toHaveCount(0);
});
