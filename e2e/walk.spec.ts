import { expect, test } from "@playwright/test";

test("desktop list fills the width and hides measure", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop list");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  const fit = await page.evaluate(() => {
    const pane = document.querySelector("[data-testid=pipeline-list]");
    const measure = document.querySelector("[data-testid=measure]");
    if (!pane) return { missing: true, gap: 0, measure: false };
    const box = pane.getBoundingClientRect();
    const shown = measure instanceof HTMLElement && getComputedStyle(measure).display !== "none" && measure.getClientRects().length > 0;
    return { missing: false, gap: document.documentElement.clientWidth - (box.x + box.width), measure: shown };
  });
  expect(fit.missing).toBe(false);
  expect(fit.gap).toBeLessThanOrEqual(2);
  expect(fit.measure).toBe(false);
});

test("unknown open land is a dash", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop card");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=sheet-grid] td[data-col=openLand]");
  const dash = page.locator("[data-testid=sheet-grid] td[data-col=openLand]").filter({ hasText: /^—$/ }).first();
  await expect(dash).toBeVisible();
  await dash.click();
  await page.waitForSelector("[data-testid=card-numbers]");
  const state = await page.evaluate(() => {
    const block = document.querySelector("[data-testid=card-numbers]");
    const row = [...(block?.querySelectorAll("div") || [])].find((el) => el.querySelector("span")?.textContent === "Open land");
    const value = row?.querySelector("strong")?.textContent?.trim() || "";
    if (value === "—") return "dash";
    if (value === "0 sq ft") return "zero";
    return "other";
  });
  expect(state).toBe("dash");
});

test("phone list is one toolbar row of cards and hides search this area", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone list");
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=phone-cards]");
  await expect(page.getByTestId("search-area")).toHaveCount(0);
  const fit = await page.evaluate(() => {
    const bar = document.querySelector(".pipeline-list .list-bar");
    const card = document.querySelector("[data-testid=phone-cards] button.list-row");
    if (!bar || !card) return { missing: true, tall: false, pieces: false, scroll: false };
    const box = bar.getBoundingClientRect();
    const meta = card.querySelector(".phone-card-meta");
    const mids = [...bar.children].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    return {
      missing: false,
      split: mids.length > 0 && Math.max(...mids) - Math.min(...mids) > 12,
      pieces: Boolean(card.querySelector(".phone-card-name") && card.querySelector(".stage-pill") && meta && meta.children.length >= 4),
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
    };
  });
  expect(fit.missing).toBe(false);
  expect(fit.split).toBe(false);
  expect(fit.pieces).toBe(true);
  expect(fit.scroll).toBe(false);
  await page.locator("[data-testid=phone-cards] button.list-row").first().click();
  await expect(page).toHaveURL(/[?&]site=/);
});

test("signed-in next step and open loops do not show a gmail id", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "signed-in text");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list] tbody tr");
  await page.locator("[data-testid=pipeline-list] tbody tr").first().click();
  await page.waitForSelector("[data-testid=next-step], [data-testid=card-numbers]");
  const leaked = await page.evaluate(() => /gmail\s+[0-9a-f]{16}/i.test(document.body.innerText));
  expect(leaked).toBe(false);
  const loops = page.getByTestId("open-loops-open");
  if (await loops.count()) {
    await loops.first().click();
    await page.waitForSelector("[data-testid=open-loops]");
    const loopsLeaked = await page.evaluate(() => /gmail\s+[0-9a-f]{16}/i.test(document.body.innerText));
    expect(loopsLeaked).toBe(false);
  }
});

test("activity times use the short date and keep the raw stamp on the title", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "activity clock");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-MIA-0082&panel=activity", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=activity]");
  const clock = await page.waitForFunction(() => {
    const root = document.querySelector("[data-testid=activity]");
    const stamps = [...(root?.querySelectorAll("time") || [])];
    if (!stamps.length) return null;
    return {
      count: stamps.length,
      iso: stamps.some((node) => /^\s*·?\s*\d{4}-\d{2}-\d{2}/.test(node.textContent || "")),
      titled: stamps.every((node) => Boolean(node.getAttribute("title"))),
      short: stamps.every((node) => /^[A-Z][a-z]{2} \d{1,2}/.test((node.textContent || "").replace(/^ · /, ""))),
    };
  });
  const value = await clock.jsonValue();
  expect(value?.count).toBeGreaterThan(0);
  expect(value?.iso).toBe(false);
  expect(value?.titled).toBe(true);
  expect(value?.short).toBe(true);
});

test("a land deeplink does not turn the land filter on", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "deeplink filters");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  const before = Number(await page.locator(".shell").getAttribute("data-list-count"));
  await page.goto("/?funnel=pipeline&pstage=desk&view=list&site=LAND-PHX-0002", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=outside-filter]");
  await expect(page).not.toHaveURL(/[?&]cats=/);
  await expect(page.locator(".chip.removable", { hasText: /^Land$/ })).toHaveCount(0);
  const after = Number(await page.locator(".shell").getAttribute("data-list-count"));
  expect(after).toBeLessThanOrEqual(before + 1);
  expect(after).toBeGreaterThan(before - 1);
});
