import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { sampleStatement } from "../lib/pnl/fixture";

test.beforeAll(() => {
  fs.mkdirSync("review-shots", { recursive: true });
});

test("desktop profit and loss is a full-width sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop pnl");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/financials/preview", { waitUntil: "networkidle" });
  await page.getByTestId("preview-revenue").click();
  const overlay = page.getByTestId("pnl-overlay");
  const sheet = page.getByTestId("pnl-sheet");
  await expect(sheet).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box?.width || 0).toBeGreaterThan(1000);
  await expect(sheet.getByRole("columnheader", { name: "Jan" })).toBeVisible();
  await expect(page.getByTestId("pnl-legend")).toContainText("Hatched = month not in package");
  await expect(page.getByTestId("pnl-legend")).toContainText("annual from statement");
  const statementHeader = sheet.getByRole("columnheader", { name: "FY2024 (statement)" });
  await expect(statementHeader).toBeVisible();
  await expect(statementHeader).toContainText("FY2024");
  await expect(statementHeader).toContainText("statement");
  const headerFit = await statementHeader.evaluate((node) => {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    return {
      clipped: el.scrollWidth > el.clientWidth + 1,
      ellipsis: style.textOverflow,
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
  expect(headerFit.clipped).toBe(false);
  expect(headerFit.ellipsis).not.toBe("ellipsis");
  expect(headerFit.text.replace(/\s/g, "")).toBe("FY2024statement");
  expect(headerFit.text.includes("…")).toBe(false);
  await sheet.locator("thead").screenshot({ path: "review-shots/pnl-statement-header.png" });
  await expect(sheet.locator("td.is-missing").first()).toHaveAttribute("title", "Missing · Sample package · Month index");
  await expect(sheet.locator("td.is-missing").first()).toContainText("Missing");
  await expect(overlay).not.toContainText("T15:00:00");
  const labor = sheet.getByRole("row", { name: /^Labor/ }).locator("td", { hasText: "$10,000" });
  await labor.click();
  const popover = page.getByTestId("pnl-popover");
  await expect(popover).toContainText("Captured Mar 1, 2026");
  await expect(popover).toContainText("Sample package");
  await expect(popover).toContainText("Jan");
  await expect(popover).toContainText("Reported");
  await expect(popover).not.toContainText("T15:00:00");
  const source = popover.getByRole("link", { name: "Sample package ↗" });
  await expect(source).toHaveAttribute("href", "https://drive.google.com/file/d/FixtureDriveFileId0000000001/view");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(popover).not.toContainText("/folders/");
  await popover.screenshot({ path: "review-shots/pnl-popover-desktop.png" });
  await popover.getByRole("button", { name: "Close line source" }).click();
  await expect(popover).toBeHidden();
  await expect(labor).toBeFocused();
  await labor.click();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(labor).toBeFocused();
  await expect(overlay).toBeVisible();
  await labor.click();
  await overlay.getByRole("button", { name: "Dollars" }).click();
  await expect(popover).toBeHidden();
  const first = sheet.locator("[data-cell='0:0']");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sheet.locator("[data-cell='0:1']")).toBeFocused();
  await page.getByRole("button", { name: "Years" }).click();
  await expect(sheet.getByRole("columnheader", { name: "2024" })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: "Jan" })).toHaveCount(0);
  await sheet.getByRole("row", { name: /^Labor/ }).locator("td").first().click();
  await expect(page.getByTestId("pnl-popover")).toBeVisible();
  await overlay.getByRole("button", { name: "Close profit and loss" }).click();
  await expect(overlay).toBeHidden();
});

