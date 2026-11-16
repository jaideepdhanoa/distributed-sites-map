import { NOT_IN_PACKAGE } from "../keyNumbers";
import { buildPnlGrid } from "./grid";
import type { PnlStatement } from "./statement";

export { packageOnFile } from "./package.ts";

export type FinancialsCard = {
  revenue: string;
  cash: string;
  cashLabel: "SDE" | "EBITDA";
  margin: string;
  coverage: string;
};

function amount(statement: PnlStatement, columnId: string, id: string): string {
  const grid = buildPnlGrid(statement, "years");
  const index = grid.columns.findIndex((column) => column.id === columnId);
  if (index < 0) return "";
  const cell = grid.rows.find((row) => row.id === id)?.cells[index];
  return cell?.kind === "value" ? cell.amount : "";
}

function calendarYearLabel(period: { year: number; columnLabel: string; periodStart: string; periodEnd: string }): string {
  const startYear = period.periodStart.slice(0, 4);
  if (
    startYear === String(period.year)
    && period.periodEnd.slice(0, 4) === startYear
    && period.periodStart.endsWith("-01-01")
    && period.periodEnd.endsWith("-12-31")
  ) {
    return `FY${period.year}`;
  }
  return period.columnLabel || `FY${period.year}`;
}

/**
 * The newest captured period. A full year on that year wins over an earlier
 * partial of the same year. An older full year is not summed in, and the
 * label names this period rather than a span across years.
 */
function cardPeriod(statement: PnlStatement): { columnId: string; label: string; months: number } | null {
  for (const year of statement.years) {
    const months = year.months.filter(Boolean).length;
    if (year.annual) return { columnId: year.annual.id, label: calendarYearLabel(year.annual), months };
    const ranges = [...(year.ranges ?? [])].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
    if (ranges[0]) return { columnId: ranges[0].id, label: ranges[0].columnLabel, months };
    if (months) {
      const label = year.columnLabel && year.columnLabel !== String(year.year) ? year.columnLabel : `FY${year.year}`;
      return { columnId: `year-${year.year}`, label, months };
    }
  }
  return null;
}

/** Compact figures for the latest period, labeled as that period. */
export function financialsCard(statement: PnlStatement, sample = false): FinancialsCard | null {
  if (statement.status !== "ready" || !statement.years.length) return null;
  const period = cardPeriod(statement);
  if (!period) return null;
  const sde = amount(statement, period.columnId, "sde");
  const ebitda = amount(statement, period.columnId, "ebitda");
  const coverage = `${period.label} · ${period.months} of 12 months${sample ? " · Sample package" : ""}`;
  return {
    revenue: amount(statement, period.columnId, "total-revenue") || "—",
    cash: sde || ebitda || "—",
    cashLabel: sde ? "SDE" : "EBITDA",
    margin: (sde ? amount(statement, period.columnId, "sde-margin") : "") || amount(statement, period.columnId, "margin") || "—",
    coverage,
  };
}

export type StatementTile = { text: string; title: string; note: string };

/** Overview tiles for a captured statement. The same figures and period as the Financials card. */
export function statementTiles(statement: PnlStatement, sample = false): { revenue: StatementTile; cash: StatementTile } | null {
  const card = financialsCard(statement, sample);
  if (!card) return null;
  const missing = (): StatementTile => ({ text: NOT_IN_PACKAGE, title: NOT_IN_PACKAGE, note: "" });
  return {
    revenue: card.revenue === "—" ? missing() : { text: card.revenue, title: card.revenue, note: card.coverage },
    cash: card.cash === "—" ? missing() : { text: card.cash, title: `${card.cashLabel} ${card.cash}`, note: `${card.cashLabel} · ${card.coverage}` },
  };
}
