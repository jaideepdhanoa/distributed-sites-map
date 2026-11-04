import { expect, test, type Page } from "@playwright/test";
import {
  CITIES,
  HOLDS,
  PIPE_LABEL,
  PIPE_STEPS,
  STEP_LABEL,
  STEPS,
  expectedOffMarket,
  expectedSites,
  expectedSquares,
  stageGroupFromText,
  unfilteredCount,
  type Catalog,
  type Chips,
} from "./expect";
import { PIN_HOOK } from "./hook";

type Drawn = { id: string; verdict: string; network_status: string; stage_group: string; kind: string };

const FILTERS: { label: string; chips: Chips; query: string }[] = [
  { label: "tier L10", chips: { tier: "L10" }, query: "tier=L10" },
  { label: "tier L4", chips: { tier: "L4" }, query: "tier=L4" },
  { label: "verdict PASS", chips: { verdict: "PASS" }, query: "verdict=PASS" },
  { label: "verdict MAYBE", chips: { verdict: "MAYBE" }, query: "verdict=MAYBE" },
  { label: "verdict UNRESOLVED", chips: { verdict: "UNRESOLVED" }, query: "verdict=UNRESOLVED" },
  { label: "listed", chips: { listed: "yes" }, query: "listed=yes" },
  { label: "land", chips: { land: true }, query: "land=1" },
  { label: "type Auto repair", chips: { types: ["Auto repair"] }, query: "types=Auto+repair" },
  { label: "type Car wash", chips: { types: ["Car wash"] }, query: "types=Car+wash" },
  { label: "search car wash", chips: { query: "car wash" }, query: "q=car+wash" },
];

async function loadCatalog(page: Page, city: string): Promise<Catalog> {
  const [sites, deals] = await Promise.all([
    page.request.get(`/api/data/sites?city=${city}`),
    page.request.get("/api/data/deals"),
  ]);
  expect(sites.ok(), "sites API").toBeTruthy();
  expect(deals.ok(), "deals API").toBeTruthy();
  return { sites: await sites.json().then((body) => body.features), deals: await deals.json().then((body) => body.features) };
}

function same(label: string, actual: string[], expected: string[]) {
  const drawn = [...new Set(actual.filter(Boolean))].sort();
  const want = [...new Set(expected)].sort();
  const missing = want.filter((id) => !drawn.includes(id));
  const extra = drawn.filter((id) => !want.includes(id));
  expect(missing, `${label} missing`).toEqual([]);
  expect(extra, `${label} extra`).toEqual([]);
}

async function source(page: Page, name: string): Promise<Drawn[]> {
  return page.evaluate((key) => ((window as unknown as { __src?: Record<string, Drawn[]> }).__src?.[key]) || [], name);
}

async function go(page: Page, query: string) {
  await page.evaluate((next) => {
    document.getElementById("e2e-nav")?.remove();
    const link = document.createElement("a");
    link.id = "e2e-nav";
    link.href = `/?${next}`;
    link.textContent = "Open";
    document.body.appendChild(link);
  }, query);
  await page.locator("#e2e-nav").click();
  await page.waitForURL((url) => {
    const want = new URLSearchParams(query);
    for (const [key, value] of want) {
      if (url.searchParams.get(key) !== value) return false;
    }
    return true;
  });
}

async function openMap(page: Page, query: string, ready: { city: string; stage?: string; visible: string; source: string; ids: string[]; off?: string[] }) {
  await go(page, query);
  const want = [...ready.ids].sort().join("\n");
  const wantOff = ready.off ? [...ready.off].sort().join("\n") : null;
  try {
    await page.waitForFunction(
      ({ expectReady, wantIds, offIds }) => {
        const shell = document.querySelector(".shell");
        const src = (window as unknown as { __src?: Record<string, { id: string }[]> }).__src || {};
        const rows = src[expectReady.source] || [];
        if (!shell) return false;
        if (shell.getAttribute("data-city") !== expectReady.city) return false;
        if (expectReady.stage && shell.getAttribute("data-stage") !== expectReady.stage) return false;
        if (shell.getAttribute("data-visible") !== expectReady.visible) return false;
        if (rows.map((row) => row.id).filter(Boolean).sort().join("\n") !== wantIds) return false;
        if (offIds == null) return true;
        return (src.offmarket || []).map((row) => row.id).filter(Boolean).sort().join("\n") === offIds;
      },
      { expectReady: ready, wantIds: want, offIds: wantOff },
      { timeout: 20_000 },
    );
  } catch {
    const got = (await source(page, ready.source)).map((pin) => pin.id);
    same(`${query} timed out`, got, ready.ids);
    if (ready.off) same(`${query} off-market timed out`, (await source(page, "offmarket")).map((pin) => pin.id), ready.off);
  }
}

