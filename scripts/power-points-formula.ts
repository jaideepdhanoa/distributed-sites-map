import { appendFileSync } from "node:fs";
import {
  POWER_POINTS_HEADER,
  POWER_PROTECTED_ROW,
  formatFormulaPlan,
  formulaMode,
  planPowerPointsFormulas,
} from "../lib/score/power-sheet";
import { SITE_TABS, assertSheetScript, readColumn, readHeaders, redact, sheetToken, writeCells } from "./power-sheet-read";

/**
 * Point Power points at the derived rating column.
 * Dry run is the default and writes nothing. Apply needs
 * POWER_POINTS_APPLY=1, POWER_POINTS_DRY_RUN=0, and CONFIRM=power-points-derived.
 * Do not run an apply against the live workbook from a pull request.
 * Row 10 on Pipeline and Land Sites is not written.
 */

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function headerIndex(headers: string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === wanted);
}

async function main(): Promise<void> {
  assertSheetScript();
  const mode = formulaMode({
    apply: process.env.POWER_POINTS_APPLY,
    dry: process.env.POWER_POINTS_DRY_RUN,
    confirm: process.env.CONFIRM,
  });
  if (mode === "refuse") {
    throw new Error("Refusing to change Power points. Set dry run off, set apply on, and type the confirm phrase.");
  }
  const token = await sheetToken();
  const sheets = [];
  for (const title of SITE_TABS) {
    const headers = await readHeaders(token, title);
    const pointsAt = headerIndex(headers, POWER_POINTS_HEADER);
    const formulas = pointsAt < 0 ? [] : await readColumn(token, title, pointsAt + 1, "formulas");
    sheets.push({
      title,
      headers,
      formulas: formulas.map((formula, index) => ({ row: POWER_HEADER_START + index, formula })),
    });
  }
  const plan = planPowerPointsFormulas(sheets);
  const text = formatFormulaPlan(plan, mode === "apply" ? "apply" : "dry-run");
  console.log(text);
  summary(`## Power points formula\n\n${text}\n`);
  if (plan.missingPowerPoints.length) {
    throw new Error(`Power points header is missing on ${plan.missingPowerPoints.join(", ")}.`);
  }
  if (mode !== "apply") return;
  const cells = [
    ...plan.headers.map((header) => ({ ...header, value: header.value })),
    ...plan.formulas.map((formula) => ({
      sheet: formula.sheet,
      row: formula.row,
      column: formula.column,
      value: formula.formula,
    })),
  ].filter((cell) => cell.row !== POWER_PROTECTED_ROW);
  await writeCells(token, cells);
  console.log(`Wrote ${plan.headers.length} headers and ${plan.formulas.length} formulas.`);
}

const POWER_HEADER_START = 5;

main().catch((error: unknown) => {
  console.error(redact(error));
  summary(`## Power points formula failed\n\n${redact(error)}\n`);
  process.exit(1);
});
