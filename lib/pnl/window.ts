import { MONTH_SHORT } from "./lines";
import type { PnlPeriodView, PnlYearView } from "./statement";

export type MonthWindow = { start: number; end: number; label: string };

function monthNumber(value: string | null | undefined, fallback: number): number {
  const month = Number(String(value || "").slice(5, 7));
  return month >= 1 && month <= 12 ? month : fallback;
}

/** The partial the year is actually about. A stored range wins. Otherwise the months on file, including missing markers. */
export function monthWindow(year: PnlYearView): MonthWindow | null {
  const range = [...(year.ranges ?? [])].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0))[0];
  if (range) {
    const start = monthNumber(range.periodStart, range.startMonth ?? 1);
    const end = monthNumber(range.periodEnd, range.throughMonth ?? start);
    if (start <= end) return { start, end, label: range.columnLabel };
  }
  const marked = [
    ...year.months.flatMap((period, index) => (period ? [index + 1] : [])),
    ...(year.missingMonths ?? []),
  ];
  if (!marked.length) return null;
  const start = Math.min(...marked);
  const end = Math.max(...marked);
  const label = start === end
    ? `${MONTH_SHORT[start - 1]} ${year.year}`
    : `${MONTH_SHORT[start - 1]}–${MONTH_SHORT[end - 1]} ${year.year}`;
  return { start, end, label };
}

export function monthsInWindow(year: PnlYearView, window: MonthWindow): PnlPeriodView[] {
  const present: PnlPeriodView[] = [];
  for (let month = window.start; month <= window.end; month += 1) {
    const period = year.months[month - 1];
    if (period) present.push(period);
  }
  return present;
}

/** Present months over the window, with missing months named. Missing months are not counted as present. */
export function windowCoverage(year: PnlYearView): string | null {
  const window = monthWindow(year);
  if (!window) return null;
  const missingNames: string[] = [];
  let present = 0;
  for (let month = window.start; month <= window.end; month += 1) {
    if (year.months[month - 1]) present += 1;
    else if ((year.missingMonths ?? []).map((item) => Number(item)).includes(month)) missingNames.push(MONTH_SHORT[month - 1]);
  }
  const span = window.end - window.start + 1;
  const named = missingNames.length ? ` (${missingNames.join(", ")} missing)` : "";
  return `${window.label} · ${present} of ${span} months${named}`;
}
