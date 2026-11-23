import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { brokerFollowUp, draftMentionsProduct } from "../lib/ndaDraft.ts";
import { ndaActivity, emailFromComms, type NdaActivityQuery } from "../lib/ndaActivity.ts";
import type { CommsRecord } from "../lib/comms.ts";
import { noteEntries } from "../lib/ndaNotes.ts";
import {
  blockerSentence,
  blockerSentenceForDeal,
  coveredSites,
  courtDayCount,
  waitingOnThemLabel,
  discussionSite,
  gateLabel,
  cardNdaLabel,
  ndaChip,
  ndaQueueAllowed,
  ndaQueueBody,
  openNdaQueue,
  overlayDeals,
  presentQueue,
  queueCourt,
  type NdaAgreement,
  type NdaSnapshot,
} from "../lib/nda.ts";
import type { DealProps } from "../lib/types.ts";

const snapshot = JSON.parse(readFileSync("data/generated/nda.json", "utf8")) as NdaSnapshot;
const fixture = JSON.parse(readFileSync("data/fixtures/nda.json", "utf8")) as NdaSnapshot;
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
  assert.equal(gateLabel("None — not gating (R-076)"), "None — not gating");
  assert.equal(ndaChip(deal({})).includes("Not started"), false);
  const overlaid = overlayDeals({ features: [{ properties: { deal_id: "PIPE-PHX-0001" } }] }, snapshot);
  assert.equal(ndaChip(overlaid.features?.[0]?.properties), "Not required");
});

