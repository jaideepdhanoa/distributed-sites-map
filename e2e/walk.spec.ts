import { expect, test } from "@playwright/test";
import fs from "node:fs";

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

test("unknown or zero open land says it is not on file", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop card");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  const columnsButton = page.getByRole("button", { name: "Columns", exact: true });
  await columnsButton.click();
  const openLand = page.getByRole("group", { name: "Columns", exact: true }).getByRole("checkbox", { name: "Open land", exact: true });
  await openLand.check();
  await columnsButton.click();
  await page.waitForSelector("[data-testid=sheet-grid] td[data-col=openLand]");
  const zeros = await page.locator("[data-testid=sheet-grid] td[data-col=openLand]").evaluateAll((nodes) => nodes.some((node) => /^0 sq ft/i.test((node.textContent || "").trim())));
  expect(zeros).toBe(false);
  const titled = await page.locator(".site-name-text").first().evaluate((node) => {
    const title = node.getAttribute("title") || "";
    const text = (node.textContent || "").trim();
    return Boolean(title) && text.length > 0 && title.includes(text.slice(0, Math.min(12, text.length)));
  });
  expect(titled).toBe(true);
  const missing = page.locator("[data-testid=sheet-grid] td[data-col=openLand]").filter({ hasText: /^Not on file$/ }).first();
  await expect(missing).toBeVisible();
  await missing.click();
  await page.waitForSelector("[data-testid=card-numbers]");
  await page.getByRole("tab", {name:"Site fit",exact:true}).click();
  await page.getByText("Parcel and source readings", {exact:true}).click();
  const land = page.locator("#panel-numbers [data-evidence=open-land] + div");
  await expect(land).toHaveText(/Not on file|—/);
});

test("phone list is one toolbar row of cards and hides search this area", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone list");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=phone-cards]");
  await expect(page.getByTestId("search-area")).toHaveCount(0);
  const fit = await page.evaluate(() => {
    const bar = document.querySelector(".pipeline-list .list-bar");
    const card = document.querySelector("[data-testid=phone-cards] button.list-row");
    const count = document.querySelector(".phone-step [data-testid=scope-count]");
    const sort = bar?.querySelector("[data-testid=sort-control]");
    if (!bar || !card || !count || !sort) return { missing: true, pieces: false, scroll: false, overlap: false, stacked: false, clipped: false };
    const countBox = count.getBoundingClientRect();
    const sortBox = sort.getBoundingClientRect();
    const overlapX = Math.min(countBox.right, sortBox.right) - Math.max(countBox.left, sortBox.left);
    const overlapY = Math.min(countBox.bottom, sortBox.bottom) - Math.max(countBox.top, sortBox.top);
    const labels = Array.from(card.querySelectorAll(".phone-measure b"), el => el.textContent);
    return {
      missing: false,
      pieces: Boolean(card.querySelector(".phone-card-name") && labels.includes("Charging spaces") && labels.includes("Cost per charge")),
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1 || bar.scrollWidth - bar.clientWidth > 1,
      overlap: overlapX > 1 && overlapY > 1,
      stacked: countBox.bottom <= sortBox.top + 1,
      clipped: count.scrollWidth > count.clientWidth + 1,
    };
  });
  expect(fit.missing).toBe(false);
  expect(fit.overlap).toBe(false);
  expect(fit.stacked).toBe(true);
  expect(fit.clipped).toBe(false);
  expect(fit.pieces).toBe(true);
  expect(fit.scroll).toBe(false);
  fs.mkdirSync("review-shots", { recursive: true });
  await page.locator(".pipeline-list .list-bar").screenshot({ path: "review-shots/phone-list-toolbar.png" });
  const firstCard = page.getByTestId("phone-cards").locator("button.list-row").first();
  await firstCard.locator(".phone-card-name").tap();
  await expect(page).toHaveURL(/[?&]site=/);
});

