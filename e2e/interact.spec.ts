import { expect, test } from "@playwright/test";
import { HOLDS } from "./expect";
import { PIN_HOOK } from "./hook";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(PIN_HOOK);
  await page.route(/arcgisonline\.com/, (route) => route.abort());
});

test("mobile layers and the menu are not open together", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".menu-sheet")).toBeVisible();
  await expect(page.locator(".legend")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator(".layers.open")).toBeVisible();
  await expect(page.locator(".menu-sheet")).toBeHidden();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".menu-sheet")).toBeVisible();
  await expect(page.locator(".layers.open")).toHaveCount(0);
});

test("Back returns to the previous city and step", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (info.project.name === "mobile") await page.locator("select[aria-label='City']").selectOption("MIA");
  else await page.getByRole("button", { name: "Miami" }).click();
  await page.waitForURL(/city=MIA/);
  if (info.project.name === "mobile") await page.locator(".phone-step").click();
  await page.locator(".funnel .step button", { hasText: "Cleared" }).first().click();
  await page.waitForURL(/stage=cleared/);
  await page.goBack();
  await page.waitForFunction(() => !location.search.includes("stage=cleared"));
  expect(page.url()).toContain("city=MIA");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "MIA");
  await expect(page.locator(".shell")).toHaveAttribute("data-stage", "land");
  await page.goBack();
  await page.waitForFunction(() => !location.search.includes("city=MIA"));
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "PHX");
});

test("a shared link restores the city, step, filter, card, and table", async ({ page }, info) => {
  await page.goto("/?city=LAS&stage=cleared&tier=L10&site=LAS-U129&table=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await expect(page.locator(".shell")).toHaveAttribute("data-city", "LAS");
  await expect(page.locator(".shell")).toHaveAttribute("data-stage", "cleared");
  await expect(page.locator("aside.drawer")).toContainText("LAS-U129");
  await expect(page.locator(".removable")).toContainText(/Larger|10,000/);
  const visibleRows = info.project.name === "mobile" ? page.locator(".dock .stack-list button") : page.locator(".dock tbody tr");
  await expect(visibleRows.first()).toBeVisible();
  expect(page.url()).toContain("tier=L10");
  expect(page.url()).toContain("table=1");
});

test("export matches the rows and columns on screen", async ({ page }) => {
  await page.goto("/?stage=cleared&view=list", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".list-pane tbody tr", { state: "attached" });
  const headers = await page.locator(".list-pane thead th").evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").replace(/[↑↓]/g, "").trim()).filter((text) => text && text !== "Map"));
  const rowIds = await page.locator(".list-pane tbody tr td:first-child").evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").trim()));
  expect(rowIds.length).toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = (await import("node:fs")).readFileSync((await download.path()) || "", "utf8");
  const parsed = parseCsv(csv).filter((row) => row.some(Boolean));
  expect(parsed[0]).toEqual(headers);
  expect(parsed.slice(1).map((row) => row[0]).sort()).toEqual([...rowIds].sort());
});

test("review holds are Possible", async ({ page }, info) => {
  await page.goto("/?site=PHX-U180", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  for (const id of HOLDS) {
    await page.goto(`/?site=${id}`, { waitUntil: "domcontentloaded" });
    const drawer = page.locator("aside.drawer");
    await expect(drawer).toContainText(id);
    await expect(drawer).not.toContainText("Utility proximity");
    await expect(drawer).not.toContainText("Serving utility");
    await expect(drawer.locator(".badge.pending, .badge.checked, .badge.gone")).toHaveText("Possible");
  }
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "How to read this" }).click();
  } else {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "How to read this" }).click();
  }
  await expect(page.locator(".guide")).toBeVisible();
});

test("signing out leaves the map and the data API", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
  }
  await page.waitForURL(/\/login/);
  const response = await page.request.get("/api/data/funnel");
  expect(response.status()).toBe(401);
});
