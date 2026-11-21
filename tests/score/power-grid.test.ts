import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POWER_PROTECTED_ROW, columnsToAppend, formulaWriteRequests, rowsToAppend, sheetsFailureText } from "../../lib/score/power-sheet";

const grids = [
  { title: "Pipeline", sheetId: 2000, columnCount: 162, rowCount: 158 },
  { title: "Land Sites", sheetId: 2013, columnCount: 172, rowCount: 162 },
];

test("a header past the grid asks for one new column before any cell write", () => {
  assert.equal(columnsToAppend(163, 162), 1);
  assert.equal(columnsToAppend(162, 162), 0);
  assert.equal(columnsToAppend(173, 172), 1);
  assert.equal(rowsToAppend(158, 158), 0);
  const body = formulaWriteRequests({
    headers: [
      { sheet: "Pipeline", row: 4, column: 163, value: "Power rating (derived)" },
      { sheet: "Land Sites", row: 4, column: 173, value: "Power rating (derived)" },
    ],
    formulas: [
      { sheet: "Pipeline", row: 5, column: 77, formula: "=A5" },
      { sheet: "Pipeline", row: POWER_PROTECTED_ROW, column: 77, formula: "=A10" },
      { sheet: "Land Sites", row: 6, column: 77, formula: "=A6" },
    ],
    grids,
  });
  assert.equal(Array.isArray(body.requests), true);
  const appends = body.requests.filter((request) => "appendDimension" in request);
  assert.deepEqual(
    appends.map((request) => request.appendDimension),
    [
      { sheetId: 2000, dimension: "COLUMNS", length: 1 },
      { sheetId: 2013, dimension: "COLUMNS", length: 1 },
    ],
  );
  const writes = body.requests.filter((request) => "updateCells" in request);
  assert.equal(writes.length, 4);
  assert.equal(appends.length + writes.length, body.requests.length);
  assert.ok(body.requests.indexOf(appends[0]) < body.requests.indexOf(writes[0]));
  const rows = writes.map((request) => (request.updateCells as { start: { rowIndex: number } }).start.rowIndex);
  assert.equal(rows.includes(POWER_PROTECTED_ROW - 1), false);
  const header = writes[0].updateCells as { start: { columnIndex: number }; rows: { values: { userEnteredValue: { stringValue?: string } }[] }[] };
  assert.equal(header.start.columnIndex, 162);
  assert.equal(header.rows[0].values[0].userEnteredValue.stringValue, "Power rating (derived)");
});

test("the Sheets failure keeps the status and message and drops secrets and cell values", () => {
  const body = JSON.stringify({
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: "Range ('Pipeline'!FG4) exceeds grid limits. Max rows: 158, max columns: 162",
    },
    requests: [{ updateCells: { rows: [{ values: [{ userEnteredValue: { stringValue: "Sample wash $9" } }] }] } }],
    private_key: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  });
  const text = sheetsFailureText(400, body);
  assert.match(text, /Sheets write failed \(400 INVALID_ARGUMENT\)/);
  assert.match(text, /Pipeline'!FG4/);
  assert.match(text, /max columns: 162/);
  assert.equal(text.includes("Sample wash"), false);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("BEGIN PRIVATE KEY"), false);
});

test("the formula apply is one batchUpdate and does not chunk a values write", () => {
  const source = readFileSync("scripts/power-sheet-read.ts", "utf8");
  assert.match(source, /spreadsheets\/\$\{SPREADSHEET_ID\}:batchUpdate/);
  assert.equal(source.includes("values:batchUpdate"), false);
  assert.equal(source.includes("start += 400"), false);
});
