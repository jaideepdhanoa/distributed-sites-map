import { expect, test, type Page } from "@playwright/test";

const sizes = [
  { project: "desktop", width: 1280, height: 800 },
  { project: "mobile", width: 390, height: 844 },
] as const;

async function ready(page: Page) {
  await page.goto("/?funnel=pipeline&city=PHX", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible();
}

for (const size of sizes) {
  test(`NDA is a tab and the view line is plain at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    await expect(page.getByTestId("view-help")).toHaveCount(0);
    if (size.width < 768) await page.getByRole("button", { name: "Menu" }).click();
    const tab = page.getByRole("button", { name: "NDA queue" });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/nda=1/);
    await expect(page.getByTestId("nda-queue")).toBeVisible();
    await expect(page.getByTestId("nda-export")).toBeVisible();
    if (size.width < 768) await expect(page.getByTestId("nda-cards")).toBeVisible();
    else await expect(page.getByRole("button", { name: "NDA id", exact: true })).toBeVisible();
  });

  test(`Dropped keeps the market and the zoom at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
    await expect.poll(async () => page.locator(".shell").getAttribute("data-zoom")).toMatch(/^\d/);
    if (size.width < 768) await page.getByRole("button", { name: "Layers" }).click();
    const zoomBefore = await page.locator(".shell").getAttribute("data-zoom");
    await page.locator("label.layer-row", { has: page.getByTestId("dropped-layer") }).click();
    await expect(page).toHaveURL(/city=PHX/);
    await expect(page).toHaveURL(/dropped=1/);
    await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
    await expect.poll(async () => page.locator(".shell").getAttribute("data-zoom")).toBe(zoomBefore);
  });

  test(`sort stays in the URL and a second click does not clear it at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/?funnel=pipeline&city=PHX&view=list", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sort-control")).toBeVisible();
    await page.getByTestId("sort-by").selectOption("stage");
    await expect(page).toHaveURL(/sort=stage(?::|%3A)asc/);
    await page.getByTestId("sort-direction").click();
    await expect(page).toHaveURL(/sort=stage(?::|%3A)desc/);
    const header = page.locator("button.sort-header", { hasText: "Stage" }).first();
    if (await header.count()) await header.click();
    await expect(page).not.toHaveURL(/sort=none/);
    await expect(page).toHaveURL(/sort=stage(?::|%3A)/);
  });

  test(`Needs location opens a fix for the signed-in role at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    const me = await page.evaluate(async () => {
      const response = await fetch("/api/me");
      return response.ok ? response.json() as Promise<{ actionRole?: string }> : { actionRole: "" };
    });
    if (size.width < 768) {
      await page.getByRole("button", { name: "Menu" }).click();
      await page.getByRole("button", { name: /Needs location/ }).click();
    } else {
      const opener = page.getByTestId("needs-location");
      if (await opener.count()) await opener.click();
    }
    const list = page.getByTestId("needs-location-list");
    if (await list.count() === 0) {
      test.skip(true, "this market has a point for every deal");
    }
    await expect(list.getByRole("heading", { name: "Needs location" })).toBeVisible();
    await expect(list).not.toContainText("PIPE-PHX-0006");
    await list.getByTestId("fix-location").first().click();
    await expect(page).toHaveURL(/fix=location/);
    const fix = page.getByTestId("location-fix");
    await expect(fix).toBeVisible();
    if (me.actionRole === "reviewer") await expect(fix.getByTestId("location-address")).toBeVisible();
    else await expect(fix.getByTestId("location-proposal")).toBeVisible();
  });
}

for (const size of sizes) {
  test(`a WB link opens the Universe card at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/data/sites**", async (route) => {
      if (/\/api\/data\/sites\/[^/?]+/.test(route.request().url())) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.json() as { features?: unknown[] };
      body.features = [...(body.features || []), {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-115.15, 36.17] },
        properties: {
          site_id: "WB-LAS-9101",
          city: "LAS",
          name: "Sample site",
          address: "10 Sample St",
          business_type: "Car wash",
          origin: "universe",
          counts_as_site: true,
          in_area: true,
        },
      }];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/?site=WB-LAS-9101", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/funnel=universe/);
    await expect(page).toHaveURL(/city=LAS/);
    await expect(page.locator("aside.drawer")).toContainText("Sample site");
    await page.getByTestId("copy-site-link").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/\?site=WB-LAS-9101$/);
  });
}

test("an unknown id shows Site not found and a protected id stays closed", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop");
  await page.goto("/?site=WB-LAS-9999", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("site-missing")).toHaveText("Site not found");
  await page.goto("/?site=PIPE-PHX-0006", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/PIPE-PHX-0006/);
  await expect(page.locator("aside.drawer")).toHaveCount(0);
});
