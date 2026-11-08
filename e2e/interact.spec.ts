import { expect, test, type Page } from "@playwright/test";
import { HOLDS } from "./expect";
import { PIN_HOOK } from "./hook";

const BANNED = /\b(?:charging|evs?|avs?|stalls?|power|utility|electric|kw|cindel|ming|ricardo|yuka|jaideep|jesse|muse|torque|indie|grok|nda|loi|offers?|walk-?away|target price)\b/gi;

function bannedHits(text: string) {
  const hits = new Set<string>();
  for (const match of text.matchAll(BANNED)) {
    const word = match[0].toLowerCase();
    const around = text.slice(Math.max(0, (match.index || 0) - 30), (match.index || 0) + match[0].length + 30);
    if (word === "power" && /\bpower\s+(rd|road)\b/i.test(around)) continue;
    // Stage 4 is labeled "Offer and close". The count is glued on in the bar text ("Offer and close0"), so this phrase is not an offer price.
    if (word === "offer" && /\boffer\s+and\s+close/i.test(around)) continue;
    if (word === "kw" && /\d[\d,]*\s+kw\b/i.test(around)) continue;
    hits.add(match[0]);
  }
  return [...hits];
}

async function visibleText(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (!shell) return "";
    const copy = shell.cloneNode(true) as HTMLElement;
    for (const note of copy.querySelectorAll(".menu-note")) {
      if (!note.textContent?.includes("published build")) note.remove();
    }
    return copy.innerText;
  });
}

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

test("mobile legend and menu are not open together", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Legend" }).click();
  await expect(page.locator(".legend.open")).toBeVisible();
  await expect(page.locator(".menu-sheet")).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator(".menu-sheet")).toBeVisible();
  await expect(page.locator(".legend.open")).toHaveCount(0);
});

test("Back returns to the previous city and step", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  if (info.project.name === "mobile") await page.locator("select[aria-label='City']").selectOption("MIA");
  else await page.getByRole("button", { name: "Miami" }).click();
  await page.waitForURL(/city=MIA/);
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

test("export matches the rows and columns on screen", async ({ page }, info) => {
  await page.goto("/?stage=cleared&table=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(info.project.name === "mobile" ? ".dock .stack-list button" : ".dock tbody tr");
  const headers = await page.locator(".dock thead th").evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").replace(/[↑↓]/g, "").trim()));
  const rowIds = await page.locator(".dock tbody tr td:first-child").evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").trim()));
  expect(rowIds.length).toBeGreaterThan(0);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu" }).click();
  } else {
    await page.getByRole("button", { name: "More" }).click();
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = (await import("node:fs")).readFileSync((await download.path()) || "", "utf8");
  const first = csv.split(/\r?\n/, 1)[0];
  expect(first.startsWith("# Filters:")).toBeTruthy();
  expect(first).toContain("city PHX");
  expect(first).toContain("step cleared");
  const parsed = parseCsv(csv.split(/\r?\n/).slice(1).join("\n")).filter((row) => row.some(Boolean));
  expect(parsed[0]).toEqual(headers);
  expect(parsed.slice(1).map((row) => row[0]).sort()).toEqual([...rowIds].sort());
  if (info.project.name === "desktop") await expect(page.locator(".more-wrap .menu")).toBeHidden();
  else await expect(page.locator(".menu-sheet")).toBeHidden();
});

test("review holds are Possible and the page has no banned terms", async ({ page }, info) => {
  await page.goto("/?site=PHX-U180", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("aside.drawer");
  for (const id of HOLDS) {
    await page.goto(`/?site=${id}`, { waitUntil: "domcontentloaded" });
    const drawer = page.locator("aside.drawer");
    await expect(drawer).toContainText(id);
    await expect(drawer).not.toContainText("Utility proximity");
    await expect(drawer).not.toContainText("Serving utility");
    await expect(drawer.locator(".badge.pending, .badge.checked, .badge.gone")).toHaveText("Possible");
    expect(bannedHits(await drawer.innerText()), id).toEqual([]);
  }
  for (const query of ["", "city=LAS", "city=MIA", "funnel=pipeline&tab=pipeline", "city=LAS&funnel=pipeline&pstage=dropped"]) {
    await page.goto(`/?${query}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    expect(bannedHits(await visibleText(page)), query || "home").toEqual([]);
  }
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "How to read this" }).click();
  } else {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "How to read this" }).click();
  }
  await expect(page.locator(".guide")).toBeVisible();
  expect(bannedHits(await page.locator(".guide").innerText())).toEqual([]);
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
