import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { droppedDealsShown } from "../../lib/pipeStage";
import { suggestedDropHistory, withSuggestedDrops } from "../../lib/suggestedDrop";
import { mergeBringBackHistory } from "../../lib/timeline/history";

type DealProps = { deal_id?: string; stage?: string; stage_group?: string; suggested_drop?: string };

test("a knock-out stays on the current stage and is labeled a suggested drop", () => {
  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealProps }[];
  };
  const before = file.features.find((feature) => feature.properties.deal_id === "PIPE-PHX-0085")?.properties;
  assert.ok(before);
  assert.equal(before.stage, "1 Desk screen");
  assert.equal(before.stage_group, "desk");
  assert.equal(before.suggested_drop, undefined);
  const annotated = withSuggestedDrops(file);
  const deal = annotated.features?.find((feature) => feature.properties?.deal_id === "PIPE-PHX-0085")?.properties;
  assert.equal(deal?.stage, "1 Desk screen");
  assert.equal(deal?.stage_group, "desk");
  assert.equal(deal?.suggested_drop, "Lot too small");
  assert.equal(before.stage, "1 Desk screen");
  assert.equal(droppedDealsShown({ all: true, stage: "desk", droppedLayer: false, searchWide: false }), false);
  assert.notEqual(deal?.stage_group, "dropped");
  const historical = annotated.features?.find((feature) => feature.properties?.deal_id === "PIPE-PHX-0014")?.properties;
  assert.equal(historical?.stage, "Dropped");
  assert.equal(historical?.stage_group, "dropped");
  assert.equal(historical?.suggested_drop, undefined);
  const desk = annotated.features?.filter((feature) => feature.properties?.stage_group === "desk" && feature.properties.suggested_drop) || [];
  assert.ok(desk.some((feature) => feature.properties?.deal_id === "PIPE-PHX-0085"));
  const items = mergeBringBackHistory([], suggestedDropHistory(["PIPE-PHX-0085"]));
  assert.equal(items[0]?.type, "drop_suggested");
  assert.match(items[0]?.summary || "", /Recommended drop\. Lot too small/);
  assert.equal(suggestedDropHistory(["PIPE-PHX-0014"]).length, 0);
});
