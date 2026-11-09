import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("search suggestions omit c-stores until the filter is on, and keep gas-only deals", () => {
  const data = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id: string; is_c_store?: boolean; name?: string; address?: string; city?: string; stage_group?: string; universe_id?: string } }[];
  };
  const deals = data.features.map((feature) => feature.properties);
  const hidden = ["c-store", "Sinclair", "ampm", "PIPE-PHX-0067", "PIPE-LAS-0070"].flatMap((query) =>
    collectSearchHits(query, deals, []).map((hit) => hit.id),
  );
  for (const id of EXPECTED) assert.equal(hidden.includes(id), false, id);
  const gas = collectSearchHits("PIPE-MIA-0076", deals, []).map((hit) => hit.id);
  assert.equal(gas.includes("PIPE-MIA-0076"), true);
  assert.equal(gas.includes("PIPE-MIA-0075"), false);
  assert.equal(collectSearchHits("PIPE-MIA-0075", deals, []).some((hit) => hit.id === "PIPE-MIA-0075"), true);
  const shown = collectSearchHits("Sinclair", deals, [], () => "universe", { cStores: true }).map((hit) => hit.id);
  assert.equal(shown.includes("PIPE-PHX-0067"), true);
});
