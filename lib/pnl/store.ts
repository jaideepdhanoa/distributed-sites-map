import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import type { PnlLinePayload, PnlRetractPayload } from "@/lib/changes/schema";
import { isPnlLineCode, type PnlBusiness } from "./lines";
import { parseAmount } from "./money";
import { coverageOf } from "./period";

export type StoreOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; entityId: string; actual: number };

type PeriodRow = {
  entity_id: string;
  business_type: string;
  through_month: number | null;
  start_month: number | null;
  year: number | string;
  month: number | null;
  grain: string;
  missing: boolean | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function sameBusiness(row: PeriodRow, payload: PnlLinePayload): boolean {
  return row.business_type === payload.business_type;
}

async function periodForYear(sql: Sql, siteId: string, year: number): Promise<PeriodRow | null> {
  const result = await sql.query<PeriodRow>(
    `SELECT entity_id, business_type, through_month, start_month, year, month, grain, missing
     FROM pnl_periods WHERE site_id = $1 AND year = $2 LIMIT 1`,
    [siteId, year],
  );
  return result.rows[0] || null;
}

async function findPeriod(sql: Sql, siteId: string, payload: PnlLinePayload, start: string, end: string): Promise<PeriodRow | null> {
  const existing = await sql.query<PeriodRow>(
    `SELECT entity_id, business_type, through_month, start_month, year, month, grain, missing
     FROM pnl_periods WHERE site_id = $1 AND grain = $2 AND period_start = $3 AND period_end = $4`,
    [siteId, payload.grain, start, end],
  );
  return existing.rows[0] || null;
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
  const missing = input.payload.missing === true || input.payload.status === "missing";
  const amount = missing ? null : parseAmount(input.payload.amount || "");
  if (!missing && !amount) {
    throw new InputError("amount must be a string such as \"12345\", \"12345.6\", or \"12345.00\", with at most two decimal places and no commas or symbols", 400, "amount");
  }
  const coverage = coverageOf({
    grain: input.payload.grain,
    year: input.payload.year,
    month: input.payload.month,
    startMonth: input.payload.start_month,
    throughMonth: input.payload.through_month,
    periodEnd: input.payload.period_end,
  });
  let period = await findPeriod(sql, input.siteId, input.payload, coverage.periodStart, coverage.periodEnd);
  if (period && !sameBusiness(period, input.payload)) {
    throw new InputError("That period is already captured with a different business or coverage.", 400, "business_type");
  }
  if (!period) {
    const sibling = await periodForYear(sql, input.siteId, input.payload.year);
    if (sibling && sibling.business_type !== input.payload.business_type) {
      throw new InputError("That year is already captured as a different business.", 400, "business_type");
    }
    const periodId = await input.mintPeriod();
    await sql.query(
      `INSERT INTO pnl_periods (
         entity_id, site_id, grain, period_start, period_end, year, month, through_month, start_month, missing, business_type, version, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12)`,
      [
        periodId,
        input.siteId,
        input.payload.grain,
        coverage.periodStart,
        coverage.periodEnd,
        input.payload.year,
        input.payload.month ?? null,
        coverage.throughMonth,
        coverage.startMonth,
        missing,
        input.payload.business_type,
        input.actorId,
      ],
    );
    period = {
      entity_id: periodId,
      business_type: input.payload.business_type,
      through_month: coverage.throughMonth,
      start_month: coverage.startMonth,
      year: input.payload.year,
      month: input.payload.month ?? null,
      grain: input.payload.grain,
      missing,
    };
  }

  if (missing) {
    const filled = await sql.query<{ entity_id: string }>(
      `SELECT entity_id FROM pnl_lines WHERE period_id = $1 AND status <> 'missing' AND deleted_at IS NULL LIMIT 1`,
      [period.entity_id],
    );
    if (filled.rows[0]) throw new InputError("That month already has a captured line.", 400, "missing");
  } else if (period.missing) {
    await sql.query(`DELETE FROM pnl_lines WHERE period_id = $1 AND status = 'missing' AND deleted_at IS NULL`, [period.entity_id]);
    await sql.query(`UPDATE pnl_periods SET missing = false, updated_at = clock_timestamp(), updated_by = $2 WHERE entity_id = $1`, [period.entity_id, input.actorId]);
  }

  const status = missing ? "missing" : input.payload.status;
  const duplicate = missing
    ? await sql.query<{ entity_id: string; version: number | string; line_code: string | null }>(
      `SELECT entity_id, version, line_code FROM pnl_lines WHERE period_id = $1 AND status = 'missing' AND deleted_at IS NULL`,
      [period.entity_id],
    )
    : await sql.query<{ entity_id: string; version: number | string; line_code: string | null }>(
      `SELECT entity_id, version, line_code FROM pnl_lines WHERE period_id = $1 AND line_code = $2 AND status = $3 AND deleted_at IS NULL`,
      [period.entity_id, input.payload.line, status],
    );
  const prior = duplicate.rows[0];
  if (input.expectedVersion === 0 && prior) {
    return { ok: false, entityId: prior.entity_id, actual: Number(prior.version) };
  }
  if (input.expectedVersion > 0) {
    const current = await sql.query<{ line_code: string | null; period_id: string; status: string; deleted_at: string | null }>(
      `SELECT line_code, period_id, status, deleted_at FROM pnl_lines WHERE entity_id = $1`,
      [input.entityId],
    );
    const row = current.rows[0];
    if (row?.deleted_at) throw new InputError("That line is retracted.", 400, "entity_id");
    const sameLine = missing
      ? row?.status === "missing"
      : row?.line_code === input.payload.line && row?.status === status;
    if (!row || row.period_id !== period.entity_id || !sameLine) {
      throw new InputError("That line does not belong to this period.", 400, "line");
    }
  }

  const stored = {
    period_id: period.entity_id,
    grain: input.payload.grain,
    year: input.payload.year,
    month: input.payload.month ?? null,
    start_month: coverage.startMonth,
    through_month: coverage.throughMonth,
    period_start: coverage.periodStart,
    period_end: coverage.periodEnd,
    business_type: input.payload.business_type as PnlBusiness,
    line: missing ? null : input.payload.line,
    amount: amount?.raw ?? null,
    status,
    missing,
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
       line_code = EXCLUDED.line_code,
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
      missing ? null : input.payload.line,
      amount?.raw ?? null,
      amount?.raw ?? null,
      status,
      input.payload.source_document,
      input.payload.source_page,
      input.payload.source_href || "",
      input.payload.captured_at,
      input.payload.captured_at,
      input.version,
      input.actorId,
    ],
  );
  if (!missing && !isPnlLineCode(text(stored.line))) throw new InputError("line must be one of the chart of accounts", 400, "line");
  return { ok: true, payload: stored };
}

