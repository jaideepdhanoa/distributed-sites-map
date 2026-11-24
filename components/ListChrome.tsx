"use client";

import { useState } from "react";

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
