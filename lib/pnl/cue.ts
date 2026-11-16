import { NOT_IN_PACKAGE } from "../keyNumbers";
import { buildPnlGrid } from "./grid";
import type { PnlStatement, PnlYearView } from "./statement";
import { windowCoverage } from "./window";

export { packageOnFile } from "./package.ts";

export type FinancialsCard = {
  revenue: string;
  cash: string;
  cashLabel: "SDE" | "EBITDA";
  margin: string;
  coverage: string;
};

function amount(statement: PnlStatement, mode: "months" | "years", year: number, columnId: string, id: string): string {
  const grid = buildPnlGrid(statement, mode, mode === "months" ? year : undefined);
  const index = grid.columns.findIndex((column) => column.id === columnId);
  if (index < 0) return "";
  const cell = grid.rows.find((row) => row.id === id)?.cells[index];
  return cell?.kind === "value" ? cell.amount : "";
}

function shownYear(statement: PnlStatement): PnlYearView | null {
  return statement.years.find((year) => year.annual || year.ranges?.length || year.months.some(Boolean) || year.missingMonths?.length) ?? null;
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
 * Figures from the same column the sheet shows for this period.
 * A full year uses that statement. A partial uses the year-to-date sum of
 * its months, which leaves missing months out. A stored range statement is
 * used only when that window has no monthly lines.
 */
export function financialsCard(statement: PnlStatement, sample = false): FinancialsCard | null {
  if (statement.status !== "ready" || !statement.years.length) return null;
  const year = shownYear(statement);
  if (!year) return null;
  const statementColumn = Boolean(year.annual);
  const mode = statementColumn ? "years" : "months";
  const columnId = statementColumn ? year.annual!.id : "ytd";
  const read = (id: string) => amount(statement, mode, year.year, columnId, id);
  const sde = read("sde");
  const ebitda = read("ebitda");
  const periodLabel = statementColumn
    ? `${calendarYearLabel(year.annual!)} · ${year.months.filter(Boolean).length} of 12 months`
    : (year.months.some(Boolean) || year.missingMonths?.length ? windowCoverage(year) : year.ranges?.[0]?.columnLabel) || `FY${year.year}`;
  const coverage = `${periodLabel}${sample ? " · Sample package" : ""}`;
  return {
    revenue: read("total-revenue") || "—",
    cash: sde || ebitda || "—",
    cashLabel: sde ? "SDE" : "EBITDA",
    margin: (sde ? read("sde-margin") : "") || read("margin") || "—",
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
