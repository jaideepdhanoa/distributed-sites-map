import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  categoriesParam,
  dealCategory,
  dealInCategories,
  defaultCategories,
  isLandParcelSite,
  landLinks,
  parseCategories,
  siteCategory,
  siteInCategories,
} from "../lib/categories.ts";
import { inStage, presentSite } from "../lib/filter.ts";
import { CATEGORY_NOTES, UNSCREENED_LISTINGS_LABEL, UNSCREENED_LISTINGS_NOTE, isAutoBusinessType } from "../lib/labels.ts";
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

test("category links default to car washes and auto service", () => {
  assert.deepEqual(defaultCategories(), { wash: true, auto: true, land: false, store: false });
  assert.deepEqual(parseCategories({}), defaultCategories());
  assert.deepEqual(parseCategories({ landlayer: "1" }), { wash: true, auto: true, land: true, store: false });
  assert.deepEqual(parseCategories({ cstore: "1" }), { wash: true, auto: true, land: false, store: true });
  assert.deepEqual(parseCategories({ cats: "land" }), { wash: false, auto: false, land: true, store: false });
  assert.deepEqual(parseCategories({ cats: "wash|store", landlayer: "1" }), { wash: true, auto: false, land: false, store: true });
  assert.deepEqual(parseCategories({ cats: "none" }), { wash: false, auto: false, land: false, store: false });
  assert.equal(categoriesParam(defaultCategories()), null);
  assert.equal(categoriesParam({ wash: true, auto: false, land: true, store: false }), "wash|land");
  assert.equal(categoriesParam({ wash: true, auto: true, land: true, store: false }), "wash|auto|land");
  assert.equal(categoriesParam({ wash: false, auto: false, land: false, store: false }), "none");
  assert.match(CATEGORY_NOTES.auto, /Auto repair/);
  assert.match(CATEGORY_NOTES.auto, /tire and lube/);
  assert.equal(UNSCREENED_LISTINGS_LABEL, "Unscreened market listings");
  assert.equal(UNSCREENED_LISTINGS_NOTE, "Listings not yet in Pipeline or Universe.");
});

test("live counts are car washes and auto service until land or c-stores are turned on", () => {
  const links = landLinks(deals);
  const open = defaultCategories();
  const withLand = { ...open, land: true };
  const withStores = { ...open, store: true };
  for (const city of ["PHX", "LAS", "MIA"]) {
    const listed = sites
      .filter((site) => site.city === city)
      .map((site) => presentSite(site))
      .filter((site) => inStage(site, "in_area") && site.listed);
    const listedOpen = listed.filter((site) => siteInCategories(site, links, open));
    assert.ok(listedOpen.every((site) => !isLandParcelSite(site, links)));
    assert.equal(listed.filter((site) => siteInCategories(site, links, withLand)).length, listed.length);

    const desk = (categories: typeof open) =>
      deals.filter((deal) => deal.city === city && deal.stage_group === "desk" && dealInCategories(deal, categories));
    const usual = desk(open);
    const washOnly = desk({ ...open, auto: false }).map((deal) => deal.deal_id);
    const autoOnly = desk({ ...open, wash: false }).map((deal) => deal.deal_id);
    assert.equal(new Set([...washOnly, ...autoOnly]).size, washOnly.length + autoOnly.length);
    assert.deepEqual([...washOnly, ...autoOnly].sort(), usual.map((deal) => deal.deal_id).sort());
    assert.ok(usual.every((deal) => deal.kind !== "land" && dealCategory(deal) !== "store"));
    const addedLand = desk(withLand).filter((deal) => !usual.some((row) => row.deal_id === deal.deal_id));
    const addedStores = desk(withStores).filter((deal) => !usual.some((row) => row.deal_id === deal.deal_id));
    assert.ok(addedLand.every((deal) => deal.kind === "land"));
    assert.ok(addedStores.every((deal) => dealCategory(deal) === "store"));
  }
});

test("search hides land parcels until the Land category is on", () => {
  const land = deals.find((deal) => deal.kind === "land" && deal.deal_id?.startsWith("LAND-"));
  assert.ok(land);
  const hidden = collectSearchHits(land.deal_id, deals, sites).map((hit) => hit.id);
  assert.equal(hidden.includes(land.deal_id), false);
  const shown = collectSearchHits(land.deal_id, deals, sites, () => "universe", { land: true }).map((hit) => hit.id);
  assert.equal(shown.includes(land.deal_id), true);
});

test("auto service is a pipeline category, separate from car washes", () => {
  for (const type of ["Auto repair", "Tire and lube", "Auto service", "General auto repair", "Tire and light auto service"]) {
    assert.equal(isAutoBusinessType(type), true, type);
    assert.equal(dealCategory({ kind: "pipeline", business_type: type }), "auto", type);
    assert.equal(dealCategory({ kind: "land", business_type: type }), "land", type);
  }
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Car wash" }), "wash");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Other" }), "wash");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Gas station", name: "Corner service station with a tenant" }), "store");
  const tires = deals.filter((deal) => deal.kind === "pipeline" && deal.business_type === "Tire and lube");
  assert.ok(tires.every((deal) => dealCategory(deal) === "auto"));
  assert.ok(deals.filter((deal) => deal.kind === "pipeline" && deal.business_type === "Auto repair").every((deal) => dealCategory(deal) === "auto"));
  assert.ok(deals.filter((deal) => deal.kind === "pipeline" && deal.business_type === "Car wash").every((deal) => dealCategory(deal) === "wash"));
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Auto repair", name: "8812-8828 N Black Canyon Hwy (auto center)" }), "auto");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Car wash", name: "Rinse My Ride" }), "wash");
  assert.equal(dealCategory({ kind: "land", business_type: "Auto repair" }), "land");

  const links = landLinks(deals);
  const census = sites.find((site) => site.origin === "universe" && !isLandParcelSite(site, links));
  assert.ok(census);
  assert.equal(siteCategory(census, links), "wash");
  const auto = deals.find((deal) => deal.kind === "pipeline" && dealCategory(deal) === "auto");
  assert.ok(auto);
  assert.equal(collectSearchHits(auto.deal_id, deals, sites).some((hit) => hit.id === auto.deal_id), true);
  assert.equal(collectSearchHits(auto.deal_id, deals, sites, () => "universe", { auto: false }).some((hit) => hit.id === auto.deal_id), false);
  assert.equal(collectSearchHits(census.site_id, deals, sites, () => "universe", { auto: false }).some((hit) => hit.id === census.site_id), true);
});
