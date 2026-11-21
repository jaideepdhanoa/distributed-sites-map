"use client";

import { useEffect, useMemo, useState } from "react";
import { focusMode, focusYear, type CommentAnchor, type OpenPnlComment } from "@/lib/comments/anchor";
import type { DataConflict } from "@/lib/conflicts/view";
import { buildPnlGrid } from "@/lib/pnl/grid";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import CommentThread, { type ThreadNote } from "./comments/CommentThread";
import PnlBasis from "./PnlBasis";
import PnlGrid from "./PnlGrid";
import PnlPhone from "./PnlPhone";

export default function PnlOverlay({
  statement = emptyStatement(),
  initialGrain = null,
  conflicts = [],
  comments = [],
  siteId = "",
  focus = null,
  previewNotes,
  onClose,
  onChecklist,
}: {
  statement?: PnlStatement;
  initialGrain?: "annual" | "monthly" | null;
  conflicts?: DataConflict[];
  comments?: OpenPnlComment[];
  siteId?: string;
  focus?: { type: "pnl_cell" | "pnl_line"; line: string; period: string } | null;
  previewNotes?: ThreadNote[];
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
  const [thread, setThread] = useState<CommentAnchor | null>(null);
  const grid = useMemo(() => buildPnlGrid(shown, mode, year, conflicts, comments), [shown, mode, year, conflicts, comments]);
  const business = shown.years.find((item) => item.year === year)?.businessLabel || shown.years[0]?.businessLabel || "";

  const focusType = focus?.type || "";
  const focusLine = focus?.line || "";
  const focusPeriod = focus?.period || "";
  useEffect(() => {
    if (!focusType || !siteId) return;
    const nextYear = focusYear(focusPeriod);
    if (nextYear) setYear(nextYear);
    setMode(focusType === "pnl_line" ? "years" : focusMode(focusPeriod));
    setThread({
      type: focusType,
      siteId,
      line: focusLine,
      period: focusType === "pnl_line" ? "" : focusPeriod,
      spaceId: "",
      label: "",
    });
  }, [focusType, focusLine, focusPeriod, siteId]);

  function openThread(anchor: { type: "pnl_cell" | "pnl_line"; line: string; period: string }) {
    if (!siteId) return;
    setThread({ type: anchor.type, siteId, line: anchor.line, period: anchor.period, spaceId: "", label: "" });
  }

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
          <div className="pnl-desktop">
            <PnlGrid grid={grid} percent={percent} onComment={siteId ? openThread : undefined} focusLine={focus?.line} focusPeriod={focus?.type === "pnl_line" ? "" : focus?.period} />
          </div>
          <PnlPhone statement={shown} conflicts={conflicts} comments={comments} onComment={siteId ? openThread : undefined} />
        </>
      )}
      {thread ? (
        <CommentThread siteId={thread.siteId} anchor={thread} notes={previewNotes} variant="sheet" source="Financials" preview={Boolean(previewNotes)} onClose={() => setThread(null)} />
      ) : null}
    </section>
  );
}
