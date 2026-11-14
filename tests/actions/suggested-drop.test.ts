import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { droppedDealsShown } from "../../lib/pipeStage";
import { loadSuggestedDrops, suggestedDropHistory, withSuggestedDrops } from "../../lib/suggestedDrop";
import { mergeBringBackHistory } from "../../lib/timeline/history";

type DealProps = { deal_id?: string; stage?: string; stage_group?: string; suggested_drop?: string };

test("a knock-out stays on the current stage and is labeled a suggested drop", () => {
  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: DealProps }[];
  };
  const drops = loadSuggestedDrops();
  assert.ok(drops.length > 0);
  const annotated = withSuggestedDrops(file);
  for (const drop of drops) {
    const before = file.features.find((feature) => feature.properties?.deal_id === drop.id)?.properties;
    assert.ok(before, drop.id);
    assert.equal(before.stage, drop.stage);
    assert.notEqual(before.stage_group, "dropped");
    assert.equal(before.suggested_drop, undefined);
    const after = annotated.features?.find((feature) => feature.properties?.deal_id === drop.id)?.properties;
    assert.equal(after?.stage, before.stage);
    assert.equal(after?.stage_group, before.stage_group);
    assert.equal(after?.suggested_drop, drop.reason);
    const items = mergeBringBackHistory([], suggestedDropHistory([drop.id]));
    assert.equal(items[0]?.type, "drop_suggested");
    assert.match(items[0]?.summary || "", new RegExp(`Recommended drop\\. ${drop.reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  const dropped = file.features.find((feature) => feature.properties?.stage_group === "dropped");
  assert.ok(dropped);
  const labeled = annotated.features?.find((feature) => feature.properties?.deal_id === dropped.properties?.deal_id)?.properties;
  assert.equal(labeled?.stage, dropped.properties?.stage);
  assert.equal(labeled?.suggested_drop, undefined);
  assert.equal(suggestedDropHistory([dropped.properties?.deal_id || ""]).some((item) => item.eventId === `suggested-drop:${dropped.properties?.deal_id}`), drops.some((drop) => drop.id === dropped.properties?.deal_id));
  assert.equal(droppedDealsShown({ all: true, stage: "desk", droppedLayer: false, searchWide: false }), false);
});
