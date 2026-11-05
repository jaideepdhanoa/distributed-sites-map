import { expect, test } from "@playwright/test";

test("pipeline list shows unpinned Phoenix deals and the key-number strip", async ({ page }) => {
  await page.goto("/?funnel=pipeline&pstage=desk&view=list");
  await page.waitForSelector("[data-testid=pipeline-list]");
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", "7");
  await expect(page.getByText("No pin").first()).toBeVisible();
  await expect(page.getByTestId("summary-row")).toContainText("Median asking");

  await page.getByRole("cell", { name: "Sinclair station and c-store (WCI listing)", exact: true }).click();
  await expect(page.getByTestId("key-strip")).toContainText("Cash flow");
  await expect(page.getByTestId("key-strip")).toContainText("Claimed");
  await expect(page.getByTestId("key-strip")).not.toContainText("Package figures not shown");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&site=LAND-PHX-0035");
  await expect(page.getByTestId("key-strip")).toContainText("104,100");
  await expect(page.getByTestId("key-strip")).toContainText("Estimated");
  await expect(page.getByTestId("key-strip")).toContainText("Site capacity");
  await page.getByRole("checkbox", { name: /^Compare$/ }).click();
  await expect(page).toHaveURL(/compare=LAND-PHX-0035/);
  await page.getByRole("checkbox", { name: /Compare Sinclair/ }).click();
  await expect(page).toHaveURL(/Sinclair|PIPE-PHX-0067/);
  await expect(page.getByTestId("compare-tray")).toContainText("Compare 2");
});
