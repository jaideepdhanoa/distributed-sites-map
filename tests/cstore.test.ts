import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPipelineStore } from "../lib/labels";
import { loadCatalog, readBuildEvents } from "../lib/queue/catalog";
import { buildQueue } from "../lib/queue/order";
import { collectSearchHits } from "../lib/search";

const EXPECTED = [
  "PIPE-LAS-0070",
  "PIPE-LAS-0071",
  "PIPE-LAS-0072",
  "PIPE-PHX-0067",
  "PIPE-PHX-0068",
  "PIPE-PHX-0069",
];

test("is_c_store on main data is exactly the six pipeline c-stores", () => {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id: string; is_c_store?: boolean; name?: string } }[];
  };
  const found = data.features
    .filter((feature) => feature.properties.is_c_store === true)
    .map((feature) => feature.properties.deal_id)
    .sort();
  assert.deepEqual(found, EXPECTED);
  const mia = data.features.filter((feature) => feature.properties.deal_id === "PIPE-MIA-0075" || feature.properties.deal_id === "PIPE-MIA-0076");
  assert.equal(mia.length, 2);
  assert.equal(mia.every((feature) => feature.properties.is_c_store === false), true);
});

test("search suggestions omit c-stores and gas stations until the filter is on", () => {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id: string; is_c_store?: boolean; name?: string; address?: string; city?: string; stage_group?: string; universe_id?: string } }[];
  };
  const deals = data.features.map((feature) => feature.properties);
  const hidden = ["c-store", "Sinclair", "ampm", "PIPE-PHX-0067", "PIPE-LAS-0070"].flatMap((query) =>
    collectSearchHits(query, deals, []).map((hit) => hit.id),
  );
  for (const id of EXPECTED) assert.equal(hidden.includes(id), false, id);
  const gas = collectSearchHits("PIPE-MIA-0076", deals, []).map((hit) => hit.id);
  assert.equal(gas.includes("PIPE-MIA-0076"), false);
  assert.equal(gas.includes("PIPE-MIA-0075"), false);
  assert.equal(collectSearchHits("PIPE-MIA-0075", deals, []).some((hit) => hit.id === "PIPE-MIA-0075"), false);
  const shown = collectSearchHits("Sinclair", deals, [], () => "universe", { cStores: true }).map((hit) => hit.id);
  assert.equal(shown.includes("PIPE-PHX-0067"), true);
  const gasShown = collectSearchHits("PIPE-MIA-0076", deals, [], () => "universe", { cStores: true }).map((hit) => hit.id);
  assert.equal(gasShown.includes("PIPE-MIA-0076"), true);
});

test("gas stations and c-stores stay out of the default review queue", () => {
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Gas station", name: "Operating c-store with gas and gaming" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Convenience store", name: "Shop" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Other", name: "Operating c-store with gas and gaming" }), true);
  assert.equal(isPipelineStore({ kind: "site", business_type: "Car wash", name: "Chevron" }), false);
  assert.equal(isPipelineStore({ kind: "site", business_type: "Car wash", name: "Circle K" }), false);
  const catalog = loadCatalog();
  for (const id of ["PIPE-LAS-0070", "PIPE-LAS-0071", "PIPE-MIA-0075", "PIPE-MIA-0076"]) {
    assert.equal(catalog.find((site) => site.id === id)?.isCStore, true, id);
  }
  const reasons: Record<string, { at: string; summary: string; type: string }[]> = {};
  for (const event of readBuildEvents()) {
    reasons[event.siteId] = reasons[event.siteId] || [];
    reasons[event.siteId].push({ at: event.at, summary: event.summary, type: event.type });
  }
  const rows = buildQueue({
    sites: catalog.map((site) => ({
      id: site.id,
      city: site.city,
      stage: site.stage,
      stageGroup: site.stageGroup,
      active: site.active,
      hidden: site.isCStore,
    })),
    reasons,
    reviewedAt: {},
    snoozeUntil: {},
    flagged: new Set(),
    mentioned: new Set(),
    assigned: new Set(),
    needsApproval: new Set(),
    today: "2026-11-10",
    filters: { market: "all", stage: "any", viable: true },
  });
  assert.equal(rows.some((row) => row.siteId === "PIPE-LAS-0070"), false);
  assert.equal(rows.some((row) => row.siteId === "PIPE-LAS-0071"), false);
  assert.equal(rows.some((row) => row.siteId === "PIPE-MIA-0076"), false);
  assert.notEqual(rows[0]?.siteId, "PIPE-LAS-0070");
});
