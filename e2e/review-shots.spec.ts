import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { cityPipelineCounts } from "./pipeline-counts";

async function showFunnel(page: Page, project: string) {
  if (project === "mobile") await page.locator(".phone-step").click();
  await expect(page.locator("nav.funnel")).toBeVisible();
}

async function waitForBasemap(page: Page) {
  await page.waitForSelector(".maplibregl-canvas");
  await page.evaluate(() => new Promise<void>((resolve) => {
    const map = (window as unknown as { __sitesMap?: { resize: () => void; once: (name: string, fn: () => void) => void } }).__sitesMap;
    if (!map) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    map.resize();
    map.once("idle", finish);
    setTimeout(finish, 2500);
  }));
}

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

test("save review screenshots from the local build", async ({ page }, info) => {
  const name = info.project.name;
  await page.goto("/?funnel=universe&stage=in_area&site=PHX-U189", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  const drawer = page.locator("aside.drawer");
  await expect(drawer).toContainText("Magic Hand Car Wash");
  await expect(drawer).toContainText("Lead source");
  await expect(drawer).toContainText("Census site");
  await expect(drawer).toContainText("County record not reviewed");
  await page.screenshot({ path: `review-shots/${name}-site-panel.png`, fullPage: false });
  if (name === "mobile") {
    await page.goto("/?funnel=universe&stage=in_area&site=PHX-U189&sheet=full", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("aside.drawer");
  }
  const record = page.locator("aside.drawer");
  await record.locator("summary.disclosure", { hasText: "Record" }).click();
  await expect(record).toContainText("PHX-U189");
  await page.goto("/?funnel=universe&stage=in_area", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  await expect(page.locator("nav.funnel")).toContainText("Universe");
  if (name === "mobile") {
    const header = await page.evaluate(() => {
      const city = document.querySelector(".phone-view-row .city-pick select");
      const search = document.querySelector(".phone-view-row .mobile-search");
      const menu = document.querySelector(".phone-view-row [aria-label='Menu']");
      const filters = document.querySelector(".phone-view-row [aria-label='Filters']");
      const row = document.querySelector(".phone-view-row");
      if (!city || !search || !menu || !filters || !row) return "the phone header is missing a control";
      if (row.querySelector(".reach-pick")) return "service area is still in the header";
      const tops = [city, search, filters, menu].map((node) => node.getBoundingClientRect().top);
      if (Math.max(...tops) - Math.min(...tops) > 4) return "the header controls wrapped";
      const cityBox = city.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (rowBox.height > 60) return "the phone header has a third row";
      if (cityBox.width > rowBox.width * 0.6) return "the city pill stretches across the row";
      const filtersBox = filters.getBoundingClientRect();
      if (cityBox.height < 40 || search.getBoundingClientRect().height < 40 || menu.getBoundingClientRect().width < 40 || filtersBox.width < 40) return "a header control is under 40px";
      return "";
    });
    expect(header).toBe("");
  } else {
    await expect(page.locator(".top .search-wrap")).toBeVisible();
    await expect(page.locator(".phone-view-row")).toBeHidden();
  }
  await page.screenshot({ path: `review-shots/${name}-universe-bar.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await showFunnel(page, name);
  await waitForBasemap(page);
  const counts = cityPipelineCounts("PHX");
  const desk = page.locator("nav.funnel .step").filter({ hasText: "Desk screen" });
  await expect(desk.locator("strong")).toHaveText(String(counts.deskDeals));
  await expect(page.getByTestId("land-beside-desk")).toHaveCount(0);
  const chipText = async () => page.locator(".summary-chip").first().textContent();
  await expect.poll(chipText).toContain("on the map ·");
  await expect.poll(chipText).toContain("dropped, hidden");
  await page.screenshot({ path: `review-shots/${name}-pipeline.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pipeline-list");
  if (name !== "mobile") {
    await expect(page.locator(".pipeline-list thead th")).toHaveCount(10);
    await expect(page.locator(".pipeline-list thead")).toContainText("County check");
    const overflow = await page.locator(".pipeline-list .list-scroll").evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } else {
    await expect(page.getByTestId("phone-cards")).toBeVisible();
    await expect(page.getByTestId("search-area")).toHaveCount(0);
    const cardGaps = await page.locator("[data-testid=phone-cards] button.list-row").first().evaluate((node) => {
      const stage = node.querySelector(".phone-card-stage")?.getBoundingClientRect();
      const meta = node.querySelector(".phone-card-meta")?.getBoundingClientRect();
      const sep = node.querySelector(".phone-sep");
      const sepStyle = sep ? getComputedStyle(sep) : null;
      return {
        stageGap: stage && meta ? meta.top - stage.bottom : -1,
        sepSpace: sepStyle ? parseFloat(sepStyle.marginLeft) + parseFloat(sepStyle.marginRight) : 0,
        bareMissing: /Not on file/.test(node.textContent || ""),
      };
    });
    expect(cardGaps.stageGap).toBeGreaterThanOrEqual(4);
    expect(cardGaps.sepSpace).toBeGreaterThanOrEqual(12);
    expect(cardGaps.bareMissing).toBe(false);
  }
  await page.screenshot({ path: `review-shots/${name}-list.png`, fullPage: false });
  await page.goto("/?funnel=universe&view=list&city=PHX", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".list-pane");
  if (name !== "mobile") {
    await expect(page.locator(".list-pane thead")).toContainText("County check");
    await expect(page.getByTestId("type-chip").first()).toBeVisible();
  } else {
    const cards = page.getByTestId("phone-cards");
    await expect(cards).toBeVisible();
    await expect(page.getByRole("heading", { name: "Phoenix · Open land" })).toBeVisible();
    await expect(page.locator(".shortlist-heading")).toContainText("Universe");
    await expect(cards.getByTestId("stage-chip")).toHaveCount(0);
    await expect(cards.locator(".phone-card-meta").first()).toContainText(/listed|listing/i);
  }
  await page.screenshot({ path: `review-shots/${name}-universe-list.png`, fullPage: false });
  await page.goto("/?newlist=1&city=PHX&site=L-239", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  await expect(page.locator("aside.drawer")).toContainText("Listed, not yet screened");
  await expect(page.locator("aside.drawer")).toContainText("Crexi");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
  await page.screenshot({ path: `review-shots/${name}-unscreened.png`, fullPage: false });
  await page.goto("/?funnel=pipeline&city=PHX&pstage=desk", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (name === "mobile") {
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByTestId("basemap")).toBeVisible();
  } else {
    await expect(page.getByTestId("basemap-desktop")).toBeVisible();
  }
  const layers = page.locator("aside.layers.open");
  await expect(layers).toBeVisible();
  await layers.screenshot({ path: `review-shots/${name}-layers.png` });
  const closeLayers = page.getByRole("button", { name: "Close layers" });
  if (await closeLayers.isVisible()) await closeLayers.click();
  await page.goto(`/?funnel=pipeline&site=PIPE-MIA-0080${name === "mobile" ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  await waitForBasemap(page);
  const stars = page.locator("aside.drawer");
  await expect(stars).toContainText("Stars & Stripes");
  await expect(stars).toContainText("Financial screen");
  const step = stars.getByTestId("workbook-step");
  await expect(step).toBeVisible();
  const more = step.getByRole("button", { name: "Show full note" });
  if (await more.count()) await more.click();
  await expect(step).toContainText("POS/car counts");
  await expect(stars).toContainText("Last contact Nov 6");
  await page.locator(".drawer-scroll").evaluate((node) => { node.scrollTop = 0; });
  await expect(stars.locator("h2")).toBeInViewport();
  await page.screenshot({ path: `review-shots/${name}-mia-0080.png`, fullPage: false });
});

test("screening queue separates court, owner and due date on both layouts", async ({ page }, info) => {
  const queue = [
    { nda_id: "NDA-910", counterparty_firm: "Sample agreement A", court: "us", court_pill: "Our court", days_court: 2, owner: "", stage: "draft", next_step: "Review draft", next_step_due: "2000-01-01" },
    { nda_id: "NDA-911", counterparty_firm: "Sample agreement B", court: "them", court_pill: "Their court", days_court: 30, owner: "reviewer", stage: "draft", next_step: "", next_step_due: "" },
  ];
  await page.route("**/api/data/nda", route => route.fulfill({ json: { queue } }));
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  const panel = page.getByTestId("nda-queue");
  await expect(panel.getByRole("heading", { name: "Overdue" })).toBeVisible();
  const rows = panel.locator(".nda-row");
  await expect(rows.first()).toContainText("Sample agreement A");
  await expect(rows.last()).toContainText("Sample agreement B");
  await panel.getByLabel("Owner", { exact: true }).selectOption("unassigned");
  await expect(rows).toHaveCount(1);
  await panel.getByRole("tab", { name: /^Their court/ }).click();
  await expect(panel.getByText("No agreements match these filters.")).toBeVisible();
  await panel.getByRole("button", { name: "Clear NDA filters" }).click();
  await expect(rows).toHaveCount(2);
  await panel.screenshot({ path: `review-shots/${info.project.name}-screening-queue.png` });
});

test("an incomplete search can recover without losing the query", async ({ page }, info) => {
  let available = false;
  await page.route("**/api/search?*", route => route.fulfill(available
    ? { json: { mode: "index", groups: { sites: [], brokers: [], conversations: [] } } }
    : { status: 503, json: {} }));
  await page.goto("/?view=list&funnel=pipeline", { waitUntil: "domcontentloaded" });
  const trigger = page.getByTestId("scope-search").filter({ visible: true }).first();
  await trigger.click();
  const dialog = page.getByTestId("command-search");
  const input = dialog.getByRole("textbox");
  await input.fill("zzqfixture");
  await expect(dialog.getByRole("status")).toContainText("Full search is unavailable");
  await dialog.screenshot({ path: `review-shots/${info.project.name}-screening-search.png` });
  available = true;
  await dialog.getByRole("button", { name: "Retry search" }).click();
  await expect(input).toHaveValue("zzqfixture");
  await expect(dialog.getByTestId("command-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("screen five sites in Phoenix and return to the same selection", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  await page.goto("/?funnel=universe&view=list&city=PHX&stage=land&sort=site:asc", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Phoenix · Open land" })).toBeVisible();
  const rows = page.locator(".pipeline-list [data-site-row]");
  await expect(rows.nth(4)).toBeVisible();
  const firstFive = async () => rows.evaluateAll(elements => elements.slice(0, 5).map(element => element.getAttribute("data-site-row")));
  const before = await firstFive();
  const box = await rows.first().boundingBox();
  expect(box).toBeTruthy();
  console.log(`Shortlist first row at ${Math.round(box!.y)} CSS px (${info.project.name})`);
  expect(box!.y).toBeLessThan(phone ? 255 : 340);
  if (phone) {
    await page.getByRole("button", { name: "More list actions" }).click();
    await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  }
  for (const i of [0, 1]) await rows.nth(i).getByRole("checkbox").check();
  await page.getByTestId("selection-bar").getByRole("button", { name: "Compare", exact: true }).click();
  const matrix = page.getByRole("table", { name: "Site comparison" });
  const measureRows = matrix.locator("[data-compare-row]");
  await expect(measureRows.first()).toBeVisible();
  if (phone) {
    const fits = await matrix.evaluate(table => {
      const end = table.querySelector("thead th:last-child")!.getBoundingClientRect().right;
      return end <= table.parentElement!.getBoundingClientRect().right + 1;
    });
    expect(fits, "both sites fit side by side on a phone").toBe(true);
  }
  const compactCount = await measureRows.count();
  expect(compactCount).toBeGreaterThan(0);
  for (const cells of await measureRows.evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll("td"), cell => cell.textContent)))) {
    expect(new Set(cells).size, "the default comparison shows differing values or a one-sided gap").toBeGreaterThan(1);
  }
  await page.getByTestId("compare-tray").screenshot({ path: `review-shots/${info.project.name}-shortlist-compare.png` });
  await page.getByRole("button", { name: "Show all measures" }).click();
  expect(await measureRows.count()).toBeGreaterThan(compactCount);
  for (const name of ["Site fit", "Financials", "Diligence"]) await expect(matrix.getByRole("rowgroup", { name })).toBeAttached();
  await expect(matrix.getByText("Not on file", { exact: true }).first()).toBeAttached();
  await page.getByRole("button", { name: "Show differences" }).click();
  await expect(measureRows).toHaveCount(compactCount);
  await page.getByRole("button", { name: "Close compare" }).click();
  await expect(page.getByTestId("selection-bar").getByRole("button", { name: "Compare", exact: true })).toBeFocused();
  const restored = await firstFive();
  expect(restored.length === 5 && restored.every((id, index) => id === before[index])).toBe(true);
  for (const i of [0, 1]) await expect(rows.nth(i).getByRole("checkbox")).toBeChecked();
});

test("the record shows the action, owner and deadline together", async ({ page }, info) => {
  await page.route("**/api/data/financials/PIPE-MIA-0080", route => route.fulfill({
    json: { workbookStep: { text: "Confirm available power with the utility.", owner: "Site team", due: "2027-01-12" } },
  }));
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-MIA-0080&sheet=full", { waitUntil: "domcontentloaded" });
  const drawer = page.locator("aside.drawer");
  const action = drawer.getByTestId("workbook-step");
  await expect(action).toContainText("Confirm available power");
  await expect(action).toContainText("Site team");
  await expect(action).toContainText("Jan 12");
  await drawer.locator(".drawer-scroll").evaluate(el => { el.scrollTop = 0; });
  const header = await drawer.getByTestId("panel-top").boundingBox();
  const last = await action.boundingBox();
  expect(header && last).toBeTruthy();
  if (header && last) {
    const y = Math.max(0, header.y);
    const bottom = Math.min(page.viewportSize()!.height, last.y + last.height + 8);
    await page.screenshot({ path: `review-shots/${info.project.name}-record-action.png`, clip: {
      x: Math.max(0, header.x), y, width: Math.min(header.width, page.viewportSize()!.width - Math.max(0, header.x)), height: bottom - y,
    } });
  }
});

test("inspect five Phoenix map pins and return to the original view", async ({ page }, info) => {
  type BrowserMap = import("maplibre-gl").Map;
  type TestWindow = Window & { __sitesMap: BrowserMap };
  const path = "/?funnel=universe&stage=in_area&city=PHX";
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForBasemap(page);
  await page.waitForFunction(async () => {
    const source = (window as unknown as TestWindow).__sitesMap?.getSource<import("maplibre-gl").GeoJSONSource>("sites");
    const data = await source?.getData();
    return data?.type === "FeatureCollection" && data.features.length >= 5;
  });
  const pins = await page.evaluate(async () => {
    const source = (window as unknown as TestWindow).__sitesMap.getSource<import("maplibre-gl").GeoJSONSource>("sites")!;
    const data = await source.getData() as {
      type: string;
      features: Array<{ geometry: { type: string; coordinates: number[] } | null; properties: { city?: string; site_id?: string } }>;
    };
    if (data.type !== "FeatureCollection") return [];
    const sites = data.features.flatMap(feature => feature.geometry?.type === "Point" && feature.properties?.city === "PHX"
      ? [{ id: String(feature.properties.site_id), center: feature.geometry.coordinates as [number, number] }] : []);
    const priority = (id: string) => id === "PHX-U189" ? 2 : id === "PHX-U645" ? 1 : 0;
    sites.sort((a, b) => priority(b.id) - priority(a.id));
    return sites.filter((site, i) => !sites.slice(0, i).some(other =>
      Math.abs(other.center[0] - site.center[0]) + Math.abs(other.center[1] - site.center[1]) < 0.002)).slice(0, 5);
  });
  expect(pins.length).toBe(5);
  const camera = () => page.evaluate(() => {
    const map = (window as unknown as TestWindow).__sitesMap;
    return [...map.getCenter().toArray(), map.getZoom()].map(value => Number(value.toFixed(4)));
  });
  for (const [index, pin] of pins.entries()) {
    await page.evaluate(point => {
      (window as unknown as TestWindow).__sitesMap.jumpTo({ center: point, zoom: 15 });
    }, pin.center);
    await page.waitForFunction(({ center, id }) => {
      const map = (window as unknown as TestWindow).__sitesMap;
      const point = map.project(center);
      return map.queryRenderedFeatures(point, { layers: ["sites"] }).some(feature => feature.properties?.site_id === id);
    }, pin);
    const before = await camera();
    const click = await page.evaluate(center => {
      const map = (window as unknown as TestWindow).__sitesMap;
      const rect = map.getContainer().getBoundingClientRect();
      const point = map.project(center);
      return { x: rect.left + point.x, y: rect.top + point.y };
    }, pin.center);
    if (info.project.name === "mobile") await page.touchscreen.tap(click.x, click.y);
    else await page.mouse.click(click.x, click.y);
    const preview = page.locator(".map-preview");
    await expect(preview).toHaveAttribute("data-record", pin.id);
    await expect(page.locator(".selected-pin-name")).toHaveText(await preview.getByRole("heading").innerText());
    const action = preview.getByRole("button", { name: "Open site record" });
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(preview.getByText("Next check", { exact: true })).toBeVisible();
    await expect(preview.locator("dd").last()).not.toBeEmpty();
    if (index === 0) {
      const county = preview.getByRole("link", { name: /Open county record/ });
      const site = await (await page.request.get(`/api/data/sites/${pin.id}`)).json();
      await expect(county).toHaveAttribute("href", new URL(site.county_url).href);
      // Confirm a single tap opens the recorded destination without relying on county uptime.
      await page.context().route(site.county_url, route => route.fulfill({ contentType: "text/plain", body: "Parcel record" }));
      const opened = page.waitForEvent("popup");
      await county.click();
      const parcel = await opened;
      await expect(parcel).toHaveURL(site.county_url);
      await parcel.close();
      await expect(preview).toBeVisible();
      await page.mouse.move(1, 1);
      await waitForBasemap(page);
      if (info.project.name === "mobile") {
        const zoom = await page.locator(".maplibregl-ctrl-zoom-in").boundingBox();
        const tools = await page.locator(".measure-row").boundingBox();
        expect(zoom && tools && tools.x + tools.width <= zoom.x, "map tools leave zoom reachable").toBe(true);
      }
      await page.screenshot({ path: `review-shots/${info.project.name}-map-preview.png` });
    }
    if (pin.id === "PHX-U645") {
      await expect(preview.getByText("County record link not on file.")).toBeVisible();
      await expect(preview.getByRole("link", { name: /Open county record/ })).toHaveCount(0);
    }
    if (index % 2 === 0 || pin.id === "PHX-U645") {
      await action.click();
      const record = page.locator("aside.drawer");
      await expect(record).toHaveAttribute("data-record", pin.id);
      const brief = record.getByRole("region", { name: "Screening decision" });
      await expect(brief).toBeInViewport();
      await expect(record.locator(".card-hero")).toBeAttached();
      if (index === 0) {
        await expect(brief).toContainText("2025");
        const aerial = record.locator("img.hero-aerial");
        if (await aerial.count()) await aerial.evaluate(async img => { await (img as HTMLImageElement).decode(); });
        await page.screenshot({ path: `review-shots/${info.project.name}-record-brief.png` });
      }
      if (info.project.name === "mobile") await expect(record).toHaveClass(/snap-full/);
      await record.getByRole("button", { name: "Close", exact: true }).click();
    } else await preview.getByRole("button", { name: "Close site preview" }).click();
    await expect(page.locator("aside.drawer")).toHaveCount(0);
    await expect.poll(camera).toEqual(before);
    const query = new URL(page.url()).searchParams;
    expect(query.get("city")).toBe("PHX");
    expect(query.get("stage")).toBe("in_area");
    await expect.poll(() => new URL(page.url()).searchParams.has("site")).toBe(false);
  }
});

test("screen a site without a linked county record", async ({ page }, info) => {
  await page.goto("/?funnel=universe&city=PHX&stage=in_area&site=PHX-U645&sheet=full", { waitUntil: "domcontentloaded" });
  const brief = page.getByRole("region", { name: "Screening decision" });
  await expect(brief).toContainText("County record link not on file.");
  await expect(brief).toBeInViewport();
  await brief.screenshot({ path: `review-shots/${info.project.name}-missing-evidence.png` });
});
