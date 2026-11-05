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
