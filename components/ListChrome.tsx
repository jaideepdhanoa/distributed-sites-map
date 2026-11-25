"use client";

import { useId, useState, type ReactNode } from "react";

export function ShortlistSummary({ title, count, commonStage, children }: {
  title: string;
  count: number;
  commonStage: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const figuresId = useId();
  const showStage = commonStage && !title.toLowerCase().endsWith(" · " + commonStage.toLowerCase());
  return (
    <section className="summary-row shortlist-summary" data-testid="summary-row" aria-label={`${title}, ${count} sites, shortlist figures`}>
      <div className="shortlist-title"><h2>{title.split(" · ")[0]} shortlist</h2><p>{count.toLocaleString()} {count === 1 ? "site" : "sites"} · {title.split(" · ").slice(1).join(" · ") || commonStage}</p>{showStage && <span className="shortlist-stage">{commonStage}</span>}</div>
      <button className="paper-btn figures-toggle" type="button" aria-expanded={expanded} aria-controls={figuresId} onClick={() => setExpanded(value => !value)}>Figures</button>
      <div className="shortlist-figures" id={figuresId} data-expanded={expanded}>{children}</div>
    </section>
  );
}

export function EmptyShortlist({ clearFilters, clearArea }: { clearFilters?: () => void; clearArea?: () => void }) {
  return <p role="status" className="note empty-filter" data-testid="empty-filter">
    {clearFilters ? <>No sites match these column filters. <button type="button" className="text-link" onClick={clearFilters}>Clear column filters</button></>
      : clearArea ? <>No matching sites in this map area. <button type="button" className="text-link" onClick={clearArea}>Clear map area</button></>
      : "No sites match this shortlist. Choose another market or stage."}
  </p>;
}

export function sharedStage(labels: string[]) {
  const first = labels[0];
  return labels.length > 1 && labels.every(label => label === first) ? first : "";
}

export function ColumnPicker({
  resetLabel,
  columns,
  hidden,
  onPreset,
  onToggle,
  onReset,
}: {
  resetLabel: string;
  columns: { id: string; label: string }[];
  hidden: string[];
  onPreset?: () => void;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col-picker only-desktop">
      <button type="button" className="paper-btn" aria-expanded={open} data-testid="columns-button" onClick={() => setOpen((value) => !value)}>Columns</button>
      {open ? (
        <div className="menu" role="group" aria-label="Columns">
          <button type="button" className="text-link" onClick={() => { onReset(); setOpen(false); }}>{resetLabel}</button>
          {onPreset && <button type="button" className="text-link" onClick={() => { onPreset(); setOpen(false); }}>Financial screen columns</button>}
          {columns.map((column) => (
            <label key={column.id}>
              <input className="check" type="checkbox" checked={!hidden.includes(column.id)} disabled={column.id === "site"} onChange={() => onToggle(column.id)} />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SortControl({
  columns,
  sort,
  onChange,
}: {
  columns: { id: string; label: string }[];
  sort: { id: string; desc: boolean };
  onChange: (id: string, desc: boolean) => void;
}) {
  return (
    <div className="list-sort" data-testid="sort-control">
      <label>
        Sort by
        <select className="secondary" aria-label="Sort by" data-testid="sort-by" value={sort.id} onChange={(event) => onChange(event.target.value, sort.desc)}>
          {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
        </select>
      </label>
      <button type="button" className="chip" data-testid="sort-direction" onClick={() => onChange(sort.id, !sort.desc)}>
        {sort.desc ? "Desc" : "Asc"}
      </button>
    </div>
  );
}

export function RowCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="row-check">
      <input className="check" type="checkbox" aria-label={label} checked={checked} onChange={onChange} />
    </label>
  );
}
