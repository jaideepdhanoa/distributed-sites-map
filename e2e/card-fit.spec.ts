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
  await page.getByRole("tab", {name:"Site fit",exact:true}).click();
  await page.locator("aside.drawer").getByText("View imagery",{exact:true}).click();
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
  const hero = await page.locator("aside.drawer .hero-frame").evaluate((node) => {
    const box = node.getBoundingClientRect();
    const tabs = node.parentElement?.querySelector(".hero-tabs")?.getBoundingClientRect();
    const overlap = tabs ? Math.min(box.bottom, tabs.bottom) - Math.max(box.top, tabs.top) : 0;
    const below = tabs ? tabs.top >= box.bottom - 1 : true;
    return { height: box.height, width: box.width, overlap, below };
  });
  expect(hero.height).toBeGreaterThan(270);
  expect(hero.height).toBeLessThan(320);
  expect(hero.width / hero.height).toBeGreaterThan(1.28);
  expect(hero.width / hero.height).toBeLessThan(1.4);
  expect(hero.overlap).toBeGreaterThan(20);
  expect(hero.below).toBe(false);
  await page.getByRole("tab", {name:"Overview",exact:true}).click();
  await page.getByTestId("card-numbers").scrollIntoViewIfNeeded();
  expect(await brokenValues(page)).toEqual([]);
});
