/** Period bounds for a captured P&L line. R-102. Existing calendar writes stay valid. */

import { MONTH_NAMES, MONTH_SHORT } from "./lines";

export type PnlGrain = "annual" | "monthly";

export type PeriodCoverage = {
  periodStart: string;
  periodEnd: string;
  /** Null means January for an annual period. Monthly periods leave this null. */
  startMonth: number | null;
  throughMonth: number | null;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function lastDay(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function coverageOf(input: {
  grain: PnlGrain;
  year: number;
  month?: number | null;
  startMonth?: number | null;
  throughMonth?: number | null;
}): PeriodCoverage {
  if (input.grain === "monthly") {
    const month = input.month ?? 1;
    return {
      periodStart: `${input.year}-${pad(month)}-01`,
      periodEnd: lastDay(input.year, month),
      startMonth: null,
      throughMonth: null,
    };
  }
  const start = input.startMonth ?? 1;
  const periodStart = `${input.year}-${pad(start)}-01`;
  const storedStart = start === 1 ? null : start;
  if (input.throughMonth == null) {
    if (start === 1) {
      return { periodStart, periodEnd: `${input.year}-12-31`, startMonth: null, throughMonth: null };
    }
    const endMonth = start - 1;
    const endYear = input.year + 1;
    return { periodStart, periodEnd: lastDay(endYear, endMonth), startMonth: storedStart, throughMonth: null };
  }
  const endMonth = input.throughMonth;
  const endYear = endMonth < start ? input.year + 1 : input.year;
  return {
    periodStart,
    periodEnd: lastDay(endYear, endMonth),
    startMonth: storedStart,
    throughMonth: input.throughMonth,
  };
}

export function spanMonths(periodStart: string, periodEnd: string): number {
  const startYear = Number(periodStart.slice(0, 4));
  const startMonth = Number(periodStart.slice(5, 7));
  const endYear = Number(periodEnd.slice(0, 4));
  const endMonth = Number(periodEnd.slice(5, 7));
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

export type PeriodLabels = {
  /** Sentence label, such as "2026 through April" or "FY2026". */
  label: string;
  /** Column header. A fiscal year is FY plus the year of its last day. */
  columnLabel: string;
  /** Full span, such as "October 2025–September 2026". */
  title: string;
};

/** Labels for a period column. A 12-month period that does not start in January is FY{end year}. */
export function periodLabels(input: {
  grain: PnlGrain;
  year: number;
  month?: number | null;
  startMonth?: number | null;
  throughMonth?: number | null;
  periodStart: string;
  periodEnd: string;
}): PeriodLabels {
  if (input.grain === "monthly" && input.month) {
    const label = `${MONTH_NAMES[input.month - 1]} ${input.year}`;
    return { label, columnLabel: MONTH_SHORT[input.month - 1], title: label };
  }
  const start = input.startMonth ?? (Number(input.periodStart.slice(5, 7)) || 1);
  const endYear = Number(input.periodEnd.slice(0, 4));
  const endMonth = Number(input.periodEnd.slice(5, 7));
  const months = spanMonths(input.periodStart, input.periodEnd);
  if (start === 1 && endMonth === 12 && endYear === input.year) {
    const label = String(input.year);
    return { label, columnLabel: label, title: label };
  }
  if (start === 1 && input.throughMonth && endYear === input.year) {
    const label = `${input.year} through ${MONTH_NAMES[input.throughMonth - 1]}`;
    const columnLabel = `${MONTH_SHORT[0]}–${MONTH_SHORT[endMonth - 1]} ${input.year}`;
    return { label, columnLabel, title: label };
  }
  const title = `${MONTH_NAMES[start - 1]} ${input.year}–${MONTH_NAMES[endMonth - 1]} ${endYear}`;
  if (months === 12 && start !== 1) {
    const columnLabel = `FY${endYear}`;
    return { label: columnLabel, columnLabel, title };
  }
  const columnLabel = start === 1 && endYear === input.year
    ? `${MONTH_SHORT[0]}–${MONTH_SHORT[endMonth - 1]} ${input.year}`
    : `${MONTH_SHORT[start - 1]} ${input.year}–${MONTH_SHORT[endMonth - 1]} ${endYear}`;
  return { label: title, columnLabel, title };
}
