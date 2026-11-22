"use client";

import { useState } from "react";

export function ColumnPicker({
  resetLabel,
  columns,
  hidden,
  onToggle,
  onReset,
}: {
  resetLabel: string;
  columns: { id: string; label: string }[];
  hidden: string[];
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

export function RowCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="row-check">
      <input className="check" type="checkbox" aria-label={label} checked={checked} onChange={onChange} />
    </label>
  );
}
