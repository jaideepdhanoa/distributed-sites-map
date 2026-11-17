"use client";

import { useMemo, useRef, useState } from "react";
import type { OpenPnlComment } from "@/lib/comments/anchor";
import { statusLabel, type DataConflict } from "@/lib/conflicts/view";
import { MONTH_SHORT } from "@/lib/pnl/lines";
import { buildPnlGrid, columnPeriodKey, columnSummary, type GridCell } from "@/lib/pnl/grid";
import type { PnlStatement } from "@/lib/pnl/statement";

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
                <span>{row.label}{row.commentOpen || cell?.commentOpen ? <i className="pnl-mark comment" data-testid="pnl-comment-mark" aria-label="Open comment" /> : null}</span>
                <strong className={value ? undefined : "pnl-muted"}>{textOf(cell, false)}</strong>
                <small>{value?.share || ""}</small>
                {value?.flag ? <i className="pnl-dot" data-testid="pnl-flag-dot" aria-label="Outside the band" /> : null}
              </button>
              {open === row.id ? <Detail cell={cell} onComment={onComment} line={row.id} period={grid.columns[index] ? columnPeriodKey(grid.columns[index]) : ""} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConflictDetail({ cell }: { cell: GridCell }) {
  if (!cell.conflict) return null;
  return (
    <div data-testid="pnl-conflict">
      <p>Conflict · {statusLabel(cell.conflict.status)}</p>
      {cell.conflict.sources.map((source) => (
        <p key={`${source.document}-${source.page}`}>{source.value} · {source.document} · {source.page}</p>
      ))}
      <p>In use: {cell.conflict.valueInUse}</p>
    </div>
  );
}

function CommentActions({
  onComment,
  line,
  period,
}: {
  onComment?: (anchor: { type: "pnl_cell" | "pnl_line"; line: string; period: string }) => void;
  line: string;
  period: string;
}) {
  if (!onComment) return null;
  return (
    <div className="act-row">
      <button type="button" className="menu-item" data-testid="pnl-cell-comment" onClick={() => onComment({ type: "pnl_cell", line, period })}>Comment</button>
      <button type="button" className="menu-item" data-testid="pnl-line-comment" onClick={() => onComment({ type: "pnl_line", line, period: "" })}>Comment on line</button>
    </div>
  );
}

function Detail({
  cell,
  onComment,
  line,
  period,
}: {
  cell: GridCell | undefined;
  onComment?: (anchor: { type: "pnl_cell" | "pnl_line"; line: string; period: string }) => void;
  line: string;
  period: string;
}) {
  if (!cell || cell.kind === "missing") {
    const source = cell?.kind === "missing" ? [cell.sourceDocument, cell.sourcePage, cell.markerSource].filter(Boolean).join(" · ") : "";
    return (
      <div className="pnl-expand" data-testid="pnl-missing-source">
        <p>Missing</p>
        {source ? <p>{source}</p> : null}
        {cell?.kind === "missing" && cell.capturedLabel ? <p>Captured {cell.capturedLabel}</p> : null}
        {cell ? <ConflictDetail cell={cell} /> : null}
        <CommentActions onComment={onComment} line={line} period={period} />
      </div>
    );
  }
  if (cell.kind === "blank") {
    return (
      <div className="pnl-expand">
        <p>Not in this statement.</p>
        <ConflictDetail cell={cell} />
        <CommentActions onComment={onComment} line={line} period={period} />
      </div>
    );
  }
  return (
    <div className="pnl-expand" data-testid="pnl-expand">
      <p>{cell.status === "calculated" ? "Calculated" : cell.status === "estimated" ? "Estimated" : cell.status === "normalized" ? "Normalized" : "Reported"}</p>
      <p>{cell.sourceDocument}{cell.sourcePage ? ` · ${cell.sourcePage}` : ""}</p>
      {cell.capturedLabel ? <p>Captured {cell.capturedLabel}</p> : null}
      {cell.flag ? <p>{cell.flag}</p> : null}
      <ConflictDetail cell={cell} />
      <CommentActions onComment={onComment} line={line} period={period} />
    </div>
  );
}
