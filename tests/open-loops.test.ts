import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ndaQueueAllowed, ndaQueueBody, type NdaSnapshot } from "../lib/nda.ts";
import {
  OPEN_LOOP_FILTERS,
  PARKED_BADGE,
  briefSet,
  courtDayCount,
  deriveOpenLoops,
  isClosedOrDropped,
  isParkedDecision,
  siteCourt,
  visibleLoops,
  type OpenLoopsSnapshot,
  type OpenLoopSite,
} from "../lib/openLoops.ts";
import { workbookStepFor } from "../lib/workbookStep.ts";

const snapshot = JSON.parse(readFileSync("data/fixtures/open-loops.json", "utf8")) as OpenLoopsSnapshot;
const derived = deriveOpenLoops(snapshot);
const route = readFileSync("lib/api/handlers/data/open-loops.ts", "utf8");
const explorer = readFileSync("components/Explorer.tsx", "utf8");
const python = readFileSync("scripts/open_loops.py", "utf8");
const panel = readFileSync("components/OpenLoops.tsx", "utf8");

const EXPECTED = [
  "NDA-004",
  "LAND-PHX-0050",
  "LAND-PHX-0053",
  "LAND-LAS-0012",
  "LAND-PHX-0052",
  "LAND-LAS-0008",
  "LAND-PHX-0056",
  "LAND-PHX-0057",
  "LAND-PHX-0039",
  "LAND-PHX-0060",
  "LAND-PHX-0061",
  "PIPE-SNA-0002",
  "NDA-002",
  "NDA-003",
  "LAND-LAS-0013",
  "PIPE-PHX-0007",
  "PIPE-PHX-0084",
  "LAND-LAS-0004",
  "PIPE-PHX-0006",
  "PIPE-PHX-0008",
  "PIPE-PHX-0009",
  "PIPE-LAS-0072",
  "PIPE-MIA-0075",
  "PIPE-PHX-0085",
  "LAND-LAS-0001",
  "LAND-PHX-0007",
  "LAND-PHX-0045",
  "PIPE-MIA-0076",
  "PIPE-MIA-0077",
  "LAND-LAS-0014",
  "LAND-PHX-0033",
  "LAND-PHX-0044",
  "LAND-PHX-0048",
  "LAND-LAS-0050",
  "LAND-MIA-0051",
  "NDA-006",
  "NDA-007",
  "NDA-008",
  "LAND-LAS-0005",
  "LAND-MIA-0006",
  "LAND-PHX-0034",
  "LAND-PHX-0036",
  "NDA-001",
  "NDA-005",
];

function site(partial: Partial<OpenLoopSite>): OpenLoopSite {
  return {
    site_id: "PIPE-PHX-9000",
    label: "Sample",
    market: "PHX",
    stage: "1 Desk screen",
    next_step: "Ask the broker for the survey.",
    nda_id: "",
    stage_blocker: "We owe a reply",
    stage_blocker_since: "2026-11-10",
    ...partial,
  };
}

function byId(id: string) {
  return derived.loops.find((row) => row.id === id);
}

test("the Nov 11 fixture keeps the brief set as the three NDA lines", () => {
  assert.equal(snapshot.source, "fixture");
  assert.equal(snapshot.as_of, "2026-11-11");
  assert.equal(derived.loops.length, EXPECTED.length);
  assert.deepEqual(derived.loops.map((row) => row.id).slice().sort(), EXPECTED.slice().sort());
  assert.equal(derived.loops[0]?.id, "NDA-004");
  assert.equal(derived.loops[0]?.court, "Us — signer");
  assert.equal(derived.loops[0]?.days, 8);
  assert.equal(derived.loops.at(-1)?.id, "NDA-005");
  const flagged = briefSet(derived.loops);
  assert.deepEqual(flagged.map((row) => row.id), ["NDA-004", "NDA-002", "NDA-003"]);
  assert.deepEqual(flagged.map((row) => row.days), [8, 20, 16]);
  assert.equal(derived.loops.filter((row) => row.owner === "Brief").length, 19);
  assert.equal(derived.loops.filter((row) => row.owner === "Chase check").length, 25);
  assert.equal(derived.loops.filter((row) => row.brief_flagged).length, 3);
  assert.match(panel, /brief_flagged \? " · In brief"/);
  assert.equal(derived.loops.filter((row) => row.owner === "Panel only").length, 0);
  let group = -1;
  let previousDays = 999;
  for (const row of derived.loops) {
    assert.equal(typeof row.days, "number");
    assert.equal(Number.isInteger(row.days), true);
    const nextGroup = row.court.startsWith("Us") ? 0 : row.court.startsWith("Them") ? 1 : 2;
    assert.ok(nextGroup >= group);
    if (nextGroup !== group) previousDays = 999;
    assert.ok(row.days <= previousDays);
    group = nextGroup;
    previousDays = row.days;
  }
});

