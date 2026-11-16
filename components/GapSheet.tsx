"use client";

import { financialsCard } from "@/lib/pnl/cue";
import { gapStatement } from "@/lib/pnl/fixture";
import { buildPnlGrid } from "@/lib/pnl/grid";
import PnlGrid from "./PnlGrid";

const statement = gapStatement();

/** Card and 2026 sheet for the missing-month fixture. Figures are samples. */
export default function GapSheet() {
  const card = financialsCard(statement);
  const grid = buildPnlGrid(statement, "months", 2026);
  return (
    <main className="gap-sheet" data-testid="gap-sheet">
      <p className="eyebrow">PIPE-MIA-0080 shape · sample figures</p>
      {card ? (
        <article className="fin-entry" data-testid="gap-card">
          <span>Financials</span>
          <strong>{card.revenue} revenue</strong>
          <small>{card.cashLabel} {card.cash} · {card.margin} margin</small>
          <small>{card.coverage}</small>
        </article>
      ) : null}
      <PnlGrid grid={grid} percent={false} />
    </main>
  );
}
