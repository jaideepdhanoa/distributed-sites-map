import assert from "node:assert/strict";
import test from "node:test";
import { groupSnapshot } from "../../lib/search/snapshot.ts";

const deals = [
  { deal_id: "PIPE-PHX-0108", name: "North Sample Wash", broker: "Ada Lane", firm: "Sample Brokers Inc" },
  { deal_id: "PIPE-PHX-0006", name: "Hidden", broker: "Hidden", firm: "Sample Brokers Inc" },
];
const comms = [
  { comms_id: "CM-0123", site_ids: "PIPE-PHX-0108", person: "Ada Lane", firm: "Sample Brokers Inc", summary: "Asked Sample Brokers Inc for the rent roll." },
  { comms_id: "CM-0999", site_ids: "PIPE-PHX-0006", person: "Hidden", firm: "Sample Brokers Inc", summary: "Hidden note." },
];

test("a firm query groups sites, brokers, and conversations", () => {
  const groups = groupSnapshot("Sample Brokers Inc", deals, comms);
  assert.equal(groups.sites[0]?.path, "/?site=PIPE-PHX-0108");
  assert.equal(groups.brokers[0]?.title, "Sample Brokers Inc");
  assert.equal(groups.brokers[0]?.path.includes("q="), false);
  assert.equal(groups.conversations[0]?.path, "/?site=PIPE-PHX-0108&panel=activity&msg=CM-0123");
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0006"), false);
  assert.equal(groups.conversations.some((item) => item.id === "CM-0999"), false);
});
