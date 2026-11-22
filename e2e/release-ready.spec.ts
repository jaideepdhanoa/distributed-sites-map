import { expect, test, type Page } from "@playwright/test";

const sizes = [
  { project: "desktop", width: 1280, height: 800 },
  { project: "mobile", width: 390, height: 844 },
] as const;

async function ready(page: Page) {
  await page.goto("/?funnel=pipeline&city=PHX", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.getByTestId("view-help")).toBeVisible();
}

for (const size of sizes) {
  test(`NDA is a tab and the view line is plain at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    await expect(page.getByTestId("view-help")).toHaveText("Deals in this market");
    const tab = page.getByRole("button", { name: "NDA queue" });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/nda=1/);
    await expect(page.getByTestId("nda-queue")).toBeVisible();
    await expect(page.getByTestId("view-help")).toHaveText("Agreements still open");
  });

  test(`Show land turns the Land category on at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    const banner = page.getByTestId("land-banner");
    await expect(banner).toContainText("Land sites are hidden by your filters");
    await page.getByTestId("show-land").click();
    await expect(page).toHaveURL(/cats=[^&]*land/);
    await expect(banner).toHaveCount(0);
  });

  test(`Dropped keeps the market and the zoom at ${size.width}`, async ({ page }, info) => {
    test.skip(info.project.name !== size.project, size.project);
    await page.setViewportSize({ width: size.width, height: size.height });
    await ready(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
    await expect.poll(async () => page.locator(".shell").getAttribute("data-zoom")).toMatch(/^\d/);
    if (size.width < 768) await page.getByRole("button", { name: "Layers" }).click();
    const zoomBefore = await page.locator(".shell").getAttribute("data-zoom");
    await page.getByTestId("dropped-layer").check();
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
    await expect(page).toHaveURL(/sort=stage:asc/);
    await page.getByTestId("sort-direction").click();
    await expect(page).toHaveURL(/sort=stage:desc/);
    const header = page.locator("button.sort-header", { hasText: "Stage" }).first();
    if (await header.count()) await header.click();
    await expect(page).not.toHaveURL(/sort=none/);
    await expect(page).toHaveURL(/sort=stage:/);
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
    await list.getByTestId("fix-location").first().click();
    await expect(page).toHaveURL(/fix=location/);
    const fix = page.getByTestId("location-fix");
    await expect(fix).toBeVisible();
    if (me.actionRole === "reviewer") await expect(fix.getByTestId("location-address")).toBeVisible();
    else await expect(fix.getByTestId("location-proposal")).toBeVisible();
    await expect(page.getByText("PIPE-PHX-0006")).toHaveCount(0);
  });
}
