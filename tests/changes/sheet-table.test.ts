import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PROTECTED_ROW, PROTECTED_SITE_ID, formatPlan, planSiteMirror, type SheetRender } from "../../lib/changes/mirror";
import { MIRROR_FIELD_HEADERS } from "../../lib/changes/site";
import {
  READ_BACK_BATCH,
  SHEET_READS_PER_SITE_TAB,
  SHEETS_RETRY_MAX_DELAY_MS,
  loadSheetTable,
  loadSheetTablePerColumn,
  readBackCells,
  readBackOutcome,
  readSheetRanges,
  sheetsFetch,
  sheetsRetryDelay,
  type SheetRead,
} from "../../lib/changes/sheetTable";

const SITE_HEADERS = ["site id", ...new Set(MIRROR_FIELD_HEADERS.flatMap((row) => row.headers))];

type Cell = { formatted?: string; unformatted?: string; formula?: string };

function shown(cell: Cell | undefined, kind: SheetRender): string {
  if (!cell) return "";
  if (kind === "formulas") return cell.formula ?? cell.unformatted ?? cell.formatted ?? "";
  if (kind === "unformatted") return cell.unformatted ?? cell.formatted ?? "";
  return cell.formatted ?? cell.unformatted ?? "";
}

function splitRange(range: string): { title: string; a1: string } {
  if (range.startsWith("'")) {
    let title = "";
    for (let i = 1; i < range.length; i += 1) {
      if (range[i] === "'") {
        if (range[i + 1] === "'") {
          title += "'";
          i += 1;
          continue;
        }
        if (range[i + 1] !== "!") throw new Error(`Unparsed range ${range}`);
        return { title, a1: range.slice(i + 2) };
      }
      title += range[i];
    }
  }
  const bang = range.indexOf("!");
  if (bang < 0) throw new Error(`Unparsed range ${range}`);
  return { title: range.slice(0, bang), a1: range.slice(bang + 1) };
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function readGrid(title: string, headerRow: number, headers: string[], body: Map<number, Map<number, Cell>>, range: string, kind: SheetRender): string[][] {
  const parsed = splitRange(range);
  if (parsed.title !== title) throw new Error(`Unexpected sheet ${parsed.title}`);
  const rowOnly = /^(\d+):(\d+)$/.exec(parsed.a1);
  if (rowOnly) {
    assert.equal(Number(rowOnly[1]), headerRow);
    assert.equal(Number(rowOnly[2]), headerRow);
    let last = headers.length - 1;
    while (last >= 0 && !headers[last]) last -= 1;
    const row: string[] = [];
    for (let index = 0; index <= last; index += 1) row.push(headers[index] || "");
    return [row];
  }
  const column = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(parsed.a1);
  if (!column) throw new Error(`Unparsed range ${range}`);
  const index = columnNumber(column[1]) - 1;
  const start = Number(column[2]);
  let lastRow = start - 1;
  for (const [row, cols] of body) {
    if (row >= start && shown(cols.get(index), kind)) lastRow = Math.max(lastRow, row);
  }
  if (lastRow < start) return [];
  const grid: string[][] = [];
  for (let row = start; row <= lastRow; row += 1) {
    const text = shown(body.get(row)?.get(index), kind);
    grid.push(text ? [text] : [""]);
  }
  return grid;
}

test("a tab is one values:batchGet per render option, however many columns it has", async () => {
  assert.ok(SITE_HEADERS.length >= 40, `site columns dropped to ${SITE_HEADERS.length}`);
  const calls: { ranges: string[]; render: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.endsWith("/values:batchGet"), true);
    assert.equal(url.search.includes("test-token"), false);
    const ranges = url.searchParams.getAll("ranges");
    calls.push({ ranges, render: url.searchParams.get("valueRenderOption") });
    const valueRanges = ranges.map((range) => {
      if (!/!\d+:\d+$/.test(range)) return { values: [] };
      if (range.includes("Activity")) return { values: [["Event ID", "When", "Summary", "Ignored"]] };
      if (range.includes("Empty")) return { values: [["Notes", "Score"]] };
      return { values: [SITE_HEADERS] };
    });
    return Response.json({ valueRanges });
  };
  const deps = { fetch: fetchImpl, sleep: async () => undefined, random: () => 0 };
  const read: SheetRead = (ranges, kind) => readSheetRanges("test-token", "spreadsheet", ranges, kind, deps);
  const fieldHeaders = SITE_HEADERS.map((name) => [name]);
  await loadSheetTable(read, "Land Sites", 4, fieldHeaders, true);
  assert.equal(calls.length, SHEET_READS_PER_SITE_TAB);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.render, null);
  assert.deepEqual(calls[0]?.ranges, ["'Land Sites'!4:4"]);
  assert.equal(calls[1]?.render, "UNFORMATTED_VALUE");
  assert.equal(calls[1]?.ranges.length, SITE_HEADERS.length);
  assert.equal(calls[2]?.render, "FORMULA");
  assert.deepEqual(calls[2]?.ranges, calls[1]?.ranges);
  assert.ok(calls[1]?.ranges.some((range) => range === "'Land Sites'!AA5:AA"));

  const activity = calls.length;
  await loadSheetTable(read, "Activity", 1, [["event id"], ["date", "when"], ["summary"]], false);
  assert.equal(calls.length - activity, 2);
  assert.equal(calls[activity]?.render, null);
  assert.equal(calls[activity + 1]?.render, null);
  assert.deepEqual(calls[activity + 1]?.ranges, ["'Activity'!A2:A", "'Activity'!B2:B", "'Activity'!C2:C"]);

  const beforeOld = calls.length;
  await loadSheetTablePerColumn(read, "Pipeline", 4, fieldHeaders, true);
  const oldCalls = calls.length - beforeOld;
  assert.equal(oldCalls, 1 + SITE_HEADERS.length * 2);
  assert.ok(oldCalls > 80);
  assert.ok(oldCalls > SHEET_READS_PER_SITE_TAB);

  const missed = calls.length;
  await loadSheetTable(read, "Empty", 4, [["site id"]], true);
  assert.equal(calls.length - missed, 1);
  assert.deepEqual(calls[missed]?.ranges, ["'Empty'!4:4"]);

  const source = readFileSync("scripts/workbook-mirror.ts", "utf8");
  const readers = [...source.matchAll(/await loadTable\([\s\S]*?\);/g)].map((hit) => hit[0]);
  assert.equal(readers.length, 4);
  assert.deepEqual(
    readers.map((reader) => reader.includes(", true")),
    [false, true, false, false],
  );
});

