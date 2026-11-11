import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  categoriesParam,
  dealInCategories,
  defaultCategories,
  isLandParcelSite,
  landLinks,
  parseCategories,
  siteInCategories,
} from "../lib/categories.ts";
import { inStage, presentSite } from "../lib/filter.ts";
import { collectSearchHits } from "../lib/search.ts";
import type { SiteProps } from "../lib/types.ts";

type DealRow = {
  deal_id: string;
  city?: string;
  kind?: string;
  stage_group?: string;
  universe_id?: string | null;
  name?: string;
  is_c_store?: boolean;
  business_type?: string;
};

type SiteRow = SiteProps & { city?: string };

const deals = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")).features.map(
  (feature: { properties: DealRow }) => feature.properties,
) as DealRow[];
const sites = JSON.parse(readFileSync("data/generated/sites.geojson", "utf8")).features.map(
  (feature: { properties: SiteRow }) => feature.properties,
) as SiteRow[];

test("category links default to car washes and keep an explicit set", () => {
  assert.deepEqual(parseCategories({}), defaultCategories());
  assert.deepEqual(parseCategories({ landlayer: "1" }), { wash: true, land: true, store: false });
  assert.deepEqual(parseCategories({ cstore: "1" }), { wash: true, land: false, store: true });
  assert.deepEqual(parseCategories({ cats: "land" }), { wash: false, land: true, store: false });
  assert.deepEqual(parseCategories({ cats: "wash|store", landlayer: "1" }), { wash: true, land: false, store: true });
  assert.deepEqual(parseCategories({ cats: "none" }), { wash: false, land: false, store: false });
  assert.equal(categoriesParam(defaultCategories()), null);
  assert.equal(categoriesParam({ wash: true, land: true, store: false }), "wash|land");
  assert.equal(categoriesParam({ wash: false, land: false, store: false }), "none");
});

test("Phoenix listed and desk counts leave land parcels out until that category is on", () => {
  const links = landLinks(deals);
  const washes = defaultCategories();
  const withLand = { ...washes, land: true };
  const phx = sites.filter((site) => site.city === "PHX").map((site) => presentSite(site));
  const listed = phx.filter((site) => inStage(site, "in_area") && site.listed);
  const listedWashes = listed.filter((site) => siteInCategories(site, links, washes));
  assert.equal(listed.length, 26);
  assert.equal(listedWashes.length, 4);
  assert.ok(listedWashes.every((site) => !isLandParcelSite(site, links)));
  assert.equal(listed.filter((site) => siteInCategories(site, links, withLand)).length, 26);

  const desk = (categories: typeof washes) =>
    deals.filter((deal) => deal.city === "PHX" && deal.stage_group === "desk" && dealInCategories(deal, categories));
  assert.equal(desk(washes).length, 1);
  assert.equal(desk(withLand).length, 21);
  assert.equal(desk({ wash: true, land: false, store: true }).length, 4);
  assert.ok(desk(withLand).some((deal) => deal.kind === "land" && deal.deal_id.startsWith("LAND-PHX-")));
});

test("search hides land parcels until the Land category is on", () => {
  const hidden = collectSearchHits("LAND-PHX-0035", deals, sites).map((hit) => hit.id);
  assert.equal(hidden.includes("LAND-PHX-0035"), false);
  const shown = collectSearchHits("LAND-PHX-0035", deals, sites, () => "universe", { land: true }).map((hit) => hit.id);
  assert.equal(shown.includes("LAND-PHX-0035"), true);
});
