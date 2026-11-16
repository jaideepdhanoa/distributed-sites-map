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
  await expect(sheet.locator("td.is-missing").first()).toHaveAttribute("title", "Month not in the package");
  await expect(overlay).not.toContainText("T15:00:00");
  await sheet.getByRole("row", { name: /^Labor/ }).getByText("$10,000").click();
  const popover = page.getByTestId("pnl-popover");
  await expect(popover).toContainText("Captured Mar 1, 2026");
  await expect(popover).toContainText("Sample package · Jan");
  await expect(popover).toContainText("Reported");
  await expect(popover).not.toContainText("T15:00:00");
  const first = sheet.locator("[data-cell='0:0']");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sheet.locator("[data-cell='0:1']")).toBeFocused();
  await page.getByRole("button", { name: "Years" }).click();
  await expect(sheet.getByRole("columnheader", { name: "2024" })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: "Jan" })).toHaveCount(0);
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
  const detail = page.getByTestId("pnl-expand");
  await expect(detail).toContainText("Captured Mar 1, 2026");
  await expect(page.getByTestId("pnl-period-label")).toContainText("Mar 2024");
  await expect(page.getByRole("button", { name: /Labor/ })).toContainText("Not in package");
  await expect(detail).toContainText("5–7%");
  await expect(detail).not.toContainText("T15:00:00");
});

test("phone overview tiles name a missing line when a package is on file", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone overview");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline&site=PIPE-PHX-0084&sheet=full", { waitUntil: "domcontentloaded" });
  const numbers = page.getByTestId("card-numbers");
  await numbers.scrollIntoViewIfNeeded();
  const revenue = numbers.locator("div").filter({ hasText: "Revenue" }).first();
  const cash = numbers.locator("div").filter({ hasText: "Cash flow" }).first();
  await expect(revenue.locator("strong")).toHaveText("Not in package");
  await expect(cash.locator("strong")).toHaveText("Not in package");
  await expect(revenue).not.toContainText("Not on file");
  await expect(cash).not.toContainText("Not on file");
  await numbers.screenshot({ path: "review-shots/pnl-phone-tiles.png" });

  await page.goto("/?funnel=pipeline&site=PIPE-PHX-0004&sheet=full", { waitUntil: "domcontentloaded" });
  const empty = page.getByTestId("card-numbers");
  await empty.scrollIntoViewIfNeeded();
  await expect(empty.locator("div").filter({ hasText: "Revenue" }).first().locator("strong")).toHaveText("—");
  const emptyCash = empty.locator("div").filter({ hasText: "Cash flow" }).first();
  await expect(emptyCash.locator("strong")).toHaveText("—");
  await expect(emptyCash).toContainText("Not on file");
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
  const cash = numbers.locator("div").filter({ hasText: "Cash flow" }).first();
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
  await expect(siteNumbers.locator("div").filter({ hasText: "Cash flow" }).first().locator("strong")).toHaveText("$520,000");
  await expect(page.getByTestId("financials-entry")).toContainText("SDE $520,000");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
