"use client";

import { useEffect, useMemo, useState } from "react";
import { buildPnlGrid } from "@/lib/pnl/grid";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlGrid from "./PnlGrid";
import PnlPhone from "./PnlPhone";

export default function PnlOverlay({
  statement = emptyStatement(),
  onClose,
  onChecklist,
}: {
  statement?: PnlStatement;
  onClose: () => void;
  onChecklist?: () => void;
}) {
  const [mode, setMode] = useState<"months" | "years">("months");
  const [percent, setPercent] = useState(false);
  const years = statement.years.map((item) => item.year);
  const [year, setYear] = useState(years[0] || 0);
  const grid = useMemo(() => buildPnlGrid(statement, mode, year), [statement, mode, year]);
  const business = statement.years.find((item) => item.year === year)?.businessLabel || statement.years[0]?.businessLabel || "";

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
          {mode === "months" && years.length > 1 ? (
            <select className="secondary" aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : null}
        </div>
        {onChecklist ? <button type="button" className="text-link" onClick={onChecklist}>Package checklist</button> : null}
        <button type="button" className="close" aria-label="Close profit and loss" onClick={onClose}><span aria-hidden="true">×</span></button>
      </header>
      {statement.status !== "ready" ? <p className="pnl-empty" data-testid="pnl-empty">{statement.message}</p> : (
        <>
          <div className="pnl-desktop"><PnlGrid grid={grid} percent={percent} /></div>
          <PnlPhone statement={statement} />
        </>
      )}
    </section>
  );
}