export async function retractPnlLine(
  sql: Sql,
  input: {
    siteId: string;
    entityId: string;
    actorId: string;
    version: number;
    payload: PnlRetractPayload;
  },
): Promise<StoreOutcome> {
  const current = await sql.query<{
    site_id: string;
    version: number | string;
    deleted_at: string | null;
    line_code: string | null;
    status: string;
    period_id: string;
  }>(
    `SELECT site_id, version, deleted_at, line_code, status, period_id FROM pnl_lines WHERE entity_id = $1`,
    [input.entityId],
  );
  const row = current.rows[0];
  if (!row || row.site_id !== input.siteId) throw new InputError("That line is not on this site.", 404, "entity_id");
  if (row.deleted_at) throw new InputError("That line is already retracted.", 400, "retract");
  await sql.query(
    `UPDATE pnl_lines
     SET deleted_at = $5::timestamptz, deleted_at_iso = $6, deleted_by = $2, delete_reason = $3, version = $4,
         updated_at = clock_timestamp(), updated_by = $2
     WHERE entity_id = $1 AND deleted_at IS NULL`,
    [input.entityId, input.actorId, input.payload.reason, input.version, input.payload.at, input.payload.at],
  );
  return {
    ok: true,
    payload: {
      retract: true,
      reason: input.payload.reason,
      actor: input.actorId,
      at: input.payload.at,
      line: row.line_code,
      status: row.status,
      period_id: row.period_id,
    },
  };
}
