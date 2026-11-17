import { shortHash } from "@/lib/changes/site";
import { POWER_RATINGS, formatPowerPoints, powerPoints, type PowerRatingName } from "./power-rating";

export { POWER_SHARE, POWER_WEIGHT, formatPowerPoints, powerPoints, powerPointsLabel } from "./power-rating";

export const DERIVED_POWER_HEADER = "Power rating (derived)";
export const POWER_POINTS_HEADER = "Power points";
export const POWER_FORMULA_CONFIRM = "power-points-derived";
export const POWER_HEADER_ROW = 4;
export const POWER_PROTECTED_ROW = 10;
export const POWER_PROTECTED_SITE_ID = "PIPE-PHX-0006";

const SHARE_RANGE = "Assumptions!$A$88:$B$98";

/** The Power points formula. It finds the derived rating by header name. A blank rating stays Unknown. */
export function powerPointsFormula(row: number): string {
  const header = `$${POWER_HEADER_ROW}:$${POWER_HEADER_ROW}`;
  const cell = `INDEX(${row}:${row},MATCH("${DERIVED_POWER_HEADER}",${header},0))`;
  const key = `IF(${cell}="","Unknown",${cell})`;
  return `=IF($A${row}="","",Assumptions!$B$79*IFERROR(VLOOKUP(${key},${SHARE_RANGE},2,FALSE),VLOOKUP("Unknown",${SHARE_RANGE},2,FALSE)))`;
}

export function isLegacyUnknownPowerFormula(formula: string): boolean {
  const compact = formula.replace(/\s+/g, "");
  const share = SHARE_RANGE.replace(/\s+/g, "");
  return compact.includes(`VLOOKUP("Unknown",${share},2,FALSE)`) && !formula.includes(DERIVED_POWER_HEADER);
}

export type FormulaColumn = {
  title: string;
  headers: string[];
  /** Power points formula by sheet row number. */
  formulas: { row: number; formula: string }[];
};

export type FormulaWrite = {
  sheet: string;
  row: number;
  column: number;
  formula: string;
};

export type FormulaPlan = {
  headers: { sheet: string; row: number; column: number; value: string }[];
  formulas: FormulaWrite[];
  skippedProtected: number;
  missingPowerPoints: string[];
};

function headerIndex(headers: string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === wanted);
}

function nextHeaderColumn(headers: string[]): number {
  let last = 0;
  headers.forEach((header, index) => {
    if (header.trim()) last = index + 1;
  });
  return last + 1;
}

/** Plan the header and the formula edits. Row 10 is never included. */
export function planPowerPointsFormulas(sheets: FormulaColumn[]): FormulaPlan {
  const plan: FormulaPlan = { headers: [], formulas: [], skippedProtected: 0, missingPowerPoints: [] };
  for (const sheet of sheets) {
    const derivedAt = headerIndex(sheet.headers, DERIVED_POWER_HEADER);
    if (derivedAt < 0) {
      plan.headers.push({
        sheet: sheet.title,
        row: POWER_HEADER_ROW,
        column: nextHeaderColumn(sheet.headers),
        value: DERIVED_POWER_HEADER,
      });
    }
    const pointsAt = headerIndex(sheet.headers, POWER_POINTS_HEADER);
    if (pointsAt < 0) {
      plan.missingPowerPoints.push(sheet.title);
      continue;
    }
    for (const cell of sheet.formulas) {
      if (cell.row === POWER_PROTECTED_ROW) {
        plan.skippedProtected += 1;
        continue;
      }
      const next = powerPointsFormula(cell.row);
      const legacy = isLegacyUnknownPowerFormula(cell.formula);
      const ours = cell.formula.replace(/\s+/g, "") === next.replace(/\s+/g, "");
      if (!legacy && !ours) continue;
      if (ours) continue;
      plan.formulas.push({ sheet: sheet.title, row: cell.row, column: pointsAt + 1, formula: next });
    }
  }
  return plan;
}

export function formulaMode(input: { apply?: string; dry?: string; confirm?: string }): "dry-run" | "apply" | "refuse" {
  const apply = input.apply === "1";
  const dry = input.dry !== "0";
  if (!apply || dry) return "dry-run";
  if ((input.confirm || "").trim() !== POWER_FORMULA_CONFIRM) return "refuse";
  return "apply";
}

export function formatFormulaPlan(plan: FormulaPlan, mode: "dry-run" | "apply"): string {
  return [
    `mode ${mode}`,
    `header_adds ${plan.headers.length}`,
    `formulas ${plan.formulas.length}`,
    `skipped_row_${POWER_PROTECTED_ROW} ${plan.skippedProtected}`,
    `missing_power_points ${plan.missingPowerPoints.length}`,
    mode === "apply" ? "This run will write formulas." : "Nothing was written.",
  ].join("\n");
}

export type PowerReportInput = {
  sheet: "Pipeline" | "Land Sites";
  rowNumber: number;
  siteId?: string;
  market?: string;
  stage?: string;
  oldPoints?: number | null;
  rating: PowerRatingName;
};

export function isPowerInPlay(row: Pick<PowerReportInput, "market" | "stage" | "rowNumber" | "siteId">): boolean {
  if (row.rowNumber === POWER_PROTECTED_ROW) return false;
  if ((row.siteId || "").trim() === POWER_PROTECTED_SITE_ID) return false;
  const stage = (row.stage || "").trim().toLowerCase();
  if (!stage || stage.startsWith("dropped") || stage.startsWith("off market")) return false;
  const market = (row.market || "").trim().toUpperCase();
  return market === "PHX" || market === "LAS" || market === "MIA";
}

export function isPowerRatingName(value: string): value is PowerRatingName {
  return (POWER_RATINGS as readonly string[]).includes(value);
}

function delta(oldPoints: number, rating: PowerRatingName): number {
  return Math.round((powerPoints(rating) - oldPoints) * 10) / 10;
}

/** Counts, and hashed per-site lines only outside CI. Names, notes, and prices are not accepted. */
export function formatPowerReport(rows: PowerReportInput[], countsOnly: boolean): string {
  const lines = ["Power points report. Counts only when this runs in CI."];
  for (const sheet of ["Pipeline", "Land Sites"] as const) {
    const key = sheet === "Pipeline" ? "pipeline" : "land";
    const inPlay = rows.filter((row) => row.sheet === sheet && isPowerInPlay(row));
    lines.push(`${key}_in_play ${inPlay.length}`);
    for (const rating of POWER_RATINGS) {
      lines.push(`${key}_${rating.toLowerCase()} ${inPlay.filter((row) => row.rating === rating).length}`);
    }
    const sum = inPlay.reduce((total, row) => total + delta(row.oldPoints == null ? powerPoints("Unknown") : row.oldPoints, row.rating), 0);
    lines.push(`${key}_delta_sum ${Math.round(sum * 10) / 10}`);
  }
  if (!countsOnly) {
    const detail = rows
      .filter((row) => isPowerInPlay(row))
      .map((row) => {
        const oldPoints = row.oldPoints == null ? powerPoints("Unknown") : row.oldPoints;
        const id = shortHash(row.siteId || `${row.sheet}:${row.rowNumber}`);
        return `#${id} ${row.sheet} ${row.rating} ${formatPowerPoints(oldPoints)} ${formatPowerPoints(powerPoints(row.rating))} ${formatPowerPoints(delta(oldPoints, row.rating))}`;
      });
    lines.push(...detail);
  }
  return lines.join("\n");
}

export function reportCountsOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === "true" || env.GITHUB_ACTIONS === "true";
}