test("a linked chip uses the site mirror, including the Miracle copy", () => {
  const miracle = fixture.sites["PIPE-LAS-0016"];
  assert.equal(fixture.source, "fixture");
  assert.equal(fixture.as_of, "2026-11-11");
  assert.equal(ndaChip(miracle), "With counterparty legal · Them — legal · 13d open · 1d waiting on them");
  assert.equal(ndaChip(fixture.sites["PIPE-LAS-0017"]), ndaChip(miracle));
  assert.equal(ndaChip(fixture.sites["LAND-LAS-0001"]), ndaChip(miracle));
  const live = snapshot.sites["PIPE-LAS-0016"];
  const liveChip = ndaChip(live);
  assert.equal(ndaChip(snapshot.sites["PIPE-LAS-0017"]), liveChip);
  assert.equal(ndaChip(snapshot.sites["LAND-LAS-0001"]), liveChip);
  assert.equal(liveChip.includes(live.nda_status), true);
  if (live.nda_days_open != null) assert.equal(liveChip.includes(`${live.nda_days_open}d open`), true);
  if (live.nda_days_in_court != null) assert.equal(liveChip.includes(`${live.nda_days_in_court}d waiting on them`), true);
  assert.equal(ndaChip({ nda_id: "NDA-006", nda_days_open: 10, nda_days_in_court: 2 }), "10d open · 2d waiting on them");
  assert.equal(waitingOnThemLabel(2), "2d waiting on them");
  assert.equal(waitingOnThemLabel(10 ** 12), `${10 ** 12}d with them`);
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

test("a saved status sits on the register row and a closed one leaves the queue", () => {
  const row = agreement({ nda_id: "NDA-901", site_ids: "PIPE-PHX-9101", nda_status: "With counterparty legal", nda_days_in_court: 2 });
  const saved = presentQueue([row], [{
    nda_id: "NDA-901",
    status: "With Moove legal",
    waiting_on: "Us — legal",
    owner: "cindel",
    next_step: "Send the form",
    last_action: "Status set to With Moove legal",
    last_action_date: "2026-11-20",
    version: 1,
  }], [{ nda_id: "NDA-901", status: "With Moove legal", note: "Legal has it.", actor: "cindel", at: "2026-11-20T15:00:00Z" }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.owner, "cindel");
  assert.equal(saved[0]?.history[0]?.note, "On the register");
  assert.equal(saved[0]?.history[1]?.note, "Legal has it.");
  assert.equal(discussionSite(row), coveredSites(row.site_ids).ids[0]);
  const closed = presentQueue([row], [{
    nda_id: "NDA-901",
    status: "Executed",
    waiting_on: "",
    owner: "",
    next_step: "",
    last_action: "",
    last_action_date: "",
    version: 2,
  }]);
  assert.equal(closed.length, 0);
  const draft = brokerFollowUp(row);
  assert.equal(draftMentionsProduct(draft), false);
  assert.equal(draft.includes("Thank you"), false);
  assert.match(draft, /Status: With counterparty legal/);
  assert.match(draft, /NDA-901/);
  const blank = brokerFollowUp({ ...row, nda_status: "  " });
  assert.equal(blank.includes("Status:"), false);
  assert.equal(blank.includes("Thank you"), false);
});

test("a register note supplies a contact email the overlay left blank", () => {
  const row = agreement({ nda_id: "NDA-901", notes: "Nov 2 wrote person@example.com.", source: "fixture" });
  const shown = presentQueue([row], [], [], "2026-11-23");
  assert.equal(shown[0]?.contact_email, "person@example.com");
  assert.equal(shown[0]?.contact_phone, "");
});

test("register notes split only when a date starts an entry", () => {
  const shaped = "Asked for the form and asks (the court changed hands twice on Nov 18). Nov 20: Sent the form. Nov 18: Opened the file. Nov 19 - Heard back.";
  const entries = noteEntries(shaped);
  assert.deepEqual(entries.map((entry) => entry.slice(0, 6)), ["Nov 20", "Nov 19", "Nov 18", "Asked "]);
  assert.equal(entries.some((entry) => entry.startsWith("(the court")), false);
  assert.equal(entries.some((entry) => entry.startsWith("Nov 9.")), false);
  assert.match(entries[3] || "", /and asks \(/);
  const intact = "She said Nov 4 she would send it; chased Nov 2 and Nov 9.";
  assert.deepEqual(noteEntries(intact), [intact]);
  const kept = "First line stays.\nSecond line stays.";
  assert.deepEqual(noteEntries(kept), [kept]);
  const range = "Forms were agreed Oct 29-30, 2026 and nothing else was logged.";
  assert.deepEqual(noteEntries(range), [range]);
});

function commsRow(partial: Partial<CommsRecord>): CommsRecord {
  return {
    comms_id: "CM-901",
    site_ids: "",
    thread_id: "",
    link: "",
    at: "2026-11-20 12:57",
    direction: "in",
    person: "Sample Person",
    firm: "Sample Firm",
    channel: "email",
    summary: "Sent the form.",
    asks_made: "",
    asks_answered: "",
    attachments: "",
    state_changes: "",
    source: "",
    message_id: "",
    subject: "NDA form",
    ...partial,
  };
}

test("NDA activity dedupes, groups a thread, and reads a matching contact email", () => {
  const query: NdaActivityQuery = {
    sites: ["PIPE-PHX-9101"],
    ndaId: "NDA-901",
    firm: "Sample Firm",
    person: "Sample Person",
    threads: ["1234abcd1234abcd"],
    source: "",
  };
  const rows = [
    commsRow({ comms_id: "CM-901", site_ids: "PIPE-PHX-9101", thread_id: "abcdef0123456789", message_id: "abcdef0123456789", at: "2026-11-20 12:57", summary: "Sent the form.", subject: "NDA form" }),
    commsRow({ comms_id: "CM-902", site_ids: "PIPE-PHX-9102", thread_id: "abcdef0123456789", message_id: "abcdef0123456789", at: "2026-11-20 12:57", summary: "Sent the form again.", subject: "NDA form" }),
    commsRow({ comms_id: "CM-903", site_ids: "", thread_id: "1234abcd1234abcd", message_id: "1234abcd1234abcd", at: "2026-11-18 09:00", direction: "out", summary: "Please reply to person@example.com.", subject: "Follow up" }),
  ];
  const activity = ndaActivity(rows, query);
  assert.equal(activity.items.length, 2);
  assert.equal(activity.items[0]?.at, "Nov 20, 12:57 PM");
  assert.equal(activity.items[0]?.subject, "NDA form");
  assert.equal(activity.items[0]?.direction, "in");
  assert.equal(activity.items[0]?.thread, activity.items[0]?.id);
  assert.equal(activity.items.some((item) => /abcdef|1234abcd/.test(item.thread + item.id)), false);
  assert.equal(activity.contact_email, "person@example.com");
  assert.equal(emailFromComms(rows, "Someone Else"), "");
  const byFirm = ndaActivity([commsRow({ comms_id: "CM-904", at: "2026-11-02 08:15", summary: "Noted." })], {
    ...query,
    sites: [],
    threads: [],
    ndaId: "NDA-902",
  });
  assert.equal(byFirm.items.length, 1);
  assert.equal(byFirm.items[0]?.at, "Nov 2, 8:15 AM");
});

test("the card hides a closed NDA and prefixes an open one for signed-in readers", () => {
  assert.equal(cardNdaLabel({}, true), "");
  assert.equal(cardNdaLabel({ nda_status: "Not required" }, true), "");
  assert.equal(cardNdaLabel({ nda_id: "NDA-001", nda_status: "Executed" }, true), "");
  assert.equal(cardNdaLabel({ nda_id: "NDA-006", nda_status: "With counterparty legal", nda_days_open: 10, nda_days_in_court: 2 }, false), "");
  assert.equal(cardNdaLabel({ nda_id: "NDA-006", nda_status: "With counterparty legal", nda_days_open: 10, nda_days_in_court: 2 }, true), "NDA: With counterparty legal · 10d open · 2d waiting on them");
});
