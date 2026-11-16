"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { conflictList, type DataConflict } from "@/lib/conflicts/view";
import { financialsCard, statementTiles, type StatementTile } from "@/lib/pnl/cue";
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
  const [sample, setSample] = useState(false);
  const [settled, setSettled] = useState(!dealId);
  const [loadedFor, setLoadedFor] = useState(dealId);
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
      setSample(false);
      setSettled(true);
      return undefined;
    }
    let cancel = false;
    setStatement(null);
    setConflicts([]);
    setSample(false);
    setSettled(false);
    fetch(`/api/data/financials/${encodeURIComponent(dealId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { pnl?: unknown; pnlDemo?: boolean; conflicts?: unknown } : null))
      .then((body) => {
        if (cancel) return;
        setStatement(readStatement(body?.pnl));
        setConflicts(conflictList(body?.conflicts));
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
  }, [dealId]);
  return { statement, conflicts, sample, settled, tiles: statement ? statementTiles(statement, sample) : null };
}

export default function FinancialsEntry({
  dealId,
  packageOnFile = false,
  loaded,
}: {
  dealId: string;
  packageOnFile?: boolean;
  loaded?: { statement: PnlStatement | null; sample: boolean; settled: boolean; conflicts?: DataConflict[] };
}) {
  const own = usePnlTiles(loaded ? "" : dealId);
  const statement = loaded ? loaded.statement : own.statement;
  const conflicts = loaded ? loaded.conflicts ?? [] : own.conflicts;
  const sample = loaded ? loaded.sample : own.sample;
  const settled = loaded ? loaded.settled : own.settled;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [dealId]);
  const card = settled && statement ? financialsCard(statement, sample) : null;
  if (!settled) {
    return (
      <article className="fin-entry" data-testid="financials-loading" aria-busy="true">
        <div className="fin-tile">
          <span>Financials</span>
          <PendingFigure lines={3} />
        </div>
      </article>
    );
  }
  return (
    <>
      {card ? (
        <article className="fin-entry">
          <button type="button" className="fin-tile" data-testid="financials-entry" onClick={() => setOpen(true)}>
            <span>Financials</span>
            <strong>{card.revenue} revenue</strong>
            <small>{card.cashLabel} {card.cash} · {card.margin} margin</small>
            <small>{card.coverage}</small>
          </button>
        </article>
      ) : packageOnFile ? (
        <p className="fin-quiet" data-testid="financials-quiet">Financials: package not yet broken into line items</p>
      ) : null}
      {open && card ? createPortal(<PnlOverlay statement={statement ?? emptyStatement()} conflicts={conflicts} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