test("the batched reader matches the per-column reader, including formulas, serial dates, and row 10", async () => {
  assert.equal(PROTECTED_ROW, 10);
  const title = "Pipeline";
  const headerRow = 4;
  const headers = ["Notes", "Site ID", "Stage", "Asking price ($)", "Next step", "Photos checked", "Broker", "Land (acres)"];
  const body = new Map<number, Map<number, Cell>>();
  const put = (row: number, column: number, cell: Cell) => {
    const cols = body.get(row) || new Map<number, Cell>();
    cols.set(column, cell);
    body.set(row, cols);
  };
  const text = (value: string): Cell => ({ formatted: value, unformatted: value });
  put(5, 0, text("LEAK-NOTES-CELL"));
  put(5, 1, text("PIPE-PHX-0001"));
  put(5, 2, text("LEAK-STAGE"));
  put(5, 3, { formatted: "$1,600,000", unformatted: "1600000" });
  put(5, 4, text("Confirm the zoning."));
  put(5, 5, { formatted: "10/21/2026", unformatted: "46316" });
  put(5, 6, text("Ada"));
  put(5, 7, { formatted: "1.20", unformatted: "1.2" });
  put(6, 1, text("PIPE-PHX-0002"));
  put(6, 4, { formatted: "24", unformatted: "24", formula: "=A1" });
  put(6, 6, text("Bo"));
  put(8, 1, text("PIPE-PHX-0003"));
  put(8, 6, text("Cy"));
  put(10, 1, text("PIPE-PHX-0004"));
  put(10, 4, text("Row ten stays"));
  put(10, 6, text("Dee"));
  put(11, 1, text(PROTECTED_SITE_ID));
  put(11, 4, text("Quarantine note"));

  const fieldHeaders = [["site id"], ["asking price ($)"], ["next step"], ["photos checked"], ["broker"], ["land (acres)"]];
  const records = [
    {
      site_id: "PIPE-PHX-0001",
      writes: {
        "Asking price ($)": "1700000",
        "Next step": "Confirm the zoning.",
        "Photos checked": "2026-10-21",
        Broker: "Ada",
        "Land (acres)": "1.20",
      },
    },
    {
      site_id: "PIPE-PHX-0002",
      writes: { "Next step": "Overwrite the formula", Broker: "Jane Doe (Acme Realty) — jane@acme.example" },
    },
    { site_id: "PIPE-PHX-0003", writes: { Broker: "Cy" } },
    { site_id: "PIPE-PHX-0004", writes: { "Next step": "Do not write row ten" } },
    { site_id: PROTECTED_SITE_ID, writes: { "Next step": "Do not write the quarantine" } },
  ];

  const serve = (calls: { ranges: string[]; kind: SheetRender }[]): SheetRead => async (ranges, kind) => {
    calls.push({ ranges: [...ranges], kind });
    return ranges.map((range) => readGrid(title, headerRow, headers, body, range, kind));
  };
  const oldCalls: { ranges: string[]; kind: SheetRender }[] = [];
  const newCalls: { ranges: string[]; kind: SheetRender }[] = [];
  const oldTable = await loadSheetTablePerColumn(serve(oldCalls), title, headerRow, fieldHeaders, true);
  const table = await loadSheetTable(serve(newCalls), title, headerRow, fieldHeaders, true);
  assert.deepEqual(table, oldTable);
  assert.equal(newCalls.length, 3);
  assert.equal(oldCalls.length, 1 + fieldHeaders.length * 2);
  assert.deepEqual(newCalls.map((call) => call.kind), ["formatted", "unformatted", "formulas"]);
  assert.equal(newCalls[1]?.ranges.length, fieldHeaders.length);
  assert.ok(oldCalls.filter((call) => call.kind === "unformatted").every((call) => call.ranges.length === 1));

  const dumped = JSON.stringify(table);
  assert.equal(dumped.includes("LEAK-NOTES-CELL"), false);
  assert.equal(dumped.includes("LEAK-STAGE"), false);
  assert.equal(dumped.includes("$1,600,000"), false);
  const first = table.rows.find((row) => row.cells[1] === "PIPE-PHX-0001");
  const formulaRow = table.rows.find((row) => row.cells[1] === "PIPE-PHX-0002");
  assert.equal(first?.cells[3], "1600000");
  assert.equal(first?.cells[5], "46316");
  assert.equal(first?.cells[0], undefined);
  assert.equal(first?.cells[2], undefined);
  assert.equal(formulaRow?.formulas?.[4], "=A1");
  assert.equal(table.rows.some((row) => row.row === PROTECTED_ROW && row.cells[1] === "PIPE-PHX-0004"), true);

  const oldPlan = planSiteMirror([oldTable], records);
  const plan = planSiteMirror([table], records);
  assert.deepEqual(plan, oldPlan);
  assert.equal(plan.changes.length, 2);
  assert.equal(plan.changes[0]?.header, "Asking price ($)");
  assert.equal(plan.changes[0]?.column, 4);
  assert.equal(plan.changes[0]?.row, 5);
  assert.equal(plan.changes[0]?.before, "1600000");
  assert.equal(plan.changes[0]?.after, "1700000");
  assert.equal(plan.changes[0]?.valueInput, "USER_ENTERED");
  assert.equal(plan.changes[1]?.header, "Broker");
  assert.equal(plan.changes[1]?.column, 7);
  assert.equal(plan.changes[1]?.before, "Bo");
  assert.equal(plan.changes.some((change) => change.header === "Next step" && change.id === "PIPE-PHX-0002"), false);
  assert.equal(plan.changes.some((change) => change.header === "Photos checked"), false);
  assert.equal(plan.changes.some((change) => change.row === PROTECTED_ROW || change.id === PROTECTED_SITE_ID), false);
  assert.equal(plan.unmatched.includes("PIPE-PHX-0004"), false);
  assert.equal(plan.unmatched.includes(PROTECTED_SITE_ID), false);
  assert.ok(plan.skippedProtected >= 2);
  const printed = formatPlan(plan.changes);
  assert.equal(printed.includes("jane@acme.example"), false);
  assert.equal(printed.includes("1700000"), false);
  assert.equal(printed.includes("1600000"), false);
  assert.equal(printed.includes("Row ten stays"), false);
  assert.match(printed, /Asking price \(\$\).*#[0-9a-f]{12} -> #[0-9a-f]{12}/);
  assert.match(printed, /Broker.*#[0-9a-f]{12} -> #[0-9a-f]{12}/);

  const activityHeaders = ["Event ID", "Date", "Summary"];
  const activityBody = new Map<number, Map<number, Cell>>([
    [2, new Map<number, Cell>([
      [0, text("A-000001")],
      [1, { formatted: "10/21/2026", unformatted: "46316" }],
      [2, text("Listing noted")],
    ])],
  ]);
  const activityCalls: { kind: SheetRender }[] = [];
  const activityRead: SheetRead = async (ranges, kind) => {
    activityCalls.push({ kind });
    return ranges.map((range) => readGrid("Activity", 1, activityHeaders, activityBody, range, kind));
  };
  const activityFields = [["event id"], ["date", "when"], ["summary"]];
  const activityOld = await loadSheetTablePerColumn(activityRead, "Activity", 1, activityFields, false);
  const activity = await loadSheetTable(activityRead, "Activity", 1, activityFields, false);
  assert.deepEqual(activity, activityOld);
  assert.equal(activity.rows[0]?.cells[1], "10/21/2026");
  assert.deepEqual(activity.rows[0]?.formulas, []);
  assert.equal(activityCalls.length, 6);
  assert.ok(activityCalls.every((call) => call.kind === "formatted"));

  const oddCalls: { ranges: string[] }[] = [];
  const oddBody = new Map<number, Map<number, Cell>>([[2, new Map<number, Cell>([[0, text("PIPE-PHX-0009")]])]]);
  const oddRead: SheetRead = async (ranges, kind) => {
    oddCalls.push({ ranges: [...ranges] });
    return ranges.map((range) => readGrid("O'Brien", 1, ["Site ID"], oddBody, range, kind));
  };
  const oddFields = [["site id"]];
  const oddOld = await loadSheetTablePerColumn(oddRead, "O'Brien", 1, oddFields, true);
  const odd = await loadSheetTable(oddRead, "O'Brien", 1, oddFields, true);
  assert.deepEqual(odd, oddOld);
  assert.equal(odd.rows[0]?.cells[0], "PIPE-PHX-0009");
  assert.ok(oddCalls.some((call) => call.ranges.some((range) => range.includes("'O''Brien'!"))));
});

test("Sheets 429 and 5xx retry with bounded jitter", async () => {
  const base = 1000;
  const cap = SHEETS_RETRY_MAX_DELAY_MS;
  assert.equal(sheetsRetryDelay(1, 0, base, cap), 500);
  assert.equal(sheetsRetryDelay(2, 0, base, cap), 1000);
  assert.equal(sheetsRetryDelay(3, 0.5, base, cap), 3000);
  assert.notEqual(sheetsRetryDelay(1, 0, base, cap), sheetsRetryDelay(1, 0.9, base, cap));
  assert.equal(sheetsRetryDelay(10, 1, base, cap), cap);
  assert.ok(sheetsRetryDelay(10, 0.99, base, cap) <= cap);
  assert.equal(sheetsRetryDelay(1, 0, base, cap, 30_000), cap);
  assert.equal(sheetsRetryDelay(1, 0, base, cap, 800), 800);

  const sleeps: number[] = [];
  let hits = 0;
  const statuses = [429, 503, 200];
  const response = await sheetsFetch("https://sheets.googleapis.com/v4/spreadsheets/abc/values:batchGet?ranges=A1", {}, {
    fetch: async () => {
      hits += 1;
      const status = statuses[hits - 1] ?? 200;
      return new Response(status === 200 ? "{}" : "jane@acme.example", {
        status,
        headers: status === 429 ? { "Retry-After": "0" } : {},
      });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    maxAttempts: 5,
    baseMs: base,
    maxDelayMs: cap,
  });
  assert.equal(response.status, 200);
  assert.equal(hits, 3);
  assert.deepEqual(sleeps, [500, 1000]);

  const giveups: number[] = [];
  let errors = 0;
  const failed = await sheetsFetch("https://sheets.googleapis.com/v4/spreadsheets/abc/values:batchGet", {}, {
    fetch: async () => {
      errors += 1;
      return new Response("jane@acme.example secret-note", { status: errors === 2 ? 500 : 429 });
    },
    sleep: async (ms) => {
      giveups.push(ms);
    },
    random: () => 0.25,
    maxAttempts: 3,
    baseMs: 100,
    maxDelayMs: 150,
  });
  assert.equal(failed.status, 429);
  assert.equal(errors, 3);
  assert.deepEqual(giveups, [62, 93]);
  assert.ok(giveups.every((ms) => ms <= 150));

  let server = 0;
  const recovered = await sheetsFetch("https://sheets.googleapis.com/v4/spreadsheets/abc/values:batchGet", {}, {
    fetch: async () => new Response("{}", { status: ++server === 1 ? 501 : 200 }),
    sleep: async () => undefined,
    random: () => 0,
    maxAttempts: 2,
    baseMs: 8,
    maxDelayMs: 8,
  });
  assert.equal(recovered.status, 200);
  assert.equal(server, 2);

  await assert.rejects(
    () => readSheetRanges("token", "abc", ["'Pipeline'!A5:A"], "unformatted", {
      fetch: async () => new Response("jane@acme.example", { status: 429 }),
      sleep: async () => undefined,
      random: () => 0,
      maxAttempts: 2,
      baseMs: 10,
      maxDelayMs: 10,
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.equal(message, "Sheets read failed (429) for a workbook range.");
      assert.equal(message.includes("jane@"), false);
      return true;
    },
  );

  let clientErrors = 0;
  const denied = await sheetsFetch("https://sheets.googleapis.com/v4/example", {}, {
    fetch: async () => {
      clientErrors += 1;
      return new Response("no", { status: 403 });
    },
    sleep: async () => {
      throw new Error("slept");
    },
    maxAttempts: 4,
  });
  assert.equal(denied.status, 403);
  assert.equal(clientErrors, 1);

  const fine = await sheetsFetch("https://sheets.googleapis.com/v4/example", {}, {
    fetch: async () => new Response("{}", { status: 200 }),
    sleep: async () => {
      throw new Error("slept");
    },
  });
  assert.equal(fine.status, 200);

  const [grid] = await readSheetRanges("token", "sheet", ["'Pipeline'!A5:A"], "unformatted", {
    fetch: async () => Response.json({ valueRanges: [{ values: [[46316], [1600000], [0], [null]] }] }),
    sleep: async () => undefined,
    random: () => 0,
  });
  assert.deepEqual(grid, [["46316"], ["1600000"], ["0"], [""]]);
});

test("read-back uses one values:batchGet and retries a 429", async () => {
  const cells = [
    { sheet: "Pipeline", row: 5, column: 4 },
    { sheet: "Pipeline", row: 6, column: 4 },
    { sheet: "O'Brien", row: 3, column: 1 },
  ];
  const calls: string[] = [];
  const sleeps: number[] = [];
  let hits = 0;
  const values = await readBackCells("token", "sheet-id", cells, {
    fetch: async (url) => {
      const href = String(url);
      calls.push(href);
      hits += 1;
      if (hits === 1) return new Response("limited", { status: 429, headers: { "Retry-After": "0" } });
      const parsed = new URL(href);
      assert.equal(parsed.pathname.endsWith("/values:batchGet"), true);
      const ranges = parsed.searchParams.getAll("ranges");
      assert.equal(ranges.length, 3);
      assert.equal(ranges.some((range) => range.includes("'O''Brien'!A3")), true);
      return Response.json({
        valueRanges: [
          { values: [["2 Financial screen"]] },
          { values: [["Sample"]] },
          { values: [[""]] },
        ],
      });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    maxAttempts: 4,
    baseMs: 1000,
    maxDelayMs: 16_000,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [500]);
  assert.equal(calls.every((url) => url.includes("values:batchGet")), true);
  assert.equal(values[0]?.value, "2 Financial screen");
  assert.equal(values[1]?.value, "Sample");
  assert.equal(values[2]?.value, "");

  const many = Array.from({ length: READ_BACK_BATCH + 1 }, (_, index) => ({ sheet: "Pipeline", row: index + 2, column: 1 }));
  let batches = 0;
  const wide = await readBackCells("token", "sheet-id", many, {
    fetch: async (url) => {
      batches += 1;
      const count = new URL(String(url)).searchParams.getAll("ranges").length;
      return Response.json({ valueRanges: Array.from({ length: count }, () => ({ values: [["ok"]] })) });
    },
    sleep: async () => {
      throw new Error("slept");
    },
  });
  assert.equal(batches, 2);
  assert.equal(wide.length, READ_BACK_BATCH + 1);
  assert.equal(wide.every((cell) => cell.value === "ok"), true);

  await assert.rejects(
    () => readBackCells("token", "sheet-id", cells, {
      fetch: async () => new Response("limited", { status: 429 }),
      sleep: async () => undefined,
      random: () => 0,
      maxAttempts: 2,
      baseMs: 10,
      maxDelayMs: 10,
    }),
    (error: unknown) => {
      const outcome = readBackOutcome(error);
      assert.equal(outcome.status, "succeeded");
      assert.equal(outcome.rethrow, false);
      assert.equal(outcome.note, "wrote cells; read-back rate limited");
      const message = error instanceof Error ? error.message : "";
      assert.equal(message.includes("limited"), false);
      return true;
    },
  );
  const mismatch = readBackOutcome(new Error("Read-back mismatch at Pipeline!D5 for PIPE-PHX-0108."));
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.rethrow, true);

  const source = readFileSync("scripts/workbook-mirror.ts", "utf8");
  const readBackAt = source.indexOf("function readBack");
  const readBackBody = source.slice(readBackAt, source.indexOf("async function main"));
  assert.match(readBackBody, /readBackCells\(/);
  assert.doesNotMatch(readBackBody, /for \(const change of changes\)/);
  assert.match(source, /readBackOutcome\(/);
  assert.match(source, /finish\("failed", "write failed"\)/);
});
