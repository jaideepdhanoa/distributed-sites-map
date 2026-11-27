import { expect, test } from "@playwright/test";

function sortButton(header: import("@playwright/test").Locator) {
  return header.locator(".col-label");
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

  await page.getByRole("button", { name: "Columns", exact: true }).click();
  const columns = page.getByRole("group", { name: "Columns", exact: true });
  await columns.getByText("Traffic", { exact: true }).click();
  if (!(await page.locator('th[data-col="score"]').count())) {
    await columns.getByText("Historical score", { exact: true }).click();
  }
  await expect(page.locator('th[data-col="traffic"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Columns", exact: true }).click();

  const score = page.locator('th[data-col="score"]');
  const before = await score.boundingBox();
  await score.locator(".col-resize").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    el.dispatchEvent(new PointerEvent("pointerdown", { clientX: startX, clientY: y, bubbles: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: startX + 160, clientY: y, bubbles: true, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: startX + 160, clientY: y, bubbles: true, pointerId: 1 }));
  });
  await expect.poll(async () => (await score.boundingBox())?.width || 0).toBeGreaterThan((before?.width || 0) + 40);
  const after = await score.boundingBox();
  expect(after && before && after.width).toBeGreaterThan((before?.width || 0) + 40);

  const land = page.locator('th[data-col="spaces"]');
  await land.hover();
  const label = sortButton(land);
  const options = land.getByRole("button", { name: "Column options for Charging spaces" });
  await expect(label).toHaveAttribute("draggable", "true");
  const nameBox = (await label.boundingBox())!;
  const menuBox = (await options.boundingBox())!;
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(menuBox.x + 1);
  expect(Math.abs(nameBox.y + nameBox.height / 2 - menuBox.y - menuBox.height / 2)).toBeLessThan(2);
  await label.dragTo(stage);
  await expect.poll(() => page.locator("thead th[data-col]").evaluateAll(headers => {
    const ids = headers.map(header => header.getAttribute("data-col"));
    return ids.indexOf("spaces") + 1 === ids.indexOf("stage");
  })).toBe(true);

  await score.getByRole("button", { name: "Column options for Historical score" }).click();
  await page.getByRole("group", { name: "Historical score column" }).getByRole("checkbox", { name: "Pin left" }).check();
  await expect(score).toHaveAttribute("data-pinned", "true");

  await stage.getByRole("button", { name: "Column options for Stage" }).press("Enter");
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
  expect(storedOrder!.indexOf("spaces")).toBeGreaterThan(-1);
  expect(storedOrder!.indexOf("spaces")).toBeLessThan(storedOrder!.indexOf("stage"));
});

test("a phone list is cards and does not offer search this area", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=phone-cards]");
  await expect(page.locator("[data-testid=phone-cards] button.list-row").first()).toBeVisible();
  await expect(page.getByTestId("search-area")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Columns", exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".shell")).not.toContainText("PIPE-PHX-0006");
});