test("a phone profit and loss stays a compact period list", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone pnl");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/financials/preview", { waitUntil: "networkidle" });
  await page.getByTestId("preview-revenue").click();
  await expect(page.getByTestId("pnl-phone")).toBeVisible();
  await expect(page.getByTestId("pnl-sheet")).toBeHidden();
  const summary = page.getByTestId("pnl-summary");
  await expect(summary).toContainText("Revenue");
  await expect(summary).toContainText("EBITDA");
  await expect(summary).toContainText("$90,000");
  await expect(page.getByRole("button", { name: "Feb · Missing" })).toBeVisible();
  await expect(page.getByTestId("pnl-overlay")).not.toContainText("T15:00:00");
  await page.getByRole("button", { name: /Chemicals/ }).click();
  const detail = page.getByTestId("pnl-popover");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveClass(/is-sheet/);
  const box = await detail.boundingBox();
  expect((box?.y || 0) + (box?.height || 0)).toBeGreaterThan(700);
  await expect(detail).toContainText("Captured Mar 1, 2026");
  await expect(page.getByTestId("pnl-period-label")).toContainText("Mar 2024");
  await expect(page.getByRole("button", { name: /Labor/ })).toContainText("Not in package");
  await expect(detail).toContainText("5–7%");
  await expect(detail).not.toContainText("T15:00:00");
  await expect(detail.getByRole("button", { name: "Close line source" })).toBeVisible();
  await page.screenshot({ path: "review-shots/pnl-phone-sheet.png" });
  await detail.screenshot({ path: "review-shots/pnl-popover-phone.png" });
  await detail.getByRole("button", { name: "Close line source" }).click();
  await expect(detail).toBeHidden();
});

test("phone overview tiles name a missing line when a package is on file", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone overview");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline&site=PIPE-PHX-0084&sheet=full", { waitUntil: "domcontentloaded" });
  const numbers = page.getByTestId("card-numbers");
  await numbers.scrollIntoViewIfNeeded();
  const revenue = numbers.locator("div").filter({ hasText: "Revenue" }).first();
  const cash = numbers.getByTestId("overview-cash");
  await expect(revenue.locator("strong")).toHaveText("Not in package");
  await expect(cash.locator("strong")).toHaveText("Not in package");
  await expect(revenue).not.toContainText("Not on file");
  await expect(cash).not.toContainText("Not on file");
  await numbers.screenshot({ path: "review-shots/pnl-phone-tiles.png" });

  await page.goto("/?funnel=pipeline&site=PIPE-PHX-0004&sheet=full", { waitUntil: "domcontentloaded" });
  const empty = page.getByTestId("card-numbers");
  await empty.scrollIntoViewIfNeeded();
  await expect(empty.locator("div").filter({ hasText: "Revenue" }).first().locator("strong")).toHaveText("—");
  const emptyCash = empty.getByTestId("overview-cash");
  await expect(emptyCash.locator("strong")).toHaveText("—");
  await expect(emptyCash).toContainText("Not on file");
});

