import { mapPower, matchesMapPower } from "../../lib/mapPower";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { PROTECTED_ROW, PROTECTED_SITE_ID, planSiteMirror } from "../../lib/changes/mirror";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { mirrorHeaderAllowed } from "../../lib/changes/site";
import { memorySql } from "../helpers/sql";
import {
  derivePowerRating,
  explicitMw,
  lineVolts,
  phaseKind,
  serviceAmps,
  serviceMw,
} from "../../lib/score/power-rating";
import {
  DERIVED_POWER_HEADER,
  POWER_FORMULA_CONFIRM,
  POWER_PROTECTED_ROW,
  POWER_PROTECTED_SITE_ID,
  formatFormulaPlan,
  formatPowerReport,
  formulaMode,
  isLegacyUnknownPowerFormula,
  isPowerInPlay,
  planPowerPointsFormulas,
  powerPoints,
  powerPointsFormula,
  powerPointsLabel,
  reportCountsOnly,
} from "../../lib/score/power-sheet";

const LEGACY = '=IF($A5="","",Assumptions!$B$79*VLOOKUP("Unknown",Assumptions!$A$88:$B$98,2,FALSE))';

test("share points stay Strong 15, OK 9, Weak 3, Unknown 7.5", () => {
  assert.equal(powerPoints("Strong"), 15);
  assert.equal(powerPoints("OK"), 9);
  assert.equal(powerPoints("Weak"), 3);
  assert.equal(powerPoints("Unknown"), 7.5);
  assert.equal(powerPointsLabel("Unknown"), "Power 7.5/15");
  assert.equal(powerPointsLabel("OK"), "Power 9/15");
});

test("277/480 and 480/277 are 480 V line-to-line, and 800 A is not Strong", () => {
  assert.equal(lineVolts("277/480"), 480);
  assert.equal(lineVolts("480/277"), 480);
  assert.equal(lineVolts("120/208"), 208);
  assert.equal(lineVolts(480), 480);
  assert.equal(phaseKind("3"), "three");
  assert.equal(phaseKind("3-phase"), "three");
  assert.equal(phaseKind("1.0"), "single");
  assert.equal(serviceAmps("800 (north building); 600 (west building)"), 800);
  assert.equal(explicitMw("1.7 MW"), 1.7);
  const eightHundred = serviceMw(800, 480, "three");
  assert.ok(eightHundred > 0.66 && eightHundred < 0.67);
  assert.ok(eightHundred < 1.7);
  const twoThousand = serviceMw(2000, 480, "three");
  assert.ok(twoThousand < 1.7);
});

test("Las Vegas DRP frontage at 1.7 MW is Strong, and the reason names the read", () => {
  const derived = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 2.1,
    cap_b_nearby: 4.2,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
    cap_b_as_of: "2026-11-05",
  });
  assert.equal(derived.rating, "Strong");
  assert.equal(derived.reason, "Strong: NV Energy DRP frontage 2.1 MW, Estimated");
  assert.equal(derived.inputs[0]?.source, "NV Energy DRP");
  assert.equal(derived.inputs[0]?.confidence, "Estimated");
  assert.equal(derived.inputs[0]?.field, "cap_b_frontage");
  assert.equal(derived.reason.includes("broker"), false);
});

test("a claimed DRP frontage is OK, and 1.0 MW frontage is OK", () => {
  const claimed = derivePowerRating({
    market: "Las Vegas",
    cap_b_frontage: 2.5,
    cap_b_source: "NV Energy DRP",
    cap_b_confidence: "Claimed",
  });
  assert.equal(claimed.rating, "OK");
  const edge = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 1,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(edge.rating, "OK");
  assert.match(edge.reason, /^OK: frontage hosting 1 MW, Estimated$/);
});

test("Phoenix and Miami cannot be Strong", () => {
  const phoenix = derivePowerRating({
    market: "PHX",
    cap_b_frontage: 2.4,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Verified",
  });
  assert.equal(phoenix.rating, "OK");
  const letter = derivePowerRating({
    market: "MIA",
    cap_c_amps: "2 MW",
    cap_c_source: "utility letter",
    cap_c_confidence: "Verified",
  });
  assert.equal(letter.rating, "OK");
  assert.match(letter.reason, /Miami caps at OK/);
  assert.equal(letter.inputs[0]?.confidence, "Verified");
});

