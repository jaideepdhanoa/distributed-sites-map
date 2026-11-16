"use client";

import { MONTH_NAMES, MONTH_SHORT } from "@/lib/pnl/lines";
import { monthColumnState } from "@/lib/pnl/columns";
import type { PnlYearView } from "@/lib/pnl/statement";

/** Period and month columns. A fiscal year uses its FY label. An unmarked gap stays blank. */
export default function PnlPeriods({
  year,
  month,
  rangeId,
  onMonth,
  onRange,
}: {
  year: PnlYearView;
  month: number | null;
  rangeId: string | null;
  onMonth: (month: number) => void;
  onRange: (id: string | null) => void;
}) {
  const ranges = year.ranges ?? [];
  const showMonths = year.months.some(Boolean) || (year.missingMonths ?? []).length > 0;
  const annualOn = !month && rangeId == null;
  return (
    <>
      {year.annual || ranges.length ? (
        <div className="chips pnl-months" role="group" aria-label="Periods">
          {year.annual ? (
            <button type="button" className={annualOn ? "chip on" : "chip"} aria-pressed={annualOn} title={year.annual.title} data-testid="pnl-column" onClick={() => onRange(null)}>
              {year.annual.columnLabel}
            </button>
          ) : null}
          {ranges.map((period) => (
            <button key={period.id} type="button" className={rangeId === period.id ? "chip on" : "chip"} aria-pressed={rangeId === period.id} title={period.title} data-testid="pnl-column" onClick={() => onRange(period.id)}>
              {period.columnLabel}
            </button>
          ))}
        </div>
      ) : null}
      {showMonths ? (
        <div className="chips pnl-months" role="group" aria-label="Months">
          {year.months.map((period, index) => {
            const state = monthColumnState(year, index);
            if (state === "present" && period) {
              return (
                <button key={MONTH_SHORT[index]} type="button" className={month === index + 1 ? "chip on" : "chip"} aria-pressed={month === index + 1} onClick={() => onMonth(index + 1)}>
                  {MONTH_SHORT[index]}
                </button>
              );
            }
            if (state === "missing") {
              return <span key={MONTH_SHORT[index]} className="pnl-missing" data-testid="pnl-missing" title={`${MONTH_NAMES[index]} was not in the package`}>Missing</span>;
            }
            return <span key={MONTH_SHORT[index]} className="pnl-gap" title={`${MONTH_NAMES[index]} was not captured`}>{MONTH_SHORT[index]}</span>;
          })}
        </div>
      ) : null}
    </>
  );
}
