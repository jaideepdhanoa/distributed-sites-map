import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLiveContactedDeal } from "../lib/filter.ts";
import { FUNNEL_NOTES } from "../lib/labels.ts";

assert.equal(isLiveContactedDeal({ kind: "pipeline", stage_group: "desk", broker_contacted: true }), true);
assert.equal(isLiveContactedDeal({ kind: "land", stage_group: "financial", broker_contacted: true }), true);
assert.equal(isLiveContactedDeal({ kind: "pipeline", stage_group: "dropped", broker_contacted: true }), false);
assert.equal(isLiveContactedDeal({ kind: "land", stage_group: "desk", broker_contacted: false }), false);
assert.equal(isLiveContactedDeal({ kind: "pipeline", stage_group: "desk" }), false);
assert.equal(isLiveContactedDeal({ stage_group: "desk", broker_contacted: true }), false);

const note = FUNNEL_NOTES.contacted;
assert.match(note, /categories you have on/);
assert.match(note, /Dropped deals stay out/);
assert.match(note, /Census sites are a separate count/);
assert.doesNotMatch(note, /Pipeline and Land deals/);
assert.doesNotMatch(note, /universe site/i);

type Deal = { kind?: string; city?: string; stage_group?: string; broker_contacted?: boolean };
const deals = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as { features: { properties: Deal }[] };
const funnel = JSON.parse(readFileSync("data/generated/funnel.json", "utf8")) as {
  stages: { id: string; unit?: string; total?: number; by_city?: Record<string, number>; note?: string }[];
};
const live = deals.features.map((feature) => feature.properties).filter((deal) => isLiveContactedDeal(deal));
const byCity = { LAS: 0, PHX: 0, MIA: 0 };
for (const deal of live) {
  if (deal.city === "LAS" || deal.city === "PHX" || deal.city === "MIA") byCity[deal.city] += 1;
}
const stage = funnel.stages.find((item) => item.id === "contacted");
assert.ok(stage, "contacted stage");
assert.equal(stage.unit, "deals");
assert.equal(stage.total, live.filter((deal) => deal.city === "LAS" || deal.city === "PHX" || deal.city === "MIA").length);
assert.deepEqual(stage.by_city, byCity);
assert.equal(stage.note, note);

console.log("contacted deal checks passed", byCity);
