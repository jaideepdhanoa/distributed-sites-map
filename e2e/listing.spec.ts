import { expect, test } from "@playwright/test";

test("original listing sits under the title, including when none is on file", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-PHX-0001");
  const link = page.getByTestId("listing-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveText("Listing ↗");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0011");
  await expect(page.getByTestId("listing-link")).toHaveText("Listing");
  await expect(page.getByTestId("listing-link")).not.toHaveAttribute("href", /.+/);

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0072");
  await expect(page.getByTestId("listing-link")).toHaveText("Listing ↗");
  await expect(page.getByTestId("listing-link")).toHaveAttribute("title", "May be removed");
});

test("a deal with a site folder shows it next to the map and listing links", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-MIA-0080");
  const folder = page.getByTestId("site-folder-link");
  await expect(folder).toBeVisible();
  await expect(folder).toHaveText("Folder ↗");
  await expect(folder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
  await expect(folder).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("map-link")).toHaveText("Map ↗");
  await expect(page.getByTestId("street-view-link")).toHaveText("Street View ↗");
  await expect(page.getByTestId("listing-link")).toHaveText("Listing ↗");
  await expect(page.getByTestId("card-numbers")).toContainText("Cash flow");
  await expect(page.getByTestId("card-numbers")).toContainText("Spare land");
  await expect(page.getByTestId("card-numbers")).toContainText("Bays that fit");
  await expect(page.getByTestId("card-numbers")).toContainText("Traffic");
  await expect(page.getByTestId("workbook-step")).toContainText("POS/car counts");
  await expect(page.locator("aside.drawer")).not.toContainText("Broker contacted");
  await expect(page.locator("aside.drawer")).not.toContainText("Not a fit");
  await expect(page.locator("aside.drawer")).not.toContainText("Not required");
  await page.getByTestId("panel-tab-numbers").click();
  const figures = page.getByTestId("key-strip");
  await expect(figures).toBeVisible();
  await expect(figures).toContainText("Space");
  await expect(figures).toContainText("Capacity");
  await expect(figures).toContainText("Attractiveness");
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const next = new URL(page.url());
    next.searchParams.set("sheet", "half");
    await page.goto(next.toString());
  }
  const photos = page.getByTestId("site-photos");
  await expect(photos).toBeVisible();
  const thumb = page.getByTestId("photo-thumb").first();
  await expect(thumb).toBeVisible();
  await expect(thumb.locator("img")).toHaveAttribute("src", /^\/api\/data\/photos\/[a-f0-9]{20}\.jpg$/);
  await expect(page.getByTestId("street-view-link")).toHaveAttribute("href", /map_action=pano/);

  const narrow = (page.viewportSize()?.width ?? 1440) < 768;
  await page.goto(`/?view=list&site=MIA-U747${narrow ? "&sheet=half" : ""}`);
  const siteFolder = page.getByTestId("site-folder-link");
  await expect(siteFolder).toBeVisible();
  await expect(siteFolder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
  await expect(page.getByTestId("site-photos")).toBeVisible();
});
