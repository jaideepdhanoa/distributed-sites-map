"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commentList, type OpenPnlComment } from "@/lib/comments/anchor";
import { COMMENT_CHANGED } from "@/lib/comments/nav";
import { conflictList, type DataConflict } from "@/lib/conflicts/view";
import { financialsCard, shownYear, statementTiles, type StatementTile } from "@/lib/pnl/cue";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlOverlay from "./PnlOverlay";

export type PnlTiles = { revenue: StatementTile; cash: StatementTile };

function readStatement(value: unknown): PnlStatement {
  if (!value || typeof value !== "object") return emptyStatement();
  const row = value as PnlStatement;
  if (row.status === "empty" || row.status === "unavailable" || row.status === "ready") return row;
  return emptyStatement();
}

export function PendingFigure({ lines = 2 }: { lines?: number }) {
  const notes = Math.max(0, lines - 1);
  return (
    <>
      <strong className="figure-hold" data-testid="figure-loading" aria-busy="true" aria-label="Loading figures">
        <span className="skeleton" />
      </strong>
      {Array.from({ length: notes }, (_, index) => (
        <small key={index} className="figure-hold" aria-hidden="true"><span className="skeleton" /></small>
      ))}
    </>
  );
}

export function usePnlTiles(dealId: string) {
  const [statement, setStatement] = useState<PnlStatement | null>(null);
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [comments, setComments] = useState<OpenPnlComment[]>([]);
  const [sample, setSample] = useState(false);
  const [settled, setSettled] = useState(!dealId);
  const [loadedFor, setLoadedFor] = useState(dealId);
  const [commentTick, setCommentTick] = useState(0);
  useEffect(() => {
    const refresh = () => setCommentTick((value) => value + 1);
    window.addEventListener(COMMENT_CHANGED, refresh);
    return () => window.removeEventListener(COMMENT_CHANGED, refresh);
  }, []);
  if (loadedFor !== dealId) {
    setLoadedFor(dealId);
    setStatement(null);
    setSample(false);
    setSettled(!dealId);
  }
  useEffect(() => {
    if (!dealId) {
      setStatement(null);
      setConflicts([]);
      setComments([]);
      setSample(false);
      setSettled(true);
      return undefined;
    }
    let cancel = false;
    if (commentTick === 0) {
      setStatement(null);
      setConflicts([]);
      setComments([]);
      setSample(false);
      setSettled(false);
    }
    fetch(`/api/data/financials/${encodeURIComponent(dealId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { pnl?: unknown; pnlDemo?: boolean; conflicts?: unknown; comments?: unknown } : null))
      .then((body) => {
        if (cancel) return;
        setStatement(readStatement(body?.pnl));
        setConflicts(conflictList(body?.conflicts));
        setComments(commentList(body?.comments));
        setSample(Boolean(body?.pnlDemo));
      })
      .catch(() => {
        if (!cancel) setStatement(emptyStatement());
      })
      .finally(() => {
        if (!cancel) setSettled(true);
      });
    return () => {
      cancel = true;
    };
  }, [dealId, commentTick]);
  return { statement, conflicts, comments, sample, settled, tiles: statement ? statementTiles(statement, sample) : null };
}

export default function FinancialsEntry({
  dealId,
  packageOnFile = false,
  compact = false,
  loaded,
}: {
  dealId: string;
  packageOnFile?: boolean;
  compact?: boolean | "link";
  loaded?: { statement: PnlStatement | null; sample: boolean; settled: boolean; conflicts?: DataConflict[]; comments?: OpenPnlComment[] };
}) {
  const own = usePnlTiles(loaded ? "" : dealId);
  const statement = loaded ? loaded.statement : own.statement;
  const conflicts = loaded ? loaded.conflicts ?? [] : own.conflicts;
  const comments = loaded ? loaded.comments ?? [] : own.comments;
  const sample = loaded ? loaded.sample : own.sample;
  const settled = loaded ? loaded.settled : own.settled;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [dealId]);
  const card = settled && statement ? financialsCard(statement, sample) : null;
  const year = statement && card ? shownYear(statement) : null;
  const [selectedLine,setSelectedLine] = useState("");
  if (!settled && compact) return <small role="status">Checking for financials…</small>;
  if (!settled) {
    return (
      <article className="fin-entry" data-testid="financials-loading" aria-busy="true">
        <div className="fin-tile">
          <span>Financials</span>
          <PendingFigure lines={3} />
          <span className="fin-open is-hold" aria-hidden="true">Open P&L <span aria-hidden="true">→</span></span>
        </div>
      </article>
    );
  }
  return (
    <>
      {compact ? (card ? <button type="button" className={compact === "link" ? "text-link statement-link" : "primary preview-open"} onClick={event => {trigger.current = event.currentTarget;setOpen(true);}}>Review financials</button> : <small>Financial statement unavailable.</small>) : card ? (
        <article className="fin-entry">
          <button type="button" className="fin-tile" data-testid="financials-entry" onClick={event => {trigger.current = event.currentTarget;setOpen(true);}}>
            <span>Financials · stated figures</span>
            <small>{card.coverage}</small>
            <strong>{card.revenue} revenue</strong>
            <small>{card.cashLabel} {card.cash} · {card.margin} margin</small>
            <span className="fin-open">Open P&L <span aria-hidden="true">→</span></span>
          </button>
          {year && <div className="statement-evidence">
            <small>Monthly statements · {year.year}</small>
            <div className="month-coverage">{Array.from({length:12},(_,i) => {
              const month = new Date(Date.UTC(year.year,i,1)).toLocaleString("en-US",{month:"short",timeZone:"UTC"});
              const label = month + (year.months[i] ? " on file" : " not on file");
              return <abbr key={month} title={label} aria-label={label} data-present={Boolean(year.months[i])}>{month}</abbr>;
            })}</div>
            {[["total-revenue","Revenue"],[card.cashLabel.toLowerCase(),card.cashLabel]].map(([line,label]) =>
              <button className="text-link" type="button" key={line} onClick={event => {trigger.current = event.currentTarget;setSelectedLine(line);setOpen(true);}}>View {label} line</button>)}
          </div>}
        </article>
      ) : packageOnFile ? (
        <p className="fin-quiet" data-testid="financials-quiet">Financials: package not yet broken into line items</p>
      ) : null}
      {open && card ? createPortal(<PnlOverlay initialGrain={selectedLine ? card.grain : null} selection={selectedLine ? {line:selectedLine,period:card.period,year:card.year} : undefined} statement={statement ?? emptyStatement()} conflicts={conflicts} comments={comments} siteId={dealId} onClose={() => { setOpen(false); setSelectedLine(""); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }} />, document.body) : null}
    </>
  );
}
