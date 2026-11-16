import { expect, test } from "@playwright/test";

test("a site card leads with financials only when a P&L has been captured", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop summary");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?site=PIPE-LAS-0011", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-record='PIPE-LAS-0011']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No P&L captured yet")).toHaveCount(0);
  const card = page.getByTestId("financials-entry");
  const quiet = page.getByTestId("financials-quiet");
  if (await card.count()) {
    await expect(card).toContainText("revenue");
    await card.click();
    await expect(page.getByTestId("pnl-overlay")).toBeVisible();
  } else if (await quiet.count()) {
    await expect(quiet).toHaveText("Financials: package not yet broken into line items");
  }
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
  await expect(sheet.getByText("Missing").first()).toBeVisible();
  await expect(overlay).not.toContainText("T15:00:00");
  await sheet.getByText("$500,000").click();
  const popover = page.getByTestId("pnl-popover");
  await expect(popover).toContainText("Mar 1, 2026");
  await expect(popover).toContainText("Sheet 2024");
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
  await expect(detail).toContainText("Mar 1, 2026");
  await expect(detail).toContainText("5–7%");
  await expect(detail).not.toContainText("T15:00:00");
});
