import assert from "node:assert/strict";
import test from "node:test";
import { attachPackageHrefs } from "../lib/financials.ts";
import { buildQueue } from "../lib/queue/order.ts";
import { FUNNEL_NOTES } from "../lib/labels.ts";
import { areaCounts, countDroppedDeals, countOutsideServiceArea, dealOnPipeStep, inReach, outsideServiceArea, parseReach, reachLabel, serviceAreaSplit, type Reach } from "../lib/reach.ts";

const rows = [
  { id: "in", service_area_class: "inside", in_area: true },
  { id: "near5", service_area_class: "near_0_5", in_area: true, service_area_distance_mi: 3.2 },
  { id: "near10", service_area_class: "near_5_10", in_area: true, service_area_distance_mi: 7.4 },
  { id: "out", service_area_class: "outside", in_area: false, service_area_distance_mi: 12 },
  { id: "edge", service_area_class: "edge_legacy", in_area: true },
  { id: "legacy", in_area: true },
  { id: "open" },
];

function ids(reach: Reach) {
  return rows.filter((row) => inReach(row, reach)).map((row) => row.id);
}

test("each reach keeps the matching classes and leaves outside out", () => {
  assert.equal(parseReach(null), "within10");
  assert.equal(parseReach("nope"), "within10");
  assert.deepEqual(ids("inside"), ["in", "edge", "legacy", "open"]);
  assert.deepEqual(ids("within5"), ["in", "near5", "edge", "legacy", "open"]);
  assert.deepEqual(ids("within10"), ["in", "near5", "near10", "edge", "legacy", "open"]);
  assert.equal(inReach({ service_area_class: "unknown" }, "within10"), true);
  assert.equal(inReach({ service_area_class: "unknown", service_area_source: "blank" }, "within10"), true);
  assert.equal(inReach({ service_area_class: null }, "within10"), true);
  assert.equal(inReach({ service_area_class: "unknown", service_area_source: "label" }, "within10"), false);
  assert.equal(inReach({ service_area_class: "outside", service_area_source: "label" }, "within10"), false);
  assert.equal(inReach({ in_area: false }, "within10"), false);
});

test("explicit unknown and outside are their own group, and Dropped is the stage", () => {
  const outside = { deal_id: "PIPE-A", kind: "pipeline", service_area_class: "outside", service_area_source: "label", stage_group: "desk" };
  const named = { deal_id: "PIPE-B", kind: "pipeline", service_area_class: "unknown", service_area_source: "label", stage_group: "financial" };
  const unrecognized = { deal_id: "PIPE-C", kind: "pipeline", service_area_class: "unknown", service_area_source: "unrecognized", stage_group: "desk" };
  const blank = { deal_id: "PIPE-D", kind: "pipeline", service_area_class: "unknown", stage_group: "desk" };
  const droppedOutside = { deal_id: "PIPE-E", kind: "pipeline", service_area_class: "outside", service_area_source: "label", stage_group: "dropped" };
  const droppedInside = { deal_id: "PIPE-F", kind: "pipeline", service_area_class: "inside", stage_group: "dropped" };
  const droppedNear = { deal_id: "PIPE-G", kind: "pipeline", service_area_class: "near_5_10", stage_group: "dropped" };
  const landDrop = { deal_id: "LAND-A", kind: "land", service_area_class: "inside", stage_group: "dropped" };
  const landOutside = { deal_id: "LAND-B", kind: "land", service_area_class: "outside", service_area_source: "label", stage_group: "financial" };
  const protectedDrop = { deal_id: "PIPE-PHX-0006", kind: "pipeline", service_area_class: "outside", service_area_source: "label", stage_group: "dropped" };
  const protectedActive = { deal_id: "PIPE-PHX-0006", kind: "pipeline", service_area_class: "outside", service_area_source: "label", stage_group: "desk" };

  assert.equal(dealOnPipeStep(outside, "desk"), false);
  assert.equal(dealOnPipeStep(outside, "dropped"), false);
  assert.equal(outsideServiceArea(outside), true);
  assert.equal(dealOnPipeStep(named, "financial"), false);
  assert.equal(dealOnPipeStep(named, "dropped"), false);
  assert.equal(outsideServiceArea(named), true);
  assert.equal(dealOnPipeStep(unrecognized, "desk"), false);
  assert.equal(outsideServiceArea(unrecognized), true);
  assert.equal(dealOnPipeStep(blank, "desk"), true);
  assert.equal(dealOnPipeStep(blank, "dropped"), false);
  assert.equal(outsideServiceArea(blank), false);
  assert.equal(dealOnPipeStep(droppedOutside, "dropped"), true);
  assert.equal(dealOnPipeStep(droppedOutside, "desk"), false);
  assert.equal(outsideServiceArea(droppedOutside), false);
  assert.equal(dealOnPipeStep(droppedInside, "dropped"), true);
  assert.equal(dealOnPipeStep(droppedNear, "dropped", "inside"), true);
  assert.equal(dealOnPipeStep(protectedDrop, "dropped"), false);
  assert.equal(outsideServiceArea(protectedDrop), false);
  assert.equal(outsideServiceArea(protectedActive), false);
  assert.equal(dealOnPipeStep(protectedActive, "desk"), false);

  const rows = [outside, named, unrecognized, blank, droppedOutside, droppedInside, droppedNear, landDrop, landOutside, protectedDrop, protectedActive];
  function badge(land: boolean) {
    return rows.filter((row) => (land || row.kind !== "land") && dealOnPipeStep(row, "dropped")).length;
  }
  function header(land: boolean) {
    return countDroppedDeals(rows.filter((row) => land || row.kind !== "land"));
  }
  assert.equal(header(false), badge(false));
  assert.equal(header(true), badge(true));
  assert.equal(badge(false), 3);
  assert.equal(badge(true), 4);
  assert.equal(countOutsideServiceArea(rows.filter((row) => row.kind !== "land")), 3);
  assert.equal(countOutsideServiceArea(rows), 4);
  assert.equal(rows.filter((row) => row.deal_id === "PIPE-PHX-0006" && (dealOnPipeStep(row, "dropped") || outsideServiceArea(row) || dealOnPipeStep(row, "desk"))).length, 0);

  assert.match(FUNNEL_NOTES.dropped, /Dropped/);
  assert.match(FUNNEL_NOTES.dropped, /Outside or Unknown/);
  assert.equal(FUNNEL_NOTES.outside, "Active sites marked Outside or Unknown in the service-area column.");
});

