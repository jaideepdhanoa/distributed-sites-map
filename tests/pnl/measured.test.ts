import assert from "node:assert/strict";
import test from "node:test";
import { monthColumnState } from "../../lib/pnl/columns";
import { financialsCard } from "../../lib/pnl/cue";
import { measuredStatement } from "../../lib/pnl/fixture";
import { buildPnlGrid, columnSummary } from "../../lib/pnl/grid";
import { windowCoverage } from "../../lib/pnl/window";

test("the measured statement shape names the missing month on the card and both sheets", () => {
  const statement = measuredStatement();
  const year2026 = statement.years.find((year) => year.year === 2026);
  const year2025 = statement.years.find((year) => year.year === 2025);
  assert.equal(year2026?.annual, null);
  assert.equal(year2026?.ranges.length, 1);
  assert.equal(year2026?.ranges[0]?.id, "PP-S-RANGE");
  assert.equal(year2026?.ranges[0]?.columnLabel, "Jan–Jul 2026");
  assert.deepEqual(year2026?.months.map((period) => period?.month ?? null), [1, 2, 3, 4, null, 6, 7, null, null, null, null, null]);
  assert.deepEqual(year2026?.missingMonths, [5]);
  assert.equal(year2026?.missingDetails[0]?.sourcePage, "Month index");
  assert.equal(year2026?.missingDetails[0]?.sourceDocument.length, 47);
  assert.equal(year2026?.coverage, "On file: January, February, March, April, June, July. Missing: May.");
  assert.equal(year2025?.annual?.id, "PP-S-2025");
  assert.deepEqual(year2025?.ranges, []);
  assert.deepEqual(year2025?.missingMonths, [4]);
  assert.equal(year2025?.missingDetails[0]?.sourcePage, "Month index");

  const carried = JSON.parse(JSON.stringify(statement)) as typeof statement;
  const card = financialsCard(carried);
  assert.equal(card?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  assert.equal(card?.revenue, "$60,000");
  assert.equal(card?.cash, "$48,000");
  assert.equal(card?.revenue.includes("90,000"), false);
  assert.equal(card?.revenue.includes("80,000"), false);

  const grid2026 = buildPnlGrid(carried, "months", 2026);
  const may = grid2026.rows.find((row) => row.id === "total-revenue")?.cells[4];
  assert.equal(grid2026.columns[4]?.missing, true);
  assert.equal(may?.kind, "missing");
  if (may?.kind === "missing") {
    assert.equal(may.sourcePage, "Month index");
    assert.equal(may.sourceDocument.length, 47);
  }
  assert.equal(columnSummary(grid2026, 4).revenue, "Missing");
  assert.equal(grid2026.rows.find((row) => row.id === "labor")?.cells[7]?.kind, "blank");

  const grid2025 = buildPnlGrid(carried, "months", 2025);
  const april = grid2025.rows.find((row) => row.id === "total-revenue")?.cells[3];
  assert.equal(grid2025.columns[3]?.missing, true);
  assert.equal(april?.kind, "missing");
  if (april?.kind === "missing") assert.equal(april.sourcePage, "Month index");
  assert.equal(columnSummary(grid2025, 3).revenue, "Missing");
  assert.equal(grid2025.rows.find((row) => row.id === "total-revenue")?.cells[0]?.kind, "blank");

  const detailsOnly = structuredClone(year2026);
  if (!detailsOnly) return;
  detailsOnly.missingMonths = [];
  assert.equal(monthColumnState(detailsOnly, 4), "missing");
  assert.equal(windowCoverage(detailsOnly), "Jan–Jul 2026 · 6 of 7 months (May missing)");

  const coverageOnly = structuredClone(year2026);
  if (!coverageOnly) return;
  coverageOnly.missingDetails = [];
  coverageOnly.coverage = "";
  (coverageOnly as { missingMonths: unknown }).missingMonths = ["2026-05"];
  assert.equal(monthColumnState(coverageOnly, 4), "missing");
  coverageOnly.missingMonths = [];
  coverageOnly.coverage = "On file: January, February, March, April, June, July. Missing: May.";
  const coverageStatement = {
    ...carried,
    years: carried.years.map((item) => item.year === 2026 ? coverageOnly : { ...item, missingMonths: [], missingDetails: [], coverage: "Missing: April." }),
  };
  assert.equal(financialsCard(coverageStatement)?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  const fromCoverage = buildPnlGrid(coverageStatement, "months", 2026);
  assert.equal(fromCoverage.rows.find((row) => row.id === "total-revenue")?.cells[4]?.kind, "missing");
  assert.equal(columnSummary(fromCoverage, 4).revenue, "Missing");
  const aprilFromCoverage = buildPnlGrid(coverageStatement, "months", 2025);
  assert.equal(aprilFromCoverage.rows.find((row) => row.id === "labor")?.cells[3]?.kind, "missing");
  assert.equal(columnSummary(aprilFromCoverage, 3).revenue, "Missing");
});
