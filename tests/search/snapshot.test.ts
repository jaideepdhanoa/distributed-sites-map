import assert from "node:assert/strict";
import test from "node:test";
import { groupSnapshot } from "../../lib/search/snapshot.ts";

const HEX = "aaaaaaaaaaaaaaaa";
const deals = [
  { deal_id: "PIPE-PHX-0108", name: "North Sample Wash", address: "10 Union Hills Dr", city: "PHX", business_type: "Car wash", broker: "Ada Lane", firm: "Sample Brokers Inc" },
  { deal_id: "PIPE-PHX-0200", name: "North Lot", address: "1 Main", city: "PHX", business_type: "Car wash", broker: "Ada Lane", firm: "Sample Brokers Inc" },
  { deal_id: "PIPE-LAS-0201", name: "South Lot", address: "2 Main", city: "LAS", business_type: "Car wash", broker: "Ada Lane", firm: "Sample Brokers Inc" },
  { deal_id: "PIPE-PHX-0006", name: "Hidden", broker: "Hidden", firm: "Sample Brokers Inc" },
];
const comms = [
  { comms_id: "CM-0123", site_ids: "PIPE-PHX-0108", person: "Ada Lane", firm: "Sample Brokers Inc", subject: "Rent roll request", summary: "Asked Sample Brokers Inc for the rent roll.", at: "2026-01-02" },
  { comms_id: "CM-0124", site_ids: "PIPE-PHX-0200", person: "Ada Lane", firm: "Sample Brokers Inc", subject: `Visit notes https://mail.google.com/mail/u/0/#inbox/${HEX} ${HEX}`, summary: "Second note.", at: "2026-02-03" },
  { comms_id: "CM-0999", site_ids: "PIPE-PHX-0006", person: "Hidden", firm: "Sample Brokers Inc", summary: "Hidden note." },
];

test("a firm query groups sites, brokers, and conversations", () => {
  const groups = groupSnapshot("Sample Brokers Inc", deals, comms);
  assert.equal(groups.sites[0]?.path, "/?site=PIPE-PHX-0108");
  assert.equal(groups.brokers[0]?.title, "Sample Brokers Inc");
  assert.equal(groups.brokers[0]?.path.includes("q="), false);
  assert.equal(groups.conversations[0]?.path, "/?site=PIPE-PHX-0108&panel=activity&msg=CM-0123");
  assert.equal(groups.conversations[0]?.title, "Rent roll request");
  assert.equal(groups.conversations[0]?.site, "North Sample Wash");
  assert.equal(groups.conversations[0]?.when, "Jan 2");
  assert.equal(groups.conversations[1]?.title, "Visit notes");
  assert.equal(groups.conversations[1]?.site, "North Lot");
  assert.equal(groups.conversations[1]?.when, "Feb 3");
  assert.equal(JSON.stringify(groups.conversations).includes(HEX), false);
  assert.equal(JSON.stringify(groups.conversations).includes("mail.google.com"), false);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0006"), false);
  assert.equal(groups.conversations.some((item) => item.id === "CM-0999"), false);
});

test("a place query does not open an empty broker group", () => {
  const groups = groupSnapshot("union hills", deals, comms);
  assert.equal(groups.sites[0]?.id, "PIPE-PHX-0108");
  assert.equal(groups.brokers.length, 0);
});

test("site fallback matches each word on name, address, city, or type", () => {
  const groups = groupSnapshot("car wash phoenix", deals, comms);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0200"), true);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-LAS-0201"), false);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0006"), false);
});
