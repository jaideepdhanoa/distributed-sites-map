import { expect, test } from "@playwright/test";

test("original listing sits under the title, including when none is on file", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-PHX-0001");
  const link = page.getByTestId("listing-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveText("View on LoopNet ↗");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0011");
  await expect(page.getByTestId("listing-link")).toHaveText("No listing page on file");

  await page.goto("/?funnel=pipeline&view=list&site=PIPE-LAS-0072");
  await expect(page.getByTestId("listing-link")).toHaveText("View on BizBuySell ↗ (may be removed)");
});

test("a deal with a site folder shows it next to the map and listing links", async ({ page }) => {
  await page.goto("/?funnel=pipeline&view=list&site=PIPE-MIA-0080");
  const folder = page.getByTestId("site-folder-link");
  await expect(folder).toBeVisible();
  await expect(folder).toHaveText("Open site folder ↗");
  await expect(folder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
  await expect(folder).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Open in Google Maps" })).toBeVisible();
  await expect(page.getByTestId("street-view-link")).toBeVisible();
  await expect(page.getByTestId("listing-link")).toBeVisible();
  await expect(page.getByTestId("grade-pair")).toBeVisible();
  await expect(page.getByTestId("site-photos")).toHaveCount(0);

  await page.goto("/?view=list&site=MIA-U747");
  const siteFolder = page.getByTestId("site-folder-link");
  await expect(siteFolder).toBeVisible();
  await expect(siteFolder).toHaveAttribute("href", "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ");
});
