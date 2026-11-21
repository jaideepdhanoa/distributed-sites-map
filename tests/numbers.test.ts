import assert from "node:assert/strict";
import test from "node:test";
import { pipelineCsv, type PipelineRow } from "../components/PipelineList.tsx";
import { inCountedMarket, latestTouch, marketCounts, reviewBadge, stepParts } from "../lib/counts.ts";
import { scoreIssue, storedScoreView } from "../lib/scoreDisplay.ts";
import type { DealProps } from "../lib/types.ts";
import { reviewWhen } from "../lib/queue/when.ts";

test("market chips add up to All, including Other", () => {
  const counts = marketCounts([
    { city: "PHX" },
    { city: "LAS" },
    { city: "MIA" },
    { city: "MIA" },
    { city: "SNA" },
  ]);
  assert.equal(counts.All, 5);
  assert.equal(counts.PHX + counts.LAS + counts.MIA + counts.Other, counts.All);
  assert.equal(counts.Other, 1);
  assert.equal(inCountedMarket("SNA", "other"), true);
  assert.equal(inCountedMarket("PHX", "other"), false);
  assert.equal(inCountedMarket("PHX", "PHX"), true);
});

test("pipeline steps count operating businesses, and land sits beside them", () => {
  const rows = [
    { kind: "pipeline", stage_group: "desk" },
    { kind: "pipeline", stage_group: "desk" },
    { kind: "land", stage_group: "desk" },
    { kind: "land", stage_group: "dropped" },
  ];
  assert.deepEqual(stepParts(rows, "desk"), { operating: 2, land: 1 });
  assert.deepEqual(stepParts(rows, "dropped"), { operating: 0, land: 1 });
});

test("the review badge names all markets when the map is one market", () => {
  assert.deepEqual(reviewBadge({ count: 8, allMarkets: false }), { count: 8, label: "all markets" });
  assert.equal(reviewBadge({ count: 8, allMarkets: true }).label, "");
});

test("last touched is the later of the workbook date and an app event", () => {
  assert.equal(latestTouch("2026-11-01", ["2026-11-19T18:00:00.000Z"]), "2026-11-19");
  assert.equal(latestTouch("2026-11-20", ["2026-11-02"]), "2026-11-20");
  assert.equal(latestTouch("", []), "");
});

test("a disagreeing score is provisional and a blank economics cell is not scored", () => {
  const off = storedScoreView({ score: 72, economics: 10, land: 10, power: 7.5, location: 10, deal: 5 });
  assert.equal(off.chip, "Provisional");
  assert.equal(off.summed, "42.5");
  assert.equal(scoreIssue({ score: 72, economics: 10, land: 10, power: 7.5, location: 10, deal: 5 }), true);
  const blank = storedScoreView({ score: 10, economics: null, land: 5, power: 5, location: 0, deal: 0 });
  assert.equal(blank.chip, "Not scored");
  assert.equal(scoreIssue({ score: 10, economics: null, land: 5, power: 5, location: 0, deal: 0 }), true);
});

test("a snapshot change names the refresh, and a proposal names its clock", () => {
  assert.equal(reviewWhen({ type: "stage", at: "2026-11-19T18:04:00.000Z", source: "snapshot" }), "Seen in the Nov 19 refresh");
  assert.match(reviewWhen({ type: "next_proposed", at: "2026-11-19T18:04:00.000Z" }), /^Proposed at /);
  assert.match(reviewWhen({ type: "note", at: "2026-11-19T18:04:00.000Z" }), /^Commented at /);
});

test("csv export leads with id, market, stage, and drop reason", () => {
  const dropped = {
    deal_id: "PIPE-PHX-0008",
    city: "PHX",
    stage: "Dropped",
    stage_group: "dropped",
    chips: [{ family: "drop_reason", code: "lot", label: "Lot", tone: "sand", help: "", since: "", note: "", owner: "", due: "", source: "" }],
  } as DealProps;
  const open = { deal_id: "LAND-LAS-0002", city: "SNA", stage: "1 Desk screen", stage_group: "desk" } as DealProps;
  const row = (deal: DealProps): PipelineRow => ({ deal, noPin: true });
  const csv = pipelineCsv([row(dropped), row(open)], ["site", "stage", "score", "chip_drop"]);
  const [header, first, second] = csv.split("\n");
  assert.equal(header, "Site ID,Market,Stage,Drop reason,Score");
  assert.match(first || "", /^"PIPE-PHX-0008","PHX","Dropped","Lot"/);
  assert.match(second || "", /^"LAND-LAS-0002","Other","/);
  assert.match(second || "", /,"",/);
});
