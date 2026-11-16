import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import type { PnlLinePayload } from "@/lib/changes/schema";
import { isPnlLineCode, type PnlBusiness } from "./lines";
import { parseAmount } from "./money";

export type StoreOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; entityId: string; actual: number };

type PeriodRow = {
  entity_id: string;
  business_type: string;
  through_month: number | null;
  year: number | string;
  month: number | null;
  grain: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function periodStart(payload: PnlLinePayload): string {
  if (payload.grain === "monthly") return `${payload.year}-${String(payload.month).padStart(2, "0")}-01`;
  return `${payload.year}-01-01`;
}

function lastDay(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function periodEnd(payload: PnlLinePayload): string {
  if (payload.grain === "monthly") return lastDay(payload.year, payload.month || 1);
  if (payload.through_month) return lastDay(payload.year, payload.through_month);
  return `${payload.year}-12-31`;
}

function samePeriod(row: PeriodRow, payload: PnlLinePayload): boolean {
  const through = row.through_month == null ? null : Number(row.through_month);
  const month = row.month == null ? null : Number(row.month);
  return row.grain === payload.grain
    && Number(row.year) === payload.year
    && month === (payload.month ?? null)
    && through === (payload.through_month ?? null)
    && row.business_type === payload.business_type;
}

async function periodForYear(sql: Sql, siteId: string, year: number): Promise<PeriodRow | null> {
  const result = await sql.query<PeriodRow>(
    `SELECT entity_id, business_type, through_month, year, month, grain
     FROM pnl_periods WHERE site_id = $1 AND year = $2 LIMIT 1`,
    [siteId, year],
  );
  return result.rows[0] || null;
}

export async function storePnlLine(
  sql: Sql,
  input: {
    siteId: string;
    entityId: string;
    expectedVersion: number;
    actorId: string;
    version: number;
    payload: PnlLinePayload;
    mintPeriod: () => Promise<string>;
  },
): Promise<StoreOutcome> {
  const amount = parseAmount(input.payload.amount);
  if (!amount) throw new InputError("Amount must be the captured number, with no rounding added.");
  const start = periodStart(input.payload);
  const existing = await sql.query<PeriodRow>(
    `SELECT entity_id, business_type, through_month, year, month, grain
     FROM pnl_periods WHERE site_id = $1 AND grain = $2 AND period_start = $3`,
    [input.siteId, input.payload.grain, start],
  );
  let period = existing.rows[0] || null;
  if (period && !samePeriod(period, input.payload)) {
    throw new InputError("That period is already captured with a different business or coverage.");
  }
  if (!period) {
    const sibling = await periodForYear(sql, input.siteId, input.payload.year);
    if (sibling && sibling.business_type !== input.payload.business_type) {
      throw new InputError("That year is already captured as a different business.");
    }
    const periodId = await input.mintPeriod();
    await sql.query(
      `INSERT INTO pnl_periods (
         entity_id, site_id, grain, period_start, period_end, year, month, through_month, business_type, version, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
      [
        periodId,
        input.siteId,
        input.payload.grain,
        start,
        periodEnd(input.payload),
        input.payload.year,
        input.payload.month ?? null,
        input.payload.through_month ?? null,
        input.payload.business_type,
        input.actorId,
      ],
    );
    period = {
      entity_id: periodId,
      business_type: input.payload.business_type,
      through_month: input.payload.through_month ?? null,
      year: input.payload.year,
      month: input.payload.month ?? null,
      grain: input.payload.grain,
    };
  }

  const duplicate = await sql.query<{ entity_id: string; version: number | string; line_code: string }>(
    `SELECT entity_id, version, line_code FROM pnl_lines WHERE period_id = $1 AND line_code = $2`,
    [period.entity_id, input.payload.line],
  );
  const prior = duplicate.rows[0];
  if (input.expectedVersion === 0 && prior) {
    return { ok: false, entityId: prior.entity_id, actual: Number(prior.version) };
  }
  if (input.expectedVersion > 0) {
    const current = await sql.query<{ line_code: string; period_id: string }>(
      `SELECT line_code, period_id FROM pnl_lines WHERE entity_id = $1`,
      [input.entityId],
    );
    const row = current.rows[0];
    if (!row || row.period_id !== period.entity_id || row.line_code !== input.payload.line) {
      throw new InputError("That line does not belong to this period.");
    }
  }

  const stored = {
    period_id: period.entity_id,
    grain: input.payload.grain,
    year: input.payload.year,
    month: input.payload.month ?? null,
    through_month: input.payload.through_month ?? null,
    business_type: input.payload.business_type as PnlBusiness,
    line: input.payload.line,
    amount: amount.raw,
    status: input.payload.status,
    source_document: input.payload.source_document,
    source_page: input.payload.source_page,
    source_href: input.payload.source_href || "",
    captured_at: input.payload.captured_at,
  };
  await sql.query(
    `INSERT INTO pnl_lines (
       entity_id, period_id, site_id, line_code, amount, amount_text, status,
       source_document, source_page, source_href, captured_at, captured_at_iso, version, updated_by
     ) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14)
     ON CONFLICT (entity_id) DO UPDATE SET
       amount = EXCLUDED.amount,
       amount_text = EXCLUDED.amount_text,
       status = EXCLUDED.status,
       source_document = EXCLUDED.source_document,
       source_page = EXCLUDED.source_page,
       source_href = EXCLUDED.source_href,
       captured_at = EXCLUDED.captured_at,
       captured_at_iso = EXCLUDED.captured_at_iso,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by`,
    [
      input.entityId,
      period.entity_id,
      input.siteId,
      input.payload.line,
      amount.raw,
      amount.raw,
      input.payload.status,
      input.payload.source_document,
      input.payload.source_page,
      input.payload.source_href || "",
      input.payload.captured_at,
      input.payload.captured_at,
      input.version,
      input.actorId,
    ],
  );
  if (!isPnlLineCode(text(stored.line))) throw new InputError("That line is not in the chart of accounts.");
  return { ok: true, payload: stored };
}