test("a verified utility letter at 1.7 MW is Strong in Las Vegas, and 800 A 480 V 3-phase is OK", () => {
  const letter = derivePowerRating({
    market: "LAS",
    cap_c_amps: "1.7 MW",
    cap_c_source: "utility letter",
    cap_c_confidence: "Verified",
  });
  assert.equal(letter.rating, "Strong");
  assert.equal(letter.reason, "Strong: utility letter 1.7 MW, Verified");
  const service = derivePowerRating({
    market: "LAS",
    cap_c_amps: 800,
    cap_c_volts: "480/277",
    cap_c_phase: "3-phase",
    cap_c_source: "utility bill",
    cap_c_confidence: "Claimed",
  });
  assert.equal(service.rating, "OK");
  assert.equal(service.reason, "OK: 3-phase service 800 A at 480 V, Claimed");
  const nameplate = derivePowerRating({
    market: "PHX",
    cap_c_amps: 400,
    cap_c_volts: "277/480",
    cap_c_phase: "3",
    cap_c_source: "nameplate photo",
    cap_c_confidence: "Verified",
  });
  assert.equal(nameplate.rating, "OK");
  assert.match(nameplate.reason, /480 V/);
});

test("nearby hosting covers a lower frontage, including a blank frontage", () => {
  const lower = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 0,
    cap_b_nearby: 3,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(lower.rating, "OK");
  assert.match(lower.reason, /nearby hosting 3 MW/);
  const blank = derivePowerRating({
    market: "LAS",
    cap_b_nearby: 2.4,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(blank.rating, "OK");
});

test("a blank hosting cell stays missing, and a stored zero stays a reading", () => {
  for (const blank of [undefined, null, "", "  "]) {
    const derived = derivePowerRating({
      market: "LAS",
      cap_b_frontage: blank,
      cap_b_nearby: blank,
      cap_b_source: "utility hosting map",
      cap_b_confidence: "Estimated",
      cap_b_as_of: "2026-11-05",
    });
    assert.equal(derived.rating, "Unknown");
    assert.match(derived.reason, /no Layer B hosting/);
  }
  const oneSide = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 0,
    cap_b_nearby: "",
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(oneSide.rating, "Unknown");
});

test("both hosting reads under 1 MW are Weak, and a valid zero counts", () => {
  const zeros = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 0,
    cap_b_nearby: 0,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(zeros.rating, "Weak");
  assert.match(zeros.reason, /frontage 0 MW and nearby 0 MW/);
  const small = derivePowerRating({
    market: "PHX",
    cap_b_frontage: 0.1,
    cap_b_nearby: 0.1,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(small.rating, "Weak");
});

test("single-phase or a small service is Weak only when Layer B is not better", () => {
  const weak = derivePowerRating({
    market: "LAS",
    cap_c_amps: 200,
    cap_c_volts: 240,
    cap_c_phase: "1",
    cap_c_source: "broker statement",
    cap_c_confidence: "Claimed",
  });
  assert.equal(weak.rating, "Weak");
  assert.match(weak.reason, /single-phase 200 A at 240 V, Claimed/);
  const better = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 1.5,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
    cap_c_amps: 50,
    cap_c_volts: 240,
    cap_c_phase: "1",
    cap_c_source: "broker statement",
    cap_c_confidence: "Claimed",
  });
  assert.equal(better.rating, "OK");
  const threePhaseWins = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 0,
    cap_b_nearby: 0,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
    cap_c_amps: 800,
    cap_c_volts: "480/277",
    cap_c_phase: "3-phase",
    cap_c_source: "utility bill",
    cap_c_confidence: "Claimed",
  });
  assert.equal(threePhaseWins.rating, "OK");
});

test("OSM-only Layer A and an incomplete Layer C stay Unknown", () => {
  const osm = derivePowerRating({
    market: "PHX",
    cap_a_source: "OSM proximity (Overpass)",
    cap_a_confidence: "Estimated",
    cap_a_substation_mi: 0.4,
  } as never);
  assert.equal(osm.rating, "Unknown");
  assert.match(osm.reason, /no Layer B hosting and no complete Layer C/);
  const partial = derivePowerRating({
    market: "PHX",
    cap_c_amps: 1200,
    cap_c_source: "listing claim",
    cap_c_confidence: "Claimed",
  });
  assert.equal(partial.rating, "Unknown");
  assert.match(partial.reason, /incomplete Layer C/);
  const gap = derivePowerRating({
    market: "LAS",
    cap_b_frontage: 0.4,
    cap_b_source: "utility hosting map",
    cap_b_confidence: "Estimated",
  });
  assert.equal(gap.rating, "Unknown");
});

