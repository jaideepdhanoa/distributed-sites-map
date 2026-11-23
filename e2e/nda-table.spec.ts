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
  const cardThread = page.getByTestId("nda-site-thread");
  await expect(cardThread).toBeVisible();
  await expect(cardThread.getByPlaceholder("Comment or @mention…")).toBeVisible();
  await expect(cardThread.getByRole("button", { name: "Comment" })).toBeVisible();
  await page.getByTestId("nda-open").click();
  await expect(page).toHaveURL(new RegExp(`nda=${found.nda}`));
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await page.getByTestId("nda-back").click();
  await expect(page.getByTestId("nda-detail")).toHaveCount(0);
  await expect(page.locator(`[data-record="${found.deal}"]`)).toBeVisible();
});

test("the phone NDA panel covers the site sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone sheet");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const found = await page.evaluate(async () => {
    const response = await fetch("/api/data/deals");
    const body = await response.json() as { features?: { properties?: { deal_id?: string; nda_id?: string; nda_status?: string } }[] };
    const closed = new Set(["Executed", "Not required", "Expired", "Declined / proceeding without"]);
    const feature = (body.features || []).find((item) => {
      const id = item.properties?.nda_id || "";
      return id.startsWith("NDA-") && !closed.has(item.properties?.nda_status || "");
    });
    return feature?.properties?.deal_id || "";
  });
  expect(found).toMatch(/^PIPE-|^LAND-/);
  await page.goto(`/?funnel=pipeline&site=${found}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("nda-open").click();
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  const covered = await page.evaluate(() => {
    const pane = document.querySelector(".nda-pane");
    const drawer = document.querySelector(".drawer");
    if (!pane || !drawer) return "missing panel or sheet";
    const drawerBox = drawer.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    const x = Math.round(drawerBox.left + drawerBox.width / 2);
    const y = Math.round(drawerBox.top + Math.min(24, drawerBox.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit?.closest(".nda-pane")) return "the site sheet covers the NDA panel";
    if (paneBox.bottom < window.innerHeight - 2) return "the NDA panel stops above the sheet";
    return "";
  });
  expect(covered).toBe("");
  await page.getByTestId("nda-back").click();
  await expect(page.locator(".drawer")).toBeVisible();
  await expect(page.getByTestId("nda-detail")).toHaveCount(0);
});

test("the NDA queue is a list and one click opens the dossier", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/?nda=1", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("nda-queue")).toBeVisible();
  await page.getByRole("button", { name: "NDA actions" }).click();
  await expect(page.getByTestId("nda-export")).toBeVisible();
  await page.getByTestId("nda-cards").locator("button").first().click();
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await expect(page.getByTestId("nda-history")).toContainText("On the register");
  await expect(page.getByRole("button", { name: "Close NDA queue" })).toHaveCount(1);
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
