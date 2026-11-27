import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const SITE = "PIPE-PHX-0014";

function shotPath(name: string) {
  fs.mkdirSync("review-shots", { recursive: true });
  return `review-shots/${name}.png`;
}

async function username(page: Page) {
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    if (!response.ok) return "";
    const body = await response.json() as { u?: string };
    return body.u || "";
  });
  return me;
}

test.use({ actionTimeout: 8_000 });

test("structured chips on the card, the sheet, and the reason pickers", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  const suffix = phone ? "phone" : "desktop";
  await page.goto(`/?funnel=pipeline&site=${SITE}${phone ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  const drawer = page.locator("aside.drawer");
  const header = drawer.getByTestId("header-chips");
  await expect(header).toBeVisible();
  await expect(header).toContainText("Financial screen");
  await expect(header).toContainText("Broker reply");
  await expect(header).toContainText("Power");
  await expect(header.locator("[data-testid^='chip-']")).toHaveCount(2);
  await drawer.locator(".drawer-scroll").evaluate((node) => { node.scrollTop = 0; });
  await header.screenshot({ path: shotPath(`chips-header-${suffix}`) });

  const section = drawer.getByTestId("section-chips");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expect(section).toContainText("Received");
  await section.screenshot({ path: shotPath(`chips-section-${suffix}`) });

  await drawer.getByTestId("panel-tab-numbers").click();
  const diligence = drawer.getByTestId("diligence-strip");
  await diligence.scrollIntoViewIfNeeded();
  await expect(diligence).toContainText("Land");
  await expect(diligence).toContainText("Estimated");
  await diligence.screenshot({ path: shotPath(`chips-diligence-${suffix}`) });

  const who = await username(page);
  await page.route("**/api/list/layout**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ layout: null, stored: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto("/?funnel=pipeline&view=list", { waitUntil: "domcontentloaded" });
  await page.evaluate((user) => {
    const key = `list-layout:v1:${(user || "anon").toLowerCase().replace(/[^a-z0-9._-]/g, "")}:pipeline`;
    const shown = ["site", "chip_waiting", "stage", "score"];
    const hidden = ["asking", "openLand", "capacity", "traffic", "cashFlow", "acres", "perAcre", "revenue", "askingRevenue", "askingCash", "businessMultiple", "landEstimate", "countyValue", "depot", "checked", "address", "apn", "zoning", "broker", "area", "nda", "lastContact", "nextStep", "type", "chip_drop", "chip_advance", "chip_gap", "chip_next", "chip_package", "chip_business", "chip_listing", "chip_lead", "chip_photos", "chip_price", "chip_financials", "chip_land", "chip_power", "chip_zoning", "chip_title", "chip_environmental"];
    localStorage.setItem(key, JSON.stringify({
      order: [...shown, ...hidden],
      widths: { chip_waiting: 180 },
      pinned: ["site"],
      hidden,
      sort: { id: "site", desc: false },
      filters: {},
      touched: true,
    }));
  }, who);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  if (phone) {
    await expect(page.getByTestId("phone-cards")).toBeVisible();
    await page.getByTestId("phone-cards").screenshot({ path: shotPath(`chips-grid-${suffix}`) });
    await page.locator("[data-testid=phone-cards] input.check").first().click();
  } else {
    const waiting = page.locator("th[data-col='chip_waiting']");
    await expect(waiting).toBeVisible();
    await waiting.scrollIntoViewIfNeeded();
    await waiting.hover();
    await waiting.getByRole("button", { name: "Column options for Waiting on" }).click({ force: true });
    await page.getByRole("group", { name: "Filter Waiting on" }).getByText("Broker reply", { exact: true }).click();
    await expect(page.locator("[data-testid='chip-waiting_on']").first()).toBeVisible();
    const filterMenu = page.locator(".col-menu");
    const headerBox = await waiting.boundingBox();
    const menuBox = await filterMenu.boundingBox();
    const chipBox = await page.locator("[data-testid='chip-waiting_on']").first().boundingBox();
    if (headerBox && menuBox && chipBox) {
      const x = Math.max(0, Math.min(headerBox.x, menuBox.x, chipBox.x) - 8);
      const y = Math.max(0, Math.min(headerBox.y, menuBox.y) - 8);
      const right = Math.max(headerBox.x + headerBox.width, menuBox.x + menuBox.width, chipBox.x + chipBox.width) + 12;
      const bottom = Math.max(menuBox.y + menuBox.height, chipBox.y + chipBox.height) + 12;
      await page.screenshot({
        path: shotPath(`chips-grid-${suffix}`),
        clip: { x, y, width: Math.min(right - x, 420), height: bottom - y },
      });
    }
    await page.getByRole("heading", { name: "Distributed Sites" }).click({ timeout: 8_000 });
    await page.locator("[data-testid=sheet-grid] tbody input.check").first().click({ timeout: 8_000 });
  }
  await page.getByRole("button", { name: "Propose drop", exact: true }).click({ timeout: 8_000 });
  await expect(page.getByTestId("drop-reason")).toBeVisible();
  await expect(page.getByTestId("drop-reason")).toContainText("Price vs value");
  const drop = page.getByTestId("drop-reason");
  await page.getByTestId("drop-reason").screenshot({ path: shotPath(`chips-drop-${suffix}`) });

  await page.goto(`/?funnel=pipeline&site=${SITE}${phone ? "&sheet=full" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  const move = page.getByTestId("empty-step-stage_move");
  await move.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  if (await move.count()) {
    await move.click();
    await expect(page.getByTestId("advance-reason")).toBeVisible();
    const advance = page.getByTestId("advance-reason");
    await expect(advance).toContainText("Land verified");
    await advance.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
    await advance.screenshot({ path: shotPath(`chips-advance-${suffix}`) });
  }
});
