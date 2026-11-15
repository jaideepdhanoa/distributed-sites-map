import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { importChanged } from "../../lib/changes/backfill";
import { diffDatabase } from "../../lib/changes/diff";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { COMMS_FIELDS, SERVICE_AREA_CLASSES } from "../../lib/changes/vocab";
import { workbookIssues, type CommsRow, type StageRow, type WorkbookSlice } from "../../lib/changes/workbook";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };

/** Counts from production shadow diff 43735484822, snapshot ab50fe1e. */
const CLASS_COUNTS = [
  ["inside", 57],
  ["near_0_5", 50],
  ["near_5_10", 31],
  ["outside", 6],
  ["unknown", 10],
  ["edge_legacy", 11],
] as const;

const BLANK_COMMS: [string, string][] = [
  ["CM-0402", "in"],
  ["CM-0423", "internal"],
  ["CM-0424", "internal"],
  ["CM-0425", "internal"],
  ["CM-0426", "internal"],
  ["CM-0427", "internal"],
  ["CM-0463", "internal"],
  ["CM-0467", "internal"],
  ["CM-0468", "internal"],
  ["CM-0471", "internal"],
  ["CM-0473", "internal"],
];

const LISTING_COMMS: [string, string][] = [
  ["CM-0433", "out"],
  ["CM-0434", "in"],
  ["CM-0435", "out"],
  ["CM-0565", "out"],
  ["CM-0578", "out"],
];

function stageChange(serviceArea: string, siteId = "PIPE-PHX-0001") {
  return {
    entity_type: "stage",
    site_id: siteId,
    expected_version: 0,
    source: "desk review",
    payload: { stage: "1 Desk screen", market: "PHX", service_area_class: serviceArea },
  };
}

function commsChange(siteId: string) {
  return {
    entity_type: "comms",
    site_id: siteId,
    expected_version: 0,
    source: "call",
    payload: { direction: "out", summary: "Called" },
  };
}

function commsRow(entityId: string, siteId: string, direction: string): CommsRow {
  const row = { entity_id: entityId, site_id: siteId } as CommsRow;
  for (const field of COMMS_FIELDS) row[field] = "";
  row.site_ids = siteId;
  row.direction = direction;
  return row;
}

function productionSlice(): { valid: WorkbookSlice; reported: WorkbookSlice } {
  const stages: StageRow[] = [];
  let n = 0;
  for (const [serviceArea, count] of CLASS_COUNTS) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const legacy = n === 1;
      stages.push({
        site_id: legacy ? "LAND-PHX-0003" : `PIPE-PHX-${String(n).padStart(4, "0")}`,
        stage: legacy ? "Financial screen" : "1 Desk screen",
        market: "PHX",
        service_area_class: serviceArea,
        reason: "",
      });
    }
  }
  stages.push({
    site_id: "PIPE-LAS-0001",
    stage: "1 Desk screen",
    market: "LAS",
    service_area_class: "",
    reason: "",
  });
  const comms = [
    ...BLANK_COMMS.map(([id, direction]) => commsRow(id, "", direction)),
    ...LISTING_COMMS.map(([id, direction]) => commsRow(id, "L-441", direction)),
  ];
  const valid: WorkbookSlice = { stages, activities: [], comms };
  const reported: WorkbookSlice = {
    stages: [
      ...stages,
      { site_id: "PIPE-MIA-0001", stage: "1 Desk screen", market: "MIA", service_area_class: "Inside", reason: "" },
      { site_id: "PIPE-MIA-0002", stage: "1 Desk screen", market: "MIA", service_area_class: "Unknown", reason: "" },
      { site_id: "PIPE-MIA-0003", stage: "1 Desk screen", market: "MIA", service_area_class: "Edge", reason: "" },
    ],
    activities: [],
    comms: [...comms, commsRow("CM-0999", "L-441a", "out")],
  };
  return { valid, reported };
}

test("the write schema accepts the six workbook classes and a blank or listing comms id", () => {
  for (const serviceArea of SERVICE_AREA_CLASSES) {
    assert.doesNotThrow(() => validateBatch(human, `class-${serviceArea}`, { changes: [stageChange(serviceArea)] }));
  }
  assert.throws(() => validateBatch(human, "display", { changes: [stageChange("Inside")] }), /inside, near_0_5/);
  assert.throws(() => validateBatch(human, "display-unknown", { changes: [stageChange("Unknown")] }), /inside, near_0_5/);
  assert.throws(() => validateBatch(human, "display-edge", { changes: [stageChange("Edge")] }), /inside, near_0_5/);
  assert.throws(() => validateBatch(human, "blank-class", { changes: [stageChange("")] }), /inside, near_0_5/);
  assert.doesNotThrow(() => validateBatch(contributor, "blank-site", { changes: [commsChange("")] }));
  assert.doesNotThrow(() => validateBatch(contributor, "listing", { changes: [commsChange("L-441")] }));
  assert.throws(() => validateBatch(contributor, "bad-listing", { changes: [commsChange("L-441a")] }), /site id is not valid/);
  assert.throws(() => validateBatch(contributor, "lower-listing", { changes: [commsChange("l-441")] }), /site id is not valid/);
  assert.throws(() => validateBatch(human, "stage-blank", { changes: [stageChange("inside", "")] }), /site id is not valid/);
  assert.throws(() => validateBatch(human, "stage-listing", { changes: [stageChange("inside", "L-441")] }), /site id is not valid/);
  assert.throws(
    () =>
      validateBatch(contributor, "activity-listing", {
        changes: [
          {
            entity_type: "activity",
            site_id: "L-441",
            expected_version: 0,
            source: "listing note",
            payload: { date: "2026-11-15", type: "listing", summary: "Listing noted" },
          },
        ],
      }),
    /site id is not valid/,
  );
});

