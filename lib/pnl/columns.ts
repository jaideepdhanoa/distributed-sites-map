/**
 * Column labels for the P&L grid.
 *
 * The spreadsheet grid on `cursor/pnl-spreadsheet-fa77` (PR 121) labels a year
 * column with the calendar year. A fiscal year must use `columnLabel` instead,
 * and a month that was not captured stays blank unless `missingMonths` names it.
 * Import this module rather than folding the labels into the grid component.
 */

import type { PnlPeriodView, PnlYearView } from "./statement";

export type MonthColumnState = "present" | "missing" | "blank";

export function monthColumnState(year: PnlYearView, monthIndex: number): MonthColumnState {
  if (year.months[monthIndex]) return "present";
  const missing = (year.missingMonths ?? []).map((month) => Number(month));
  if (missing.includes(monthIndex + 1)) return "missing";
  return "blank";
}

export type YearColumn = {
  id: string;
  label: string;
  title: string;
  periodId: string;
};

/** One grid column per full year and per partial or fiscal period. */
export function yearColumns(years: PnlYearView[]): YearColumn[] {
  const columns: YearColumn[] = [];
  for (const year of years) {
    const periods = [year.annual, ...(year.ranges ?? [])].filter((period): period is PnlPeriodView => Boolean(period));
    if (!periods.length) {
      columns.push({
        id: `year-${year.year}`,
        label: year.columnLabel || String(year.year),
        title: year.columnLabel || String(year.year),
        periodId: "",
      });
      continue;
    }
    for (const period of periods) {
      columns.push({
        id: period.id,
        label: period.columnLabel,
        title: period.title,
        periodId: period.id,
      });
    }
  }
  return columns;
}