test("the formula reads the derived header through the share table and skips row 10", () => {
  const formula = powerPointsFormula(5);
  assert.match(formula, /MATCH\("Power rating \(derived\)",\$4:\$4,0\)/);
  assert.match(formula, /Assumptions!\$B\$79/);
  assert.match(formula, /Assumptions!\$A\$88:\$B\$98/);
  assert.equal(formula.includes("BY"), false);
  assert.equal(isLegacyUnknownPowerFormula(LEGACY), true);
  assert.equal(isLegacyUnknownPowerFormula(formula), false);
  const headers = ["Site", "Power points", "Score (of 100)"];
  const plan = planPowerPointsFormulas([
    {
      title: "Pipeline",
      headers,
      formulas: [
        { row: 5, formula: LEGACY },
        { row: 10, formula: LEGACY },
        { row: 11, formula: powerPointsFormula(11) },
      ],
    },
  ]);
  assert.equal(plan.headers[0]?.value, DERIVED_POWER_HEADER);
  assert.equal(plan.headers[0]?.column, 4);
  assert.equal(plan.formulas.length, 1);
  assert.equal(plan.formulas[0]?.row, 5);
  assert.equal(plan.formulas[0]?.column, 2);
  assert.equal(plan.skippedProtected, 1);
  assert.equal(plan.formulas.some((row) => row.row === POWER_PROTECTED_ROW), false);
  assert.equal(POWER_PROTECTED_ROW, PROTECTED_ROW);
  assert.equal(POWER_PROTECTED_SITE_ID, PROTECTED_SITE_ID);
  assert.match(formatFormulaPlan(plan, "dry-run"), /Nothing was written/);
  assert.equal(formulaMode({}), "dry-run");
  assert.equal(formulaMode({ apply: "1", dry: "0", confirm: "nope" }), "refuse");
  assert.equal(formulaMode({ apply: "1", dry: "0", confirm: POWER_FORMULA_CONFIRM }), "apply");
});

test("the report is counts only in CI and never prints a name or a price", () => {
  const rows = [
    { sheet: "Pipeline" as const, rowNumber: 5, siteId: "PIPE-LAS-9001", market: "LAS", stage: "1 Desk screen", oldPoints: 7.5, rating: "Strong" as const, name: "Sample wash", asking: "$9" },
    { sheet: "Pipeline" as const, rowNumber: 10, siteId: "PIPE-PHX-0006", market: "PHX", stage: "1 Desk screen", oldPoints: 7.5, rating: "Strong" as const },
    { sheet: "Pipeline" as const, rowNumber: 12, siteId: "PIPE-SNA-9002", market: "SNA", stage: "1 Desk screen", oldPoints: 7.5, rating: "OK" as const },
    { sheet: "Land Sites" as const, rowNumber: 6, siteId: "LAND-PHX-9001", market: "PHX", stage: "Off market (no lead)", oldPoints: 7.5, rating: "Weak" as const },
    { sheet: "Land Sites" as const, rowNumber: 7, siteId: "LAND-LAS-9001", market: "LAS", stage: "1 Desk screen", oldPoints: 7.5, rating: "Weak" as const },
  ];
  assert.equal(isPowerInPlay(rows[0]), true);
  assert.equal(isPowerInPlay(rows[1]), false);
  assert.equal(isPowerInPlay(rows[2]), false);
  assert.equal(isPowerInPlay(rows[3]), false);
  const ci = formatPowerReport(rows, true);
  assert.match(ci, /pipeline_in_play 1/);
  assert.match(ci, /pipeline_strong 1/);
  assert.match(ci, /land_weak 1/);
  assert.equal(ci.includes("Sample wash"), false);
  assert.equal(ci.includes("PIPE-LAS-9001"), false);
  assert.equal(ci.includes("$9"), false);
  assert.equal(ci.includes("#"), false);
  const local = formatPowerReport(rows, false);
  assert.match(local, /#/);
  assert.equal(local.includes("Sample wash"), false);
  assert.equal(local.includes("PIPE-LAS-9001"), false);
  assert.equal(reportCountsOnly({ CI: "true" }), true);
  assert.equal(reportCountsOnly({}), false);
});

const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };

