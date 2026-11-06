import assert from "node:assert/strict";
import { listingCue } from "../lib/format.ts";
import { capacityFacts, cashTile, inRange, openLandText, peerNote, publicDeal, rangesFromSearch, summaryOf, tileAmount } from "../lib/keyNumbers.ts";
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
console.log("key numbers ok");
