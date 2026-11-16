/**
 * Column labels for the P&L grid.
 *
 * The spreadsheet grid on `cursor/pnl-spreadsheet-fa77` (PR 121) labels a year
 * column with the calendar year. A fiscal year must use `columnLabel` instead,
 * and a month that was not captured stays blank unless `missingMonths` names it.
 * Import this module rather than folding the labels into the grid component.
 */

import { MONTH_NAMES, MONTH_SHORT } from "./lines";
import type { PnlPeriodView, PnlYearView } from "./statement";

export type MonthColumnState = "present" | "missing" | "blank";

function asMonth(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) return value;
  const text = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(text);
  if (iso) {
    const month = Number(iso[2]);
    return month >= 1 && month <= 12 ? month : null;
  }
  const lower = text.toLowerCase();
  const full = MONTH_NAMES.findIndex((name) => name.toLowerCase() === lower);
  if (full >= 0) return full + 1;
  const short = MONTH_SHORT.findIndex((name) => name.toLowerCase() === lower.replace(/\.$/, ""));
  if (short >= 0) return short + 1;
  const plain = Number(text);
  return Number.isInteger(plain) && plain >= 1 && plain <= 12 ? plain : null;
}

function monthsInCoverage(coverage: string): number[] {
  const match = /Missing:\s*([^.]+)/i.exec(coverage || "");
  if (!match) return [];
  return match[1].split(",").map((part) => asMonth(part)).filter((month): month is number => month != null);
}

function listedMonths(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

/**
 * Months the statement calls missing. Accepts the year lists, a YYYY-MM
 * string, and the coverage sentence ("Missing: May") when the lists are empty.
 */
export function markedMonths(year: PnlYearView): number[] {
  const raw = [
    ...listedMonths(year.missingMonths),
    ...listedMonths(year.missingDetails).map((item) => (
      item && typeof item === "object" && "month" in item ? (item as { month: unknown }).month : item
    )),
    ...monthsInCoverage(year.coverage || ""),
  ];
  const months = raw.map(asMonth).filter((month): month is number => month != null);
  return [...new Set(months)].sort((a, b) => a - b);
}

export function monthColumnState(year: PnlYearView, monthIndex: number): MonthColumnState {
  if (year.months[monthIndex]) return "present";
  if (markedMonths(year).includes(monthIndex + 1)) return "missing";
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