test("service-area counts follow the reach and split by class", () => {
  const universe = rows.filter((row) => row.id !== "open");
  const inside = areaCounts(universe, "inside");
  assert.equal(inside.total, 3);
  assert.equal(inside.inside, 2);
  assert.equal(inside.near_0_5, 0);
  assert.equal(inside.edge_legacy, 1);
  assert.equal(serviceAreaSplit(universe, "inside"), "Inside 2 · Edge 1");
  const within5 = areaCounts(universe, "within5");
  assert.equal(within5.total, 4);
  assert.equal(within5.near_0_5, 1);
  assert.equal(within5.near_5_10, 0);
  assert.equal(serviceAreaSplit(universe, "within5"), "Inside 2 · Near, under 5 mi 1 · Edge 1");
  const within10 = areaCounts(universe, "within10");
  assert.equal(within10.total, 5);
  assert.equal(within10.near_5_10, 1);
  assert.equal(within10.inside + within10.near_0_5 + within10.near_5_10 + within10.edge_legacy, within10.total);
  assert.equal(serviceAreaSplit(universe, "within10"), "Inside 2 · Near, under 5 mi 1 · Near, 5 to 10 mi 1 · Edge 1");
  assert.equal(reachLabel("inside"), "Service area only");
  assert.equal(reachLabel("within5"), "Service area + 5 mi");
  assert.equal(reachLabel("within10"), "Service area + 10 mi");
});

function queue(reach: Reach) {
  return buildQueue({
    sites: rows.map((row) => ({
      id: row.id,
      city: "PHX",
      stage: "1 Desk screen",
      stageGroup: "desk",
      active: true,
      service_area_class: row.service_area_class,
      in_area: "in_area" in row ? row.in_area : null,
    })),
    reasons: {
      out: [{ at: "2026-11-14", summary: "Flagged for you.", type: "flag" }],
    },
    reviewedAt: {},
    snoozeUntil: {},
    flagged: new Set(["out"]),
    mentioned: new Set(),
    assigned: new Set(),
    needsApproval: new Set(),
    today: "2026-11-14",
    filters: { market: "all", viable: true, reach },
  }).map((item) => item.siteId);
}

test("the review queue uses the same reach and does not drop a site", () => {
  assert.deepEqual(queue("inside"), ["edge", "in", "legacy", "open"]);
  assert.deepEqual(queue("within5"), ["edge", "in", "legacy", "near5", "open"]);
  assert.deepEqual(queue("within10"), ["edge", "in", "legacy", "near10", "near5", "open"]);
  assert.equal(queue("within10").includes("out"), false);
});

test("a package link is copied only for a reader who can see financials", () => {
  const features = [{ properties: { deal_id: "PIPE-1" } }, { properties: { deal_id: "PIPE-2" } }];
  const hrefs = { "PIPE-1": "https://drive.google.com/drive/folders/abc" };
  assert.equal("package_href" in (attachPackageHrefs(features, hrefs, false)[0]?.properties || {}), false);
  const shown = attachPackageHrefs(features, hrefs, true);
  assert.equal(shown[0]?.properties?.package_href, hrefs["PIPE-1"]);
  assert.equal(shown[1]?.properties?.package_href, undefined);
});
