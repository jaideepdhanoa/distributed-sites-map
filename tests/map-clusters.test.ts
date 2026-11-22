import assert from "node:assert/strict";
import test from "node:test";
import { CITY_VIEW } from "../lib/filter.ts";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  PHONE_BUBBLE_PX,
  PIN_SPLIT_ZOOM,
  bubbleClearsSheet,
  clusterBubbleLabel,
  countedPins,
  leafBounds,
  phoneBubbleRadius,
  pinsOverlap,
  takeSolo,
} from "../lib/mapClusters.ts";

test("city cameras show individual pins and a low zoom still groups them", () => {
  assert.equal(PIN_SPLIT_ZOOM, 10);
  assert.equal(CLUSTER_MAX_ZOOM, 9);
  assert.ok(CLUSTER_RADIUS >= 36);
  for (const view of Object.values(CITY_VIEW)) assert.ok(view.zoom >= PIN_SPLIT_ZOOM);
  assert.equal(phoneBubbleRadius() * 2, PHONE_BUBBLE_PX);
  assert.ok(phoneBubbleRadius() >= 22);
});

test("a bubble label is only the count", () => {
  for (const count of [1, 12, 999, 1200, 20000]) {
    const label = clusterBubbleLabel(count);
    assert.ok(label.length <= 28);
    assert.equal(label.includes(" "), false);
    assert.match(label, /^[0-9.]+k?$/);
  }
  assert.equal(clusterBubbleLabel(12), "12");
  assert.equal(clusterBubbleLabel(1200), "1.2k");
});

test("a pipeline bubble counts each deal once and leaves the county pins out", () => {
  const site = { geometry: { type: "Point", coordinates: [-112, 33.4] }, properties: { site_id: "PHX-U9101", pin_kind: "site" } };
  const deal = { geometry: { type: "Point", coordinates: [-112, 33.4] }, properties: { deal_id: "PIPE-PHX-9101", pin_kind: "deal" } };
  const other = { geometry: { type: "Point", coordinates: [-115, 36.1] }, properties: { deal_id: "PIPE-LAS-9101", pin_kind: "deal" } };
  const deals = countedPins({ group: "deals", sites: [site], offMarket: [], deals: [deal, other, deal] });
  assert.deepEqual(deals.map((feature) => feature.properties?.deal_id), ["PIPE-PHX-9101", "PIPE-LAS-9101"]);
  const universe = countedPins({ group: "sites", sites: [site], offMarket: [], deals: [deal, other] });
  assert.deepEqual(universe.map((feature) => feature.properties?.site_id), ["PHX-U9101"]);
});

test("a deep-linked pin is kept out of the group", () => {
  const features = [
    { geometry: { type: "Point", coordinates: [-112, 33] }, properties: { site_id: "PHX-U9101", pin_kind: "site" } },
    { geometry: { type: "Point", coordinates: [-112.01, 33.01] }, properties: { site_id: "PHX-U9102", pin_kind: "site" } },
    { geometry: { type: "Point", coordinates: [-80, 26] }, properties: { deal_id: "PIPE-MIA-9101", pin_kind: "deal" } },
  ];
  const held = takeSolo(features, "PHX-U9101");
  assert.equal(held.solo?.properties?.site_id, "PHX-U9101");
  assert.deepEqual(held.grouped.map((feature) => feature.properties?.site_id || feature.properties?.deal_id), ["PHX-U9102", "PIPE-MIA-9101"]);
  const deal = takeSolo(features, "PIPE-MIA-9101");
  assert.equal(deal.solo?.properties?.deal_id, "PIPE-MIA-9101");
  assert.equal(deal.grouped.length, 2);
  assert.equal(takeSolo(features, null).solo, null);
  assert.equal(takeSolo(features, "missing").solo, null);
});

test("a bubble click uses the bounds of its pins", () => {
  const bounds = leafBounds([
    { geometry: { type: "Point", coordinates: [-112.2, 33.4] } },
    { geometry: { type: "Point", coordinates: [-111.6, 33.7] } },
    { geometry: { type: "LineString", coordinates: [] } },
  ]);
  assert.deepEqual(bounds, [[-112.2, 33.4], [-111.6, 33.7]]);
  assert.equal(leafBounds([]), null);
});

test("grouped pins stay apart and above the phone sheet", () => {
  assert.equal(pinsOverlap([{ x: 0, y: 0 }, { x: 80, y: 0 }], 36), false);
  assert.equal(pinsOverlap([{ x: 0, y: 0 }, { x: 20, y: 0 }], 36), true);
  assert.equal(bubbleClearsSheet(400, 22, 500), true);
  assert.equal(bubbleClearsSheet(490, 22, 500), false);
});