test("a P&L comment is a cell pin, not a row link", async ({ page }, info) => {
  const comments: { type: "pnl_cell"; line: string; period: string }[] = [];
  await page.route("**/api/data/financials/PIPE-LAS-0011", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pnl: sampleStatement(), pnlDemo: false, comments }),
    });
  });
  await page.route("**/api/changes", async (route) => {
    const body = route.request().postDataJSON() as {
      changes?: { entity_type?: string; payload?: { anchor?: { type?: string; line?: string; period?: string } } }[];
    };
    const change = body.changes?.[0];
    const anchor = change?.payload?.anchor;
    if (change?.entity_type === "comment" && anchor?.type === "pnl_cell" && anchor.line) {
      comments.push({ type: "pnl_cell", line: anchor.line, period: anchor.period || "" });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results: [{ entity_id: "NT-000001", version: 1 }] }),
    });
  });
  const mobile = info.project.name === "mobile";
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?funnel=pipeline&site=PIPE-LAS-0011&panel=numbers${mobile ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("financials-entry").click();
  const overlay = page.getByTestId("pnl-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".text-link", { hasText: "Comment" })).toHaveCount(0);
  if (mobile) await page.getByRole("button", { name: /Labor/ }).click();
  else await overlay.getByRole("row", { name: /^Labor/ }).locator("td", { hasText: "$10,000" }).click();
  const popover = page.getByTestId("pnl-popover");
  const icon = popover.getByTestId("pnl-cell-comment");
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("title", "Comment");
  await icon.click();
  const sheet = page.getByTestId("comment-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByTestId("comment-body").fill("The labor cell needs a second look.");
  await sheet.getByRole("button", { name: "Comment", exact: true }).click();
  await sheet.getByRole("button", { name: "Close comment thread" }).click();
  await expect(sheet).toBeHidden();
  if (mobile && await popover.isVisible()) {
    await popover.getByRole("button", { name: "Close line source" }).click();
  }
  const surface = mobile ? page.getByTestId("pnl-phone") : overlay.locator(".pnl-desktop");
  const pin = surface.getByTestId("pnl-cell-pin").first();
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(page.getByTestId("comment-sheet")).toBeVisible();
});

test("the sample site overview uses the same P&L as the Financials card", async ({ page }) => {
  await page.route("**/api/data/financials/PIPE-LAS-0011", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pnl: sampleStatement(), pnlDemo: true }),
    });
  });
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?funnel=pipeline&site=PIPE-LAS-0011&panel=numbers${mobile ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  const numbers = page.getByTestId("card-numbers");
  await numbers.scrollIntoViewIfNeeded();
  const revenue = numbers.locator("div").filter({ hasText: "Revenue" }).first();
  const cash = numbers.getByTestId("overview-cash");
  await expect(revenue.locator("strong")).toHaveText("$1,000,000");
  await expect(revenue).toContainText("FY2024");
  await expect(revenue).toContainText("2 of 12 months");
  await expect(cash.locator("strong")).toHaveText("$520,000");
  await expect(cash).toContainText("SDE");
  await expect(cash).toContainText("2 of 12 months");
  await expect(revenue).not.toContainText("Not on file");
  await expect(cash).not.toContainText("Not on file");
  const entry = page.getByTestId("financials-entry");
  await expect(entry).toContainText("$1,000,000 revenue");
  await expect(entry).toContainText("SDE $520,000");
  await expect(entry).toContainText("FY2024 · 2 of 12 months · Sample package");
  await expect(page.locator(".month-coverage abbr[data-present=true]")).toHaveCount(2);
  await page.getByRole("button", {name:"View SDE line"}).click();
  const linked = page.locator(mobile ? ".pnl-phone-line[data-linked=true] button" : ".pnl-desktop td[data-linked=true]").first();
  await expect(linked).toContainText("$520,000");
  await page.getByRole("button", {name:"Close profit and loss"}).click();
  const numbersList = page.locator("#panel-numbers .kv");
  await expect(numbersList).toContainText("$1,000,000");
  await expect(numbersList).toContainText("$520,000");
  await expect(numbersList).toContainText("2 of 12 months");
  await expect(numbersList).not.toContainText("Not on file");
  await page.goto(`/?funnel=pipeline&site=LAS-U858${mobile ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  const siteDrawer = page.locator("aside.drawer[data-record='LAS-U858']");
  await siteDrawer.waitFor({ state: "attached", timeout: 45_000 });
  const siteNumbers = siteDrawer.getByTestId("card-numbers");
  await expect(siteNumbers.locator("div").filter({ hasText: "Revenue" }).first().locator("strong")).toHaveText("$1,000,000");
  await expect(siteNumbers.getByTestId("overview-cash").locator("strong")).toHaveText("$520,000");
  await expect(page.getByTestId("financials-entry")).toContainText("SDE $520,000");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a financial check leads with statement coverage and opens its evidence", async ({ page }) => {
  const id = "PIPE-MIA-0080";
  await page.route("**/api/data/deals", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const deal = payload.features.find((item: { properties: { deal_id: string } }) => item.properties.deal_id === id);
    deal.properties.stage_blocker = "Review the financial statement.";
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/api/data/financials/${id}`, route => route.fulfill({ json: { pnl: sampleStatement(), pnlDemo: true } }));
  await page.goto(`/?funnel=pipeline&site=${id}&sheet=full`, { waitUntil: "domcontentloaded" });
  const brief = page.getByRole("region", { name: "Screening decision" });
  await expect(brief.getByText("Statement coverage", { exact: true })).toBeInViewport();
  await expect(brief).toContainText("Sample package");
  await brief.getByRole("button", { name: "Open P&L" }).click();
  await expect(page.getByRole("dialog", { name: "Profit and loss" })).toBeVisible();
});

