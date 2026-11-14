import assert from "node:assert/strict";
import test from "node:test";
import { attachPackageHrefs } from "../lib/financials.ts";
import { buildQueue } from "../lib/queue/order.ts";
import { areaCounts, inReach, parseReach, reachLabel, serviceAreaSplit, type Reach } from "../lib/reach.ts";

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
  assert.equal(inReach({ service_area_class: "unknown" }, "within10"), false);
  assert.equal(inReach({ in_area: false }, "within10"), false);
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
  assert.equal(serviceAreaSplit(universe, "within5"), "Inside 2 · Near 0-5 1 · Edge 1");
  const within10 = areaCounts(universe, "within10");
  assert.equal(within10.total, 5);
  assert.equal(within10.near_5_10, 1);
  assert.equal(within10.inside + within10.near_0_5 + within10.near_5_10 + within10.edge_legacy, within10.total);
  assert.equal(serviceAreaSplit(universe, "within10"), "Inside 2 · Near 0-5 1 · Near 5-10 1 · Edge 1");
  assert.equal(reachLabel("within5"), "Within 5 mi");
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
