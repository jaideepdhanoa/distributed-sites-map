import { expect, test, type Page, type Route } from "@playwright/test";

const viewports = [
  { width: 1280, height: 1072, project: "desktop" },
  { width: 390, height: 844, project: "mobile" },
] as const;

async function failActions(page: Page) {
  const down = (route: Route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down" }) });
  await page.route("**/api/queue**", down);
  await page.route("**/api/actions/accounts**", down);
  await page.route("**/api/data/spaces**", down);
}

async function topInView(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  const viewport = page.viewportSize();
  expect(box, selector).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(viewport!.height);
}

for (const size of viewports) {
  test(`map and list stay in view when discussion is down at ${size.width}x${size.height}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await failActions(page);
    await page.goto("/?funnel=pipeline&city=PHX", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Discussion is unavailable on this preview")).toBeVisible();
    await expect(page.getByTestId("view-help")).toHaveCount(0);
    await topInView(page, ".map-stage");
    await page.goto("/?funnel=pipeline&city=PHX&view=list", { waitUntil: "domcontentloaded" });
    await topInView(page, "[data-testid=pipeline-list]");
  });
}


test("the phone funnel keeps the service-area split off the listed line", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone funnel");
  await page.goto("/?funnel=universe&reach=within5", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await page.locator("button.phone-step").click();
  await expect(page.getByTestId("service-area-split")).toBeVisible();
  const problem = await page.evaluate(() => {
    const step = [...document.querySelectorAll(".funnel .step")].find((el) => /Service area/.test(el.textContent || ""));
    const split = step?.querySelector("[data-testid=service-area-split]");
    const listed = [...(step?.querySelectorAll(".sub") || [])].find((el) => /listed/.test(el.textContent || ""));
    const row = document.querySelector(".funnel-row");
    const head = row?.querySelector(".funnel-sheet-head");
    const close = head?.querySelector(".close");
    const first = row?.querySelector(".funnel .step");
    if (!step || !split || !listed || !row || !head || !close || !first) return "missing funnel pieces";
    const splitBox = split.getBoundingClientRect();
    const listedBox = listed.getBoundingClientRect();
    const overlap = Math.min(splitBox.bottom, listedBox.bottom) - Math.max(splitBox.top, listedBox.top);
    if (overlap > 1) return `split covers listed by ${Math.round(overlap)}px`;
    if (listedBox.top < splitBox.bottom + 2) return `listed is ${Math.round(listedBox.top - splitBox.bottom)}px under the split`;
    const headBox = head.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    if (closeBox.bottom > firstBox.top + 1) return "close overlaps the first step";
    if (closeBox.top < headBox.top - 1 || closeBox.bottom > headBox.bottom + 1) return "close sits outside the sheet header";
    if (headBox.right - closeBox.right > 20) return "close is not aligned to the header edge";
    if (closeBox.width > 48 || closeBox.height > 48) return `close is ${Math.round(closeBox.width)} by ${Math.round(closeBox.height)}`;
    const bar = document.querySelector(".bar");
    if (!bar) return "missing header";
    const paint = getComputedStyle(bar);
    if (paint.backgroundImage.includes("gradient")) return "header fades over the map";
    const ask = document.querySelector(".ask-launch");
    if (!ask) return "missing Ask";
    const askBox = ask.getBoundingClientRect();
    const overAsk = document.elementFromPoint(askBox.left + askBox.width / 2, askBox.top + askBox.height / 2);
    const atEdge = document.elementFromPoint(4, 24);
    const canvas = (node: Element | null) => Boolean(node?.closest(".maplibregl-map, canvas"));
    if (canvas(overAsk)) return "a map mark covers Ask";
    if (canvas(atEdge)) return "a map mark shows through the header edge";
    return "";
  });
  expect(problem).toBe("");
});

test("the desk list keeps the location note out of the stage tabs", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop list");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline&pstage=desk&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  await expect(page.locator("nav.funnel").getByText("without a location")).toHaveCount(0);
  const note = page.getByTestId("unmapped-note");
  if (await note.count()) {
    await expect(note).toBeVisible();
    await expect(note).toContainText("without a location");
  }
  const mark = page.locator("[data-testid=pipeline-list] [data-testid=suggested-drop]").first();
  await expect(mark).toBeVisible();
  await expect(mark).not.toContainText("Suggested drop:");
  await expect(mark).not.toContainText("…");
  const full = await mark.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(full).toBe(true);
});

test("phone chrome stays inside the viewport and the map pill sits in its track", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone widths");
  for (const width of [363, 390, 560]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?funnel=pipeline&site=PIPE-PHX-0014", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    await page.waitForSelector(".drawer-scroll");
    await page.waitForSelector(".phone-view-row .map-switch button.on");
    const fit = await page.evaluate(() => {
      const doc = document.documentElement;
      const track = document.querySelector(".phone-view-row .funnel-switch.map-switch");
      const pill = track?.querySelector("button.on");
      const neighbor = document.querySelector(".phone-view-row select.secondary");
      const sheet = document.querySelector(".drawer-scroll");
      const city = document.querySelector(".phone-view-row .city-pick select");
      const search = document.querySelector(".phone-view-row .mobile-search");
      const menu = document.querySelector(".phone-view-row .icon-btn");
      const row = document.querySelector(".phone-view-row");
      if (!track || !pill || !neighbor || !sheet || !city || !search || !menu || !row) {
        return { missing: true, overflow: 0, sheet: 0, past: 0, top: 0, bottom: 0, left: 0, gap: 0, trackH: 0, neighborH: 0, sameRow: false, compact: false, tap: 0 };
      }
      const trackBox = track.getBoundingClientRect();
      const pillBox = pill.getBoundingClientRect();
      const neighborBox = neighbor.getBoundingClientRect();
      const cityBox = city.getBoundingClientRect();
      const searchBox = search.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const list = track.querySelectorAll("button")[1]?.getBoundingClientRect();
      const tops = [cityBox.top, trackBox.top, searchBox.top, menuBox.top];
      const past = [...document.querySelectorAll(".top > *, .phone-view-row > *")].filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) return false;
        return box.right > doc.clientWidth + 1 || box.left < -1;
      }).length;
      return {
        missing: false,
        overflow: doc.scrollWidth - doc.clientWidth,
        sheet: sheet.scrollWidth - sheet.clientWidth,
        past,
        top: pillBox.top - trackBox.top,
        bottom: trackBox.bottom - pillBox.bottom,
        left: pillBox.left - trackBox.left,
        gap: list ? list.left - pillBox.right : -1,
        trackH: trackBox.height,
        neighborH: neighborBox.height,
        sameRow: Math.max(...tops) - Math.min(...tops) <= 4,
        compact: cityBox.width < rowBox.width * 0.6,
        tap: Math.min(cityBox.height, searchBox.height, searchBox.width, menuBox.height, menuBox.width),
      };
    });
    expect(fit.missing, `${width}px layout`).toBe(false);
    expect(fit.overflow, `${width}px document overflow`).toBeLessThanOrEqual(0);
    expect(fit.sheet, `${width}px sheet overflow`).toBeLessThanOrEqual(1);
    expect(fit.past, `${width}px chrome past the edge`).toBe(0);
    expect(fit.top).toBeGreaterThanOrEqual(2);
    expect(Math.abs((fit.top ?? 0) - (fit.bottom ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((fit.top ?? 0) - (fit.left ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((fit.top ?? 0) - (fit.gap ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((fit.trackH ?? 0) - (fit.neighborH ?? 0))).toBeLessThanOrEqual(1);
    expect(fit.sameRow, `${width}px city, map, search, and menu share a row`).toBe(true);
    expect(fit.compact, `${width}px city pill stays compact`).toBe(true);
    expect(fit.tap, `${width}px tap targets`).toBeGreaterThanOrEqual(40);
  }
});

test("the desktop map pill sits inside its track", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop chrome");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".top .map-switch button.on");
  const fit = await page.evaluate(() => {
    const doc = document.documentElement;
    const track = document.querySelector(".top .funnel-switch.map-switch");
    const pill = track?.querySelector("button.on");
    if (!track || !pill) return { missing: true, overflow: 0, top: 0, bottom: 0, left: 0, gap: 0 };
    const trackBox = track.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const list = track.querySelectorAll("button")[1]?.getBoundingClientRect();
    return {
      missing: false,
      overflow: doc.scrollWidth - doc.clientWidth,
      top: pillBox.top - trackBox.top,
      bottom: trackBox.bottom - pillBox.bottom,
      left: pillBox.left - trackBox.left,
      gap: list ? list.left - pillBox.right : -1,
    };
  });
  expect(fit.missing).toBe(false);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  await expect(page.locator(".top .search-wrap")).toBeVisible();
  await expect(page.locator(".phone-view-row")).toBeHidden();
  const shared = await page.evaluate(() => {
    const word = document.querySelector(".top .word");
    const search = document.querySelector(".top .search-wrap");
    if (!word || !search) return false;
    return Math.abs(word.getBoundingClientRect().top - search.getBoundingClientRect().top) < 8;
  });
  expect(shared).toBe(true);
  expect(fit.top).toBeGreaterThanOrEqual(1);
  expect(Math.abs((fit.top ?? 0) - (fit.bottom ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((fit.top ?? 0) - (fit.left ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((fit.top ?? 0) - (fit.gap ?? 0))).toBeLessThanOrEqual(1);
});
