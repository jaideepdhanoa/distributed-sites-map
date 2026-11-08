import { expect, test } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

test("pipeline list shows unpinned Phoenix deals and the key-number strip", async ({ page }) => {
  const desk = cityPipelineCounts("PHX");
  await page.goto("/?funnel=pipeline&pstage=desk&view=list");
  await page.waitForSelector("[data-testid=pipeline-list]");
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(desk.deskTotal));
  await expect(page.locator(".no-pin").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("summary-row")).toContainText("Median asking");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&site=PIPE-PHX-0067");
  await page.getByTestId("panel-tab-numbers").click();
  await expect(page.getByTestId("key-strip")).toContainText("Cash flow");
  await expect(page.getByTestId("key-strip")).toContainText("Broker-stated");
  await expect(page.getByTestId("key-strip")).not.toContainText("Package figures not shown");

  await page.goto("/?funnel=pipeline&view=list&site=LAND-PHX-0035");
  await page.getByTestId("panel-tab-numbers").click();
  await expect(page.getByTestId("key-strip")).toContainText("104,100");
  await expect(page.getByTestId("key-strip")).toContainText("Estimated");
  await expect(page.getByTestId("key-strip")).toContainText("Space");
  await expect(page.getByTestId("key-strip")).toContainText("Capacity");
  await expect(page.getByTestId("key-strip")).toContainText("Attractiveness");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&compare=LAND-PHX-0035|PIPE-PHX-0067");
  await expect(page.getByTestId("compare-tray")).toContainText("Compare 2");
  await expect(page.getByTestId("compare-tray")).toContainText("$478,044");
});
