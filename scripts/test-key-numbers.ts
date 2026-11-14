import assert from "node:assert/strict";
import { listingCue } from "../lib/format.ts";
import { matchesLandTier, spareTier } from "../lib/filter.ts";
import { DEAL_LABEL_FIELD, capacityFacts, cashTile, cleanFactText, countYear, dealLabelFeatures, defaultColumnIds, displayScore, growthText, pillText, inRange, openLandText, parseColumns, peerNote, publicDeal, rangesFromSearch, sheetMoney, summaryOf, tileAmount, universeTrafficLine, vehiclesPerDay, workbookTrafficLine } from "../lib/keyNumbers.ts";
import { overlayFeatures } from "../lib/overlays.ts";
import { inSelectedMarket, matchesOpenLandTier } from "../lib/filter.ts";
import { inMapArea, parseMapArea } from "../lib/geoFilter.ts";
import { addressKey, relatedRecords } from "../lib/related.ts";
import type { DealProps } from "../lib/types.ts";

function deal(partial: Partial<DealProps>): DealProps {
  return {
    deal_id: "PIPE-1",
    kind: "pipeline",
    name: "Sample",
    address: "1 Main St",
    city: "PHX",
    stage: "1 Desk screen",
    stage_group: "desk",
    broker: "",
    firm: "Matthews",
    listing_url: "",
    asking_price: 2200000,
    asking_price_display: "$2,200,000",
    asking_price_source: "Matthews",
    next_step: "",
    universe_id: "",
    coord_status: "geocoded",
    miles_to_depot: 2.3,
    listed: true,
    source_line: "Matthews",
    land_acres: 3.98,
    land_acres_basis: "Estimated",
    open_land_sqft: 104100,
    price_per_acre: 552764,
    price_per_acre_display: "$553K",
    figures_status: "vacant",
    ...partial,
  };
}

const rows = [
  deal({ deal_id: "A", asking_price: 100, land_acres: 1, price_per_acre: 100, open_land_sqft: 10 }),
  deal({ deal_id: "B", asking_price: 300, land_acres: 2, price_per_acre: 50, open_land_sqft: 40 }),
  deal({ deal_id: "C", asking_price: null, land_acres: 3, price_per_acre: null, open_land_sqft: null }),
];
const summary = summaryOf(rows);
assert.equal(summary.count, 3);
assert.equal(summary.withAsking, 2);
assert.equal(summary.medianAsking, 200);
assert.equal(summary.totalAcres, 6);
assert.equal(summary.medianPerAcre, 75);

const filter = rangesFromSearch(new URLSearchParams("amin=200&cmax=2"));
assert.equal(inRange(rows[0], filter), false);
assert.equal(inRange(rows[1], filter), true);

const note = peerNote(rows[1], rows);
assert.equal(note?.label, "1st lowest of 2 Phoenix pipeline");

