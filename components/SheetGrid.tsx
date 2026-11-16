"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GripVertical, ListFilter, Pin } from "lucide-react";
import {
  clampWidth,
  columnWidth,
  cycleSort,
  moveColumn,
  type ListLayout,
  type SheetColumn,
} from "@/lib/listLayout";

const WINDOW_AT = 180;

export default function SheetGrid<Row>({
  rows,
  rowId,
  columns,
  layout,
  onLayout,
  selectedId,
  onOpen,
  onClose,
  renderCell,
  headerExtra,
  trailing,
  labelledBy,
  scrollRef: scrollRefProp,
}: {
  rows: Row[];
  rowId: (row: Row) => string;
  columns: SheetColumn<Row>[];
  layout: ListLayout;
  onLayout: (next: ListLayout) => void;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  renderCell: (row: Row, columnId: string) => ReactNode;
  headerExtra?: (columnId: string) => ReactNode;
  trailing?: (row: Row) => ReactNode;
  labelledBy?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollRefProp ?? innerRef;
  const [menu, setMenu] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const ids = columns.map((column) => column.id);
  const colCount = ids.length + (trailing ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: rows.length > WINDOW_AT ? 8 : rows.length,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onScroll = () => node.classList.toggle("is-scrolled", node.scrollLeft > 4);
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, selectedId]);

  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest("input, textarea, select, .col-menu")) return;
    if (!scrollRef.current?.contains(active)) return;
    const cell = scrollRef.current.querySelector<HTMLElement>(`[data-cell="${focus.row}:${focus.col}"]`);
    if (cell && active !== cell) cell.focus();
  }, [focus, items.length, scrollRef]);

  useEffect(() => {
    if (!menu) return undefined;
    function onPointer(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".col-menu, .col-filter")) return;
      setMenu(null);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [menu]);

  function moveFocus(rowDelta: number, colDelta: number) {
    const row = Math.min(Math.max(focusRef.current.row + rowDelta, 0), Math.max(rows.length - 1, 0));
    const col = Math.min(Math.max(focusRef.current.col + colDelta, 0), Math.max(colCount - 1, 0));
    focusRef.current = { row, col };
    setFocus({ row, col });
    virtualizer.scrollToIndex(row, { align: "auto" });
  }

  function onGridKey(event: React.KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(0, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(0, -1);
    } else if (event.key === "Enter") {
      const row = rows[focusRef.current.row];
      if (!row) return;
      event.preventDefault();
      onOpen(rowId(row));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      onClose();
    }
  }

  function reorder(from: string, to: string) {
    if (!to || from === to) return;
    onLayout({ ...layout, order: moveColumn(layout.order, from, to), touched: true });
  }

  function onGripDown(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const pointer = event.pointerId;
    event.currentTarget.setPointerCapture(pointer);
    let over = id;
    function move(next: PointerEvent) {
      const hit = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-col]");
      over = hit?.dataset.col || over;
      setDragOver(over);
    }
    function up() {
      reorder(id, over);
      setDragOver(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onResizeDown(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.closest("tr");
    const widths = { ...layout.widths };
    header?.querySelectorAll<HTMLElement>("th[data-col]").forEach((cell) => {
      const col = cell.dataset.col;
      if (col && widths[col] == null) widths[col] = Math.round(cell.getBoundingClientRect().width);
    });
    const startX = event.clientX;
    const start = widths[id] || 160;
    function move(next: PointerEvent) {
      widths[id] = clampWidth(start + next.clientX - startX);
      onLayout({ ...layout, widths: { ...widths }, touched: true });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function widthOf(id: string) {
    return layout.widths[id] || columnWidth(id);
  }

  let pinnedLeft = 0;
  const pinnedOffset = new Map<string, number>();
  for (const column of columns) {
    if (!layout.pinned.includes(column.id)) continue;
    pinnedOffset.set(column.id, pinnedLeft);
    pinnedLeft += widthOf(column.id);
  }

  const span = colCount || 1;
  const tableWidth = columns.reduce((sum, column) => sum + widthOf(column.id), 0) + (trailing ? 112 : 0);

  return (
    <div className="list-scroll" ref={scrollRef} data-testid="sheet-grid" onKeyDown={onGridKey}>
      <table className="list-table" role="grid" aria-labelledby={labelledBy} aria-rowcount={rows.length + 1} aria-colcount={span} style={{ width: "100%", minWidth: tableWidth }}>
        <thead>
          <tr role="row">
            {columns.map((column) => {
              const active = layout.sort?.id === column.id;
              const pinned = layout.pinned.includes(column.id);
              const filtered = Boolean(layout.filters[column.id]);
              const width = widthOf(column.id);
              return (
                <th
                  key={column.id}
                  role="columnheader"
                  data-col={column.id}
                  data-pinned={pinned ? "true" : "false"}
                  className={`${pinned ? "is-pinned" : ""} ${dragOver === column.id ? "col-over" : ""} ${column.className || ""}`.trim()}
                  aria-sort={active ? (layout.sort?.desc ? "descending" : "ascending") : "none"}
                  style={{
                    width: `${width}px`,
                    minWidth: `${width}px`,
                    left: pinned ? pinnedOffset.get(column.id) : undefined,
                  }}
                >
                  <span className="col-head">
                    {headerExtra?.(column.id)}
                    <button
                      type="button"
                      className="sort-header col-grip"
                      aria-label={`Reorder ${column.label}`}
                      onPointerDown={(event) => onGripDown(event, column.id)}
                    >
                      <GripVertical aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="sort-header"
                      onClick={() => onLayout({ ...layout, sort: cycleSort(layout.sort, column.id), touched: true })}
                    >
                      {column.label}
                      {active ? (layout.sort?.desc ? " ↓" : " ↑") : ""}
                    </button>
                    <span className={`col-tools ${pinned || filtered ? "has-active" : ""}`}>
                      <button
                        type="button"
                        className="sort-header col-filter"
                        aria-label={`Filter ${column.label}`}
                        aria-expanded={menu === column.id}
                        onClick={() => setMenu((current) => (current === column.id ? null : column.id))}
                      >
                        <ListFilter aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sort-header col-pin"
                        aria-label={pinned ? `Unpin ${column.label}` : `Pin ${column.label}`}
                        aria-pressed={pinned}
                        onClick={() => {
                          const next = pinned ? layout.pinned.filter((item) => item !== column.id) : [...layout.pinned, column.id];
                          onLayout({ ...layout, pinned: next.length ? next : ["site"], touched: true });
                        }}
                      >
                        <Pin aria-hidden="true" />
                      </button>
                    </span>
                    <button
                      type="button"
                      className="sort-header col-resize"
                      aria-label={`Resize ${column.label}`}
                      onPointerDown={(event) => onResizeDown(event, column.id)}
                    />
                  </span>
                  {menu === column.id ? (
                    <div className="menu col-menu" role="group" aria-label={`${column.label} column`}>
                      <label>
                        <input
                          className="check"
                          type="checkbox"
                          checked={pinned}
                          onChange={() => {
                            const next = pinned ? layout.pinned.filter((item) => item !== column.id) : [...layout.pinned, column.id];
                            onLayout({ ...layout, pinned: next.length ? next : ["site"], touched: true });
                          }}
                        />
                        Pin left
                      </label>
                      {column.id === "site" ? null : (
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            onLayout({ ...layout, hidden: [...layout.hidden, column.id], pinned: layout.pinned.filter((item) => item !== column.id), touched: true });
                            setMenu(null);
                          }}
                        >
                          Hide
                        </button>
                      )}
                      <label>
                        Filter
                        <input
                          className="field"
                          type="text"
                          aria-label={`Filter ${column.label}`}
                          value={layout.filters[column.id] || ""}
                          onChange={(event) => {
                            const filters = { ...layout.filters };
                            const value = event.target.value;
                            if (value.trim()) filters[column.id] = value;
                            else delete filters[column.id];
                            onLayout({ ...layout, filters, touched: true });
                          }}
                        />
                      </label>
                      {filtered ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            const filters = { ...layout.filters };
                            delete filters[column.id];
                            onLayout({ ...layout, filters, touched: true });
                          }}
                        >
                          Clear filter
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </th>
              );
            })}
            {trailing ? <th aria-sort="none"><span className="sr">Map</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={span} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const id = rowId(row);
            return (
              <tr
                key={id}
                role="row"
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={id === selectedId ? "list-row on" : "list-row"}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("input, button, a")) return;
                  onOpen(id);
                }}
              >
                {columns.map((column, col) => {
                  const pinned = layout.pinned.includes(column.id);
                  const width = widthOf(column.id);
                  const focused = focus.row === item.index && focus.col === col;
                  const full = column.text(row).trim();
                  return (
                    <td
                      key={column.id}
                      role="gridcell"
                      data-cell={`${item.index}:${col}`}
                      data-col={column.id}
                      data-pinned={pinned ? "true" : "false"}
                      tabIndex={focused || (item.index === 0 && col === 0 && focus.row === 0 && focus.col === 0) ? 0 : -1}
                      className={`${pinned ? "is-pinned" : ""} ${focused ? "cell-focus" : ""} ${column.className || ""}`.trim()}
                      title={full && full !== "—" ? full : undefined}
                      style={{
                        width: `${width}px`,
                        minWidth: `${width}px`,
                        left: pinned ? pinnedOffset.get(column.id) : undefined,
                      }}
                      onFocus={() => setFocus({ row: item.index, col })}
                    >
                      {renderCell(row, column.id)}
                    </td>
                  );
                })}
                {trailing ? (
                  <td
                    role="gridcell"
                    data-cell={`${item.index}:${ids.length}`}
                    tabIndex={focus.row === item.index && focus.col === ids.length ? 0 : -1}
                    className={focus.row === item.index && focus.col === ids.length ? "cell-focus" : undefined}
                    onFocus={() => setFocus({ row: item.index, col: ids.length })}
                  >
                    {trailing(row)}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {padBottom > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={span} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
