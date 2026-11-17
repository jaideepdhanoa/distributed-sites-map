import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mirrorGridNeedsGrowth,
  mirrorGridRequests,
  planMirrorTabs,
  planUniverseMirror,
  writeMirrorTabs,
  type CellChange,
  type MirrorPlan,
  type SheetTable,
} from "../../lib/changes/mirror";

function sheet(headers: string[], body: string[][]): SheetTable {
  return {
    title: "Universe",
    headerRow: 1,
    headers: [...headers],
    rows: body.map((cells, index) => ({ row: index + 2, cells: [...cells] })),
  };
}

function blankPlan(changes: CellChange[] = []): MirrorPlan {
  return { changes, skippedProtected: 0, unmatched: [], appended: 0, refused: [], held: [] };
}

const legacyHeaders = ["Market", "Archetype", "Business name", "Address", "Counted in funnel"];

test("a Universe tab without an id column adds the header, backfills one match, and appends the rest", () => {
  const table = sheet(legacyHeaders, [
    ["PHX", "Wash", "Alpha Wash", "1 Main St", "Yes"],
    ["PHX", "Wash", "Alpha Wash", "1 Main St", "Yes"],
    ["LAS", "Wash", "Beta Wash", "2 Side St", "Yes"],
  ]);
  const plan = planUniverseMirror(table, [
    { universe_id: "WB-PHX-0106", values: { name: "Alpha Wash", address: "1 Main St", market: "PHX", counted: "Yes" } },
    { universe_id: "WB-LAS-0107", values: { name: "Beta Wash", address: "2 Side St", market: "LAS", counted: "No" } },
    { universe_id: "WB-MIA-0108", values: { name: "Gamma Wash", address: "9 New St", market: "MIA", counted: "Yes" } },
  ]);

  const header = plan.changes.find((change) => change.row === 1);
  assert.equal(header?.after, "Universe ID");
  assert.equal(header?.column, legacyHeaders.length + 1);
  assert.equal(header?.before, "");

  const legacy = plan.changes.filter((change) => change.row === 2 || change.row === 3 || change.row === 4);
  assert.deepEqual(
    legacy.map((change) => ({ row: change.row, header: change.header, after: change.after })),
    [{ row: 4, header: "Universe ID", after: "WB-LAS-0107" }],
  );
  assert.equal(plan.changes.some((change) => change.after === "WB-PHX-0106"), false);
  assert.equal(plan.unmatched.includes("WB-PHX-0106"), true);
  assert.equal(plan.appended, 1);

  const appended = plan.changes.filter((change) => change.row === 5);
  assert.equal(appended.some((change) => change.header === "Universe ID" && change.after === "WB-MIA-0108"), true);
  assert.equal(appended.some((change) => change.header === "Business name" && change.after === "Gamma Wash"), true);
  assert.equal(appended.some((change) => change.header === "Archetype"), false);
  assert.equal(plan.changes.some((change) => change.row < 5 && change.header === "Business name"), false);
  assert.equal(plan.changes.some((change) => change.row < 5 && change.header === "Address"), false);

  const grid = { sheetId: 15529668, columnCount: legacyHeaders.length, rowCount: 4 };
  assert.equal(mirrorGridNeedsGrowth(plan.changes, grid), true);
  const body = mirrorGridRequests(plan.changes, grid);
  const appends = body.requests.filter((request) => "appendDimension" in request);
  assert.deepEqual(
    appends.map((request) => request.appendDimension),
    [
      { sheetId: 15529668, dimension: "COLUMNS", length: 1 },
      { sheetId: 15529668, dimension: "ROWS", length: 1 },
    ],
  );
  const writes = body.requests.filter((request) => "updateCells" in request);
  assert.equal(appends.length + writes.length, body.requests.length);
  assert.ok(body.requests.indexOf(appends[0]) < body.requests.indexOf(writes[0]));
  const headerWrite = writes.find((request) => {
    const start = (request.updateCells as { start: { rowIndex: number } }).start;
    return start.rowIndex === 0;
  });
  const entered = headerWrite?.updateCells as { rows: { values: { userEnteredValue: { stringValue?: string; formulaValue?: string } }[] }[] };
  assert.equal(entered.rows[0].values[0].userEnteredValue.stringValue, "Universe ID");
  assert.equal(entered.rows[0].values[0].userEnteredValue.formulaValue, undefined);
});

