"use client";

import { useMemo, useRef, useState } from "react";
import type { OpenPnlComment } from "@/lib/comments/anchor";
import type { DataConflict } from "@/lib/conflicts/view";
import { MONTH_SHORT } from "@/lib/pnl/lines";
import { buildPnlGrid, columnPeriodKey, columnSummary, type GridCell } from "@/lib/pnl/grid";
import type { PnlStatement } from "@/lib/pnl/statement";
import PnlLinePopover from "./PnlLinePopover";

function textOf(cell: GridCell | undefined, percent: boolean): string {
  if (!cell || cell.kind === "blank") return "Not in package";
  if (cell.kind === "missing") return "Missing";
  if (percent) return cell.share || "—";
  return cell.amount;
}

export default function PnlPhone({
  statement,
  conflicts = [],
  comments = [],
  onComment,
}: {
  statement: PnlStatement;
  conflicts?: DataConflict[];
  comments?: OpenPnlComment[];
  onComment?: (anchor: { type: "pnl_cell" | "pnl_line"; line: string; period: string }) => void;
}) {
  const years = statement.years.map((item) => item.year);
  const [grain, setGrain] = useState<"month" | "year">("month");
  const [year, setYear] = useState(years[0] || 0);
  const initialMonth = statement.years[0]?.months.findLastIndex((period) => period) ?? 0;
  const [month, setMonth] = useState(initialMonth < 0 ? 0 : initialMonth);
  const [yearIndex, setYearIndex] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const touch = useRef(0);
  const grid = useMemo(
    () => buildPnlGrid(statement, grain === "month" ? "months" : "years", year, conflicts, comments),
    [statement, grain, year, conflicts, comments],
  );
  const index = grain === "month" ? month : yearIndex;
  const summary = columnSummary(grid, index);
  const periods = grain === "month" ? [...MONTH_SHORT, grid.columns[12]?.label || "YTD"] : grid.columns.map((column) => column.label);
  const periodTitle = grain === "month"
    ? (month >= 12 ? periods[12] : `${MONTH_SHORT[month]} ${year}`)
    : periods[yearIndex] || "";

  function closeLine() {
    const node = anchor.current;
    setOpen(null);
    node?.focus();
  }

  const openRow = grid.rows.find((row) => row.id === open);
  const openCell: GridCell | undefined = openRow?.cells[index];
  const openLabel = openRow?.label || "Line";

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
        {grid.rows.filter((row) => row.kind === "line" || row.id === "sde" || (Boolean(onComment) && (row.kind === "total" || row.kind === "margin"))).map((row) => {
          const cell = row.cells[index];
          const value = cell?.kind === "value" ? cell : null;
          const period = grid.columns[index] ? columnPeriodKey(grid.columns[index]) : "";
          const cellCount = cell?.commentCount || 0;
          const lineCount = row.commentCount || 0;
          return (
            <div key={row.id} className="pnl-phone-line">
              <button
                type="button"
                className="list-row"
                aria-expanded={open === row.id}
                data-pnl-anchor={open === row.id ? "open" : undefined}
                onClick={(event) => {
                  if (open === row.id) return;
                  anchor.current = event.currentTarget;
                  setOpen(row.id);
                }}
              >
                <span>{row.label}</span>
                <strong className={value ? undefined : "pnl-muted"}>{textOf(cell, false)}</strong>
                <small>{value?.share || ""}</small>
                {value?.flag ? <i className="pnl-dot" data-testid="pnl-flag-dot" aria-label="Outside the band" /> : null}
              </button>
              {onComment && cellCount ? (
                <button type="button" className="icon-btn pnl-pin" data-testid="pnl-cell-pin" aria-label={cellCount > 1 ? `${cellCount} comments` : "Open comment"} title={cellCount > 1 ? `${cellCount} comments` : "Open comment"} onClick={() => onComment({ type: "pnl_cell", line: row.id, period })}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9H8l-3 3V6z" /></svg>
                  {cellCount > 1 ? <span>{cellCount}</span> : null}
                </button>
              ) : null}
              {onComment && lineCount ? (
                <button type="button" className="icon-btn pnl-pin" data-testid="pnl-line-pin" aria-label={lineCount > 1 ? `${lineCount} comments on line` : "Comment on line"} title="Comment on line" onClick={() => onComment({ type: "pnl_line", line: row.id, period: "" })}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9H8l-3 3V6z" /></svg>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {openCell && open ? (
        <PnlLinePopover
          label={openLabel}
          cell={openCell}
          sheet
          onClose={closeLine}
          actions={onComment ? (
            <div className="pnl-comment-actions">
              <button
                type="button"
                className="icon-btn pnl-pin pnl-comment-btn"
                data-testid="pnl-cell-comment"
                aria-label="Comment"
                title="Comment"
                onClick={() => onComment({ type: "pnl_cell", line: open, period: grid.columns[index] ? columnPeriodKey(grid.columns[index]) : "" })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9H8l-3 3V6z" /></svg>
              </button>
              <button
                type="button"
                className="icon-btn pnl-pin pnl-comment-btn"
                data-testid="pnl-line-comment"
                aria-label="Comment on line"
                title="Comment on line"
                onClick={() => onComment({ type: "pnl_line", line: open, period: "" })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9H8l-3 3V6z" /></svg>
              </button>
            </div>
          ) : null}
        />
      ) : null}
    </div>
  );
}
