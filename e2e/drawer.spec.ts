import { expect, test } from "@playwright/test";

test("the deal panel can be resized and keeps that width", async ({ page }, info) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-PHX-0067");
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toBeVisible();
  const grip = page.getByRole("separator", { name: "Resize panel" });

  if (info.project.name === "mobile") {
    await expect(grip).toBeHidden();
    const width = await drawer.evaluate((node) => node.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(370);
    return;
  }

  await expect(grip).toBeVisible();
  const start = await drawer.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(start).toBeGreaterThanOrEqual(370);
  expect(start).toBeLessThanOrEqual(400);

  const box = await grip.boundingBox();
  if (!box) throw new Error("missing resize grip");
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 18, box.y + 120, { steps: 8 });
  await page.mouse.up();
  const narrow = await drawer.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(narrow).toBeGreaterThanOrEqual(360);
  expect(narrow).toBeLessThanOrEqual(370);

  const again = await grip.boundingBox();
  if (!again) throw new Error("missing resize grip");
  await page.mouse.move(again.x + again.width / 2, again.y + 200);
  await page.mouse.down();
  await page.mouse.move(80, again.y + 200, { steps: 12 });
  await page.mouse.up();
  const wide = await drawer.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(wide).toBeGreaterThan(700);
  expect(wide).toBeLessThanOrEqual(864);

  const stored = await page.evaluate(() => localStorage.getItem("drawer-width"));
  expect(Number(stored)).toBe(wide);

  await page.reload();
  await expect(page.locator("aside.drawer")).toBeVisible();
  const restored = await page.locator("aside.drawer").evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(restored).toBe(wide);
});
