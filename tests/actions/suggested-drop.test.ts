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
  const restored = annotated.features?.find((feature) => feature.properties?.deal_id === "PIPE-PHX-0014")?.properties;
  assert.equal(restored?.stage, "1 Desk screen");
  assert.equal(restored?.stage_group, "desk");
  assert.equal(restored?.suggested_drop, "Lot too small");
  assert.ok(suggestedDropHistory(["PIPE-PHX-0014"]).length > 0);
  const dropped = annotated.features?.find((feature) => feature.properties?.deal_id === "PIPE-MIA-0079")?.properties;
  assert.equal(dropped?.stage, "Dropped");
  assert.equal(dropped?.stage_group, "dropped");
  assert.equal(dropped?.suggested_drop, undefined);
  const desk = annotated.features?.filter((feature) => feature.properties?.stage_group === "desk" && feature.properties.suggested_drop) || [];
  assert.ok(desk.some((feature) => feature.properties?.deal_id === "PIPE-PHX-0085"));
  assert.ok(desk.some((feature) => feature.properties?.deal_id === "PIPE-PHX-0014"));
  const items = mergeBringBackHistory([], suggestedDropHistory(["PIPE-PHX-0085"]));
  assert.equal(items[0]?.type, "drop_suggested");
  assert.match(items[0]?.summary || "", /Recommended drop\. Lot too small/);
  assert.equal(suggestedDropHistory(["PIPE-MIA-0079"]).length, 0);
});
