import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPipelineStore } from "../lib/labels";
import { loadCatalog, readBuildEvents } from "../lib/queue/catalog";
import { buildQueue } from "../lib/queue/order";
import { collectSearchHits } from "../lib/search";

type DealRow = {
  deal_id: string;
  kind?: string;
  is_c_store?: boolean;
  name?: string;
  address?: string;
  city?: string;
  stage_group?: string;
  universe_id?: string;
};

function deals(): DealRow[] {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealRow }[];
  };
  return data.features.map((feature) => feature.properties);
}

test("c-store flags are pipeline deals and stay out of the default search", () => {
  const rows = deals();
  const stores = rows.filter((deal) => deal.is_c_store === true);
  assert.ok(stores.length > 0);
  assert.ok(stores.every((deal) => deal.kind === "pipeline"));
  for (const store of stores) {
    assert.equal(collectSearchHits(store.deal_id, rows, []).some((hit) => hit.id === store.deal_id), false, store.deal_id);
    const shown = collectSearchHits(store.deal_id, rows, [], () => "universe", { cStores: true });
    assert.equal(shown.some((hit) => hit.id === store.deal_id), true, store.deal_id);
  }
});

test("search suggestions omit c-stores until the filter is on", () => {
  const rows = deals();
  const stores = rows.filter((deal) => deal.is_c_store === true);
  const hidden = ["c-store", "Sinclair", "ampm", ...stores.map((deal) => deal.deal_id)].flatMap((query) =>
    collectSearchHits(query, rows, []).map((hit) => hit.id),
  );
  for (const store of stores) assert.equal(hidden.includes(store.deal_id), false, store.deal_id);
});

test("gas stations and c-stores stay out of the default review queue", () => {
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Gas station", name: "Operating c-store with gas and gaming" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Convenience store", name: "Shop" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Other", name: "Corner service station with a tenant" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Other", name: "Sinclair station" }), true);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Car wash", name: "Chevron" }), false);
  assert.equal(isPipelineStore({ kind: "pipeline", business_type: "Car wash", name: "Circle K" }), false);
  assert.equal(isPipelineStore({ kind: "site", business_type: "Car wash", name: "Chevron" }), false);
  assert.equal(isPipelineStore({ kind: "site", business_type: "Car wash", name: "Circle K" }), false);
  assert.equal(isPipelineStore({ kind: "land", business_type: "Gas station", name: "Closed gas station and c-store across from the airport" }), false);
  const catalog = loadCatalog();
  const stores = catalog.filter((site) => site.isCStore);
  assert.ok(stores.length > 0);
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
  for (const store of stores) assert.equal(rows.some((row) => row.siteId === store.id), false, store.id);
});
