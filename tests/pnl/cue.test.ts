import assert from "node:assert/strict";
import test from "node:test";
import { financialsCard, packageOnFile, statementTiles } from "../../lib/pnl/cue.ts";
import { DEMO_PNL_SITE_ID, demoStatement } from "../../lib/pnl/demo.ts";
import { sampleStatement } from "../../lib/pnl/fixture.ts";
import { buildPnlGrid, columnSummary } from "../../lib/pnl/grid.ts";
import { parseAmount } from "../../lib/pnl/money.ts";
import { buildStatement, emptyStatement, type CapturedLine, type MissingMonth } from "../../lib/pnl/statement.ts";

test("a package on file is not the same as a captured P&L", () => {
  assert.equal(packageOnFile("Received", "Package on file"), true);
  assert.equal(packageOnFile("partial", ""), true);
  assert.equal(packageOnFile("Requested", ""), false);
  assert.equal(packageOnFile("Refused or unavailable", ""), false);
  assert.equal(packageOnFile("", ""), false);
  assert.equal(financialsCard(emptyStatement()), null);
});

test("the card uses the latest full year and counts every captured month", () => {
  const card = financialsCard(sampleStatement(), true);
  assert.equal(card?.revenue, "$1,000,000");
  assert.equal(card?.cashLabel, "SDE");
  assert.equal(card?.cash, "$520,000");
  assert.equal(card?.margin, "52.0%");
  assert.equal(card?.coverage, "FY2024 · 2 of 12 months · Sample package");
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  assert.equal(demoStatement(DEMO_PNL_SITE_ID), null);
  process.env.VERCEL_ENV = "preview";
  assert.equal(demoStatement("PIPE-LAS-0001"), null);
  assert.equal(demoStatement(DEMO_PNL_SITE_ID)?.status, "ready");
  if (previous == null) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previous;
});

test("overview tiles use the sample statement period and leave a missing line out of the package", () => {
  const tiles = statementTiles(sampleStatement(), true);
  assert.equal(tiles?.revenue.text, "$1,000,000");
  assert.equal(tiles?.revenue.note, "FY2024 · 2 of 12 months · Sample package");
  assert.equal(tiles?.cash.text, "$520,000");
  assert.equal(tiles?.cash.note, "SDE · FY2024 · 2 of 12 months · Sample package");
  assert.equal(statementTiles(emptyStatement()), null);
  const labor = parseAmount("10000");
  if (!labor) throw new Error("labor amount");
  const costsOnly = statementTiles(buildStatement([{
    id: "PL-1",
    periodId: "PP-1",
    grain: "annual",
    year: 2024,
    month: null,
    throughMonth: null,
    business: "car_wash",
    code: "labor",
    amount: labor,
    status: "reported",
    sourceDocument: "Sample package",
    sourcePage: "1",
    sourceHref: "",
    capturedAt: "2026-03-01T15:00:00-07:00",
  }]), false);
  assert.equal(costsOnly?.revenue.text, "Not in package");
  assert.equal(costsOnly?.cash.text, "Not in package");
  assert.equal(costsOnly?.revenue.note, "");
});

test("the card names the latest period instead of summing older years into the label", () => {
  function line(id: string, year: number, code: "revenue" | "ebitda", raw: string, throughMonth: number | null): CapturedLine {
    const amount = parseAmount(raw);
    if (!amount) throw new Error("amount");
    return {
      id,
      periodId: throughMonth ? `PP-${year}-part` : `PP-${year}`,
      grain: "annual",
      year,
      month: null,
      throughMonth,
      business: "car_wash",
      code,
      amount,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: "1",
      sourceHref: "",
      capturedAt: "2026-03-01T15:00:00-07:00",
    };
  }
  const card = financialsCard(buildStatement([
    line("PL-1", 2024, "revenue", "500000", null),
    line("PL-2", 2024, "ebitda", "400000", null),
    line("PL-3", 2026, "revenue", "200000", 6),
    line("PL-4", 2026, "ebitda", "150000", 6),
  ]));
  assert.equal(card?.cashLabel, "EBITDA");
  assert.equal(card?.cash, "$150,000");
  assert.equal(card?.revenue, "$200,000");
  assert.equal(card?.coverage, "Jan–Jun 2026");
  assert.equal((card?.coverage || "").includes("2024"), false);
});

test("the card matches the sheet total for a partial and leaves a missing month out", () => {
  const captured = "2026-03-01T15:00:00-07:00";
  const lines: CapturedLine[] = [];
  function add(id: string, periodId: string, grain: "annual" | "monthly", month: number | null, throughMonth: number | null, code: "revenue" | "labor", raw: string) {
    const amount = parseAmount(raw);
    if (!amount) throw new Error("amount");
    lines.push({
      id,
      periodId,
      grain,
      year: 2026,
      month,
      throughMonth,
      business: "car_wash",
      code,
      amount,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: "1",
      sourceHref: "",
      capturedAt: captured,
    });
  }
  for (const month of [1, 2, 3, 4, 6, 7]) {
    add(`PL-r-${month}`, `PP-m-${month}`, "monthly", month, null, "revenue", "10000");
    add(`PL-l-${month}`, `PP-m-${month}`, "monthly", month, null, "labor", "2000");
  }
  add("PL-range-r", "PP-range", "annual", null, 7, "revenue", "90000");
  add("PL-range-l", "PP-range", "annual", null, 7, "labor", "30000");
  const missing: MissingMonth[] = [{
    year: 2026,
    month: 5,
    business: "car_wash",
    periodId: "PP-missing",
    sourceDocument: "Sample package",
    sourcePage: "May",
    capturedAt: captured,
  }];
  const statement = buildStatement(lines, missing);
  const card = financialsCard(statement);
  const grid = buildPnlGrid(statement, "months", 2026);
  const summary = columnSummary(grid, 12);
  assert.equal(card?.revenue, summary.revenue);
  assert.equal(card?.cash, summary.ebitda);
  assert.equal(card?.revenue, "$60,000");
  assert.equal(card?.revenue.includes("90,000"), false);
  assert.equal(card?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  const may = grid.rows.find((row) => row.id === "labor")?.cells[4];
  assert.equal(may?.kind, "missing");
  if (may?.kind === "missing") {
    assert.equal(may.sourceDocument, "Sample package");
    assert.equal(may.sourcePage, "May");
  }
  const years = buildPnlGrid(statement, "years");
  const rangeIndex = years.columns.findIndex((column) => column.label === "Jan–Jul 2026");
  assert.equal(columnSummary(years, rangeIndex).revenue, summary.revenue);
});
