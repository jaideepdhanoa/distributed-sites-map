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

test("Phoenix listed and desk counts leave land parcels out until that category is on", () => {
  const links = landLinks(deals);
  const washes = defaultCategories();
  const withLand = { ...washes, land: true };
  const phx = sites.filter((site) => site.city === "PHX").map((site) => presentSite(site));
  const listed = phx.filter((site) => inStage(site, "in_area") && site.listed);
  const listedWashes = listed.filter((site) => siteInCategories(site, links, washes));
  assert.equal(listed.length, 30);
  assert.equal(listedWashes.length, 4);
  assert.ok(listedWashes.every((site) => !isLandParcelSite(site, links)));
  assert.equal(listed.filter((site) => siteInCategories(site, links, withLand)).length, 30);

  const desk = (categories: typeof washes) =>
    deals.filter((deal) => deal.city === "PHX" && deal.stage_group === "desk" && dealInCategories(deal, categories));
  assert.equal(desk(washes).length, 7);
  assert.equal(desk(withLand).length, 39);
  assert.equal(desk({ ...washes, store: true }).length, 10);
  assert.ok(desk(withLand).some((deal) => deal.kind === "land" && deal.deal_id.startsWith("LAND-PHX-")));
});

test("search hides land parcels until the Land category is on", () => {
  const hidden = collectSearchHits("LAND-PHX-0035", deals, sites).map((hit) => hit.id);
  assert.equal(hidden.includes("LAND-PHX-0035"), false);
  const shown = collectSearchHits("LAND-PHX-0035", deals, sites, () => "universe", { land: true }).map((hit) => hit.id);
  assert.equal(shown.includes("LAND-PHX-0035"), true);
});

test("auto service is a pipeline category, separate from car washes", () => {
  const byId = new Map(deals.map((deal) => [deal.deal_id, deal]));
  const row = (id: string) => {
    const deal = byId.get(id);
    assert.ok(deal, id);
    return deal;
  };

  for (const type of ["Auto repair", "Tire and lube", "Auto service", "General auto repair", "Tire and light auto service"]) {
    assert.equal(isAutoBusinessType(type), true, type);
    assert.equal(dealCategory({ kind: "pipeline", business_type: type }), "auto", type);
    assert.equal(dealCategory({ kind: "land", business_type: type }), "land", type);
  }
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Car wash" }), "wash");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Other" }), "wash");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Gas station", name: "Corner service station with a tenant" }), "store");

  assert.equal(dealCategory(row("PIPE-MIA-0074")), "auto");
  assert.equal(dealCategory(row("PIPE-MIA-0077")), "auto");
  assert.equal(row("PIPE-MIA-0074").business_type, "Auto repair");
  assert.equal(row("PIPE-MIA-0077").business_type, "Auto repair");
  const tires = deals.filter((deal) => deal.kind === "pipeline" && deal.business_type === "Tire and lube");
  assert.ok(tires.length > 0);
  assert.ok(tires.every((deal) => dealCategory(deal) === "auto"));

  assert.equal(row("PIPE-PHX-0081").business_type, "Car wash");
  assert.equal(dealCategory(row("PIPE-PHX-0081")), "wash");
  assert.equal(row("PIPE-MIA-0082").business_type, "Car wash");
  assert.equal(dealCategory(row("PIPE-MIA-0082")), "wash");
  assert.equal(row("PIPE-PHX-0083").business_type, "Car wash");
  assert.equal(dealCategory(row("PIPE-PHX-0083")), "wash");
  assert.equal(row("PIPE-PHX-0085").business_type, "Auto repair");
  assert.equal(dealCategory(row("PIPE-PHX-0085")), "auto");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Auto repair", name: "8812-8828 N Black Canyon Hwy (auto center)" }), "auto");
  assert.equal(dealCategory({ kind: "pipeline", business_type: "Car wash", name: "Rinse My Ride" }), "wash");

  const links = landLinks(deals);
  const corner = sites.find((site) => site.site_id === "WB-MIA-0011");
  assert.ok(corner);
  assert.equal(siteCategory(corner, links), "wash");
  const parcel = row("LAND-MIA-0006");
  assert.equal(parcel.business_type, "Auto repair");
  assert.equal(dealCategory(parcel), "land");

  const open = defaultCategories();
  const washesOnly = { ...open, auto: false };
  const autosOnly = { ...open, wash: false };
  const miamiDesk = (categories: typeof open) =>
    deals.filter((deal) => deal.city === "MIA" && deal.stage_group === "desk" && dealInCategories(deal, categories));
  const both = miamiDesk(open).map((deal) => deal.deal_id).sort();
  assert.deepEqual(both, ["PIPE-MIA-0012", "PIPE-MIA-0013", "PIPE-MIA-0074", "PIPE-MIA-0077", "PIPE-MIA-0086"]);
  assert.deepEqual(miamiDesk(washesOnly).map((deal) => deal.deal_id).sort(), ["PIPE-MIA-0086"]);
  assert.deepEqual(miamiDesk(autosOnly).map((deal) => deal.deal_id).sort(), ["PIPE-MIA-0012", "PIPE-MIA-0013", "PIPE-MIA-0074", "PIPE-MIA-0077"]);

  const found = collectSearchHits("PIPE-MIA-0074", deals, sites).map((hit) => hit.id);
  assert.equal(found.includes("PIPE-MIA-0074"), true);
  const hidden = collectSearchHits("PIPE-MIA-0074", deals, sites, () => "universe", { auto: false }).map((hit) => hit.id);
  assert.equal(hidden.includes("PIPE-MIA-0074"), false);
  const census = collectSearchHits("WB-MIA-0011", deals, sites, () => "universe", { auto: false }).map((hit) => hit.id);
  assert.equal(census.includes("WB-MIA-0011"), true);
});
