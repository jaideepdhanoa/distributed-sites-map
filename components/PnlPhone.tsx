"use client";

import { useMemo, useRef, useState } from "react";
import { MONTH_SHORT } from "@/lib/pnl/lines";
import { buildPnlGrid, columnSummary, type GridCell } from "@/lib/pnl/grid";
import type { PnlStatement } from "@/lib/pnl/statement";

function textOf(cell: GridCell | undefined, percent: boolean): string {
  if (!cell || cell.kind === "missing" || cell.kind === "blank") return "Not in package";
  if (percent) return cell.share || "—";
  return cell.amount;
}

export default function PnlPhone({ statement }: { statement: PnlStatement }) {
  const years = statement.years.map((item) => item.year);
  const [grain, setGrain] = useState<"month" | "year">("month");
  const [year, setYear] = useState(years[0] || 0);
  const initialMonth = statement.years[0]?.months.findLastIndex((period) => period) ?? 0;
  const [month, setMonth] = useState(initialMonth < 0 ? 0 : initialMonth);
  const [yearIndex, setYearIndex] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const touch = useRef(0);
  const grid = useMemo(
    () => buildPnlGrid(statement, grain === "month" ? "months" : "years", year),
    [statement, grain, year],
  );
  const index = grain === "month" ? month : yearIndex;
  const summary = columnSummary(grid, index);
  const periods = grain === "month" ? [...MONTH_SHORT, grid.columns[12]?.label || "YTD"] : years.map(String);
  const periodTitle = grain === "month"
    ? (month >= 12 ? periods[12] : `${MONTH_SHORT[month]} ${year}`)
    : String(years[yearIndex] || "");

  function step(delta: number) {
    const next = Math.min(Math.max(index + delta, 0), periods.length - 1);
    if (grain === "month") setMonth(next);
    else setYearIndex(next);
    setOpen(null);
  }

  return (
    <div className="pnl-phone-body" data-testid="pnl-phone">
      <div className="segmented" role="group" aria-label="Period grain">
        <button type="button" className={grain === "month" ? "segmented on" : "segmented"} onClick={() => { setGrain("month"); setOpen(null); }}>Months</button>
        <button type="button" className={grain === "year" ? "segmented on" : "segmented"} onClick={() => { setGrain("year"); setOpen(null); }}>Years</button>
      </div>
      {grain === "month" && years.length > 1 ? (
        <label className="pnl-year-pick">
          Year
          <select className="secondary" aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      ) : null}
      <div className="chips pnl-periods" role="group" aria-label="Periods">
        {periods.map((label, item) => {
          const missing = Boolean(grid.columns[item]?.missing);
          const selected = item === index;
          return (
            <button
              key={label}
              type="button"
              className={selected ? "chip on" : "chip"}
              aria-pressed={selected}
              data-missing={missing ? "true" : "false"}
              onClick={() => {
                if (grain === "month") setMonth(item);
                else setYearIndex(item);
                setOpen(null);
              }}
            >
              {label}{missing ? " · Missing" : ""}
            </button>
          );
        })}
      </div>
      <p className="pnl-period-label" data-testid="pnl-period-label">{periodTitle}</p>
      <div
        className="metrics pnl-summary"
        data-testid="pnl-summary"
        onTouchStart={(event) => {
          touch.current = event.changedTouches[0]?.clientX || 0;
        }}
        onTouchEnd={(event) => {
          const next = event.changedTouches[0]?.clientX || 0;
          if (touch.current - next > 40) step(1);
          else if (next - touch.current > 40) step(-1);
        }}
      >
        <article><span>Revenue</span><strong>{summary.revenue}</strong></article>
        <article><span>Costs</span><strong>{summary.costs}</strong></article>
        <article><span>EBITDA</span><strong>{summary.ebitda}</strong></article>
        <article><span>Margin</span><strong>{summary.margin}</strong></article>
      </div>
      <div className="pnl-lines">
        {grid.rows.filter((row) => row.kind === "line" || row.id === "sde").map((row) => {
          const cell = row.cells[index];
          const value = cell?.kind === "value" ? cell : null;
          return (
            <div key={row.id}>
              <button
                type="button"
                className="list-row"
                aria-expanded={open === row.id}
                onClick={() => setOpen((current) => (current === row.id ? null : row.id))}
              >
                <span>{row.label}</span>
                <strong className={value ? undefined : "pnl-muted"}>{textOf(cell, false)}</strong>
                <small>{value?.share || ""}</small>
                {value?.flag ? <i className="pnl-dot" data-testid="pnl-flag-dot" aria-label="Outside the band" /> : null}
              </button>
              {open === row.id ? <Detail cell={cell} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ cell }: { cell: GridCell | undefined }) {
  if (!cell || cell.kind === "missing") return <p className="pnl-expand">This month is not in the package.</p>;
  if (cell.kind === "blank") return <p className="pnl-expand">Not in this statement.</p>;
  return (
    <div className="pnl-expand" data-testid="pnl-expand">
      <p>{cell.status === "calculated" ? "Calculated" : cell.status === "estimated" ? "Estimated" : "Reported"}</p>
      <p>{cell.sourceDocument}{cell.sourcePage ? ` · ${cell.sourcePage}` : ""}</p>
      {cell.capturedLabel ? <p>Captured {cell.capturedLabel}</p> : null}
      {cell.flag ? <p>{cell.flag}</p> : null}
    </div>
  );
}
