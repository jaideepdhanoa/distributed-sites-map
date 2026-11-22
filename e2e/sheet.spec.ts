import { expect, test } from "@playwright/test";

function sortButton(header: import("@playwright/test").Locator) {
  return header.locator("button.sort-header:not(.col-grip):not(.col-filter):not(.col-pin):not(.col-resize)");
}

async function cycleSort(header: import("@playwright/test").Locator) {
  await sortButton(header).evaluate((el: HTMLButtonElement) => el.click());
}

test("the sheet reorders, resizes, pins, hides, sorts, filters, and keeps the layout", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop sheet");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith("list-layout:v1:")) window.localStorage.removeItem(key);
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=sheet-grid]");
  const stage = page.locator('th[data-col="stage"]');
  await expect(stage).toHaveAttribute("aria-sort", "none");
  await cycleSort(stage);
  await expect(stage).toHaveAttribute("aria-sort", "ascending");
  await cycleSort(stage);
  await expect(stage).toHaveAttribute("aria-sort", "descending");
  await cycleSort(stage);
  await expect(stage).toHaveAttribute("aria-sort", "ascending");

  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("group", { name: "Columns" }).getByText("Traffic", { exact: true }).click();
  await expect(page.locator('th[data-col="traffic"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Columns" }).click();

  const score = page.locator('th[data-col="score"]');
  const before = await score.boundingBox();
  await score.getByRole("button", { name: "Resize Score" }).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    el.dispatchEvent(new PointerEvent("pointerdown", { clientX: startX, clientY: y, bubbles: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: startX + 160, clientY: y, bubbles: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: startX + 160, clientY: y, bubbles: true, pointerId: 1 }));
  });
  await expect(score).toHaveAttribute("style", /width:\s*2\d\dpx/);
  const after = await score.boundingBox();
  expect(after && before && after.width).toBeGreaterThan((before?.width || 0) + 40);

  const land = page.locator('th[data-col="openLand"]');
  await land.hover();
  const grip = land.getByRole("button", { name: "Reorder Open land" });
  await expect(grip).toBeVisible();
  const from = await grip.boundingBox();
  const label = sortButton(land);
  const labelBox = await label.boundingBox();
  const filter = land.getByRole("button", { name: "Filter Open land" });
  const pin = land.getByRole("button", { name: "Pin Open land" });
  const filterBox = await filter.boundingBox();
  const pinBox = await pin.boundingBox();
  expect(from && labelBox && filterBox && pinBox).toBeTruthy();
  if (from && labelBox && filterBox && pinBox) {
    expect(from.width).toBeGreaterThanOrEqual(24);
    expect(from.height).toBeGreaterThanOrEqual(24);
    expect(from.x + from.width).toBeLessThanOrEqual(labelBox.x + 1);
    expect(from.x + from.width).toBeLessThanOrEqual(filterBox.x + 1);
    expect(from.x + from.width).toBeLessThanOrEqual(pinBox.x + 1);
  }
  const slot = await grip.evaluate((el) => getComputedStyle(el).position);
  expect(slot).not.toBe("absolute");
  await page.locator("[data-testid=sheet-grid] thead").screenshot({ path: "review-shots/column-grip-desktop.png" });
  const target = await stage.boundingBox();
  expect(from && target).toBeTruthy();
  if (from && target) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 24, target.y + 12, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.locator("[data-testid=sheet-grid] thead th[data-col]").nth(1)).toHaveAttribute("data-col", "openLand");

  await score.getByRole("button", { name: "Pin Score" }).click({ force: true });
  await expect(score).toHaveAttribute("data-pinned", "true");

  await stage.getByRole("button", { name: "Filter Stage" }).click({ force: true });
  await page.getByRole("group", { name: "Filter Stage" }).getByRole("checkbox", { name: "Offer and close" }).check();
  await expect(page.locator("[data-testid=sheet-grid] tbody tr.list-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.locator("[data-testid=sheet-grid] tbody tr.list-row").first()).toBeVisible();

  const first = page.locator("[data-testid=sheet-grid] td[data-cell='0:0']");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-testid=sheet-grid] td[data-cell='0:1']")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]site=/);
  await expect(page.locator("aside.drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]site=/);
  await expect(page.locator(".shell")).not.toContainText("PIPE-PHX-0006");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=sheet-grid]");
  await expect(page.locator('th[data-col="traffic"]')).toHaveCount(0);
  await expect(page.locator('th[data-col="score"]')).toHaveAttribute("data-pinned", "true");
  const storedOrder = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((item) => item.startsWith("list-layout:v1:") && item.endsWith(":pipeline"));
    if (!key) return null;
    const layout = JSON.parse(window.localStorage.getItem(key) || "{}") as { order?: string[] };
    return layout.order || null;
  });
  expect(storedOrder).toBeTruthy();
  expect(storedOrder!.indexOf("openLand")).toBeGreaterThan(-1);
  expect(storedOrder!.indexOf("openLand")).toBeLessThan(storedOrder!.indexOf("stage"));
});

test("a phone list is cards and does not offer search this area", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=phone-cards]");
  await expect(page.locator("[data-testid=phone-cards] button.list-row").first()).toBeVisible();
  await expect(page.getByTestId("search-area")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".shell")).not.toContainText("PIPE-PHX-0006");
});