assert.equal(cashTile(deal({ figures_status: "withheld" })).value, "Package figures not shown");
assert.equal(cashTile(deal({ stated_cash_flow: -121000, stated_cash_flow_display: "-$121,000", cash_flow_label: "EBITDA", figures_basis: "Documented", package_status: "Received", figures_status: "shown" })).value, "-$121,000");
assert.equal(cashTile(deal({ stated_cash_flow: -121000, stated_cash_flow_display: "-$121,000", cash_flow_label: "EBITDA", figures_basis: "Documented", package_status: "Received" })).note, "EBITDA · Package on file");
assert.equal(cashTile(deal({ stated_cash_flow: -121000, stated_cash_flow_display: "-$121,000", cash_flow_label: "EBITDA", figures_basis: "Documented", package_status: "Received" })).basis, "Documented");
assert.equal(cashTile(deal({ figures_basis: "Claimed", stated_cash_flow_display: "$400,000", cash_flow_label: "EBITDA" })).basis, "Broker-stated");
assert.equal(cashTile(deal({ kind: "land", figures_status: "vacant", stated_cash_flow: 0, stated_cash_flow_display: "$0" })).hidden, true);
assert.equal(cashTile(deal({ kind: "land", figures_status: "vacant" })).value, "");
assert.equal(pillText(deal({ kind: "land", land_acres: 0.28, price_per_acre: 4464285.71, price_per_acre_display: "$4.46M", asking_price: 1250000 }), "acres"), "0.28 ac");
assert.equal(pillText(deal({ land_acres: 1.42, price_per_acre: 774648, price_per_acre_display: "$775K" }), "acres"), "1.42 ac");
assert.equal(pillText(deal({ land_acres: 775000, price_per_acre_display: "$775K" }), "acres"), "");
const landLabels = dealLabelFeatures([
  { geometry: { type: "Point", coordinates: [-112.08, 33.5] }, properties: deal({ kind: "land", deal_id: "LAND-PHX-0002", land_acres: 0.28, price_per_acre: 4464285.71, price_per_acre_display: "$4.46M" }) },
], "acres");
assert.deepEqual(landLabels.map((feature) => feature.properties.pill), ["0.28 ac"]);
assert.equal(landLabels.some((feature) => feature.properties.pill.includes("$")), false);
assert.equal(pillText(deal({ land_acres: 1.42, price_per_acre: 774648, price_per_acre_display: "$775K" }), "peracre"), "$775K");
assert.equal(pillText(deal({ land_acres: 1.64, price_per_acre: null, price_per_acre_display: "" }), "peracre"), "");
const labels = dealLabelFeatures([
  { geometry: { type: "Point", coordinates: [-112.1, 33.4] }, properties: deal({ deal_id: "A", land_acres: 1.42, price_per_acre: 774648 }) },
  { geometry: { type: "Point", coordinates: [-112.2, 33.5] }, properties: deal({ deal_id: "B", land_acres: 1.64, price_per_acre: null }) },
], "peracre");
assert.deepEqual(labels.map((feature) => feature.properties.pill), ["$775K"]);
assert.equal(labels.some((feature) => feature.properties.pill.includes(" ac")), false);
assert.equal(DEAL_LABEL_FIELD[0], "get");
assert.equal(DEAL_LABEL_FIELD[1], "pill");
assert.equal(spareTier({ spare_ac_own: 0 }), null);
assert.equal(spareTier({ spare_ac_own: 0.2 }), "L4");
assert.equal(workbookTrafficLine(deal({ trade_aadt: 46000, trade_aadt_road: "86000042 (N/A to N/A)", trade_aadt_m: 335 })).includes("n/a"), false);
assert.match(workbookTrafficLine(deal({ trade_aadt: 46000, trade_aadt_road: "86000042 (N/A to N/A)", trade_aadt_m: 335 })), /segment 86000042/);
assert.equal(workbookTrafficLine(deal({ trade_aadt: 266478, trade_aadt_road: "I 010", trade_aadt_m: 85 })).includes("on I-10, freeway"), true);
assert.equal(cleanFactText("OSM via diligence_sweep.py"), "");
assert.equal(cleanFactText("OSM proximity (Overpass)"), "OSM proximity (Overpass)");
assert.equal(displayScore("#REF!"), "");
assert.equal(displayScore(72), "72");
assert.equal(displayScore(""), "");
assert.equal(sheetMoney(99214, "$99,214"), "$99,214");
assert.equal(sheetMoney(317659, "$317,659"), "$317,659");
assert.equal(inSelectedMarket({ city: "UNK", address: "5020 S 16th St", listing_url: "https://www.loopnet.com/Listing/5020-S-16th-St-Phoenix-AZ/1/" }, "PHX", [-112.04799, 33.40119]), true);
assert.equal(inSelectedMarket({ city: "SNA", address: "1 Main St" }, "PHX", [-117.8, 33.6]), false);
assert.equal(inSelectedMarket({ city: "PHX", address: "1616 E Portland St" }, "PHX", null), true);
assert.equal(matchesOpenLandTier(2500, "L4"), false);
assert.equal(matchesOpenLandTier(55000, "L10"), true);
assert.equal(matchesOpenLandTier(0, "L4"), false);
assert.equal(matchesOpenLandTier(null, "L4"), false);
assert.equal(addressKey("5020 S 16th St"), addressKey("5020 S 16th Street"));
assert.equal(relatedRecords(
  { id: "LAND-PHX-0033", kind: "deal", address: "5020 S 16th St", name: "5020 S 16th St" },
  [{ id: "WB-PHX-0016", kind: "site", address: "5020 S 16th St", name: "Vacant lot", apn: "113-54-014" }],
)[0]?.id, "WB-PHX-0016");
const overlayDeal = {
  geometry: { type: "Point", coordinates: [-112.05, 33.46] },
  properties: deal({ trade_aadt: 266478, trade_aadt_road: "I 010", trade_aadt_max: 386198, trade_population: null, trade_washes_1mi: 1, trade_washes_3mi: 6 }),
};
const overlayBlank = {
  geometry: { type: "Point", coordinates: [-112.1, 33.4] },
  properties: deal({ deal_id: "BLANK", trade_aadt: null, trade_population: null, trade_washes_1mi: null, trade_washes_3mi: null }),
};
const trafficLabels = overlayFeatures([overlayDeal, overlayBlank], ["traffic", "population", "washes"]);
assert.equal(trafficLabels.length, 1);
assert.match(trafficLabels[0].properties.label, /freeway/);
assert.equal(trafficLabels[0].properties.label.includes("people"), false);
assert.match(trafficLabels[0].properties.label, /washes 1 in 1 mi, 6 in 3 mi/);
assert.equal(inMapArea(-112.05, 33.46, { kind: "radius", lng: -112.05, lat: 33.46, miles: 1 }), true);
assert.equal(inMapArea(-112.2, 33.46, { kind: "radius", lng: -112.05, lat: 33.46, miles: 1 }), false);
assert.equal(parseMapArea({ get: (key) => key === "ring" ? "-112.05000,33.46000,1" : key === "poly" ? "-112,33;-112,34;-111,34" : null }), null);
assert.deepEqual(capacityFacts({ cap_a_substation_mi: 0.96, cap_a_line_ft: 7873, cap_a_source: "OSM via diligence_sweep.py" }, "deal"), [
  { id: "a", lines: ["Substation 0.96 mi", "Line 7,873 ft"], basis: "" },
]);
assert.equal(matchesLandTier({ spare_ac_own: 0 }, "L4"), false);
assert.equal(matchesLandTier({ spare_ac_own: 0.2 }, "L4"), true);
assert.equal(matchesLandTier({ spare_ac_own: null }, "L4"), false);
assert.equal(growthText(-0.0557), "-5.57%");
assert.equal(countYear("2025"), "2025");
assert.equal(countYear(""), "");
assert.equal(vehiclesPerDay("32,500", "2024"), "32,500 vehicles/day · 2024");
assert.equal(vehiclesPerDay(840), "840 vehicles/day");
assert.equal(vehiclesPerDay(""), "");
assert.equal(vehiclesPerDay(null), "");
const miami = universeTrafficLine({
  aadt_count: "14,300",
  aadt_road: "US 1",
  aadt_year: "2025",
  aadt_source: "FDOT annual average daily traffic, retrieved 2026-11-04. Nearest counted road within 150 m.",
});
assert.match(miami, /14,300 vehicles\/day · 2025/);
assert.equal(miami.includes("2026"), false);
assert.equal(universeTrafficLine({ aadt_count: "81000", aadt_year: "2024", aadt_source: "" }), "81,000 vehicles/day · 2024");
assert.equal(universeTrafficLine({ aadt_count: "" }), "");
assert.match(workbookTrafficLine(deal({ trade_aadt: 840, trade_aadt_road: "07  SOUTHERN AVE", trade_aadt_m: 58, trade_aadt_max: 27012 })), /840 vehicles\/day/);
assert.match(workbookTrafficLine(deal({ trade_aadt: 840, trade_aadt_road: "07  SOUTHERN AVE", trade_aadt_m: 58, trade_aadt_max: 27012 })), /Workbook trade area/);
const load = capacityFacts({ cap_d_peak: 108, cap_d_year: 192720 }, "deal")[0].lines.join(" ");
assert.match(load, /108 kW/);
assert.match(load, /192,720 kWh\/year/);
assert.equal(cashTile(deal({ figures_status: "shown", stated_cash_flow_display: "$400,000", cash_multiple_display: "6.2x cash flow", figures_basis: "Claimed", figures_source: "BizBuySell listing" })).extra, "6.2x cash flow");
assert.deepEqual(tileAmount(4990000, "$4,990,000"), { text: "$4.99M", title: "$4,990,000" });
assert.deepEqual(tileAmount(7000000, "$7,000,000"), { text: "$7M", title: "$7,000,000" });
assert.deepEqual(tileAmount(null, ""), { text: "Not provided", title: "Not provided" });
assert.equal(listingCue({ listing_url: "https://www.loopnet.com/Listing/1" }).label, "View on LoopNet ↗");
assert.equal(listingCue({ listing_url: "" }).label, "No listing page on file");
assert.equal(listingCue({ listing_url: "https://www.bizbuysell.com/x", listing_removed: true }).label, "View on BizBuySell ↗ (may be removed)");
assert.deepEqual(capacityFacts({ cap_a_substation_mi: 0.81, cap_a_line_ft: 392, cap_a_source: "OSM proximity (Overpass)", cap_a_confidence: "Estimated", cap_a_as_of: "2026-11-03" }, "site"), [
  { id: "a", lines: ["Substation 0.81 mi", "Line 392 ft"], basis: "OSM proximity (Overpass) · Estimated · 2026-11-03" },
]);
assert.deepEqual(capacityFacts({ cap_c_amps: 1200, cap_c_source: "listing claim", cap_c_confidence: "Claimed" }, "site"), []);
assert.equal(capacityFacts({ cap_c_amps: 1200, cap_c_source: "listing claim", cap_c_confidence: "Claimed" }, "deal")[0].lines[0], "1,200 amps");
assert.equal(capacityFacts({}, "deal").length, 0);
const pin = publicDeal({ site_capacity: "Strong", cap_a_substation_mi: 0.4, name: "A" });
assert.equal("site_capacity" in pin, false);
assert.equal("cap_a_substation_mi" in pin, false);
assert.equal(pin.name, "A");
assert.equal(openLandText(0), "0 sq ft");
assert.equal(openLandText(null), "");
assert.equal(openLandText(undefined), "");
assert.equal(defaultColumnIds().includes("address"), false);
assert.equal(defaultColumnIds().includes("site"), true);
assert.deepEqual(parseColumns(null).includes("nda"), false);
assert.equal(parseColumns("site,nda").includes("nda"), true);
console.log("key numbers ok");