test("closed NDAs stay out and their frozen days-open are left alone", () => {
  const closed = snapshot.register.filter((row) => row.nda_id === "NDA-009" || row.nda_id === "NDA-010");
  assert.deepEqual(closed.map((row) => [row.nda_id, row.nda_waiting_on, row.nda_days_open]), [
    ["NDA-009", "—", 5],
    ["NDA-010", "—", 2],
  ]);
  assert.equal(derived.loops.some((row) => row.id === "NDA-009" || row.id === "NDA-010"), false);
  const raw = JSON.stringify(derived.loops);
  assert.equal(raw.includes("1899"), false);
  assert.equal(raw.includes("12/30"), false);
});

test("NDA-002 keeps its description and NDA-005 is zero days with the site folded in", () => {
  const confidential = byId("NDA-002");
  assert.equal(confidential?.site_note, "Confidential Las Vegas business (identity withheld pending NDA)");
  assert.deepEqual(confidential?.folded_site_ids, []);
  assert.equal(confidential?.court, "Them — legal");
  assert.equal(confidential?.days, 20);
  assert.equal(JSON.stringify(confidential).toLowerCase().includes("missing"), false);
  const folded = byId("NDA-005");
  assert.equal(folded?.court, "Them — signer");
  assert.equal(folded?.days, 0);
  const shipped = deriveOpenLoops(JSON.parse(readFileSync("data/generated/open-loops.json", "utf8")) as OpenLoopsSnapshot);
  const queue = ndaQueueBody(JSON.parse(readFileSync("data/generated/nda.json", "utf8")) as NdaSnapshot);
  for (const loop of shipped.loops) {
    assert.equal(typeof loop.days, "number");
    assert.ok(loop.days >= 0);
    assert.equal(JSON.stringify(loop).includes("1899"), false);
    const queued = queue.queue.find((row) => row.nda_id === loop.id);
    if (queued) assert.equal(queued.nda_waiting_on, loop.court);
  }
  assert.equal(courtDayCount("12/30/1899"), 0);
  assert.equal(courtDayCount(0), 0);
  assert.deepEqual(folded?.folded_site_ids, ["PIPE-PHX-0014"]);
  assert.equal(derived.loops.some((row) => row.id === "PIPE-PHX-0014"), false);
  const separate = byId("NDA-003");
  assert.deepEqual(separate?.folded_site_ids, []);
  assert.equal(derived.loops.some((row) => row.id === "PIPE-PHX-0018"), false);
  assert.equal(byId("NDA-008")?.folded_site_ids.includes("PIPE-LAS-0070"), true);
  assert.equal(byId("NDA-008")?.folded_site_ids.includes("PIPE-LAS-0071"), true);
});

test("parked rows stay off the default list and off the brief, and stage is still Desk screen", () => {
  for (const id of ["PIPE-LAS-0015", "PIPE-LAS-0016", "PIPE-LAS-0017"]) {
    assert.equal(derived.loops.some((row) => row.id === id), false);
    assert.equal(briefSet(derived.parked).some((row) => row.id === id), false);
    const source = snapshot.sites.find((row) => row.site_id === id);
    assert.match(source?.stage || "", /Desk screen/);
    assert.equal(/dropped/i.test(source?.stage || ""), false);
  }
  const shown = visibleLoops(derived, { ...OPEN_LOOP_FILTERS, showParked: true });
  const parked = shown.find((row) => row.id === "PIPE-LAS-0015");
  assert.equal(parked?.parked, true);
  assert.equal(PARKED_BADGE, "Parked — owner's decision");
  assert.match(panel, /row\.parked \? <p>\{PARKED_BADGE\}<\/p>/);
  assert.equal(briefSet(shown).map((row) => row.id).includes("PIPE-LAS-0015"), false);
  assert.deepEqual(briefSet(shown).map((row) => row.id), ["NDA-004", "NDA-002", "NDA-003"]);
});

