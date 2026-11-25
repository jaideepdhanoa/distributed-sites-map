import { buildPnlGrid, columnPeriodKey } from "./grid";
import { financialsCard } from "./cue";
import { monthWindow } from "./window";
import type { PnlStatement, PnlYearView } from "./statement";

export const statementLines = {
  statement_revenue: "total-revenue", statement_sde: "sde", statement_ebitda: "ebitda",
} as const;
export type StatementMeasure = keyof typeof statementLines;
export const statementMeasures = Object.keys(statementLines) as StatementMeasure[];
export function isStatementMeasure(value: string): value is StatementMeasure {
  return Object.hasOwn(statementLines, value);
}

/** Rebuild the cited window even after a new month or annual package becomes available. */
export function citedWindow(statement: PnlStatement, anchor: string): PnlStatement | null {
  if (!anchor) return statement;
  const [rawYear,grain,period] = anchor.split("|");
  const year = statement.years.find(row => row.year === Number(rawYear));
  if (!year) return null;
  function select(row:PnlYearView): PnlYearView | null {
    if (grain === "annual") {
      const annual = [row.annual,...row.ranges].find(p => p?.id === period);
      return annual ? {...row,annual} : null;
    }
    const bounds = /^(\d{1,2})-(\d{1,2})$/.exec(period || "");
    if (grain !== "monthly" || !bounds) return null;
    const start = Number(bounds[1]), end = Number(bounds[2]);
    if (start < 1 || end > 12 || start > end) return null;
    const inside = (month:number) => month >= start && month <= end;
    return {...row,annual:null,months:row.months.map((p,i)=>inside(i+1) ? p : null),
      ranges:row.ranges.filter(p=>(p.startMonth || 1) === start && p.throughMonth === end),
      missingMonths:row.missingMonths.filter(inside),missingDetails:row.missingDetails.filter(d=>inside(d.month))};
  }
  const scoped = select(year);
  if (!scoped) return null;
  const normalized = statement.normalizedYears.filter(r => r.year === year.year).flatMap(r => select(r) || []);
  return {...statement,years:[scoped],normalizedYears:normalized,hasNormalized:normalized.length>0};
}

export function statementFigures(statement: PnlStatement, sample: boolean, anchor = "") {
  const scoped = citedWindow(statement,anchor);
  if (!scoped) return [];
  const card = financialsCard(scoped,sample);
  if (!card) return [];
  const {year,grain,coverage:period} = card;
  const row = scoped.years.find(item => item.year === year)!;
  const window = monthWindow(row);
  const key = [year,grain,row.annual?.id || (window && window.start + "-" + window.end)].join("|");
  if (anchor && anchor !== key) return [];
  const grid = buildPnlGrid(scoped, grain === "annual" ? "years" : "months", year);
  const index = grid.columns.findIndex(col => col.id === (row.annual?.id || "ytd"));
  if (index < 0) return [];
  const column = grid.columns[index];
  return statementMeasures.map(measure => {
    const line = statementLines[measure];
    const cell = grid.rows.find(row => row.id === line)?.cells[index];
    const recorded = cell?.kind === "value" ? cell : undefined;
    // A year-to-date total has its own formula. Keep the documents behind its monthly cells.
    const monthlySources = grain === "monthly" && recorded?.status === "calculated"
      ? grid.rows.find(r => r.id === line)?.cells.slice(0,12).flatMap((c,i) =>
          c.kind === "value" && c.sourceDocument && (!window || (i+1 >= window.start && i+1 <= window.end))
            ? [[c.sourceDocument,c.sourcePage].filter(Boolean).join(" · ")] : []) || []
      : [];
    const sources = [...new Set(monthlySources)];
    const source = sources.length ? sources.slice(0,3).join(" / ") + (sources.length > 3 ? " +" + (sources.length-3) + " more" : "")
      : [recorded?.sourceDocument,recorded?.sourcePage].filter(Boolean).join(" · ") || "Financial statement";
    return { measure, anchor:key, period, value:recorded?.amount || "—",
      basis:recorded?.status || "Financial statement",
      source,
      selection:{ year, grain, period:columnPeriodKey(column), line } };
  });
}
