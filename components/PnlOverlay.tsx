"use client";

import { useEffect, useMemo, useState } from "react";
import type { DataConflict } from "@/lib/conflicts/view";
import { buildPnlGrid } from "@/lib/pnl/grid";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlBasis from "./PnlBasis";
import PnlGrid from "./PnlGrid";
import PnlPhone from "./PnlPhone";

export default function PnlOverlay({
  statement = emptyStatement(),
  initialGrain = null,
  conflicts = [],
  onClose,
  onChecklist,
}: {
  statement?: PnlStatement;
  initialGrain?: "annual" | "monthly" | null;
  conflicts?: DataConflict[];
  onClose: () => void;
  onChecklist?: () => void;
}) {
  const [mode, setMode] = useState<"months" | "years">(initialGrain === "annual" ? "years" : "months");
  const [percent, setPercent] = useState(false);
  const [basis, setBasis] = useState<"stated" | "normalized">("stated");
  const shown: PnlStatement = basis === "normalized"
    ? { ...statement, years: statement.normalizedYears ?? [] }
    : statement;
  const years = shown.years.map((item) => item.year);
  useEffect(() => {
    if (initialGrain === "annual") setMode("years");
    if (initialGrain === "monthly") setMode("months");
  }, [initialGrain]);
  const [year, setYear] = useState(years[0] || 0);
  const grid = useMemo(() => buildPnlGrid(shown, mode, year, conflicts), [shown, mode, year, conflicts]);
  const business = shown.years.find((item) => item.year === year)?.businessLabel || shown.years[0]?.businessLabel || "";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="pnl-overlay" role="dialog" aria-modal="true" aria-label="Profit and loss" data-testid="pnl-overlay">
      <header className="pnl-bar">
        <div>
          <p className="eyebrow">Profit and loss</p>
          <strong>{business}</strong>
        </div>
        <div className="pnl-desktop-controls">
          <div className="segmented" role="group" aria-label="Columns">
            <button type="button" className={mode === "months" ? "segmented on" : "segmented"} onClick={() => setMode("months")}>Months</button>
            <button type="button" className={mode === "years" ? "segmented on" : "segmented"} onClick={() => setMode("years")}>Years</button>
          </div>
          <div className="segmented" role="group" aria-label="Figures">
            <button type="button" className={percent ? "segmented" : "segmented on"} onClick={() => setPercent(false)}>Dollars</button>
            <button type="button" className={percent ? "segmented on" : "segmented"} onClick={() => setPercent(true)}>% of revenue</button>
          </div>
          {statement.hasNormalized ? <PnlBasis basis={basis} onChange={setBasis} /> : null}
          {mode === "months" && years.length > 1 ? (
            <select className="secondary" aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((item) => {
                const label = shown.years.find((view) => view.year === item)?.columnLabel || String(item);
                return <option key={item} value={item}>{label}</option>;
              })}
            </select>
          ) : null}
        </div>
        {onChecklist ? <button type="button" className="text-link" onClick={onChecklist}>Package checklist</button> : null}
        <button type="button" className="close" data-overlay-dismiss="true" aria-label="Close profit and loss" onClick={onClose}><span aria-hidden="true">×</span></button>
      </header>
      {statement.status !== "ready" ? <p className="pnl-empty" data-testid="pnl-empty">{statement.message}</p> : (
        <>
          <div className="pnl-desktop"><PnlGrid grid={grid} percent={percent} /></div>
          <PnlPhone statement={shown} conflicts={conflicts} />
        </>
      )}
    </section>
  );
}
