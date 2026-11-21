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

export type SheetGrid = {
  title: string;
  sheetId: number;
  columnCount: number;
  rowCount: number;
};

/** Columns past the current grid. A values write cannot create them. */
export function columnsToAppend(column: number, columnCount: number): number {
  if (!Number.isFinite(column) || !Number.isFinite(columnCount)) return 0;
  return Math.max(0, Math.floor(column) - Math.floor(columnCount));
}

export function rowsToAppend(row: number, rowCount: number): number {
  if (!Number.isFinite(row) || !Number.isFinite(rowCount)) return 0;
  return Math.max(0, Math.floor(row) - Math.floor(rowCount));
}

type BatchRequest = Record<string, unknown>;

/**
 * One spreadsheets.batchUpdate body. appendDimension runs before the cell
 * writes, and the request is atomic: a rejected range writes nothing.
 * Row 10 is omitted.
 */
export function formulaWriteRequests(input: {
  headers: FormulaPlan["headers"];
  formulas: FormulaPlan["formulas"];
  grids: SheetGrid[];
}): { requests: BatchRequest[] } {
  const grids = new Map(input.grids.map((grid) => [grid.title, grid]));
  const requests: BatchRequest[] = [];
  const cells: { sheet: string; row: number; column: number; value: string }[] = [];
  for (const header of input.headers) {
    if (header.row === POWER_PROTECTED_ROW) continue;
    cells.push(header);
  }
  for (const formula of input.formulas) {
    if (formula.row === POWER_PROTECTED_ROW) continue;
    cells.push({ sheet: formula.sheet, row: formula.row, column: formula.column, value: formula.formula });
  }
  const extraColumns = new Map<string, number>();
  const extraRows = new Map<string, number>();
  for (const cell of cells) {
    const grid = grids.get(cell.sheet);
    if (!grid) throw new Error(`Missing a grid for ${cell.sheet}.`);
    extraColumns.set(cell.sheet, Math.max(extraColumns.get(cell.sheet) || 0, columnsToAppend(cell.column, grid.columnCount)));
    extraRows.set(cell.sheet, Math.max(extraRows.get(cell.sheet) || 0, rowsToAppend(cell.row, grid.rowCount)));
  }
  for (const [title, length] of extraColumns) {
    if (length <= 0) continue;
    const grid = grids.get(title);
    if (!grid) continue;
    requests.push({ appendDimension: { sheetId: grid.sheetId, dimension: "COLUMNS", length } });
  }
  for (const [title, length] of extraRows) {
    if (length <= 0) continue;
    const grid = grids.get(title);
    if (!grid) continue;
    requests.push({ appendDimension: { sheetId: grid.sheetId, dimension: "ROWS", length } });
  }
  for (const cell of cells) {
    const grid = grids.get(cell.sheet);
    if (!grid) throw new Error(`Missing a grid for ${cell.sheet}.`);
    const entered = cell.value.startsWith("=") ? { formulaValue: cell.value } : { stringValue: cell.value };
    requests.push({
      updateCells: {
        start: { sheetId: grid.sheetId, rowIndex: cell.row - 1, columnIndex: cell.column - 1 },
        rows: [{ values: [{ userEnteredValue: entered }] }],
        fields: "userEnteredValue",
      },
    });
  }
  return { requests };
}

/** Status and Sheets message only. Request bodies and secrets stay out. */
export function sheetsFailureText(status: number, body: string): string {
  let message = "";
  let statusText = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; status?: unknown } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
    if (typeof parsed.error?.status === "string") statusText = parsed.error.status;
  } catch {
    message = "";
  }
  const text = [`Sheets write failed (${status}${statusText ? ` ${statusText}` : ""}).`, message].filter(Boolean).join(" ");
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
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