test("a site stores the derived rating and the mirror writes that header", async () => {
  assert.equal(mirrorHeaderAllowed("Power rating (derived)"), true);
  assert.throws(
    () => validateBatch(contributor, "grade", { changes: [{
      entity_type: "site",
      site_id: "PIPE-LAS-9001",
      expected_version: 1,
      source: "sample",
      payload: { facts: { power_rating: "Strong" } },
    }] }),
    /not accepted/,
  );
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, contributor, "power-create", {
    changes: [{
      entity_type: "site",
      site_id: "PIPE-LAS-9001",
      expected_version: 0,
      source: "sample",
      payload: { name: "Sample wash", market: "LAS" },
    }],
  });
  await applyBatch(sql, contributor, "power-facts", {
    changes: [{
      entity_type: "site",
      site_id: "PIPE-LAS-9001",
      expected_version: 1,
      source: "sample",
      payload: {
        facts: {
          cap_b_frontage: "2.1",
          cap_b_source: "utility hosting map",
          cap_b_confidence: "Estimated",
        },
        sources: { cap_b_frontage: "sample hosting map" },
      },
    }],
  });
  const stored = await sql.query<{ power_rating: string; power_rating_reason: string }>(
    "SELECT power_rating, power_rating_reason FROM sites WHERE site_id = 'PIPE-LAS-9001'",
  );
  assert.equal(stored.rows[0]?.power_rating, "Strong");
  assert.equal(stored.rows[0]?.power_rating_reason, "Strong: NV Energy DRP frontage 2.1 MW, Estimated");
  const plan = planSiteMirror(
    [{
      title: "Pipeline",
      headerRow: 4,
      headers: ["Site ID", DERIVED_POWER_HEADER],
      rows: [
        { row: 5, cells: ["PIPE-LAS-9001", ""] },
        { row: 10, cells: ["PIPE-PHX-0006", "OK"] },
      ],
    }],
    [
      { site_id: "PIPE-LAS-9001", writes: { [DERIVED_POWER_HEADER]: "Strong" } },
      { site_id: "PIPE-PHX-0006", writes: { [DERIVED_POWER_HEADER]: "Strong" } },
    ],
  );
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]?.after, "Strong");
  assert.equal(plan.changes[0]?.row, 5);
  assert.equal(plan.changes.some((change) => change.row === 10), false);
});

test("the formula and report workflows stay manual, and the formula apply is confirm-gated", () => {
  const formula = readFileSync(".github/workflows/power-points-formula.yml", "utf8");
  const report = readFileSync(".github/workflows/power-points-report.yml", "utf8");
  assert.match(formula, /workflow_dispatch:/);
  assert.doesNotMatch(formula, /pull_request:/);
  assert.match(formula, /dry_run:[\s\S]*?default: true/);
  assert.match(formula, /power-points-derived/);
  assert.match(formula, /inputs\.confirm != 'power-points-derived'/);
  assert.match(report, /workflow_dispatch:/);
  assert.doesNotMatch(report, /pull_request:/);
  assert.doesNotMatch(report, /values:batchUpdate|batchUpdate/);
  const migration = readFileSync("db/migrations/024_power_rating.sql", "utf8");
  assert.match(migration, /power_rating/);
  assert.match(migration, /power_rating_reason/);
  assert.doesNotMatch(migration, /PIPE-|LAND-|INSERT INTO sites/);
});

test("map evidence preserves zero, forecast years, disagreement and independent filter axes", () => {
  const broker = {cap_c_phase:"3-phase",cap_c_volts:480,cap_c_source:"Broker note",cap_c_confidence:"Claimed",
    cap_b_frontage:0,cap_b_nearby:2.2,cap_b_horizon:"2028"};
  const document = {cap_c_volts:240,cap_c_source:"Main panel photo",cap_c_confidence:"Verified"};
  const facts = mapPower(broker,document);
  assert.equal(facts.street[0].frontage,0);
  assert.equal(facts.street[0].horizon,"2028");
  assert.equal(facts.differing,true);
  assert.equal(matchesMapPower(facts,"broker","with"),true);
  assert.equal(matchesMapPower(facts,"documented","with"),true);
  assert.equal(matchesMapPower(mapPower(document),"documented","without"),true);
  assert.equal(matchesMapPower(mapPower({cap_a_line_ft:20}),"unknown","without"),true);
  assert.equal(mapPower(broker).service[0].available,null);
  assert.equal(mapPower(document).service[0].documented,true);
});
