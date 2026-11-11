import { expect, test } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

test("auto service is on with car washes, and unscreened listings stay a separate toggle", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop filters");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?funnel=pipeline&pstage=desk&city=MIA&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=pipeline-list]");
  const both = cityPipelineCounts("MIA");
  const washes = cityPipelineCounts("MIA", { auto: false });
  const autos = cityPipelineCounts("MIA", { wash: false });
  const list = page.getByTestId("pipeline-list");
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(both.deskTotal));
  await expect(list).toContainText("Owner-operated repair shop");
  await expect(list).toContainText("M Car Wash");
  await expect(page).not.toHaveURL(/[?&]cats=/);

  await page.locator("button.tool", { hasText: "Filters" }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel.getByTestId("wash-category")).toBeChecked();
  await expect(panel.getByTestId("auto-category")).toBeChecked();
  await expect(panel.getByTestId("land-category")).not.toBeChecked();
  await expect(panel.getByTestId("cstore-category")).not.toBeChecked();
  await expect(panel.getByText("Auto repair and tire and lube.")).toBeVisible();
  const listings = panel.getByTestId("unscreened-listings");
  await expect(listings).not.toBeChecked();
  await expect(panel.getByText("Unscreened market listings")).toBeVisible();
  await expect(panel.getByText("Listings not yet in Pipeline or Universe.")).toBeVisible();
  await expect(panel.getByText("Listed, not yet screened")).toHaveCount(0);

  await listings.click();
  await expect(page).toHaveURL(/newlist=1/);
  await expect(page).not.toHaveURL(/[?&]cats=/);
  await listings.click();
  await expect(page).not.toHaveURL(/newlist=/);
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(both.deskTotal));

  await panel.getByTestId("auto-category").click();
  await expect(page).toHaveURL(/[?&]cats=wash(?:&|$)/);
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(washes.deskTotal));
  await expect(page.locator("nav.funnel").getByRole("button", { name: /Desk screen/ })).toContainText(String(washes.deskTotal));
  await expect(list).not.toContainText("Owner-operated repair shop");
  await expect(list).toContainText("M Car Wash");

  await panel.getByTestId("wash-category").click();
  await panel.getByTestId("auto-category").click();
  await expect(page).toHaveURL(/[?&]cats=auto(?:&|$)/);
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(autos.deskTotal));
  await expect(list).toContainText("Owner-operated repair shop");
  await expect(list).not.toContainText("M Car Wash");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&cats=wash");
  await expect(page.getByTestId("pipeline-list")).toContainText("Black Canyon");
  await page.goto("/?funnel=pipeline&pstage=desk&view=list&cats=auto");
  await expect(page.getByTestId("pipeline-list")).not.toContainText("Black Canyon");

  await page.goto("/?funnel=pipeline&pstage=desk");
  const layers = page.locator("aside.layers.open");
  await expect(layers.getByText("Auto service")).toHaveCount(0);
  await expect(layers.getByText("Unscreened market listings")).toHaveCount(0);
  await expect(layers.getByText("C-stores")).toHaveCount(0);
  await expect(layers.getByText("Land", { exact: true })).toHaveCount(0);
});
