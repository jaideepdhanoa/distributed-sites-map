"use client";

import { useEffect, useRef, useState } from "react";
import { withoutGmail } from "@/lib/displayText";
import type { GridCell, GridColumn, PnlGrid, ValueCell } from "@/lib/pnl/grid";
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

export default function PnlGrid({ grid, percent }: { grid: PnlGrid; percent: boolean }) {
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
    if (!cell || (cell.kind !== "value" && cell.kind !== "missing" && !cell.conflict)) {
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

  const popover = open ? focusable[open.row]?.cells[open.col] : null;
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
                <th scope="row" className="is-pinned" data-col="line">{row.label}</th>
                {row.cells.map((cell, col) => {
                  const flagged = cell.kind === "value" && Boolean(cell.flag);
                  const missing = cell.kind === "missing";
                  const focused = focus?.row === index && focus?.col === col;
                  return (
                    <td
                      key={grid.columns[col]?.id || col}
                      role="gridcell"
                      data-cell={`${index}:${col}`}
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
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && popover && (popover.kind === "value" || popover.kind === "missing" || popover.conflict) ? (
        <PnlLinePopover
          label={focusable[open.row]?.label || "Line"}
          cell={popover}
          style={{ top: open.top, left: open.left }}
          onClose={closePopover}
        />
      ) : null}
    </div>
    </div>
  );
}
