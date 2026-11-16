import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import { detectWorkbookDrift } from "../../lib/changes/drift";
import { PROTECTED_SITE_ID, formatMirrorDrift, mirrorDrift, planActivityMirror, type CellChange, type SheetTable } from "../../lib/changes/mirror";
import {
  PROTECT_BANNER,
  PROTECT_CONFIRM,
  formatProtectionPlan,
  planSheetProtection,
  protectionMode,
  protectionRequests,
} from "../../lib/changes/protect";
import { shortHash } from "../../lib/changes/site";
import { memorySql } from "../helpers/sql";

const SENTINEL = "SENTINEL-BROKER-NOTE-not-a-cell";

function activityTable(): SheetTable {
  return {
    title: "Activity",
    headerRow: 1,
    headers: ["Event ID", "Date", "Site ID", "Type", "Summary"],
    rows: [{ row: 2, cells: ["A-000010", "2026-11-06", "PIPE-PHX-0001", "visit", "Sheet text"] }],
  };
}

test("the sync script reports drift and does not apply workbook rows", () => {
  const source = readFileSync("scripts/import-shadow.ts", "utf8");
  assert.equal(source.includes("importChanged"), false);
  assert.equal(source.includes("applyParsedChanges"), false);
  assert.match(source, /detectWorkbookDrift/);
  assert.match(source, /rememberSheetIdFloors/);
  assert.doesNotMatch(source, /WORKBOOK_IMPORT_APPLY/);
});

test("drift counts a workbook edit and does not write it or echo the text", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const base = {
    stages: [{ site_id: "PIPE-PHX-0001", stage: "1 Desk screen", market: "PHX", service_area_class: "inside", reason: "" }],
    activities: [{ entity_id: "A-000010", site_id: "PIPE-PHX-0001", date: "2026-11-06", type: "visit", summary: "Listed", source_link: "" }],
    comms: [],
  };
  await importChanged(sql, base, "snap-base");
  const edited = {
    ...base,
    stages: [{ ...base.stages[0], stage: "2 Financial screen", reason: SENTINEL }],
    activities: [{ ...base.activities[0], summary: SENTINEL, site_id: PROTECTED_SITE_ID }],
  };
  const saved = {
    read: process.env.READ_STAGES_FROM_DB,
    api: process.env.CHANGES_API_ENABLED,
  };
  process.env.READ_STAGES_FROM_DB = "1";
  process.env.CHANGES_API_ENABLED = "1";
  try {
    const drift = await detectWorkbookDrift(sql, edited);
    assert.match(drift.text, /stage changed [1-9]/);
    assert.match(drift.text, new RegExp(`#${shortHash("PIPE-PHX-0001")}`));
    assert.equal(drift.text.includes(SENTINEL), false);
    assert.equal(drift.text.includes("PIPE-PHX-0001"), false);
    assert.equal(drift.text.includes(PROTECTED_SITE_ID), false);
    assert.match(drift.text, /skipped_protected [1-9]/);
    assert.match(drift.text, /were not written/);
    const stored = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = 'PIPE-PHX-0001'");
    assert.equal(stored.rows[0]?.stage, "1 Desk screen");
  } finally {
    if (saved.read === undefined) delete process.env.READ_STAGES_FROM_DB;
    else process.env.READ_STAGES_FROM_DB = saved.read;
    if (saved.api === undefined) delete process.env.CHANGES_API_ENABLED;
    else process.env.CHANGES_API_ENABLED = saved.api;
  }
});

test("mirror drift hashes ids and overwrites a filled cell", () => {
  const plan = planActivityMirror(activityTable(), [
    { entity_id: "A-000010", site_id: "PIPE-PHX-0001", date: "2026-11-06", type: "visit", summary: SENTINEL, source_link: "", imported: true },
  ]);
  const summary = plan.changes.find((change) => change.header === "Summary");
  assert.equal(summary?.before, "Sheet text");
  assert.equal(summary?.after, SENTINEL);
  const drift = formatMirrorDrift(mirrorDrift(plan.changes));
  assert.match(drift, /drift_cells [1-9]/);
  assert.match(drift, new RegExp(`#${shortHash("A-000010")}`));
  assert.equal(drift.includes(SENTINEL), false);
  assert.equal(drift.includes("Sheet text"), false);
  assert.equal(drift.includes("A-000010"), false);
  const hidden: CellChange = { sheet: "Pipeline", row: 10, column: 2, header: "Stage", id: PROTECTED_SITE_ID, before: "Dropped", after: "1 Desk screen" };
  const quiet = formatMirrorDrift(mirrorDrift([hidden]));
  assert.equal(quiet.includes(PROTECTED_SITE_ID), false);
  assert.match(quiet, /drift_cells 0/);
});

test("protection stays a dry run until apply, dry-run off, and the confirm phrase", () => {
  assert.equal(protectionMode({ apply: undefined, dry: undefined, confirm: "" }), "dry-run");
  assert.equal(protectionMode({ apply: "1", dry: "1", confirm: PROTECT_CONFIRM }), "dry-run");
  assert.equal(protectionMode({ apply: "1", dry: "0", confirm: "nope" }), "refuse");
  assert.equal(protectionMode({ apply: "1", dry: "0", confirm: PROTECT_CONFIRM }), "apply");

  const plan = planSheetProtection([
    { sheetId: 1, title: "Pipeline", wholeSheet: false },
    { sheetId: 2, title: "Rules & Decisions", wholeSheet: false },
    { sheetId: 3, title: "Run Log", wholeSheet: false },
    { sheetId: 4, title: "Activity", wholeSheet: true },
  ]);
  assert.deepEqual(plan.protect.map((sheet) => sheet.title), ["Pipeline"]);
  assert.deepEqual(plan.writable, ["Rules & Decisions", "Run Log"]);
  assert.deepEqual(plan.already, ["Activity"]);
  assert.deepEqual(plan.missingWritable, []);
  const text = formatProtectionPlan(plan, "dry-run");
  assert.match(text, /Nothing was written/);
  assert.match(text, /Rules & Decisions, Run Log/);
  assert.equal(text.includes(SENTINEL), false);

  const missing = planSheetProtection([{ sheetId: 1, title: "Pipeline", wholeSheet: false }]);
  assert.deepEqual(missing.missingWritable, ["Rules & Decisions", "Run Log"]);

  const requests = protectionRequests(plan, "mirror@example.com");
  const body = JSON.stringify(requests);
  assert.equal(body.includes("userEnteredValue"), false);
  assert.match(body, /"fields":"note"/);
  assert.match(body, new RegExp(PROTECT_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const ranges = requests.filter((request) => "addProtectedRange" in (request as object));
  assert.equal(ranges.length, 1);
  assert.equal(body.includes("Rules & Decisions"), false);
  assert.equal(body.includes("Run Log"), false);
});