test("an existing Universe id is not a reason to rewrite the legacy name", () => {
  const table = sheet(["Universe ID", "Business name", "Market", "Address"], [
    ["WB-PHX-0106", "Legacy Wash", "PHX", "1 Main St"],
  ]);
  const plan = planUniverseMirror(table, [
    { universe_id: "WB-PHX-0106", values: { name: "Other Wash", address: "1 Main St", market: "PHX", counted: "Yes" } },
    { universe_id: "WB-PHX-0107", values: { name: "Fresh Wash", address: "4 New St", market: "PHX", counted: "Yes" } },
  ]);
  assert.equal(plan.changes.some((change) => change.after === "Other Wash"), false);
  assert.equal(plan.changes.some((change) => change.row === 2), false);
  assert.equal(plan.appended, 1);
  assert.equal(plan.changes.some((change) => change.after === "WB-PHX-0107"), true);
});

test("a Universe failure still writes Comms, and the log drops secrets", async () => {
  const writes: string[] = [];
  const comms: CellChange = {
    sheet: "Comms Log",
    row: 2,
    column: 1,
    header: "Comms ID",
    id: "CM-0001",
    before: "",
    after: "CM-0001",
  };
  const planned = await planMirrorTabs([
    {
      tab: "Universe",
      run: async () => {
        throw new Error("Universe is missing an id column (universe id, site id, lead id). ya29.SECRET person@example.com");
      },
    },
    { tab: "Comms Log", run: async () => blankPlan([comms]) },
  ]);
  assert.equal(planned.failed.length, 1);
  assert.equal(planned.failed[0]?.tab, "Universe");
  assert.match(planned.failed[0]?.message || "", /missing an id column/);
  assert.equal(planned.failed[0]?.message.includes("SECRET"), false);
  assert.equal(planned.failed[0]?.message.includes("person@example.com"), false);
  assert.equal(planned.failed[0]?.message.includes("[redacted-token]"), true);
  const first = await writeMirrorTabs(planned.planned, async (tab) => {
    writes.push(tab);
  });
  assert.deepEqual(writes, ["Comms Log"]);
  assert.equal(first.failed.length, 0);
  assert.equal(first.written.length, 1);

  writes.length = 0;
  const universe: CellChange = { ...comms, sheet: "Universe", id: "WB-PHX-0106", after: "WB-PHX-0106" };
  const second = await writeMirrorTabs(
    [
      { tab: "Universe", plan: blankPlan([universe]) },
      { tab: "Comms Log", plan: blankPlan([comms]) },
    ],
    async (tab) => {
      if (tab === "Universe") throw new Error('Sheets write failed (400). "private_key":"secret-key"');
      writes.push(tab);
    },
  );
  assert.deepEqual(writes, ["Comms Log"]);
  assert.equal(second.failed.length, 1);
  assert.equal(second.failed[0]?.tab, "Universe");
  assert.equal(second.failed[0]?.message.includes("secret-key"), false);
  assert.equal(second.written.length, 1);
  assert.equal(second.written[0]?.sheet, "Comms Log");
});

test("the mirror script plans and writes each tab, and grows the Universe grid in one batch", () => {
  const source = readFileSync("scripts/workbook-mirror.ts", "utf8");
  const mirror = readFileSync("lib/changes/mirror.ts", "utf8");
  assert.match(source, /planMirrorTabs\(/);
  assert.match(source, /writeMirrorTabs\(/);
  assert.match(source, /writeFormulaBatch\(/);
  const planAt = source.indexOf("await planMirrorTabs(");
  const watchAt = source.indexOf("watchMirrorCancel(");
  const writeAt = source.indexOf("await writeMirrorTabs(");
  assert.ok(planAt > 0 && watchAt > planAt && writeAt > watchAt);
  assert.match(mirror, /appendDimension: \{ sheetId: grid\.sheetId, dimension: "COLUMNS", length: extraColumns \}/);
  const requests = mirror.slice(mirror.indexOf("export function mirrorGridRequests"));
  assert.ok(requests.indexOf("appendDimension") < requests.indexOf("updateCells"));
});