test("import keeps the production service areas and the 16 real comms rows", async () => {
  const { valid, reported } = productionSlice();
  assert.equal(valid.stages.filter((row) => row.service_area_class !== "").length, 165);
  assert.equal(valid.comms.length, 16);
  const issues = workbookIssues(reported);
  assert.deepEqual(
    issues.stage.map((issue) => issue.value),
    ["Inside", "Unknown", "Edge"],
  );
  assert.deepEqual(
    issues.comms.map((issue) => [issue.id, issue.value]),
    [["CM-0999", "L-441a"]],
  );
  assert.equal(issues.comms.some((issue) => issue.value === "L-441" || issue.value === ""), false);

  const sql = await memorySql();
  await migrate(sql);
  const imported = await importChanged(sql, reported, "ab50fe1e");
  assert.equal(imported.inserted.stage, 166);
  assert.equal(imported.invalid.stage, 3);
  assert.equal(imported.inserted.comms, 16);
  assert.equal(imported.invalid.comms, 1);

  const stored = await sql.query<{ service_area_class: string; n: number | string }>(
    "SELECT service_area_class, count(*)::int AS n FROM site_stages GROUP BY 1 ORDER BY 1",
  );
  assert.deepEqual(
    stored.rows.map((row) => [row.service_area_class, Number(row.n)]),
    [
      ["", 1],
      ["edge_legacy", 11],
      ["inside", 57],
      ["near_0_5", 50],
      ["near_5_10", 31],
      ["outside", 6],
      ["unknown", 10],
    ],
  );
  const legacy = await sql.query<{ stage: string; service_area_class: string }>(
    "SELECT stage, service_area_class FROM site_stages WHERE site_id = 'LAND-PHX-0003'",
  );
  assert.equal(legacy.rows[0]?.stage, "Financial screen");
  assert.equal(legacy.rows[0]?.service_area_class, "inside");
  const blank = await sql.query<{ site_id: string }>("SELECT site_id FROM comms_entries WHERE entity_id = 'CM-0402'");
  assert.equal(blank.rows[0]?.site_id, "");
  const listing = await sql.query<{ site_id: string }>("SELECT site_id FROM comms_entries WHERE entity_id = 'CM-0433'");
  assert.equal(listing.rows[0]?.site_id, "L-441");

  const dirty = await diffDatabase(sql, reported, "snapshot ab50fe1e");
  assert.equal(dirty.clean, false);
  assert.deepEqual(dirty.clean_by_entity, { stage: false, activity: true, comms: false, site: true });
  assert.deepEqual(dirty.legacy_stages, ["LAND-PHX-0003"]);
  const clean = await diffDatabase(sql, valid, "snapshot ab50fe1e");
  assert.equal(clean.clean, true);
  assert.deepEqual(clean.clean_by_entity, { stage: true, activity: true, comms: true, site: true });
  assert.deepEqual(clean.legacy_stages, ["LAND-PHX-0003"]);
});

test("a write stores edge_legacy, unknown, a blank site, and L-441 unchanged", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, human, "edge", { changes: [stageChange("edge_legacy", "PIPE-PHX-0001")] });
  await applyBatch(sql, human, "unknown", { changes: [stageChange("unknown", "PIPE-PHX-0002")] });
  await applyBatch(sql, contributor, "blank", { changes: [commsChange("")] });
  await applyBatch(sql, contributor, "listing", { changes: [commsChange("L-441")] });
  const stages = await sql.query<{ site_id: string; service_area_class: string }>(
    "SELECT site_id, service_area_class FROM site_stages ORDER BY site_id",
  );
  assert.deepEqual(
    stages.rows.map((row) => [row.site_id, row.service_area_class]),
    [
      ["PIPE-PHX-0001", "edge_legacy"],
      ["PIPE-PHX-0002", "unknown"],
    ],
  );
  const comms = await sql.query<{ site_id: string }>("SELECT site_id FROM comms_entries ORDER BY site_id");
  assert.deepEqual(
    comms.rows.map((row) => row.site_id),
    ["", "L-441"],
  );
});
