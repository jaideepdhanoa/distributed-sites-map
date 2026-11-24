"use client";

import { useEffect, useRef, useState } from "react";
import { withoutGmail } from "@/lib/displayText";
import { columnPeriodKey, matchesColumnPeriod, type GridCell, type GridColumn, type PnlGrid, type ValueCell } from "@/lib/pnl/grid";
import { sourceView } from "@/lib/pnl/sourceLink";
import PnlLinePopover from "./PnlLinePopover";

function figure(cell: ValueCell, percent: boolean): { primary: string; secondary: string } {
  if (percent) return { primary: cell.share || "—", secondary: cell.amount === cell.share ? "" : cell.amount };
  return { primary: cell.amount, secondary: cell.share && cell.share !== cell.amount ? cell.share : "" };
}

function HeaderLabel({ column }: { column: GridColumn }) {
  const match = column.statement ? /^(FY\d+)\s+\(statement\)$/.exec(column.label) : null;
  if (!match) return column.label;
  return (
    <span className="pnl-col">
      <span>{match[1]}</span>
      <small>statement</small>
    </span>
  );
}

function ConflictMark({ cell }: { cell: GridCell }) {
  if (!cell.conflict || cell.conflict.status === "resolved") return null;
  return <i className="pnl-mark conflict" data-testid="pnl-conflict-mark" aria-label="Sources disagree" />;
}

function CommentGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14v9H8l-3 3V6z" />
    </svg>
  );
}

function CommentPin({
  count,
  label,
  testId,
  className = "",
  onClick,
}: {
  count: number;
  label: string;
  testId: string;
  className?: string;
  onClick: () => void;
}) {
  if (count < 1) return null;
  const name = count > 1 ? `${count} comments` : label;
  return (
    <button
      type="button"
      className={`icon-btn pnl-pin ${className}`.trim()}
      data-testid={testId}
      aria-label={name}
      title={name}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <CommentGlyph />
      {count > 1 ? <span>{count}</span> : null}
    </button>
  );
}

function missingTitle(cell: GridCell): string | undefined {
  if (cell.kind !== "missing") return undefined;
  const view = sourceView({
    document: cell.sourceDocument,
    page: cell.sourcePage,
    href: cell.sourceHref || "",
    capturedLabel: "",
  });
  const source = [view.label, view.pageAside || view.pageNote, withoutGmail(cell.markerSource)].filter(Boolean).join(" · ");
  return source ? `Missing · ${source}` : "Missing";
}

function CellBody({ cell, percent }: { cell: GridCell; percent: boolean }) {
  if (cell.kind === "missing") return <span className="pnl-missing">Missing<ConflictMark cell={cell} /></span>;
  if (cell.kind === "blank") return <span className="pnl-blank"><ConflictMark cell={cell} />—</span>;
  const shown = figure(cell, percent);
  return (
    <span className="pnl-figure">
      <span className="pnl-amount">
        {cell.status === "calculated" ? null : <i className={`pnl-mark ${cell.status}`} aria-label={cell.status === "estimated" ? "Estimated" : cell.status === "normalized" ? "Normalized" : "Reported"} />}
        <ConflictMark cell={cell} />
        <strong>{shown.primary}</strong>
      </span>
      {shown.secondary ? <small>{shown.secondary}</small> : null}
    </span>
  );
}

