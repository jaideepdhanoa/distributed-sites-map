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

function amount(statement: PnlStatement, year: number, id: string): string {
  const grid = buildPnlGrid(statement, "years");
  const index = statement.years.findIndex((item) => item.year === year);
  const cell = grid.rows.find((row) => row.id === id)?.cells[index];
  return cell?.kind === "value" ? cell.amount : "";
}

/** Compact figures for the latest full year, plus coverage across every captured year. */
export function financialsCard(statement: PnlStatement, sample = false): FinancialsCard | null {
  if (statement.status !== "ready" || !statement.years.length) return null;
  const full = statement.years.find((year) => year.annual) ?? statement.years[0];
  const sde = amount(statement, full.year, "sde");
  const ebitda = amount(statement, full.year, "ebitda");
  const years = statement.years.map((year) => year.year).sort((a, b) => a - b);
  const span = years.length === 1 ? `FY${years[0]}` : `FY${years[0]}–${years[years.length - 1]}`;
  const months = statement.years.reduce((sum, year) => sum + year.months.filter(Boolean).length, 0);
  const coverage = `${span} · ${months} of ${statement.years.length * 12} months${sample ? " · Sample package" : ""}`;
  return {
    revenue: amount(statement, full.year, "total-revenue") || "—",
    cash: sde || ebitda || "—",
    cashLabel: sde ? "SDE" : "EBITDA",
    margin: (sde ? amount(statement, full.year, "sde-margin") : "") || amount(statement, full.year, "margin") || "—",
    coverage,
  };
}