test("closed and dropped notes are not live loops", () => {
  for (const id of ["LAND-PHX-0043", "LAND-PHX-0049", "LAND-PHX-0054", "LAND-PHX-0055", "PIPE-PHX-0005", "PIPE-PHX-0081", "PIPE-PHX-0018"]) {
    assert.equal(derived.loops.some((row) => row.id === id), false);
    assert.equal(isClosedOrDropped(snapshot.sites.find((row) => row.site_id === id)?.next_step || ""), true);
  }
  assert.equal(derived.loops.some((row) => /none\s*[—-]\s*closed/i.test(row.next_step)), false);
  assert.equal(derived.loops.some((row) => /^(?:dropped|closed)\b/i.test(row.next_step)), false);
  assert.equal(derived.loops.some((row) => /\bstays dropped\b/i.test(row.next_step)), false);
  assert.equal(byId("LAND-LAS-0008")?.label.includes("Closed"), true);
  assert.equal(isClosedOrDropped("Not dropped. Still waiting on the broker."), false);
});

test("courts and owners follow the table", () => {
  assert.equal(byId("LAND-PHX-0050")?.court, "Us — reply");
  assert.equal(byId("LAND-PHX-0050")?.detail, "We owe a reply");
  assert.equal(byId("LAND-LAS-0008")?.court, "Us — diligence");
  assert.equal(byId("LAND-LAS-0008")?.detail, "Our-side diligence");
  assert.equal(byId("PIPE-SNA-0002")?.court, "Them — broker");
  assert.equal(byId("PIPE-SNA-0002")?.owner, "Chase check");
  assert.equal(byId("PIPE-SNA-0002")?.days, 28);
  assert.equal(byId("PIPE-SNA-0002")?.brief_flagged, false);
  assert.equal(byId("PIPE-PHX-0084")?.detail, "Awaiting package");
  assert.equal(byId("PIPE-PHX-0084")?.owner, "Brief");
  assert.equal(byId("PIPE-PHX-0084")?.days, 5);
  assert.equal(byId("PIPE-PHX-0084")?.brief_flagged, false);
  assert.equal(siteCourt("We owe a reply", ""), "Us — reply");
  assert.equal(siteCourt("Our-side diligence", ""), "Us — diligence");
  assert.equal(siteCourt("NDA execution", "—"), "Them — signer");
  assert.equal(siteCourt("NDA execution", "Us — signer"), "Us — signer");
  assert.equal(siteCourt("Price/terms", ""), "—");
  assert.equal(siteCourt("Tenure", ""), "—");
  assert.equal(isParkedDecision("Jaideep decided this is a suggested drop"), true);
  assert.equal(isParkedDecision("KEEP parked as a suggested drop"), true);
  assert.equal(isParkedDecision("Monitor only — parked at his direction"), true);
  assert.equal(isParkedDecision("Under 4 stalls fit"), false);
});

