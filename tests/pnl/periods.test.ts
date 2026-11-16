import assert from "node:assert/strict";
import test from "node:test";
import { monthColumnState, yearColumns } from "../../lib/pnl/columns.ts";
import { parseAmount } from "../../lib/pnl/money.ts";
import { coverageOf, periodLabels } from "../../lib/pnl/period.ts";
import { buildStatement, type CapturedLine, type PnlYearView } from "../../lib/pnl/statement.ts";

function money(raw: string) {
  const parsed = parseAmount(raw);
  if (!parsed) throw new Error("bad amount");
  return parsed;
}

function annual(partial: Partial<CapturedLine> & Pick<CapturedLine, "id" | "periodId" | "year">): CapturedLine {
  return {
    grain: "annual",
    month: null,
    throughMonth: null,
    business: "car_wash",
    code: "revenue",
    amount: money("100000"),
    status: "reported",
    sourceDocument: "Sample package",
    sourcePage: "Sheet",
    sourceHref: "",
    capturedAt: "2026-03-01T15:00:00-07:00",
    ...partial,
  };
}

test("a fiscal year is twelve months from the start month and labels FY by its last day", () => {
  const coverage = coverageOf({ grain: "annual", year: 2025, startMonth: 10 });
  assert.equal(coverage.periodStart, "2025-10-01");
  assert.equal(coverage.periodEnd, "2026-09-30");
  const labels = periodLabels({ grain: "annual", year: 2025, ...coverage });
  assert.equal(labels.columnLabel, "FY2026");
  assert.equal(labels.title, "October 2025–September 2026");
});

test("January partials keep a calendar start and are labeled as ranges", () => {
  const april = coverageOf({ grain: "annual", year: 2026, throughMonth: 4 });
  const july = coverageOf({ grain: "annual", year: 2026, throughMonth: 7 });
  const full = coverageOf({ grain: "annual", year: 2026 });
  assert.equal(april.periodEnd, "2026-04-30");
  assert.equal(july.periodEnd, "2026-07-31");
  assert.equal(full.periodEnd, "2026-12-31");
  assert.equal(periodLabels({ grain: "annual", year: 2026, ...april }).columnLabel, "Jan–Apr 2026");
  assert.equal(periodLabels({ grain: "annual", year: 2026, ...july }).columnLabel, "Jan–Jul 2026");
  assert.equal(periodLabels({ grain: "annual", year: 2026, ...full }).columnLabel, "2026");
});

test("the year columns use the fiscal label, and only an explicit gap is Missing", () => {
  const statement = buildStatement([
    annual({ id: "PL-1", periodId: "PP-1", year: 2025, startMonth: 10 }),
    annual({ id: "PL-2", periodId: "PP-2", year: 2026 }),
    annual({ id: "PL-3", periodId: "PP-3", year: 2026, throughMonth: 4, amount: money("300000") }),
  ], [{ year: 2026, month: 2, business: "car_wash", periodId: "PP-9" }]);
  const columns = yearColumns(statement.years);
  assert.deepEqual(columns.map((column) => column.label), ["2026", "Jan–Apr 2026", "FY2026"]);
  const calendar = statement.years.find((year) => year.year === 2026) as PnlYearView;
  assert.equal(monthColumnState(calendar, 1), "missing");
  assert.equal(monthColumnState(calendar, 2), "blank");
});
