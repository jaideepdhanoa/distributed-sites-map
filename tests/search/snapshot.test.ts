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

test("site rows carry the address, id, and stage, and a linked universe row folds into the deal", () => {
  const rows = [
    { deal_id: "PIPE-PHX-0005", name: "North Wash", address: "515 E Union Hills Dr", city: "PHX", stage: "Dropped", stage_group: "dropped", universe_id: "PHX-U435", broker: "Ada Lane" },
    { deal_id: "PIPE-PHX-0081", name: "North Wash", address: "5515 N 59th Ave", city: "PHX", stage: "2 Financial screen", stage_group: "financial", broker: "Ada Lane" },
  ];
  const catalog = [
    { site_id: "PHX-U435", name: "", address: "515 E Union Hills Dr", city: "PHX", linked_deal_id: "PIPE-PHX-0005" },
    { site_id: "PHX-U428", name: "Corner Store", address: "4250 W Union Hills Dr", city: "PHX" },
  ];
  const named = groupSnapshot("north wash", rows, [], catalog);
  const dropped = named.sites.find((item) => item.id === "PIPE-PHX-0005");
  assert.equal(dropped?.detail, "515 E Union Hills Dr, Phoenix · PIPE-PHX-0005 · Dropped");
  const other = named.sites.find((item) => item.id === "PIPE-PHX-0081");
  assert.equal(other?.detail, "5515 N 59th Ave, Phoenix · PIPE-PHX-0081 · Financial screen");
  const groups = groupSnapshot("union hills", rows, [], catalog);
  assert.equal(groups.sites.some((item) => item.id === "PHX-U435"), false);
  assert.equal(groups.sites.some((item) => item.title === "515 E Union Hills Dr"), false);
  assert.equal(groups.sites.some((item) => item.id === "PIPE-PHX-0005"), true);
  const store = groups.sites.find((item) => item.id === "PHX-U428");
  assert.equal(store?.title, "Corner Store");
  assert.match(store?.detail || "", /Universe$/);
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
