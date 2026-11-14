import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compMedianOf,
  isLandSegment,
  landCompSets,
  listingQualifies,
  listingStale,
  priceSite,
  priceWorkbook,
  type CompSource,
  type FactRow,
  type SiteInput,
} from "../lib/pricing.ts";

assert.equal(isLandSegment("Vacant land (entitled car wash)"), true);
assert.equal(isLandSegment("Car wash: express tunnel"), false);
assert.equal(isLandSegment("Auto service building with a yard"), false);
assert.equal(isLandSegment("Industrial yard (contractor yard with shop building)"), true);
assert.equal(isLandSegment(""), false);
assert.equal(isLandSegment("", true), true);

const asOfLive = "Listed";
assert.equal(listingQualifies("Sold or withdrawn", ""), false);
assert.equal(listingQualifies("Sold — broker confirmed Nov 8, 2026"), true);
assert.equal(listingQualifies("Not verified live Nov 13, 2026 — Crexi listing appears removed"), false);
assert.equal(listingQualifies("Under contract - broker confirmed Nov 11, 2026"), true);
assert.equal(listingQualifies(asOfLive, "2024-01-01"), true);
assert.equal(listingStale("Listed (stale — last updated Jan 31, 2022; liveness re-verified Nov 5, 2026)"), true);
assert.equal(listingStale("Listed — live, verified Nov 13, 2026"), false);

function comp(partial: Partial<CompSource> & Pick<CompSource, "id">): CompSource {
  return {
    source: "land",
    market: "PHX",
    segment: "Vacant land (commercial)",
    acres: "1",
    price: "1000000",
    status: "Listed",
    checked: "Nov 10, 2026",
    area: "Yes",
    address: `${partial.id} 100 Main St`,
    link: "",
    ...partial,
  };
}

const reachLand: CompSource[] = [
  comp({ id: "A", price: "1000000", area: "Yes" }),
  comp({ id: "B", price: "1200000", area: "Yes" }),
  comp({ id: "C", price: "800000", area: "Yes" }),
  comp({ id: "D", price: "900000", area: "Yes" }),
  comp({ id: "E", price: "2000000", area: "Near 0-5" }),
  comp({ id: "F", price: "2100000", area: "Near 0-5" }),
];
const narrow = landCompSets(reachLand, []);
assert.equal(narrow.markets[0]?.reach, "plus5");
assert.equal(narrow.markets[0]?.count, 6);
assert.match(narrow.markets[0]?.tip || "", /Based on 6 land listings within 5 mi of the service area/);

const insideOnly = landCompSets(reachLand.filter((row) => row.area === "Yes").concat([
  comp({ id: "G", price: "1100000", area: "Yes" }),
]), []);
assert.equal(insideOnly.markets[0]?.reach, "service");
assert.equal(insideOnly.markets[0]?.count, 5);

const sized = landCompSets([
  comp({ id: "small", acres: "0.16" }),
  comp({ id: "big", acres: "6" }),
  comp({ id: "low", acres: "0.25", price: "250000" }),
  comp({ id: "high", acres: "5", price: "5000000" }),
  comp({ id: "mid", acres: "1", price: "1000000" }),
  comp({ id: "mid2", acres: "1.2", price: "1100000", address: "mid2 200 Oak Ave" }),
  comp({ id: "mid3", acres: "1.4", price: "1300000", address: "mid3 300 Pine Ave" }),
], []);
assert.deepEqual(sized.comps.map((row) => row.id).sort(), ["high", "low", "mid", "mid2", "mid3"]);

const copied = landCompSets(
  [comp({ id: "LAND-1", link: "https://www.loopnet.com/Listing/100-Main/40939330/", address: "4405 N 7th Ave", acres: "0.28", price: "1250000" })],
  [{ id: "L-1", source: "register", market: "PHX", acres: "0.28", price: "1250000", status: "Listed", address: "4405 N 7th Ave", link: "https://www.loopnet.com/Listing/4405-N-7th-Ave-Phoenix-AZ/40939330/" }],
);
assert.deepEqual(copied.comps.map((row) => row.id), ["LAND-1"]);

const entitled = landCompSets([
  comp({ id: "wash-name", segment: "Vacant land (entitled car wash)", address: "3141 E Ocotillo Rd" }),
  comp({ id: "real-wash", segment: "Car wash: express tunnel", address: "2436 E Cheyenne Ave" }),
  comp({ id: "yard-mention", segment: "Auto service building with a yard", address: "5690 Boulder Hwy" }),
  comp({ id: "one", address: "1 A St" }),
  comp({ id: "two", address: "2 B St" }),
  comp({ id: "three", address: "3 C St" }),
], []);
assert.equal(entitled.comps.some((row) => row.id === "wash-name"), true);
assert.equal(entitled.comps.some((row) => row.id === "real-wash"), false);
assert.equal(entitled.comps.some((row) => row.id === "yard-mention"), false);

const staleRow = comp({
  id: "old",
  status: "Listed (stale — last updated Jan 31, 2022; liveness re-verified Nov 5, 2026)",
  address: "9 D St",
});
const flagged = landCompSets([
  staleRow,
  comp({ id: "s1", address: "11 E St" }),
  comp({ id: "s2", address: "12 F St" }),
  comp({ id: "s3", address: "13 G St" }),
  comp({ id: "s4", address: "14 H St" }),
], []);
assert.equal(flagged.comps.find((row) => row.id === "old")?.stale, true);
assert.equal(flagged.markets[0]?.stale, 1);
assert.match(flagged.markets[0]?.tip || "", /1 on the market more than a year/);

