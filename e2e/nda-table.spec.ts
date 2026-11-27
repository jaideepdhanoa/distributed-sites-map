import { expect, test } from "@playwright/test";

test("a site card opens its NDA and can come back", async ({ page }, info) => {
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
  await expect(page.getByTestId("nda-site-thread")).toHaveCount(0);
  await expect(page.getByTestId("nda-view-all")).toHaveCount(0);
  await page.getByRole("tab", { name: "Diligence", exact: true }).click();
  const card = page.getByTestId("nda-card-line");
  await expect(card).toBeVisible();
  if (info.project.name !== "mobile") await page.mouse.move(0, 0);
  const rest = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
  await card.hover();
  const hovered = await card.evaluate((node) => {
    const style = getComputedStyle(node);
    return { cursor: style.cursor, background: style.backgroundColor };
  });
  expect(hovered.cursor).toBe("pointer");
  if (info.project.name !== "mobile") {
    await expect.poll(() => card.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(rest);
    await card.screenshot({ path: "review-shots/nda-card-hover.png" });
  }
  await card.focus();
  const ring = await card.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(ring).not.toBe("none");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`nda=${found.nda}`));
  await expect(page.getByTestId("nda-detail")).toBeVisible();
  await page.getByTestId("nda-back").click();
  await expect(page.getByTestId("nda-detail")).toHaveCount(0);
  await expect(page.locator(`[data-record="${found.deal}"]`)).toBeVisible();
});

test("an NDA comment uses the activity row", async ({ page }) => {
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
    return { deal: feature?.properties?.deal_id || "", nda: feature?.properties?.nda_id || "" };
  });
  expect(found.nda).toMatch(/^NDA-/);
  await page.route("**/api/actions/notes?**", async (route) => {
    const url = new URL(route.request().url());
    if ((url.searchParams.get("targetId") || "").toUpperCase() === found.nda) {
      await route.fulfill({
        json: {
          notes: [{
            id: "NT-9001",
            parentId: null,
            body: "Sample NDA note.",
            authorId: "sample",
            createdAt: "2026-11-20T19:57:00.000Z",
            deleted: false,
            mentions: [],
            anchor: { type: "nda", siteId: found.nda, line: found.nda, period: "", spaceId: "", label: found.nda },
          }],
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/actions/accounts**", (route) => route.fulfill({ json: { accounts: [{ id: "sample", name: "Sample Owner" }] } }));
  await page.goto(`/?funnel=pipeline&site=${found.deal}&panel=activity`, { waitUntil: "domcontentloaded" });
  const row = page.locator("[data-nda-comment]");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Sample Owner");
  await expect(row).toContainText("Sample NDA note.");
  await expect(row.getByTestId("nda-activity-chip")).toHaveText(`on ${found.nda}`);
  await row.getByTestId("nda-activity-chip").click();
  await expect(page.getByTestId("nda-detail")).toBeVisible();
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
  await page.getByRole("tab", {name:"Diligence",exact:true}).click();
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
