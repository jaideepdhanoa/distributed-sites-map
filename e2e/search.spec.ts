import { expect, test } from "@playwright/test";

const GROUPS = {
  sites: [{ id: "PIPE-PHX-0008", title: "North Sample Wash", path: "/?site=PIPE-PHX-0008&sheet=full", url: "https://distributedsites.com/?site=PIPE-PHX-0008" }],
  brokers: [{ id: "sample-broker", title: "Sample Broker", path: "/?site=PIPE-PHX-0008", url: "https://distributedsites.com/?site=PIPE-PHX-0008" }],
  conversations: [{
    id: "CM-0123",
    title: "Sample note",
    site: "North Sample Wash",
    when: "Jan 2",
    path: "/?site=PIPE-PHX-0008&panel=activity&msg=CM-0123&sheet=full",
    url: "https://distributedsites.com/?site=PIPE-PHX-0008&panel=activity&msg=CM-0123",
  }],
};

const SITES_ONLY = {
  sites: [{ id: "PIPE-PHX-0008", title: "North Sample Wash", path: "/?site=PIPE-PHX-0008", url: "https://distributedsites.com/?site=PIPE-PHX-0008" }],
  brokers: [],
  conversations: [],
};

const COMMS = {
  rows: [{
    commsId: "CM-0123",
    at: "2026-01-02T15:00:00.000Z",
    direction: "in",
    person: "Sample",
    firm: "Sample Co",
    channel: "email",
    summary: "Sample note",
    approximate: false,
    citedEventIds: [],
    messageId: "",
  }],
  internal: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/search?**", (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get("q") || "").toLowerCase();
    if (query.includes("siteonly")) {
      return route.fulfill({ json: { mode: "records", groups: SITES_ONLY, ids: ["PIPE-PHX-0008"] } });
    }
    if (query.includes("sample")) {
      return route.fulfill({ json: { mode: "records", groups: GROUPS, ids: ["PIPE-PHX-0008"] } });
    }
    return route.fulfill({ json: { mode: "fallback", groups: { sites: [], brokers: [], conversations: [] }, ids: [] } });
  });
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    await route.fulfill({ json: { ...body, actionsEnabled: true } });
  });
  await page.route("**/api/queue?**", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const market = new URL(route.request().url()).searchParams.get("market");
    const count = market === "all" ? 4 : 9;
    const items = Array.from({ length: count }, (_, index) => ({
      siteId: `PIPE-PHX-010${index}`,
      snapshot: { name: "Sample Wash", businessType: "Car wash" },
    }));
    return route.fulfill({ json: { items } });
  });
  await page.route("**/api/data/comms?**", (route) => route.fulfill({ json: COMMS }));
  await page.route("**/api/data/timeline?**", (route) => route.fulfill({ json: { items: [], materials: [] } }));
});

test("command search opens from the keyboard and the scope bar, then deeplinks", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; } body:has(.command-search) .map-corner, body:has(.command-search) .map-key { display: none !important; }" });
  await page.waitForSelector(".shell");
  await expect(page.locator("header.bar input.search")).toHaveCount(0);

  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const palette = page.getByTestId("command-search");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  if (info.project.name === "desktop") {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
  }

  const bar = page.locator("header.bar");
  const before = await bar.boundingBox();
  await page.getByTestId("scope-search").locator("visible=true").first().click();
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search everything").fill("sample");
  const after = await bar.boundingBox();
  expect(Math.abs((after?.height || 0) - (before?.height || 0))).toBeLessThan(4);
  await expect(palette.getByTestId("command-group-sites")).toContainText("North Sample Wash");
  await expect(palette.getByTestId("command-group-brokers")).toContainText("Sample Broker");
  const threads = palette.getByTestId("command-group-conversations");
  await expect(threads).toContainText("Sample note");
  await expect(threads).toContainText("North Sample Wash");
  await expect(threads).toContainText("Jan 2");
  if (info.project.name === "mobile") {
    const inputBox = await palette.getByLabel("Search everything").boundingBox();
    const groupBox = await palette.getByTestId("command-group-sites").boundingBox();
    const viewport = page.viewportSize();
    expect(inputBox && groupBox && viewport).toBeTruthy();
    expect(groupBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height - 4);
    expect(groupBox!.y - (inputBox!.y + inputBox!.height)).toBeLessThan(48);
    expect(groupBox!.y + 24).toBeLessThan(viewport!.height);
  }
  await palette.getByLabel("Search everything").fill("siteonly");
  await expect(palette.getByTestId("command-group-sites")).toContainText("North Sample Wash");
  await expect(palette.getByTestId("command-group-brokers")).toHaveCount(0);
  await expect(palette.getByTestId("command-group-conversations")).toHaveCount(0);
  await palette.getByLabel("Search everything").fill("sample");
  await page.screenshot({ path: `e2e/output/command-search-${info.project.name}.png`, fullPage: false });
  await palette.getByLabel("Search everything").fill("zzzzzz");
  await expect(palette.getByTestId("command-empty")).toHaveText("No matches.");
  await expect(palette.getByText("No matches.")).toHaveCount(1);
  await palette.getByLabel("Search everything").fill("sample");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await page.getByTestId("ask-open").click();
  await page.evaluate(() => {
    const node = document.querySelector<HTMLTextAreaElement>("#ask-question") ?? document.body.appendChild(document.createElement("textarea"));
    node.focus();
  });
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search everything").fill("sample");
  await expect(palette.getByTestId("command-group-sites")).toContainText("North Sample Wash");
  await palette.getByLabel("Search everything").press("Enter");
  await expect(page).toHaveURL(/site=PIPE-PHX-0008/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await page.goto("/?q=PIPE-PHX-0084&funnel=universe", { waitUntil: "domcontentloaded" });
  await page.getByTestId("scope-search").locator("visible=true").first().click();
  await palette.getByLabel("Search everything").fill("sample");
  const siteHit = palette.getByTestId("command-group-sites").getByRole("button", { name: "North Sample Wash" });
  await expect(siteHit).toBeVisible();
  await siteHit.click();
  await expect(page).toHaveURL(/site=PIPE-PHX-0008/);
  await expect(page).not.toHaveURL(/[?&]q=/);

  await page.getByTestId("panel-tab-activity").click();
  await expect(page).toHaveURL(/panel=activity/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await page.getByTestId("comms-CM-0123").getByRole("button").click();
  await expect(page).toHaveURL(/panel=activity/);
  await expect(page).toHaveURL(/msg=CM-0123/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("comms-CM-0123")).toHaveClass(/tl-highlight/);
  await page.screenshot({ path: `e2e/output/activity-deeplink-${info.project.name}.png`, fullPage: false });

  await page.goto("/?funnel=pipeline&view=list&q=3510+W+Cactus+Rd", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("queue-count")).toHaveText("4");
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/review=1/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByTestId("queue-count")).toHaveText("4");
});
