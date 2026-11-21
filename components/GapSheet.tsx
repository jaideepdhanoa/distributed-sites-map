"use client";

import { financialsCard } from "@/lib/pnl/cue";
import { measuredStatement } from "@/lib/pnl/fixture";
import { buildPnlGrid } from "@/lib/pnl/grid";
import PnlGrid from "./PnlGrid";

const statement = measuredStatement();

function sourceLine(year: number, index: number): string {
  const cell = buildPnlGrid(statement, "months", year).rows.find((row) => row.id === "total-revenue")?.cells[index];
  if (cell?.kind !== "missing") return "";
  return [cell.sourceDocument, cell.sourcePage].filter(Boolean).join(" · ");
}

/** Card and both sheets for the measured missing-month statement. Figures are samples. */
export default function GapSheet() {
  const card = financialsCard(statement);
  const grid2026 = buildPnlGrid(statement, "months", 2026);
  const grid2025 = buildPnlGrid(statement, "months", 2025);
  const maySource = sourceLine(2026, 4);
  const aprilSource = sourceLine(2025, 3);
  return (
    <main className="gap-sheet" data-testid="gap-sheet">
      <p className="eyebrow">Measured statement · sample figures</p>
      {card ? (
        <article className="fin-entry" data-testid="gap-card">
          <span>Financials</span>
          <strong>{card.revenue} revenue</strong>
          <small>{card.cashLabel} {card.cash} · {card.margin} margin</small>
          <small>{card.coverage}</small>
        </article>
      ) : null}
      <div className="pnl-pop" data-testid="pnl-popover" style={{ position: "static", margin: "12px 0" }}>
        <strong>Total revenue · May 2026</strong>
        <div data-testid="pnl-missing-source">
          <p>Missing</p>
          <p>{maySource}</p>
        </div>
      </div>
      <h2>2026</h2>
      <PnlGrid grid={grid2026} percent={false} />
      <h2>2025</h2>
      <div className="pnl-pop" style={{ position: "static", margin: "12px 0" }}>
        <strong>Total revenue · Apr 2025</strong>
        <p>Missing</p>
        <p>{aprilSource}</p>
      </div>
      <PnlGrid grid={grid2025} percent={false} />
    </main>
  );
}