async function badge(page: Page, label: string) {
  const text = (await page.locator(".funnel .step").filter({ hasText: label }).locator("strong").first().innerText()).replace(/,/g, "").replace(/\s+/g, " ").trim();
  const of = /^(\d+) of (\d+)$/.exec(text);
  if (of) return { shown: Number(of[1]), total: Number(of[2]), filtered: true, text };
  const plain = /^(\d+)$/.exec(text);
  expect(plain, `badge ${label}: ${text}`).not.toBeNull();
  return { shown: Number(plain?.[1]), total: Number(plain?.[1]), filtered: false, text };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(PIN_HOOK);
  await page.route(/arcgisonline\.com/, (route) => route.abort());
});

for (const city of CITIES) {
  test(`${city} pins match the API at every step and filter`, async ({ page }) => {
    const catalog = await loadCatalog(page, city);
    const cityQuery = city === "PHX" ? "" : `city=${city}&`;
    await page.goto(`/?${cityQuery}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    await page.waitForFunction(() => ((window as unknown as { __src?: { sites?: unknown[] } }).__src?.sites || []).length > 0);

    const sets = new Map<string, Set<string>>();
    for (const step of STEPS) {
      const expected = expectedSites(catalog, city, step);
      const off = expectedOffMarket(catalog, city);
      await openMap(page, `${cityQuery}stage=${step}`, {
        city,
        stage: step,
        visible: String(expected.visible),
        source: "sites",
        ids: expected.drawn,
        off,
      });
      const drawn = await source(page, "sites");
      same(`${city} ${step}`, drawn.map((pin) => pin.id), expected.drawn);
      const count = await badge(page, STEP_LABEL[step]);
      expect(count.shown, `${city} ${step} badge`).toBe(expected.visible);
      expect(count.filtered, `${city} ${step} unfiltered badge`).toBe(false);
      same(`${city} ${step} off-market`, (await source(page, "offmarket")).map((pin) => pin.id), off);
      sets.set(step, new Set(expected.drawn));
      for (const extra of ["listed", "contacted"] as const) {
        const subset = expectedSites(catalog, city, step, { extra });
        if (!subset.drawn.length && !subset.visible) continue;
        await openMap(page, `${cityQuery}stage=${step}&extra=${extra}`, {
          city,
          stage: step,
          visible: String(subset.visible),
          source: "sites",
          ids: subset.drawn,
        });
        same(`${city} ${step} ${extra}`, (await source(page, "sites")).map((pin) => pin.id), subset.drawn);
      }
    }
    for (let index = 1; index < STEPS.length; index += 1) {
      const prior = sets.get(STEPS[index - 1])!;
      for (const id of sets.get(STEPS[index])!) expect(prior.has(id), `${city} ${STEPS[index]} not inside ${STEPS[index - 1]}`).toBe(true);
    }
    const cleared = sets.get("cleared")!;
    for (const id of HOLDS) expect(cleared.has(id), `${id} cleared`).toBe(false);

    for (const step of STEPS) {
      for (const filter of FILTERS) {
        const expected = expectedSites(catalog, city, step, filter.chips);
        const off = filter.chips.query || filter.chips.types ? expectedOffMarket(catalog, city, filter.chips) : undefined;
        await openMap(page, `${cityQuery}stage=${step}&${filter.query}`, {
          city,
          stage: step,
          visible: String(expected.visible),
          source: "sites",
          ids: expected.drawn,
          off,
        });
        const drawn = await source(page, "sites");
        same(`${city} ${step} ${filter.label}`, drawn.map((pin) => pin.id), expected.drawn);
        const count = await badge(page, STEP_LABEL[step]);
        expect(count.filtered, `${city} ${step} ${filter.label}`).toBe(true);
        expect(count.shown, `${city} ${step} ${filter.label} badge`).toBe(expected.visible);
        expect(count.total, `${city} ${step} ${filter.label} total`).toBe(unfilteredCount(catalog, city, step));
        if (filter.chips.query || filter.chips.types) {
          const off = expectedOffMarket(catalog, city, filter.chips);
          same(`${city} ${step} ${filter.label} off-market`, (await source(page, "offmarket")).map((pin) => pin.id), off);
        }
      }
    }

    const tierSets = new Map<string, Set<string>>();
    for (const step of STEPS) tierSets.set(step, new Set(expectedSites(catalog, city, step, { tier: "L4" }).drawn));
    for (let index = 1; index < STEPS.length; index += 1) {
      for (const id of tierSets.get(STEPS[index])!) expect(tierSets.get(STEPS[index - 1])!.has(id), `${city} L4 funnel`).toBe(true);
    }

    for (const query of ["LLC", `${city}-U1`]) {
      const expected = expectedSites(catalog, city, "universe", { query });
      await openMap(page, `${cityQuery}stage=universe&q=${encodeURIComponent(query)}`, {
        city,
        stage: "universe",
        visible: String(expected.visible),
        source: "sites",
        ids: expected.drawn,
      });
      same(`${city} search ${query}`, (await source(page, "sites")).map((pin) => pin.id), expected.drawn);
    }

    const held = expectedSites(catalog, city, "land", { extra: "held" });
    if (held.visible || held.drawn.length) {
      await openMap(page, `${cityQuery}extra=held`, {
        city,
        visible: String(held.visible),
        source: "sites",
        ids: held.drawn,
      });
      same(`${city} held`, (await source(page, "sites")).map((pin) => pin.id), held.drawn);
    }

    const county = expectedSites(catalog, city, "county");
    await openMap(page, `${cityQuery}stage=county`, {
      city,
      stage: "county",
      visible: String(county.visible),
      source: "sites",
      ids: county.drawn,
    });
    const countyPins = await source(page, "sites");
    for (const id of HOLDS) {
      const pin = countyPins.find((item) => item.id === id);
      if (!pin) continue;
      expect(pin.verdict, id).not.toBe("PASS");
      expect(pin.network_status, id).not.toBe("cleared");
    }
  });

  test(`${city} pipeline squares match the selected stage`, async ({ page }) => {
    const catalog = await loadCatalog(page, city);
    const cityQuery = city === "PHX" ? "" : `city=${city}&`;
    await page.goto(`/?${cityQuery}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".shell");
    await page.waitForSelector(".map[data-deal-markers='square']");

    for (const step of PIPE_STEPS) {
      const expected = expectedSquares(catalog, city, step);
      await go(page, `${cityQuery}funnel=pipeline&tab=pipeline&pstage=${step}`);
      await page.waitForFunction(
        (count) => (((window as unknown as { __src?: { deals?: unknown[] } }).__src?.deals) || []).length === count,
        expected.length,
        { timeout: 20_000 },
      );
      const drawn = await source(page, "deals");
      same(`${city} pipeline ${step}`, drawn.map((pin) => pin.id), expected);
      for (const pin of drawn) {
        expect(pin.kind, pin.id).toBe("pipeline");
        expect(pin.stage_group, pin.id).toBe(step);
      }
      expect((await source(page, "offmarket")).length, `${city} ${step} off-market hidden`).toBe(0);
      const count = await badge(page, PIPE_LABEL[step]);
      expect(count.shown, `${city} ${step} badge`).toBe(expected.length);
      await expect(page.locator(".map[data-deal-markers='square']"), "deal marker").toBeAttached();
    }

    const repair = expectedSquares(catalog, city, "desk", { types: ["Auto repair"] });
    await go(page, `${cityQuery}funnel=pipeline&tab=pipeline&pstage=desk&types=Auto+repair`);
    await page.waitForFunction(
      (count) => (((window as unknown as { __src?: { deals?: unknown[] } }).__src?.deals) || []).length === count,
      repair.length,
      { timeout: 20_000 },
    );
    same(`${city} pipeline type`, (await source(page, "deals")).map((pin) => pin.id), repair);
    expect((await badge(page, PIPE_LABEL.desk)).shown).toBe(repair.length);
  });
}

test("deal stage counts follow the stage text", async ({ page }) => {
  const response = await page.request.get("/api/data/deals");
  expect(response.ok()).toBeTruthy();
  const features = (await response.json()).features as { properties: { deal_id: string; stage?: string; stage_group?: string; city: string; kind: string } }[];
  const mismatches = features
    .filter((feature) => stageGroupFromText(feature.properties.stage) !== feature.properties.stage_group)
    .map((feature) => feature.properties.deal_id);
  expect(mismatches, "stage text disagrees with stage group").toEqual([]);
});
