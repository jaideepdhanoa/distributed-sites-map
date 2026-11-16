import type { Sql } from "@/lib/actions/db";

/**
 * Stored shape of a month the package should have had.
 * The document name is a stand-in of the same length. Amounts are samples.
 * PP-000016 through PP-000021 are the value months, in order: 1, 2, 3, 4, 6, 7.
 */
export const MISSING_SOURCE_DOCUMENT = "Sample package. Stand-in for the missing month.";
export const MISSING_SOURCE_PAGE = "Month index";
export const MISSING_SITE = "PIPE-MIA-0080";

const CAPTURED = "2026-11-16T12:00:00Z";
const MONTH_END: Record<number, string> = { 1: "31", 2: "28", 3: "31", 4: "30", 5: "31", 6: "30", 7: "31" };

function periodEnd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${MONTH_END[month]}`;
}

async function insertPeriod(
  sql: Sql,
  id: string,
  grain: "monthly" | "annual",
  year: number,
  month: number | null,
  throughMonth: number | null,
  missing: boolean,
  end: string,
): Promise<void> {
  const start = `${year}-01-01`;
  const periodStart = grain === "monthly" && month ? `${year}-${String(month).padStart(2, "0")}-01` : start;
  await sql.query(
    `INSERT INTO pnl_periods (
       entity_id, site_id, grain, period_start, period_end, year, month, through_month, start_month, missing, business_type, version, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'car_wash', 1, 'fixture')`,
    [id, MISSING_SITE, grain, periodStart, end, year, month, throughMonth, missing],
  );
}

async function insertLine(
  sql: Sql,
  id: string,
  periodId: string,
  code: string | null,
  amount: string | null,
  status: "reported" | "missing",
  page: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO pnl_lines (
       entity_id, period_id, site_id, line_code, amount, amount_text, status,
       source_document, source_page, source_href, captured_at, captured_at_iso, version, updated_by, deleted_at
     ) VALUES (
       $1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, '', $10::timestamptz, $11, 1, 'fixture', NULL
     )`,
    [id, periodId, MISSING_SITE, code, amount, amount, status, status === "missing" ? MISSING_SOURCE_DOCUMENT : "Sample package", page, CAPTURED, CAPTURED],
  );
}

/** Insert the monthly gap: null line code, status missing, period.missing true. No events. */
export async function insertMissingMonthShape(sql: Sql): Promise<void> {
  const months: { id: string; month: number }[] = [
    { id: "PP-000016", month: 1 },
    { id: "PP-000017", month: 2 },
    { id: "PP-000018", month: 3 },
    { id: "PP-000019", month: 4 },
    { id: "PP-000020", month: 6 },
    { id: "PP-000021", month: 7 },
  ];
  for (const period of months) {
    await insertPeriod(sql, period.id, "monthly", 2026, period.month, null, false, periodEnd(2026, period.month));
    await insertLine(sql, `PL-r-${period.month}`, period.id, "revenue", "10000", "reported", String(period.month));
    await insertLine(sql, `PL-l-${period.month}`, period.id, "labor", "2000", "reported", String(period.month));
  }
  await insertPeriod(sql, "PP-000003", "annual", 2026, null, 7, false, "2026-07-31");
  await insertLine(sql, "PL-range-r", "PP-000003", "revenue", "90000", "reported", "Range");
  await insertLine(sql, "PL-range-l", "PP-000003", "labor", "30000", "reported", "Range");
  await insertPeriod(sql, "PP-000096", "monthly", 2026, 5, null, true, "2026-05-31");
  await insertLine(sql, "PL-000285", "PP-000096", null, null, "missing", MISSING_SOURCE_PAGE);
  await insertPeriod(sql, "PP-000095", "monthly", 2025, 4, null, true, "2025-04-30");
  await insertLine(sql, "PL-000284", "PP-000095", null, null, "missing", MISSING_SOURCE_PAGE);
}