const market = {
  metro: "PHX" as const,
  reach: "service" as const,
  within: "the service area",
  count: 22,
  medianPerAcre: 1_145_129,
  stale: 0,
  tip: "Estimate. Based on 22 land listings within the service area.",
  enough: true,
};
const site: SiteInput = {
  id: "PIPE-PHX-0003",
  market: "PHX",
  segment: "Car wash: express tunnel",
  acres: "0.92",
  asking: "2300000",
  revenue: "698807",
  ebitda: "102517",
  claimed: "102517",
  normalized: "",
  label: "EBITDA",
  financialsStatus: "Documented",
  countyValue: "1004424",
  countyBasis: "Maricopa County Assessor full cash value",
};
const facts: FactRow[] = [
  { id: "PIPE-PHX-0003", figure: "Revenue", period: "FY2025", value: "698807", claim: "Documented" },
  { id: "PIPE-PHX-0003", figure: "EBITDA", period: "FY2025", value: "102517", claim: "Documented" },
];
const priced = priceSite(site, facts, market);
assert.equal(priced.stated_revenue, 698807);
assert.equal(priced.revenue_basis, "Package");
assert.equal(priced.revenue_period, "FY2025");
assert.equal(priced.land_estimate, Math.round(0.92 * 1_145_129));
assert.equal(priced.business_value, 2_300_000 - (priced.land_estimate || 0));
assert.equal(priced.revenue_multiple, Math.round((2_300_000 / 698807) * 10) / 10);
assert.equal(priced.earnings_multiple, Math.round((2_300_000 / 102517) * 10) / 10);
assert.equal(priced.business_multiple, Math.round(((priced.business_value || 0) / 102517) * 10) / 10);
assert.equal(priced.earnings_multiple_which, "EBITDA");
assert.equal(priced.revenue_multiple_basis, "Broker-stated");
assert.equal(priced.business_multiple_basis, "Estimate");
assert.equal(priced.county_value, 1004424);
assert.equal(priced.land_estimate_basis, "Estimate");
assert.equal(priced.land_estimate_tip, "Based on 22 land listings within the service area");

const missing = priceSite({ ...site, revenue: "", ebitda: "", claimed: "", acres: "", countyValue: "" }, [], null);
assert.equal(missing.stated_revenue_display, null);
assert.equal(missing.revenue_multiple_display, "—");
assert.equal(missing.earnings_multiple_display, "—");
assert.equal(missing.business_multiple_display, "—");
assert.equal(missing.land_estimate_display, null);
assert.equal(missing.county_value_display, null);

const loss = priceSite({ ...site, ebitda: "-121000", claimed: "-121000" }, [], market);
assert.equal(loss.earnings_multiple_display, "Loss-making");
assert.equal(loss.business_multiple_display, "Loss-making");
assert.equal(loss.earnings_multiple, null);

const covered = priceSite({ ...site, asking: "500000", ebitda: "100000", claimed: "100000", acres: "1" }, [], market);
assert.equal(covered.business_value_display, "Land covers asking");
assert.equal(covered.business_multiple_display, "Land covers asking");

const gas = priceSite({ ...site, id: "GAS", segment: "Gas station and c-store", acres: "" }, [], market);
assert.equal(gas.pricing_eligible, true);
assert.equal(gas.revenue_multiple_display.endsWith("x"), true);
assert.equal(gas.land_estimate, null);
assert.equal(gas.land_estimate_reason, "Needs acres");
assert.equal(gas.business_multiple_reason, "Needs a land estimate");

const workbook = JSON.parse(readFileSync(new URL("../data/pricing/sources.json", import.meta.url), "utf8")) as {
  land: CompSource[];
  register: CompSource[];
  sites: SiteInput[];
  facts: FactRow[];
};
const built = landCompSets(workbook.land, workbook.register);
const phx = built.markets.find((row) => row.metro === "PHX");
const las = built.markets.find((row) => row.metro === "LAS");
const mia = built.markets.find((row) => row.metro === "MIA");
assert.equal(phx?.reach, "service");
assert.equal(phx?.count, 22);
assert.equal(Math.round(phx?.medianPerAcre || 0), 1145129);
assert.equal(las?.reach, "plus5");
assert.equal(las?.count, 11);
assert.equal(Math.round(las?.medianPerAcre || 0), 804598);
assert.equal(mia?.enough, false);
assert.equal(mia?.count, 1);
const miaSite = priceWorkbook(workbook.sites, workbook.facts, built.markets)["PIPE-MIA-0080"];
assert.equal(miaSite.land_estimate, null);
assert.equal(miaSite.land_estimate_display, null);
assert.equal(miaSite.land_estimate_reason, "Too few land comps (1 in Miami, need 5)");
assert.equal(miaSite.business_value_reason, "Needs a land estimate");
assert.equal(miaSite.business_multiple_reason, "Needs a land estimate");
assert.equal(miaSite.county_value, 728180);
assert.equal(miaSite.business_multiple_display, "—");

const hidden = compMedianOf([{ city: "PHX", comp_median_per_acre: 100, comp_median_tip: "Estimate. Based on 22 land listings within the service area." }]);
assert.equal(hidden.value, 100);
const signedOut = compMedianOf([]);
assert.equal(signedOut.value, null);

console.log("pricing ok");
