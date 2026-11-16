import assert from "node:assert/strict";
import test from "node:test";
import { filledSections, paletteGroups } from "../../lib/search/palette.ts";

const deals = [
  { deal_id: "PIPE-PHX-0008", kind: "pipeline", name: "North Wash", address: "1 Main", broker: "Ada Broker", firm: "Ada Co", city: "PHX", stage_group: "desk", business_type: "Car wash" },
  { deal_id: "PIPE-PHX-0067", kind: "pipeline", name: "Sinclair", address: "2 Fuel", broker: "Sinclair Desk", firm: "Fuel Co", city: "PHX", stage_group: "desk", business_type: "Gas station", is_c_store: true },
  { deal_id: "PIPE-PHX-0006", kind: "pipeline", name: "Quarantine", address: "Hidden", broker: "Hidden Broker", firm: "Hidden", city: "PHX", stage_group: "desk", business_type: "Car wash" },
];

test("palette groups sites and brokers without the search index", () => {
  const groups = paletteGroups("ada", deals, []);
  assert.equal(groups.sites.length, 1);
  assert.equal(groups.sites[0]?.path, "/?site=PIPE-PHX-0008");
  assert.equal(groups.sites[0]?.path.includes("q="), false);
  assert.equal(groups.brokers[0]?.title, "Ada Co");
  assert.equal(groups.conversations.length, 0);
  const hidden = paletteGroups("hidden", deals, []);
  assert.equal(hidden.sites.some((item) => item.id === "PIPE-PHX-0006"), false);
  assert.equal(hidden.brokers.some((item) => item.title === "Hidden Broker"), false);
});

test("palette fallback matches city and type words that are not one phrase", () => {
  const groups = paletteGroups("car wash phoenix", deals, []);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0008"), true);
  assert.equal(filledSections(groups).some((section) => section.label === "Brokers"), false);
});

test("palette fallback keeps c-stores out until that category is on", () => {
  const hidden = paletteGroups("Sinclair", deals, []);
  assert.equal(hidden.sites.length, 0);
  assert.equal(hidden.brokers.length, 0);
  const shown = paletteGroups("Sinclair", deals, [], { cStores: true });
  assert.equal(shown.sites[0]?.id, "PIPE-PHX-0067");
});
