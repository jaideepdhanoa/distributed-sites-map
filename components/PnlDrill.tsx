"use client";

import { useState } from "react";
import { MONTH_NAMES, MONTH_SHORT } from "@/lib/pnl/lines";
import {
  emptyStatement,
  statedRevenue,
  type PnlLineView,
  type PnlPeriodView,
  type PnlStatement,
  type PnlYearView,
} from "@/lib/pnl/statement";

function Lines({ lines }: { lines: PnlLineView[] }) {
  return (
    <div className="pnl-lines">
      {lines.map((line) => (
        <article key={line.id} className="pnl-line" data-testid="pnl-line">
          <span className="pnl-name">{line.label}</span>
          <strong>{line.amount}</strong>
          <span className={line.status === "estimated" ? "pnl-status estimated" : "pnl-status reported"}>
            {line.status === "estimated" ? "Estimated" : "Reported"}
          </span>
          {line.share ? <span className="pnl-share">{line.share}</span> : null}
          <span className="pnl-source">
            {line.sourceHref ? (
              <a className="text-link" href={line.sourceHref} target="_blank" rel="noopener noreferrer">
                {line.sourceDocument} ↗
              </a>
            ) : (
              line.sourceDocument
            )}
            <span className="pnl-page">· {line.sourcePage}</span>
          </span>
          <time className="pnl-when" dateTime={line.capturedAt}>{line.capturedAt}</time>
          {line.flag ? <p className="pnl-flag" role="note" data-testid="pnl-flag">{line.flag.reason}</p> : null}
        </article>
      ))}
    </div>
  );
}

function PeriodBody({ period }: { period: PnlPeriodView }) {
  return (
    <div data-testid="pnl-period">
      {period.note ? <p className="pnl-note">{period.note}</p> : null}
      {period.revenue.length ? (
        <section>
          <h3>Revenue</h3>
          <Lines lines={period.revenue} />
        </section>
      ) : null}
      {period.costs.length ? (
        <section>
          <h3>Costs</h3>
          <Lines lines={period.costs} />
        </section>
      ) : null}
      {period.results.length ? (
        <section>
          <h3>Result</h3>
          <p className="pnl-note">Shown only when the package states it. Not calculated from the lines above.</p>
          <Lines lines={period.results} />
        </section>
      ) : null}
      {period.addbacks.length ? (
        <section data-testid="pnl-addbacks">
          <h3>Owner add-backs</h3>
          <p className="pnl-note">Separate from the lines above. Shown only when the package states them.</p>
          <Lines lines={period.addbacks} />
        </section>
      ) : null}
    </div>
  );
}

function YearCard({ year, onOpen }: { year: PnlYearView; onOpen: () => void }) {
  const revenue = statedRevenue(year.annual);
  return (
    <article className="pnl-year">
      <button type="button" className="fin-tile" data-testid="pnl-year" onClick={onOpen}>
        <span>{year.year}{year.businessLabel ? ` · ${year.businessLabel}` : ""}</span>
        {revenue ? <strong>{revenue.amount}</strong> : <strong>{year.annual ? "No stated revenue total" : "No annual statement"}</strong>}
        {revenue ? <small>{revenue.status === "estimated" ? "Estimated" : "Reported"} · Annual revenue</small> : null}
        <small>{year.coverage}</small>
        <small>{year.flagCount === 0 ? "No line outside the band" : year.flagCount === 1 ? "1 line outside the band" : `${year.flagCount} lines outside the band`}</small>
      </button>
    </article>
  );
}

export default function PnlDrill({ statement = emptyStatement() }: { statement?: PnlStatement }) {
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const selected = statement.years.find((item) => item.year === year) ?? null;
  const monthPeriod = selected && month ? selected.months[month - 1] : null;

  return (
    <div className="pnl" data-testid="pnl-drill">
      <h3>Profit and loss</h3>
      {statement.status !== "ready" ? (
        <p className="pnl-empty" data-testid="pnl-empty">{statement.message}</p>
      ) : null}
      {statement.status === "ready" && !selected ? (
        <div className="pnl-years">
          {statement.years.map((item) => (
            <YearCard key={item.year} year={item} onOpen={() => { setYear(item.year); setMonth(null); }} />
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="pnl-open">
          <button
            type="button"
            className="text-link pnl-back"
            onClick={() => {
              if (month) setMonth(null);
              else setYear(null);
            }}
          >
            {month ? selected.annual?.label || String(selected.year) : "All years"}
          </button>
          <p className="pnl-kicker">
            {selected.businessLabel ? `${selected.businessLabel} · ` : ""}
            {monthPeriod ? monthPeriod.label : selected.annual?.label || String(selected.year)}
          </p>
          <div className="chips pnl-months" role="group" aria-label="Months">
            {selected.months.map((period, index) => period ? (
              <button
                key={MONTH_SHORT[index]}
                type="button"
                className={month === index + 1 ? "chip on" : "chip"}
                aria-pressed={month === index + 1}
                onClick={() => setMonth(index + 1)}
              >
                {MONTH_SHORT[index]}
              </button>
            ) : (
              <span key={MONTH_SHORT[index]} className="pnl-gap" title={`${MONTH_NAMES[index]} is not in the package`}>{MONTH_SHORT[index]}</span>
            ))}
          </div>
          <p className="pnl-coverage" data-testid="pnl-coverage">{selected.coverage}</p>
          {month && !monthPeriod ? null : monthPeriod ? (
            <PeriodBody period={monthPeriod} />
          ) : selected.annual ? (
            <PeriodBody period={selected.annual} />
          ) : (
            <p className="pnl-note">No annual statement has been captured for this year.</p>
          )}
        </div>
      ) : null}
      {statement.status === "ready" ? (
        <p className="pnl-note">A line is shown only when the package states it. Bands compare that line with stated revenue for the same period.</p>
      ) : null}
    </div>
  );
}