test("phone cards keep gaps between the stage and the facts", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone card gaps");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  const card = page.locator("[data-testid=phone-cards] button.list-row").first();
  await expect(card).toBeVisible();
  await page.locator("[data-testid=phone-cards]").screenshot({ path: "review-shots/mobile-card-gaps.png" });
  const gaps = await card.evaluate((node) => {
    const [spaces, cost] = node.querySelectorAll(".phone-measure");
    const preceding = spaces?.previousElementSibling;
    if (!preceding || !spaces || !cost) return null;
    const spacesBox = spaces.getBoundingClientRect();
    const summary = document.querySelector("[data-testid=summary-row]");
    const tiles = [...(summary?.querySelectorAll(":scope > div") || [])].map((el) => el.getBoundingClientRect());
    const tops = tiles.map((box) => box.top);
    return {
      stageGap: spacesBox.top - preceding.getBoundingClientRect().bottom,
      measureGap: cost.getBoundingClientRect().top - spacesBox.bottom,
      bareMissing: /Not on file/.test(node.textContent || ""),
      summaryHeight: summary?.getBoundingClientRect().height || 0,
      firstCardVisible: node.getBoundingClientRect().bottom <= innerHeight,
      showsCoverage: Boolean(summary?.textContent?.includes("reported")),
      oneRow: tops.length > 1 && Math.max(...tops) - Math.min(...tops) < 4,
      clipped: Boolean(summary && tiles.some((box) => box.right > (summary.getBoundingClientRect().right + 1))),
    };
  });
  expect(gaps).toBeTruthy();
  expect(gaps?.stageGap).toBeGreaterThanOrEqual(4);
  expect(gaps?.measureGap).toBeGreaterThanOrEqual(4);
  expect(gaps?.bareMissing).toBe(false);
  expect(gaps?.clipped).toBe(false);
  expect(gaps?.showsCoverage).toBe(true);
  expect(gaps?.firstCardVisible).toBe(true);
  expect(gaps?.summaryHeight).toBeLessThan(844 * 0.16);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.locator(".shortlist-figures")).toBeVisible();
});

test("signed-in next step and open loops do not show a gmail id", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "signed-in text");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list] tbody tr");
  await page.locator("[data-testid=pipeline-list] tbody tr").first().click();
  await page.waitForSelector("[data-testid=next-step], [data-testid=card-numbers]");
  const leaked = await page.evaluate(() => /\b[0-9a-f]{16}\b/i.test(document.body.innerText));
  expect(leaked).toBe(false);
  const payloadLeak = await page.evaluate(async () => {
    const response = await fetch("/api/data/deals");
    const text = await response.text();
    const withoutLinks = text.replace(/https:\/\/mail\.google\.com\/[^"\\\s]+/g, "");
    return /\b[0-9a-f]{16}\b/i.test(withoutLinks);
  });
  expect(payloadLeak).toBe(false);
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
      short: stamps.every((node) => {
        const text = (node.textContent || "").replace(/^ · /, "").trim();
        return text === "time not recorded" || text.endsWith("(approx.)") || /^[A-Z][a-z]{2} \d{1,2}/.test(text);
      }),
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
  await page.goto("/?funnel=pipeline&city=PHX&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  const before = Number(await page.locator(".shell").getAttribute("data-list-count"));
  await page.goto("/?funnel=pipeline&city=PHX&view=list&site=LAND-PHX-0002", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=outside-filter]");
  await expect(page).not.toHaveURL(/[?&]cats=/);
  await expect(page).not.toHaveURL(/[?&]landlayer=/);
  await page.getByRole("button", { name: "Filters", exact: true }).first().click();
  await expect(page.getByTestId("land-category")).not.toBeChecked();
  await expect(page.locator(".chip.removable", { hasText: /^Land$/ })).toHaveCount(0);
  const after = Number(await page.locator(".shell").getAttribute("data-list-count"));
  expect(after).toBe(before);
  const filterCount = await page.evaluate(() => document.querySelector("[data-testid=map-scope] [data-testid=scope-count]")?.textContent?.replace(/,/g, "").split(" ")[0] || "");
  expect(filterCount).toBe(String(before));
  await expect(page.getByTestId("outside-row")).toBeVisible();
  const cardLeak = await page.evaluate(() => {
    const drawer = document.querySelector("aside.drawer");
    const text = drawer instanceof HTMLElement ? drawer.innerText : "";
    return /\b[0-9a-f]{16}\b/i.test(text);
  });
  expect(cardLeak).toBe(false);
  const covered = await page.evaluate(() => {
    const drawer = document.querySelector("aside.drawer");
    const backdrop = document.querySelector("button.backdrop");
    const heading = drawer?.querySelector("h2");
    if (!drawer || !backdrop || !heading) return true;
    const rect = heading.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 12, rect.top + 8);
    return hit === backdrop || Boolean(backdrop.contains(hit));
  });
  expect(covered).toBe(false);
});

test("the All count matches the list, and a zoomed width uses cards", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "counts and zoom");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&view=list", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-scope").click();
  await page.waitForSelector("[data-testid=all-stages]");
  const counts = await page.evaluate(() => {
    const all = document.querySelector("[data-testid=all-stages] strong")?.textContent?.replace(/,/g, "").trim() || "";
    const shown = document.querySelector("[data-testid=pipeline-list]")?.getAttribute("data-list-count") || "";
    return { all, shown, match: all === shown };
  });
  expect(counts.match).toBe(true);
  await page.setViewportSize({ width: 427, height: 700 });
  await expect(page.getByTestId("phone-cards")).toBeVisible();
  await expect(page.getByTestId("sheet-grid")).toHaveCount(0);
});
