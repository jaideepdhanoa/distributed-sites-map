import { expect, test } from "@playwright/test";

test("a site card opens its NDA and can come back", async ({ page }) => {
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const found = await page.evaluate(async () => {
    const response = await fetch("/api/data/deals");
    const body = await response.json() as { features?: { properties?: { deal_id?: string; nda_id?: string; nda_status?: string } }[] };
    const closed = new Set(["Executed", "Not required", "Expired", "Declined / proceeding without"]);
    const feature = (body.features || []).find((item) => {
      const id = item.properties?.nda_id || "";
      const status = item.properties?.nda_status || "";
      return id.startsWith("NDA-") && !closed.has(status);
    });
    return { deal: feature?.properties?.deal_id || "", nda: feature?.properties?.nda_id || "" };
  });
  expect(found.deal).toMatch(/^PIPE-|^LAND-/);
  expect(found.nda).toMatch(/^NDA-/);
  await page.goto(`/?funnel=pipeline&site=${found.deal}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("nda-open").click();
  await expect(page).toHaveURL(new RegExp(`nda=${found.nda}`));
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await page.getByTestId("nda-back").click();
  await expect(page.getByTestId("nda-detail")).toHaveCount(0);
  await expect(page.locator(`[data-record="${found.deal}"]`)).toBeVisible();
});

test("the NDA queue is a table on desktop and cards on a phone", async ({ page }, info) => {
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-queue")).toBeVisible();
  await expect(page.getByTestId("nda-export")).toBeVisible();
  if (info.project.name === "mobile") {
    await expect(page.getByTestId("nda-cards")).toBeVisible();
    await page.getByTestId("nda-cards").locator("button").first().click();
  } else {
    await expect(page.getByRole("button", { name: "NDA id", exact: true })).toBeVisible();
    const cell = page.getByRole("gridcell").filter({ hasText: /^NDA-/ }).first();
    await expect(cell).toBeVisible();
    await cell.click();
  }
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await expect(page.getByTestId("nda-history")).toContainText("On the register");
  await page.getByTestId("nda-draft").click();
  const draft = await page.getByTestId("nda-draft-text").inputValue();
  expect(draft.toLowerCase()).not.toContain("charging");
  expect(draft).not.toMatch(/\bAVs?\b/i);
  await expect(page.getByRole("button", { name: "Copy draft" })).toBeVisible();
  await expect(page.getByTestId("nda-draft-text")).not.toHaveValue(/Thank you/);
});

test("the NDA detail stays within a phone width", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone width");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-cards")).toBeVisible();
  await page.getByTestId("nda-cards").locator("button").first().click();
  const panel = page.getByTestId("nda-detail");
  await expect(panel).toBeVisible();
  const fit = await panel.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
});