test("screen power evidence and trace acquisition pricing", async ({page}) => {
  const id = "PIPE-LAS-0011";
  await page.route("**/api/data/deals", async route => {
    const response = await route.fetch();
    const data = await response.json();
    const row = data.features.find((item: {properties:{deal_id:string}}) => item.properties.deal_id === id);
    Object.assign(row.properties, {name:"Juniper Wash", address:"Illustrative site", stage_group:"desk",
      stage_blocker:"Confirm on-site power.", decision_reason:"", next_step:"", kind:"pipeline",
      cap_c_amps:null, cap_c_volts:null, cap_c_phase:null, cap_c_panels:null, cap_b_frontage:2.1,
      cap_b_source:"Utility hosting map", cap_b_confidence:"Estimated", saving_vs_hub:"18%"});
    await route.fulfill({response,json:data});
  });
  await page.route("**/api/actions/status", route => route.fulfill({json:{enabled:true,actionRole:"viewer"}}));
  await page.route("**/api/actions/comparison-evidence?*", route => {
    expect(new URL(route.request().url()).searchParams.get("measure")).toBe("power");
    return route.fulfill({json:{followUp:null,accounts:[]}});
  });
  await page.goto("/?funnel=pipeline&site="+id);
  const brief = page.getByRole("region",{name:"Screening decision"});
  const action = brief.getByRole("button",{name:"Open power follow-up"});
  await expect(action).toBeInViewport();
  await action.click();
  await expect(page.getByRole("dialog")).toContainText("No open follow-up");
  await page.getByRole("button",{name:"Close evidence request"}).click();
  await page.getByRole("tab",{name:"Site fit"}).click();
  await expect(page.locator(".power-evidence")).toContainText("On-site capacity unconfirmed");
  await expect(page.locator(".power-evidence")).toContainText("2.1 MW");
  await page.getByRole("tab",{name:"Financials"}).click();
  await expect(page.getByTestId("pricing")).toBeVisible();
  await expect(page.locator(".investment-economics")).toContainText("18%");
  await expect(page.locator(".investment-economics")).toContainText("Implied business price");
});

test("power follow-up stays with the selected map pin", async ({ page }, info) => {
  // Isolate the pin workflow from the external basemap tile service.
  await page.route("https://tiles.openfreemap.org/styles/positron",route=>route.fulfill({json:{version:8,
    glyphs:"https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",sources:{},
    layers:[{id:"background",type:"background",paint:{"background-color":"#f2ede4"}}]}}));
  await page.route("https://demotiles.maplibre.org/**",route=>route.fulfill({contentType:"application/x-protobuf",body:""}));
  await page.route("**/api/data/deals", async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    for (const {properties} of catalog.features) Object.assign(properties, {
      name:"Example service site", address:"Example parcel", stage_group:"desk", stage_blocker:"Confirm on-site power.", kind:"pipeline",
    });
    await route.fulfill({response,json:catalog});
  });
  await page.route("**/api/actions/status", route => route.fulfill({json:{enabled:true,actionRole:"viewer"}}));
  await page.route("**/api/actions/comparison-evidence?*", route => route.fulfill({json:{accounts:[],followUp:{
    note:"note-sample",status:"accepted",owner:"Field team",due:"2030-03-15",targetKind:"site",targetId:"example-site",
  }}}));
  await page.route("**/api/actions/notes?*", route => route.fulfill({json:{notes:[{
    id:"note-sample",body:"Confirm service at the parcel.",authorId:"reviewer",createdAt:"2026-01-02T12:00:00+00:00",mentions:[],
  }]}}));
  await page.goto("/?city=PHX&funnel=pipeline&pstage=all");
  const nearby = page.getByRole("complementary",{name:"Nearby sites"});
  const toggle = nearby.getByRole("button",{name:/^Nearby sites/});
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await nearby.locator("[data-nearby-id]").first().click();
  const pin = page.locator(".map-preview");
  const id = await pin.getAttribute("data-record");
  const camera = () => page.evaluate(() => {
    const map = (window as unknown as {__sitesMap:import("maplibre-gl").Map}).__sitesMap;
    return [...map.getCenter().toArray(),map.getZoom()];
  });
  await page.waitForFunction(() => !(window as unknown as {__sitesMap:import("maplibre-gl").Map}).__sitesMap.isMoving());
  const original = await camera();
  await pin.getByRole("button",{name:"Open power follow-up"}).click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet).toContainText("Field team · Due 2030-03-15");
  await sheet.getByRole("button",{name:"View follow-up"}).click();
  await expect(sheet.locator("[data-note-id=note-sample]")).toContainText("Confirm service at the parcel.");
  await sheet.screenshot({path:"review-shots/"+info.project.name+"-linked-power.png"});
  await sheet.getByRole("button",{name:"Close evidence request"}).click();
  await expect(pin).toHaveAttribute("data-record",id!);
  await expect.poll(camera).toEqual(original);
});