export default function PnlGrid({
  grid,
  percent,
  onComment,
  focusLine,
  focusPeriod,
}: {
  grid: PnlGrid;
  percent: boolean;
  onComment?: (anchor: { type: "pnl_cell" | "pnl_line"; line: string; period: string }) => void;
  focusLine?: string;
  focusPeriod?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const [open, setOpen] = useState<{ row: number; col: number; top: number; left: number } | null>(null);
  const focusable = grid.rows.filter((row) => row.kind !== "group");
  const colCount = grid.columns.length;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onScroll = () => node.classList.toggle("is-scrolled", node.scrollLeft > 4);
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [grid.columns.length]);

  useEffect(() => {
    if (!focus) return;
    const cell = scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${focus.row}:${focus.col}"]`);
    if (cell && document.activeElement !== cell) cell.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus, grid.columns.length, grid.rows.length]);

  function move(rowDelta: number, colDelta: number) {
    setOpen(null);
    setFocus((current) => ({
      row: Math.min(Math.max((current?.row || 0) + rowDelta, 0), Math.max(focusable.length - 1, 0)),
      col: Math.min(Math.max((current?.col || 0) + colDelta, 0), Math.max(colCount - 1, 0)),
    }));
  }

  function reveal(row: number, col: number, target: HTMLElement) {
    const cell = focusable[row]?.cells[col];
    const canOpen = Boolean(onComment) || cell?.kind === "value" || cell?.kind === "missing" || Boolean(cell?.conflict);
    if (!cell || !canOpen) {
      setOpen(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const width = 280;
    const height = 220;
    let top = rect.top - height - 8;
    let left = rect.left;
    if (top < 8) {
      left = rect.right + 8;
      top = Math.max(8, rect.top);
      if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
    }
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    opener.current = target;
    setOpen({ row, col, top, left });
  }

  function closePopover() {
    const node = opener.current;
    setOpen(null);
    node?.focus();
  }

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(0, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(0, -1);
    } else if (event.key === "Enter" && focus) {
      const target = event.target;
      if (target instanceof HTMLElement) reveal(focus.row, focus.col, target);
    }
  }

  const linkedColumn = focusPeriod ? grid.columns.findIndex(column => matchesColumnPeriod(column, focusPeriod)) : 0;
  useEffect(() => {
    if (!focusLine || linkedColumn < 0 || !scrollRef.current?.getClientRects().length) return;
    const cell = scrollRef.current.querySelector<HTMLElement>(`[data-line="${CSS.escape(focusLine)}"][data-colindex="${linkedColumn}"]`);
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusLine, linkedColumn, grid.rows.length]);

  const popover = open ? focusable[open.row]?.cells[open.col] : null;
  const popoverRow = open ? focusable[open.row] : null;
  const popoverColumn = open ? grid.columns[open.col] : null;
  let cursor = 0;

  return (
    <div className="pnl-grid">
      {grid.note ? <p className="pnl-legend" data-testid="pnl-legend">{grid.note}</p> : null}
    <div className="list-scroll pnl-scroll" ref={scrollRef} data-testid="pnl-sheet" onKeyDown={onKey}>
      <table className="list-table pnl-table" role="grid" aria-label="Profit and loss" aria-rowcount={focusable.length + 1} aria-colcount={colCount + 1}>
        <thead>
          <tr role="row">
            <th className="is-pinned" data-col="line" scope="col">Line</th>
            {grid.columns.map((column) => (
              <th key={column.id} scope="col" data-col={column.id} aria-label={column.label} className={column.missing ? "is-missing" : undefined}>
                <HeaderLabel column={column} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => {
            if (row.kind === "group") {
              return (
                <tr key={row.id} className="group-row">
                  <th scope="rowgroup" colSpan={colCount + 1}>{row.label}</th>
                </tr>
              );
            }
            const index = cursor;
            cursor += 1;
            return (
              <tr key={row.id} role="row" className="list-row">
                <th scope="row" className="is-pinned" data-col="line">
                  {row.label}
                  {onComment ? (
                    <button
                      type="button"
                      className={`icon-btn pnl-pin pnl-row-pin${row.commentCount ? " has-comments" : ""}`}
                      data-testid="pnl-line-comment"
                      data-row={row.id}
                      aria-label={row.commentCount && row.commentCount > 1 ? `${row.commentCount} comments on line` : "Comment on line"}
                      title="Comment on line"
                      onClick={() => onComment({ type: "pnl_line", line: row.id, period: "" })}
                    >
                      <CommentGlyph />
                      {row.commentCount && row.commentCount > 1 ? <span>{row.commentCount}</span> : null}
                    </button>
                  ) : null}
                </th>
                {row.cells.map((cell, col) => {
                  const flagged = cell.kind === "value" && Boolean(cell.flag);
                  const missing = cell.kind === "missing";
                  const focused = focus?.row === index && focus?.col === col;
                  return (
                    <td
                      key={grid.columns[col]?.id || col}
                      role="gridcell"
                      data-cell={`${index}:${col}`}
                      data-line={row.id}
                      data-linked={row.id === focusLine && col === linkedColumn || undefined}
                      data-row={index}
                      data-colindex={col}
                      data-period={grid.columns[col] ? columnPeriodKey(grid.columns[col]) : ""}
                      data-col={grid.columns[col]?.id}
                      tabIndex={focused || (!focus && index === 0 && col === 0) ? 0 : -1}
                      className={`${missing ? "is-missing" : ""} ${flagged ? "is-flag" : ""} ${cell.conflict && cell.conflict.status !== "resolved" ? "is-conflict" : ""} ${focused ? "cell-focus" : ""}`.trim()}
                      title={missingTitle(cell) || (cell.kind === "value" && cell.flag ? cell.flag : undefined)}
                      data-pnl-anchor={open?.row === index && open?.col === col ? "open" : undefined}
                      onFocus={() => setFocus({ row: index, col })}
                      onClick={(event) => {
                        if (open?.row === index && open?.col === col) return;
                        reveal(index, col, event.currentTarget);
                      }}
                    >
                      <CellBody cell={cell} percent={percent} />
                      {onComment ? (
                        <CommentPin
                          count={cell.commentCount || 0}
                          label="Open comment"
                          testId="pnl-cell-pin"
                          onClick={() => onComment({ type: "pnl_cell", line: row.id, period: grid.columns[col] ? columnPeriodKey(grid.columns[col]) : "" })}
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && popover ? (
        <PnlLinePopover
          label={focusable[open.row]?.label || "Line"}
          cell={popover}
          style={{ top: open.top, left: open.left }}
          onClose={closePopover}
          actions={onComment && popoverRow && popoverColumn ? (
            <button
              type="button"
              className="icon-btn pnl-pin pnl-comment-btn"
              data-testid="pnl-cell-comment"
              aria-label="Comment"
              title="Comment"
              onClick={() => onComment({ type: "pnl_cell", line: popoverRow.id, period: columnPeriodKey(popoverColumn) })}
            >
              <CommentGlyph />
            </button>
          ) : null}
        />
      ) : null}
    </div>
    </div>
  );
}
