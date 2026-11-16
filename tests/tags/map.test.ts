import assert from "node:assert/strict";
import test from "node:test";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { prepareRows, type SheetColumn } from "../../lib/listLayout";
import { advanceReasonCode, calendarToZoned, dropReasonCode, mapTags, sinceLabel, tagHash } from "../../lib/tags/map";
import { sectionChips, TAG_FAMILIES } from "../../lib/tags/vocab";

test("today's cells become chips, and the free text stays on the note", () => {
  const mapped = mapTags({
    siteId: "PIPE-PHX-0100",
    market: "PHX",
    stage: "2 Financial screen",
    blocker: "Awaiting broker reply",
    blockerSince: "2026-11-11",
    nextStep: "Follow up on the power question.",
    packageStatus: "Received",
    ndaStatus: "With Moove legal",
    photoStatus: "Partial",
    sourceKind: "broker-listed",
    listed: true,
    figuresBasis: "Documented",
    landBasis: "Estimated",
    hasPrice: true,
    zoning: "C-2",
  });
  const byFamily = new Map(mapped.chips.map((chip) => [chip.family, chip]));
  assert.equal(byFamily.get("waiting_on")?.code, "broker_reply");
  assert.equal(byFamily.get("waiting_on")?.since, "Nov 11");
  assert.equal(byFamily.get("waiting_on")?.note, "Awaiting broker reply");
  assert.equal(byFamily.get("next_action")?.code, "follow_up");
  assert.equal(byFamily.get("next_action")?.note, "Follow up on the power question.");
  assert.equal(byFamily.get("biggest_gap")?.code, "power");
  assert.equal(byFamily.get("package")?.label, "Received");
  assert.equal(byFamily.get("nda")?.code, "moove_legal");
  assert.equal(byFamily.get("photos")?.code, "partial");
  assert.equal(byFamily.get("lead_source")?.code, "listing");
  assert.equal(byFamily.get("diligence_financials")?.code, "verified");
  assert.equal(byFamily.get("diligence_land")?.code, "estimated");
  assert.equal(byFamily.get("diligence_zoning")?.code, "claimed");
  assert.equal(calendarToZoned("2026-11-11", "PHX"), "2026-11-11T12:00:00-07:00");
  assert.equal(sinceLabel("2026-11-11T12:00:00-07:00"), "Nov 11");
});

test("an unmapped blocker is hashed and does not become a chip", () => {
  const mapped = mapTags({ siteId: "PIPE-LAS-0101", market: "LAS", blocker: "Price terms still open" });
  assert.equal(mapped.chips.some((chip) => chip.family === "waiting_on"), false);
  assert.equal(mapped.unmapped.some((row) => row.family === "waiting_on" && row.hash === tagHash("Price terms still open")), true);
  assert.equal(JSON.stringify(mapped.unmapped).includes("Price terms"), false);
});

test("the quarantined row and pipeline row 10 produce no chips", () => {
  assert.equal(mapTags({ siteId: EXCLUDED_SITE_ID, blocker: "Awaiting broker reply" }).chips.length, 0);
  assert.equal(mapTags({ siteId: "PIPE-MIA-0102", excelRow: 10, blocker: "Awaiting broker reply" }).chips.length, 0);
});

test("drop and advance reasons match the vocabulary labels", () => {
  assert.equal(dropReasonCode("The lot is too small."), "lot_too_small");
  assert.equal(dropReasonCode("Price vs value"), "price_vs_value");
  assert.equal(advanceReasonCode("Package received"), "package_received");
  assert.equal(advanceReasonCode("The file is ready."), "");
});

test("the card header keeps stage plus at most waiting and the biggest gap", () => {
  const mapped = mapTags({
    siteId: "PIPE-PHX-0103",
    market: "PHX",
    blocker: "We owe a reply",
    nextStep: "Check the zoning before a decision.",
    packageStatus: "None",
    photoStatus: "Complete",
    ndaStatus: "Not required",
  });
  const header = mapped.chips.filter((chip) => chip.family === "waiting_on" || chip.family === "biggest_gap");
  assert.equal(header.length, 2);
  const section = sectionChips(mapped.chips, ["package", "photos", "nda", "biggest_gap"]);
  assert.equal(section.some((chip) => chip.family === "package"), false);
  assert.equal(section.some((chip) => chip.family === "photos"), false);
  assert.equal(section.some((chip) => chip.family === "nda"), false);
});

test("every family except stage and NDA has its own sheet column", () => {
  for (const family of TAG_FAMILIES) {
    if (family.family === "nda") continue;
    assert.ok(family.column, family.family);
  }
});

test("a chip-set filter keeps rows whose code is selected", () => {
  type Row = { code: string; label: string };
  const columns: SheetColumn<Row>[] = [{
    id: "chip_waiting",
    label: "Waiting on",
    text: (row) => row.label,
    code: (row) => row.code,
    choices: [{ code: "broker_reply", label: "Broker reply" }],
  }];
  const rows = [{ code: "broker_reply", label: "Broker reply" }, { code: "we_owe", label: "Us/we owe a reply" }];
  const kept = prepareRows(rows, columns, {
    order: ["chip_waiting"],
    widths: {},
    pinned: [],
    hidden: [],
    sort: null,
    filters: { chip_waiting: "broker_reply" },
    touched: true,
  }, ["chip_waiting"]);
  assert.deepEqual(kept.map((row) => row.code), ["broker_reply"]);
});
