import { expect, test } from "@playwright/test";

test("pipeline counts name the set, and score issue is a filter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop funnel");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  const all = page.getByTestId("all-stages");
  await expect(all).toBeVisible();
  await expect(all).toContainText("All");
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByTestId("score-issue")).toBeVisible();
  await expect(page.getByTestId("land-beside-desk")).toHaveCount(0);
  await expect(page.locator("nav.funnel")).not.toContainText("+0 land");
});

test("provisional and not scored render from a fixture", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "score fixture");
  let blankId = "";
  let offId = "";
  let evenId = "";
  await page.route("**/api/data/deals*", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { features?: { properties?: Record<string, unknown> }[] };
    const rows = (body.features || []).filter((feature) => feature.properties?.kind === "pipeline" && feature.properties.deal_id !== "PIPE-PHX-0006");
    const blank = rows[0]?.properties;
    const off = rows[1]?.properties;
    const even = rows[2]?.properties;
    if (blank) {
      blankId = String(blank.deal_id || "");
      blank.score = 20;
      blank.economics_points = null;
      blank.land_points = 5;
      blank.power_points = 5;
      blank.location_points = 5;
      blank.deal_points = 5;
      blank.business_type = "Car wash";
    }
    if (off) {
      offId = String(off.deal_id || "");
      off.score = 90;
      off.economics_points = 10;
      off.land_points = 10;
      off.power_points = 10;
      off.location_points = 10;
      off.deal_points = 10;
      off.business_type = "Car wash";
    }
    if (even) {
      evenId = String(even.deal_id || "");
      even.score = 47.12;
      even.economics_points = 4.62;
      even.land_points = 25;
      even.power_points = 7.5;
      even.location_points = 5;
      even.deal_points = 5;
      even.business_type = "Car wash";
    }
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const loaded = page.waitForResponse((response) => response.url().includes("/api/data/deals") && response.ok());
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await loaded;
  await page.goto(`/?funnel=pipeline&site=${blankId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("score-chip")).toHaveText("Not scored");
  await page.goto(`/?funnel=pipeline&site=${offId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("score-chip")).toContainText("Provisional");
  await expect(page.getByTestId("score-chip")).toContainText("50");
  await page.goto(`/?funnel=pipeline&site=${evenId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("score-chip")).toHaveText("47.1");
});

test("the Phoenix chip matches All after Phoenix is selected", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop market chips");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  const phoenix = page.getByTestId("market-PHX");
  await expect(phoenix).toBeVisible();
  await phoenix.click();
  await expect(page).toHaveURL(/[?&]city=PHX(?:&|$)/);
  const numberIn = async (locator: ReturnType<typeof page.getByTestId>) => {
    const text = await locator.innerText();
    return Number(text.replace(/,/g, "").match(/\d+/)?.[0] || "NaN");
  };
  await expect.poll(async () => numberIn(page.getByTestId("all-stages").locator("strong"))).toBeGreaterThan(0);
  const all = await numberIn(page.getByTestId("all-stages").locator("strong"));
  const chip = await numberIn(phoenix);
  expect(chip).toBe(all);
});

test("phone pipeline keeps the All chip", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone funnel");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline", { waitUntil: "domcontentloaded" });
  await page.locator(".phone-step").click();
  const all = page.getByTestId("all-stages");
  await expect(all).toBeVisible();
  const clipped = await all.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(clipped).toBe(false);
  await page.goto("/?funnel=pipeline&view=list", { waitUntil: "domcontentloaded" });
  const rowClipped = await page.locator("[data-testid=summary-row]").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [...node.children].some((child) => child.getBoundingClientRect().right > box.right + 1);
  });
  expect(rowClipped).toBe(false);
});