test("a knock-out without a park line stays, and no-court rows sort last", () => {
  const synthetic = deriveOpenLoops({
    source: "test",
    as_of: "2026-11-11",
    label: "",
    register: [{
      nda_id: "NDA-900",
      counterparty_firm: "Example",
      counterparty_person: "Ada",
      site_ids: "PIPE-PHX-9001",
      nda_status: "Moove form sent",
      nda_waiting_on: "Them — signer",
      nda_waiting_on_since: "2026-11-01",
      nda_gates: "Package",
      nda_days_open: 10,
      nda_days_in_court: 10,
    }],
    sites: [
      site({ site_id: "PIPE-PHX-9001", stage_blocker: "NDA execution", nda_id: "NDA-900", stage_blocker_since: "2026-11-01" }),
      site({ site_id: "PIPE-PHX-9002", stage_blocker: "NDA execution", nda_id: "", stage_blocker_since: "2026-11-09" }),
      site({ site_id: "PIPE-PHX-9003", stage_blocker: "Price/terms", stage_blocker_since: "2026-11-01", next_step: "Price is still open." }),
      site({ site_id: "PIPE-PHX-9004", stage_blocker: "Tenure", stage_blocker_since: "2026-10-28" }),
      site({ site_id: "PIPE-PHX-9005", stage: "Dropped", stage_blocker: "We owe a reply" }),
      site({ site_id: "PIPE-SNA-9006", market: "SNA", stage_blocker: "Awaiting broker reply", stage_blocker_since: "2026-10-01", next_step: "Under 4 stalls fit. Still waiting on the broker." }),
    ],
  });
  assert.equal(synthetic.loops.some((row) => row.id === "PIPE-PHX-9001"), false);
  assert.deepEqual(synthetic.loops.find((row) => row.id === "NDA-900")?.folded_site_ids, ["PIPE-PHX-9001"]);
  const unlinked = synthetic.loops.find((row) => row.id === "PIPE-PHX-9002");
  assert.equal(unlinked?.court, "Them — signer");
  assert.equal(unlinked?.owner, "Brief");
  assert.equal(synthetic.loops.find((row) => row.id === "PIPE-PHX-9003")?.court, "—");
  assert.equal(synthetic.loops.find((row) => row.id === "PIPE-PHX-9003")?.owner, "Panel only");
  assert.equal(synthetic.loops.find((row) => row.id === "PIPE-PHX-9004")?.owner, "Panel only");
  assert.equal(synthetic.loops.some((row) => row.id === "PIPE-PHX-9005"), false);
  const knock = synthetic.loops.find((row) => row.id === "PIPE-SNA-9006");
  assert.equal(knock?.owner, "Chase check");
  assert.equal(knock?.brief_flagged, false);
  const ids = synthetic.loops.map((row) => row.id);
  assert.ok(ids.indexOf("PIPE-PHX-9003") > ids.indexOf("PIPE-SNA-9006"));
  assert.ok(ids.indexOf("PIPE-PHX-9004") > ids.indexOf("NDA-900"));
  const aged = visibleLoops(synthetic, { ...OPEN_LOOP_FILTERS, age: "15+" });
  assert.equal(aged.some((row) => row.id === "PIPE-SNA-9006"), true);
  assert.equal(aged.some((row) => row.id === "NDA-900"), false);
});

test("the open-loops API is signed in the same way as the NDA queue", () => {
  assert.equal(ndaQueueAllowed("viewer"), true);
  assert.equal(ndaQueueAllowed("guest"), false);
  assert.match(route, /requireUser\(/);
  assert.match(route, /ndaQueueAllowed\(session\.actionRole\)/);
  assert.match(explorer, /ndaQueueAllowed\(me\.actionRole\)/);
  assert.match(explorer, /loopsAllowed/);
  assert.match(explorer, /loops: "1"/);
  assert.match(explorer, /Open loops/);
  assert.equal(python.includes("workbook.save"), false);
  assert.equal(python.toLowerCase().includes("morning-brief"), false);
  assert.equal(readFileSync("lib/openLoops.ts", "utf8").toLowerCase().includes("morning-brief"), false);
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons, [{ path: "/api/alerts/digest", schedule: "0 15 * * *" }]);
  const raw = readFileSync("data/fixtures/open-loops.json", "utf8");
  assert.equal(/\bcharging\b/i.test(raw), false);
  assert.equal(/\bautonomous\b/i.test(raw), false);
  assert.equal(/\bAVs?\b/.test(raw), false);
});

test("the signed-in workbook step keeps the text the public card drops", () => {
  const site = {
    site_id: "PIPE-MIA-0080",
    label: "Stars & Stripes",
    market: "MIA",
    stage: "2 Financial screen",
    next_step: "Awaiting POS/car counts and water bills.",
    nda_id: "",
    stage_blocker: "—",
    stage_blocker_since: "",
    next_step_owner: "Broker",
    next_step_due: "2026-11-20",
  };
  const step = workbookStepFor({ sites: [site] }, "PIPE-MIA-0080");
  assert.equal(step?.text, "Awaiting POS/car counts and water bills.");
  assert.equal(step?.owner, "Broker");
  assert.equal(step?.due, "2026-11-20");
  assert.equal(workbookStepFor({ sites: [site] }, "PIPE-PHX-0001"), null);
  const deals = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as { features: { properties: { deal_id?: string; next_step?: string } }[] };
  const stars = deals.features.find((feature) => feature.properties.deal_id === "PIPE-MIA-0080")?.properties;
  assert.equal(stars?.next_step || "", "");
  const loops = JSON.parse(readFileSync("data/generated/open-loops.json", "utf8")) as OpenLoopsSnapshot;
  assert.match(workbookStepFor(loops, "PIPE-MIA-0080")?.text || "", /POS\/car counts/);
});
