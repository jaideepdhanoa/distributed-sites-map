"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { financialsCard } from "@/lib/pnl/cue";
import { emptyStatement, type PnlStatement } from "@/lib/pnl/statement";
import PnlOverlay from "./PnlOverlay";

function readStatement(value: unknown): PnlStatement {
  if (!value || typeof value !== "object") return emptyStatement();
  const row = value as PnlStatement;
  if (row.status === "empty" || row.status === "unavailable" || row.status === "ready") return row;
  return emptyStatement();
}

export default function FinancialsEntry({ dealId, packageOnFile = false }: { dealId: string; packageOnFile?: boolean }) {
  const [statement, setStatement] = useState<PnlStatement | null>(null);
  const [sample, setSample] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancel = false;
    setStatement(null);
    setOpen(false);
    fetch(`/api/data/financials/${encodeURIComponent(dealId)}`)
      .then(async (response) => (response.ok ? await response.json() as { pnl?: unknown; pnlDemo?: boolean } : null))
      .then((body) => {
        if (cancel) return;
        setStatement(readStatement(body?.pnl));
        setSample(Boolean(body?.pnlDemo));
      })
      .catch(() => {
        if (!cancel) setStatement(emptyStatement());
      });
    return () => {
      cancel = true;
    };
  }, [dealId]);
  const card = statement ? financialsCard(statement, sample) : null;
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
      {open && card ? createPortal(<PnlOverlay statement={statement ?? emptyStatement()} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
