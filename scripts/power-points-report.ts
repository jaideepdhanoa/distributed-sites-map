import { appendFileSync } from "node:fs";
import { derivePowerRating } from "../lib/score/power-rating";
import { formatPowerReport, reportCountsOnly, type PowerReportInput } from "../lib/score/power-sheet";
import { SITE_TABS, assertSheetScript, readColumn, readHeaders, redact, sheetToken } from "./power-sheet-read";

/**
 * Dry run only. Compares today's Power points with the derived rating.
 * CI logs are counts. Site names, notes, addresses, and prices are not read
 * and are not printed.
 */

const FIELDS: { header: string; key: string }[] = [
  { header: "Market", key: "market" },
  { header: "Stage", key: "stage" },
  { header: "Site ID", key: "siteId" },
  { header: "Power points", key: "oldPoints" },
  { header: "pwr_b_hosting_mw_frontage", key: "cap_b_frontage" },
  { header: "pwr_b_hosting_mw_nearby", key: "cap_b_nearby" },
  { header: "pwr_b_source_type", key: "cap_b_source" },
  { header: "pwr_b_as_of", key: "cap_b_as_of" },
  { header: "pwr_b_confidence", key: "cap_b_confidence" },
  { header: "pwr_c_service_amps", key: "cap_c_amps" },
  { header: "pwr_c_service_volts", key: "cap_c_volts" },
  { header: "pwr_c_service_phase", key: "cap_c_phase" },
  { header: "pwr_c_source_type", key: "cap_c_source" },
  { header: "pwr_c_as_of", key: "cap_c_as_of" },
  { header: "pwr_c_confidence", key: "cap_c_confidence" },
];

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function headerIndex(headers: string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === wanted);
}

function points(value: string): number | null {
  const text = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

async function main(): Promise<void> {
  assertSheetScript();
  const token = await sheetToken();
  const rows: PowerReportInput[] = [];
  for (const title of SITE_TABS) {
    const headers = await readHeaders(token, title);
    const columns = new Map<string, string[]>();
    let length = 0;
    for (const field of FIELDS) {
      const index = headerIndex(headers, field.header);
      const values = index < 0 ? [] : await readColumn(token, title, index + 1, "unformatted");
      columns.set(field.key, values);
      length = Math.max(length, values.length);
    }
    for (let index = 0; index < length; index += 1) {
      const cell = (key: string) => columns.get(key)?.[index] || "";
      if (!cell("siteId") && !cell("market") && !cell("stage")) continue;
      const derived = derivePowerRating({
        market: cell("market"),
        cap_b_frontage: cell("cap_b_frontage"),
        cap_b_nearby: cell("cap_b_nearby"),
        cap_b_source: cell("cap_b_source"),
        cap_b_as_of: cell("cap_b_as_of"),
        cap_b_confidence: cell("cap_b_confidence"),
        cap_c_amps: cell("cap_c_amps"),
        cap_c_volts: cell("cap_c_volts"),
        cap_c_phase: cell("cap_c_phase"),
        cap_c_source: cell("cap_c_source"),
        cap_c_as_of: cell("cap_c_as_of"),
        cap_c_confidence: cell("cap_c_confidence"),
      });
      rows.push({
        sheet: title,
        rowNumber: 5 + index,
        siteId: cell("siteId"),
        market: cell("market"),
        stage: cell("stage"),
        oldPoints: points(cell("oldPoints")),
        rating: derived.rating,
      });
    }
  }
  const text = formatPowerReport(rows, reportCountsOnly());
  console.log(text);
  summary(`## Power points report\n\n\`\`\`\n${text}\n\`\`\`\n`);
}

main().catch((error: unknown) => {
  console.error(redact(error));
  summary(`## Power points report failed\n\n${redact(error)}\n`);
  process.exit(1);
});
