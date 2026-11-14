import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  blockerSentence,
  blockerSentenceForDeal,
  coveredSites,
  courtDayCount,
  ndaChip,
  ndaQueueAllowed,
  ndaQueueBody,
  openNdaQueue,
  overlayDeals,
  queueCourt,
  type NdaAgreement,
  type NdaSnapshot,
} from "../lib/nda.ts";
import type { DealProps } from "../lib/types.ts";

const snapshot = JSON.parse(readFileSync("data/generated/nda.json", "utf8")) as NdaSnapshot;
const route = readFileSync("lib/api/handlers/data/nda.ts", "utf8");

function deal(partial: Partial<DealProps>): DealProps {
  return {
    deal_id: "PIPE-PHX-0001",
    kind: "pipeline",
    name: "Sample",
    address: "1 Main St",
    city: "PHX",
    stage: "1 Desk screen",
    stage_group: "desk",
    broker: "",
    firm: "",
    listing_url: "",
    asking_price: null,
    asking_price_display: null,
    asking_price_source: "",
    next_step: "",
    universe_id: "",
    coord_status: "listing",
    miles_to_depot: null,
    listed: true,
    source_line: "",
    ...partial,
  };
}

function agreement(partial: Partial<NdaAgreement>): NdaAgreement {
  return {
    nda_id: "NDA-900",
    counterparty_firm: "",
    counterparty_person: "",
    scope: "",
    site_ids: "",
    nda_status: "With Moove legal",
    nda_form: "",
    nda_waiting_on: "Us — legal",
    nda_opened_date: "",
    nda_sent_date: "",
    nda_last_action_date: "",
    nda_waiting_on_since: "",
    nda_executed_date: "",
    nda_gates: "",
    nda_days_open: 1,
    nda_days_in_court: 1,
    source: "",
    notes: "",
    ...partial,
  };
}

test("an unlinked site reads Not required and never Not started", () => {
  assert.equal(ndaChip({}), "Not required");
  assert.equal(ndaChip({ nda_status: "Not started" }), "Not required");
  assert.equal(ndaChip({ nda_id: "NDA-001", nda_status: "Not started" }), "Not required");
  assert.equal(ndaChip({ nda_status: "Not required", nda_waiting_on: "—", nda_gates: "None — not gating (R-076)" }), "Not required");
  assert.equal(ndaChip(deal({})).includes("Not started"), false);
  const overlaid = overlayDeals({ features: [{ properties: { deal_id: "PIPE-PHX-0001" } }] }, snapshot);
  assert.equal(ndaChip(overlaid.features?.[0]?.properties), "Not required");
});

test("a linked chip uses the site mirror, including the Miracle copy", () => {
  const miracle = snapshot.sites["PIPE-LAS-0016"];
  assert.equal(ndaChip(miracle), "With counterparty legal · Them — legal · 14d open · 2d in court");
  assert.equal(ndaChip(snapshot.sites["PIPE-LAS-0017"]), ndaChip(miracle));
  assert.equal(ndaChip(snapshot.sites["LAND-LAS-0001"]), ndaChip(miracle));
  assert.equal(ndaChip({ nda_id: "NDA-006", nda_days_open: 10, nda_days_in_court: 2 }), "10d open · 2d in court");
  assert.equal(ndaChip({ nda_id: "NDA-010", nda_status: "Broker asked — send our form" }), "Broker asked — send our form");
});

test("the blocker sentence counts days from the since date and stays quiet when the blocker is —", () => {
  assert.equal(blockerSentence({
    stage: "1 Desk screen",
    stageGroup: "desk",
    blocker: "Awaiting package",
    since: "2026-10-30",
    today: "2026-11-11",
  }), "Desk screen — blocked by Awaiting package (12 days)");
  assert.equal(blockerSentence({
    stage: "1 Desk screen",
    stageGroup: "desk",
    blocker: "Tenure",
    since: "2026-11-10",
    today: "2026-11-11",
  }), "Desk screen — blocked by Tenure (1 day)");
  assert.equal(blockerSentence({
    stage: "1 Desk screen",
    stageGroup: "desk",
    blocker: "—",
    since: "2026-11-01",
    today: "2026-11-11",
  }), "");
  assert.equal(blockerSentence({
    stage: "1 Desk screen",
    stageGroup: "desk",
    blocker: "",
    today: "2026-11-11",
  }), "");
  const execution = blockerSentenceForDeal(deal({
    stage_blocker: "NDA execution",
    stage_blocker_since: "",
  }), "2026-11-11");
  assert.equal(execution, "Desk screen — blocked by NDA execution");
  assert.equal(execution.includes("("), false);
});

