import { expect, test } from "@playwright/test";
import { nearestSheetSnap, sheetSnapHeights, stepSheet } from "../lib/sheetSnap";
import { previewChromePlacement } from "../lib/previewChrome";

const SONORAN = "/?funnel=pipeline&pstage=dropped&site=PIPE-PHX-0001";

test("sheet steps and drag release stop at half", () => {
  expect(stepSheet("peek", "more")).toBe("half");
  expect(stepSheet("half", "more")).toBe("full");
  expect(stepSheet("full", "less")).toBe("half");
  expect(stepSheet("half", "less")).toBe("peek");
  const view = 800;
  const heights = sheetSnapHeights(view);
  expect(heights.peek).toBeLessThanOrEqual(view / 2);
  expect(nearestSheetSnap(heights.peek, view)).toBe("peek");
  expect(nearestSheetSnap(heights.half, view)).toBe("half");
  expect(nearestSheetSnap(heights.full, view)).toBe("full");
  expect(nearestSheetSnap((heights.peek + heights.half) / 2 + 8, view)).toBe("half");
});

test("phone show more and show less stop at half", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.goto(SONORAN);
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toHaveClass(/snap-half/);
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(drawer).toHaveClass(/snap-peek/);
  const peek = await drawer.boundingBox();
  const view = page.viewportSize()?.height ?? 800;
  expect(peek!.height).toBeLessThanOrEqual(view / 2);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(drawer).toHaveClass(/snap-half/);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(drawer).toHaveClass(/snap-full/);
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(drawer).toHaveClass(/snap-half/);
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(drawer).toHaveClass(/snap-peek/);
});

test("dragging the grab bar releases on half", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.goto(SONORAN);
  await page.getByRole("button", { name: "Show less" }).click();
  const grab = page.getByRole("button", { name: "Drag sheet" });
  const box = await grab.boundingBox();
  const shift = await page.evaluate(() => {
    const view = window.innerHeight;
    const peek = Math.min(320, Math.round(view * 0.45));
    const half = Math.round(view * 0.56);
    return half - peek;
  });
  const x = box!.x + box!.width / 2;
  const y = box!.y + 16;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - shift, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator("aside.drawer")).toHaveClass(/snap-half/);
});

test("zoom stays in the map and the preview button clears the drawer", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop map chrome");
  await page.goto(SONORAN);
  await page.locator("aside.drawer").waitFor();
  await page.evaluate(() => {
    const button = document.createElement("vercel-live-feedback");
    button.textContent = "notes";
    button.style.cssText = "position:fixed;right:8px;top:420px;width:44px;height:44px;border-radius:50%;background:#111";
    document.body.appendChild(button);
  });
  await page.waitForFunction(() => {
    const button = document.querySelector("vercel-live-feedback");
    const drawer = document.querySelector("aside.drawer");
    if (!button || !drawer) return false;
    return button.getBoundingClientRect().right <= drawer.getBoundingClientRect().left - 4;
  });
  const zoomRight = await page.locator(".maplibregl-ctrl-top-right").evaluate((node) => node.getBoundingClientRect().right);
  const drawerLeft = await page.locator("aside.drawer").evaluate((node) => node.getBoundingClientRect().left);
  expect(zoomRight).toBeLessThanOrEqual(drawerLeft);
});

test("phone layers list scrolls between the header and the sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layers");
  await page.goto(SONORAN);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const panel = page.locator(".layers.open");
  const note = panel.locator(".layer-meta").last();
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeVisible();
  await expect(panel.getByText("Land Sites")).toBeVisible();
  const bounds = await page.evaluate(() => {
    const layers = document.querySelector(".layers.open")!;
    const bar = document.querySelector("header.bar")!;
    const drawer = document.querySelector("aside.drawer")!;
    const note = layers.querySelector(".layers-body .layer-meta:last-child")!;
    const lr = layers.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const dr = drawer.getBoundingClientRect();
    const nr = note.getBoundingClientRect();
    return {
      belowHeader: lr.top >= br.bottom - 2,
      aboveSheet: lr.bottom <= dr.top + 8,
      noteInside: nr.top >= lr.top - 1 && nr.bottom <= lr.bottom + 1,
    };
  });
  expect(bounds.belowHeader).toBe(true);
  expect(bounds.aboveSheet).toBe(true);
  expect(bounds.noteInside).toBe(true);
});

test("preview button hides on the phone when the sheet is above peek", () => {
  const hidden = previewChromePlacement({
    viewportWidth: 390,
    viewportHeight: 800,
    drawerLeft: 0,
    drawerTop: 352,
    phone: true,
    abovePeek: true,
  });
  expect(hidden.display).toBe("none");
  const parked = previewChromePlacement({
    viewportWidth: 1280,
    viewportHeight: 800,
    drawerLeft: 900,
    drawerTop: 140,
    phone: false,
    abovePeek: false,
  });
  expect(parseFloat(parked.left)).toBeLessThan(900);
});
