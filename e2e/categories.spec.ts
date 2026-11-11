import { expect, test, type Locator, type Page } from "@playwright/test";
import { cityPipelineCounts } from "./pipeline-counts";

async function overlaps(button: Locator, target: Locator) {
  const left = await button.boundingBox();
  const right = await target.boundingBox();
  if (!left || !right) return false;
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

async function plantPreviewButton(page: Page) {
  await page.evaluate(() => {
    const button = document.createElement("vercel-toolbar");
    button.dataset.testid = "preview-comment";
    button.style.width = "44px";
    button.style.height = "44px";
    button.style.borderRadius = "999px";
    button.style.background = "#1c1914";
    document.body.appendChild(button);
  });
  return page.getByTestId("preview-comment");
}

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
  await expect(list).toContainText("Majestic Car Wash");
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
  await expect(list).toContainText("Majestic Car Wash");

  await panel.getByTestId("wash-category").click();
  await panel.getByTestId("auto-category").click();
  await expect(page).toHaveURL(/[?&]cats=auto(?:&|$)/);
  await expect(page.locator(".shell")).toHaveAttribute("data-list-count", String(autos.deskTotal));
  await expect(list).toContainText("Owner-operated repair shop");
  await expect(list).not.toContainText("Majestic Car Wash");

  await page.goto("/?funnel=pipeline&pstage=desk&view=list&cats=wash");
  await expect(page.getByTestId("pipeline-list")).not.toContainText("Black Canyon");
  await page.goto("/?funnel=pipeline&pstage=desk&view=list&cats=auto");
  await expect(page.getByTestId("pipeline-list")).toContainText("Black Canyon");

  await page.goto("/?funnel=pipeline&pstage=desk");
  const layers = page.locator("aside.layers.open");
  await expect(layers.getByText("Auto service")).toHaveCount(0);
  await expect(layers.getByText("Unscreened market listings")).toHaveCount(0);
  await expect(layers.getByText("C-stores")).toHaveCount(0);
  await expect(layers.getByText("Land", { exact: true })).toHaveCount(0);
});

test("the preview comment button stays off phone sheets and list actions", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone preview button");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?funnel=pipeline&city=MIA&pstage=desk", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  const button = await plantPreviewButton(page);
  await expect(button).toHaveCSS("display", "block");

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await expect(filters).toBeVisible();
  await expect(button).toHaveCSS("display", "none");
  expect(await overlaps(button, filters)).toBe(false);
  await expect(filters.getByTestId("auto-category")).toBeChecked();
  await expect(filters.getByText("Unscreened market listings")).toBeVisible();
  await page.getByRole("button", { name: "Close filters" }).click();
  await expect(button).toHaveCSS("display", "block");

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.locator("aside.layers.open");
  await expect(layers).toBeVisible();
  await expect(button).toHaveCSS("display", "none");
  expect(await overlaps(button, layers)).toBe(false);
  await page.getByRole("button", { name: "Close layers" }).click();

  await page.locator(".phone-step").click();
  await expect(page.locator(".shell")).toHaveClass(/steps-open/);
  await expect(button).toHaveCSS("display", "none");
  expect(await overlaps(button, page.locator("nav.funnel"))).toBe(false);
  await page.getByRole("button", { name: "Close steps" }).click();

  await page.getByRole("group", { name: "Map or list" }).getByRole("button", { name: "List", exact: true }).click();
  await page.waitForSelector("[data-testid=pipeline-list]");
  await expect(button).toHaveCSS("display", "none");
  const show = page.getByRole("button", { name: "Show on map" }).first();
  await expect(show).toBeVisible();
  expect(await overlaps(button, show)).toBe(false);
  const listing = page.locator(".list-cards .listing-icon").first();
  await expect(listing).toBeVisible();
  expect(await overlaps(button, listing)).toBe(false);
});