test("a live NDA chip is the stored status and never a blank spreadsheet date", () => {
  const mirror = Object.values(snapshot.sites).find((item) => item.nda_id && item.nda_status && item.nda_status !== "Not required");
  assert.ok(mirror);
  const chip = ndaChip(mirror);
  assert.ok(chip.includes(mirror.nda_status));
  assert.equal(chip.includes("1899"), false);
  const deals = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id?: string; stage?: string; stage_group?: string; stage_blocker?: string } }[];
  };
  for (const feature of deals.features) {
    const deal = feature.properties;
    if (!deal.stage) continue;
    const sentence = blockerSentence({
      stage: deal.stage,
      stageGroup: deal.stage_group,
      blocker: deal.stage_blocker,
      today: "2026-11-11",
    });
    assert.equal(sentence.includes("1899"), false);
    if (deal.stage_blocker && deal.stage_blocker !== "—") assert.ok(sentence.includes(deal.stage_blocker) || sentence === "");
  }
});

test("the queue is one open agreement per row, sorted by days in the current court", () => {
  const body = ndaQueueBody(snapshot);
  const ids = body.queue.map((row) => row.nda_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 0);
  assert.equal(courtDayCount("12/30/1899"), 0);
  for (const row of body.queue) {
    assert.equal(ndaChip(row).includes("1899"), false);
    assert.equal(courtDayCount(row.nda_days_in_court) === null || (courtDayCount(row.nda_days_in_court) || 0) >= 0, true);
  }
  const sorted = openNdaQueue(body.queue);
  assert.deepEqual(sorted.map((row) => row.nda_id), ids);
  assert.deepEqual(coveredSites("PIPE-LAS-0070; PIPE-LAS-0071").ids, ["PIPE-LAS-0070", "PIPE-LAS-0071"]);
  assert.deepEqual(coveredSites("PIPE-PHX-0018; Apache Junction tire business"), {
    ids: ["PIPE-PHX-0018"],
    note: "Apache Junction tire business",
  });
  const closed = openNdaQueue([
    agreement({ nda_id: "NDA-901", nda_status: "Executed", nda_days_in_court: 40 }),
    agreement({ nda_id: "NDA-902", nda_status: "Declined / proceeding without", nda_days_in_court: 30 }),
    agreement({ nda_id: "NDA-903", nda_status: "Expired", nda_days_in_court: 20 }),
    agreement({ nda_id: "NDA-904", nda_status: "Not required", nda_days_in_court: 10 }),
    agreement({ nda_id: "NDA-905", nda_status: "Not started", nda_days_in_court: 9 }),
    agreement({ nda_id: "NDA-906", nda_status: "With counterparty legal", nda_waiting_on: "Us — legal", nda_days_in_court: 4 }),
  ]);
  assert.deepEqual(closed.map((row) => row.nda_id), ["NDA-906"]);
  assert.equal(queueCourt(closed[0]), "Us — legal");
  assert.equal(closed[0]?.nda_status, "With counterparty legal");
});

test("the NDA queue is signed in the same way as financials", () => {
  assert.equal(ndaQueueAllowed("viewer"), true);
  assert.equal(ndaQueueAllowed("contributor"), true);
  assert.equal(ndaQueueAllowed("reviewer"), true);
  assert.equal(ndaQueueAllowed("guest"), false);
  assert.match(route, /requireUser\(/);
  assert.match(route, /ndaQueueAllowed\(session\.actionRole\)/);
  assert.equal(snapshot.source, "workbook");
  assert.equal(JSON.stringify(snapshot).includes("Not started"), false);
});
