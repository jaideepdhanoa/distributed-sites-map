import { expect, test, type Page } from "@playwright/test";

async function brokenValues(page: Page) {
  return page.getByTestId("card-numbers").locator("strong").evaluateAll((nodes) => nodes.flatMap((node) => {
    const el = node as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = range.getClientRects().length;
    const clipped = el.scrollWidth > el.clientWidth + 1;
    if (lines > 1 || clipped) return [`${(el.textContent || "").trim()} lines=${lines} clipped=${clipped}`];
    return [];
  }));
}

test("number values stay whole in the drawer and on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline&site=PIPE-MIA-0080", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("card-numbers")).toBeVisible();
  expect(await brokenValues(page)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline&site=PIPE-MIA-0080&sheet=full", { waitUntil: "domcontentloaded" });
  const scroller = page.locator(".drawer-scroll");
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(page.locator("aside.drawer h2")).toBeInViewport();
  await expect(page.locator("aside.drawer .stage-pill").first()).toBeInViewport();
  const covered = await page.evaluate(() => {
    const bar = document.querySelector(".bar");
    const title = document.querySelector("aside.drawer h2");
    const photo = document.querySelector("aside.drawer .hero-frame");
    if (!bar || !title || !photo) return "missing";
    const limit = bar.getBoundingClientRect().bottom;
    if (photo.getBoundingClientRect().top < limit - 1) return `photo under the bar (${photo.getBoundingClientRect().top} < ${limit})`;
    if (title.getBoundingClientRect().top < limit - 1) return `title under the bar (${title.getBoundingClientRect().top} < ${limit})`;
    return "";
  });
  expect(covered).toBe("");
  await page.getByTestId("card-numbers").scrollIntoViewIfNeeded();
  expect(await brokenValues(page)).toEqual([]);
});
