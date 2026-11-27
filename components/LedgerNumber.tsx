"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type Unit = "money" | "percent" | "count" | "years";
type Scale = { base: number | null; fallback: number; factor?: number; negative?: boolean; limit?: number };
type Props = {
  label: string;
  caption?: string;
  value: number | null;
  unit: Unit;
  scale?: Scale;
  valid: (n: number) => boolean;
  onValue: (n: number) => void;
};

function format(n: number, unit: Unit, short = false) {
  const number = new Intl.NumberFormat("en-US", {
    style: unit === "money" ? "currency" : "decimal",
    currency: "USD",
    notation: short && Math.abs(n) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: short ? 1 : 2,
    minimumFractionDigits: 0,
  }).format(n);
  return number + (unit === "percent" ? "%" : unit === "years" ? " yr" : "");
}

function sliderRange(scale: Scale, value: number, unit: Unit) {
  const limit = scale.limit ?? 1e10;
  const magnitude = Math.min(limit, Math.abs(scale.base ?? 0) * (scale.factor ?? 2) || scale.fallback);
  const endpointUnit = unit === "money" ? Math.max(0.01, 10 ** Math.floor(Math.log10(magnitude)) / 2) : 1;
  const endpoint = Math.ceil(magnitude / endpointUnit) * endpointUnit;
  const max = Math.min(limit, Math.max(endpoint, value));
  const min = scale.negative ? Math.max(-limit, Math.min(-endpoint, value)) : 0;
  // Aim for fine currency increments at both small and multimillion-dollar sites.
  const currencyStep = Math.max(0.01, 10 ** Math.floor(Math.log10(magnitude / 50)));
  const step = unit === "money" ? currencyStep : unit === "percent" ? 0.1 : 1;
  return { min, max, step };
}

export function LedgerNumber({ label, caption, value, unit, scale, valid, onValue }: Props) {
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState("");
  const [activeRange, setActiveRange] = useState<ReturnType<typeof sliderRange> | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    } else if (restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  const parsed = entry.trim() === "" ? NaN : Number(entry);
  const invalid = !valid(parsed);
  function finish(commit: boolean, focus: boolean) {
    if (commit && !invalid && parsed !== value) onValue(parsed);
    restoreFocus.current = focus;
    setEditing(false);
  }

  const readout = value == null ? "Set value" : format(value, unit);
  const range = scale ? (activeRange ?? sliderRange(scale, value ?? 0, unit)) : null;
  return <div className={scale ? "ledger-adjuster" : "ledger-minor"}>
    {(caption || !scale) && <span className="ledger-caption">{caption ?? label}</span>}
    {range && <div className="ledger-track">
      <small>{format(range.min, unit, true)}</small>
      <input className="ledger-slider" type="range" aria-label={label} aria-valuetext={value == null ? "Unset. Choose a trial value." : readout} data-unset={value == null}
        min={range.min} max={range.max} step={range.step} value={value ?? 0}
        style={{ "--filled": (value == null ? 0 : (value - range.min) / (range.max - range.min) * 100) + "%" } as CSSProperties}
        onFocus={() => setActiveRange(range)} onBlur={() => setActiveRange(null)}
        onPointerUp={e => {
          if (value == null && valid(e.currentTarget.valueAsNumber)) onValue(e.currentTarget.valueAsNumber);
        }}
        onKeyDown={e => {
          if (value == null && e.key === "Home" && valid(range.min)) onValue(range.min);
        }}
        onChange={e => { const n = Number(e.target.value); if (valid(n)) onValue(n); }} />
      <small>{format(range.max, unit, true)}</small>
    </div>}
    {editing ? <span className="ledger-entry">
      <input className="field" aria-label={"Exact " + label} ref={field} type="number" step="any"
        value={entry} aria-invalid={invalid} onChange={e => setEntry(e.target.value)} onBlur={() => finish(true, false)}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
          if (e.key === "Enter") { e.preventDefault(); if (!invalid) finish(true, true); }
        }} />
      {invalid && <small role="status">Enter a valid {unit === "count" ? "whole number" : "value"}.</small>}
    </span> : <button type="button" className="text-link ledger-readout" aria-label={"Type exact " + label + " · " + readout}
      title={"Type exact " + label} ref={trigger} onClick={() => {
        setEntry(value == null ? "" : String(Number(value.toPrecision(14))));
        setEditing(true);
      }}>
      {readout}<span aria-hidden="true" className="ledger-edit-icon">✎</span>
    </button>}
  </div>;
}
