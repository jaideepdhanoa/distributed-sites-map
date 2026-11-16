import { expect, test } from "@playwright/test";

const GROUPS = {
  sites: [{ id: "PIPE-PHX-0108", title: "North Sample Wash", path: "/?site=PIPE-PHX-0108", url: "https://distributedsites.com/?site=PIPE-PHX-0108" }],
  brokers: [{ id: "sample-broker", title: "Sample Broker", path: "/?site=PIPE-PHX-0108", url: "https://distributedsites.com/?site=PIPE-PHX-0108" }],
  conversations: [{ id: "CM-0123", title: "Sample thread", path: "/?site=PIPE-PHX-0108&panel=activity&msg=CM-0123", url: "https://distributedsites.com/?site=PIPE-PHX-0108&panel=activity&msg=CM-0123" }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/search?**", (route) => {
    const url = new URL(route.request().url());
    if ((url.searchParams.get("q") || "").toLowerCase().includes("sample")) {
      return route.fulfill({ json: { mode: "index", groups: GROUPS, ids: ["PIPE-PHX-0108"] } });
    }
    return route.fulfill({ json: { mode: "fallback", groups: { sites: [], brokers: [], conversations: [] }, ids: [] } });
  });
});

test("command search groups deeplinks and the grid search stays on the map", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; } body:has(.command-search) .map-corner, body:has(.command-search) .map-key { display: none !important; }" });
  await page.waitForSelector(".shell");
  if (info.project.name === "desktop") await page.keyboard.press("Control+k");
  else await page.getByTestId("command-search-open").click();
  const palette = page.getByTestId("command-search");
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search everything").fill("sample");
  await expect(palette.getByTestId("command-group-sites")).toContainText("North Sample Wash");
  await expect(palette.getByTestId("command-group-brokers")).toContainText("Sample Broker");
  await expect(palette.getByTestId("command-group-conversations")).toContainText("Sample thread");
  await expect(palette.getByRole("link", { name: "Sample thread" })).toHaveAttribute("href", /panel=activity&msg=CM-0123/);
  await page.screenshot({ path: `e2e/output/command-search-${info.project.name}.png`, fullPage: false });
  await palette.getByRole("button", { name: "Close search" }).click();
  await expect(palette).toBeHidden();
  const prices = page.getByRole("button", { name: "Off", exact: true });
  if (await prices.isVisible()) await prices.click();
  const box = page.locator("input.search:visible").first();
  await box.fill("phx");
  await expect(page.getByTestId("search-hits")).toBeVisible();
  await page.screenshot({ path: `e2e/output/grid-search-${info.project.name}.png`, fullPage: false });
});
