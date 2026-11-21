import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { isPnlLineCode } from "./lines";
import { parseAmount } from "./money";
import { buildStatement, emptyStatement, unavailableStatement, type CapturedLine, type MissingMonth, type PnlStatement } from "./statement";

export { linkedPnlIds } from "./ids";

type Row = {
  site_id?: string;
  period_id: string;
  grain: string;
  year: number | string;
  month: number | string | null;
  through_month: number | string | null;
  start_month?: number | string | null;
  period_start?: string | Date | null;
  period_end?: string | Date | null;
  missing?: boolean | null;
  business_type: string;
  line_id: string | null;
  line_code: string | null;
  amount_text: string | null;
  status: string;
  source_document: string;
  source_page: string;
  source_href: string;
  captured_at_iso: string;
};

function missingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "42P01") return true;
  const message = error instanceof Error ? error.message : "";
  return /pnl_periods|pnl_lines|does not exist/i.test(message);
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  return Number(value);
}

function day(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const date = String(value.getUTCDate()).padStart(2, "0");
    return `${value.getUTCFullYear()}-${month}-${date}`;
  }
  return String(value).slice(0, 10);
}

function flagged(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function markerMonth(row: Pick<Row, "month" | "grain" | "period_start">): number | null {
  const month = numberOrNull(row.month);
  if (month && month >= 1 && month <= 12) return month;
  if (String(row.grain || "").trim() !== "monthly") return null;
  const start = day(row.period_start);
  const parsed = Number(start.slice(5, 7));
  return parsed >= 1 && parsed <= 12 ? parsed : null;
}

function rememberMissing(missing: MissingMonth[], item: MissingMonth): void {
  const existing = missing.find((row) => row.year === item.year && row.month === item.month);
  if (!existing) {
    missing.push(item);
    return;
  }
  if (!existing.periodId && item.periodId) existing.periodId = item.periodId;
  if (!existing.sourceDocument && item.sourceDocument) existing.sourceDocument = item.sourceDocument;
  if (!existing.sourcePage && item.sourcePage) existing.sourcePage = item.sourcePage;
  if (!existing.sourceHref && item.sourceHref) existing.sourceHref = item.sourceHref;
  if (!existing.capturedAt && item.capturedAt) existing.capturedAt = item.capturedAt;
  if (!existing.markerSource && item.markerSource) existing.markerSource = item.markerSource;
}

function isMissingMarker(row: Row): boolean {
  const status = String(row.status || "").trim().toLowerCase();
  if (status === "missing") return true;
  const noLine = row.line_code == null || String(row.line_code).trim() === "";
  return flagged(row.missing) && noLine && !row.amount_text;
}

type MissingPeriodRow = {
  period_id: string;
  grain: string;
  year: number | string;
  month: number | string | null;
  period_start: string | Date | null;
  business_type: string;
  line_status: string | null;
  source_document: string | null;
  source_page: string | null;
  source_href: string | null;
  captured_at_iso: string | null;
};

/**
 * A missing month is the period. The line that records it has a null line code,
 * so this query never filters on line_code. `missing = true` on the period, or
 * any line with status `missing`, marks every row in that period.
 */
async function collectMissingPeriods(sql: Sql, siteIds: string[]): Promise<MissingMonth[]> {
  const result = await sql.query<MissingPeriodRow>(
    `SELECT p.entity_id AS period_id, p.grain, p.year, p.month, p.period_start, p.business_type,
            lower(btrim(coalesce(l.status, ''))) AS line_status,
            l.source_document, l.source_page, l.source_href, l.captured_at_iso
     FROM pnl_periods p
     LEFT JOIN pnl_lines l ON l.period_id = p.entity_id AND l.deleted_at IS NULL
     WHERE (
         p.site_id = ANY($1::text[])
         OR EXISTS (
           SELECT 1 FROM pnl_lines owned
           WHERE owned.period_id = p.entity_id AND owned.deleted_at IS NULL AND owned.site_id = ANY($1::text[])
         )
       )
       AND (
         p.missing IS TRUE
         OR EXISTS (
           SELECT 1 FROM pnl_lines marker
           WHERE marker.period_id = p.entity_id
             AND marker.deleted_at IS NULL
             AND lower(btrim(marker.status)) = 'missing'
         )
       )`,
    [siteIds],
  );
  const groups = new Map<string, MissingPeriodRow[]>();
  for (const row of result.rows) {
    const list = groups.get(row.period_id) || [];
    list.push(row);
    groups.set(row.period_id, list);
  }
  const missing: MissingMonth[] = [];
  for (const [periodId, group] of groups) {
    const row = group[0];
    if (!row) continue;
    const business = String(row.business_type || "").trim();
    if (business !== "car_wash" && business !== "auto_service") continue;
    const month = markerMonth(row);
    const year = Number(row.year);
    if (!month || !Number.isInteger(year)) continue;
    const source = group.find((item) => item.line_status === "missing" && item.source_document)
      || group.find((item) => item.source_document);
    rememberMissing(missing, {
      year,
      month,
      business: business === "auto_service" ? "auto_service" : "car_wash",
      periodId,
      sourceDocument: source?.source_document || "",
      sourcePage: source?.source_page || "",
      sourceHref: source?.source_href || "",
      capturedAt: source?.captured_at_iso || "",
    });
  }
  return missing;
}

export async function loadPnlStatement(sql: Sql, siteId: string | string[]): Promise<PnlStatement> {
  const requested = (Array.isArray(siteId) ? siteId : [siteId]).map((id) => id.trim()).filter((id) => id && !isExcludedSite(id));
  if (!requested.length) return emptyStatement();
  try {
    const result = await sql.query<Row>(
      `SELECT l.site_id, p.entity_id AS period_id, p.grain, p.year, p.month, p.through_month, p.start_month,
              p.period_start, p.period_end, p.missing, p.business_type,
              l.entity_id AS line_id, l.line_code, l.amount_text, l.status,
              l.source_document, l.source_page, l.source_href, l.captured_at_iso
       FROM pnl_lines l
       JOIN pnl_periods p ON p.entity_id = l.period_id
       WHERE l.site_id = ANY($1::text[]) AND l.deleted_at IS NULL`,
      [requested],
    );
    const valueSite = requested.find((id) => result.rows.some((row) => row.site_id === id && !isMissingMarker(row) && row.amount_text));
    const keyed = valueSite || requested.find((id) => result.rows.some((row) => row.site_id === id));
    const rows = keyed ? result.rows.filter((row) => row.site_id === keyed || isMissingMarker(row)) : [];
    const lines: CapturedLine[] = [];
    const missing = await collectMissingPeriods(sql, requested);
    const missingPeriodIds = new Set(missing.map((item) => item.periodId).filter(Boolean));
    for (const row of rows) {
      const business = String(row.business_type || "").trim();
      const grain = String(row.grain || "").trim();
      if (business !== "car_wash" && business !== "auto_service") continue;
      if (grain !== "annual" && grain !== "monthly") continue;
      if (missingPeriodIds.has(row.period_id) || isMissingMarker(row)) {
        const month = markerMonth(row);
        if (isMissingMarker(row) && grain === "monthly" && month) {
          rememberMissing(missing, {
            year: Number(row.year),
            month,
            business: business === "auto_service" ? "auto_service" : "car_wash",
            periodId: row.period_id,
            sourceDocument: row.source_document || "",
            sourcePage: row.source_page || "",
            sourceHref: row.source_href || "",
            capturedAt: row.captured_at_iso || "",
          });
        }
        continue;
      }
      if (row.site_id !== keyed) continue;
      const status = String(row.status || "").trim();
      if (status !== "reported" && status !== "estimated" && status !== "normalized") continue;
      if (!row.line_code || !isPnlLineCode(row.line_code)) continue;
      const amount = parseAmount(row.amount_text || "");
      if (!amount) continue;
      const periodStart = day(row.period_start);
      const periodEnd = day(row.period_end);
      const storedGrain = grain === "annual" ? "annual" : "monthly";
      const storedStatus = status === "estimated" ? "estimated" : status === "normalized" ? "normalized" : "reported";
      lines.push({
        id: row.line_id || row.period_id,
        periodId: row.period_id,
        grain: storedGrain,
        year: Number(row.year),
        month: numberOrNull(row.month),
        throughMonth: numberOrNull(row.through_month),
        startMonth: numberOrNull(row.start_month),
        ...(periodStart && periodEnd ? { periodStart, periodEnd } : {}),
        business: business === "auto_service" ? "auto_service" : "car_wash",
        code: row.line_code,
        amount,
        status: storedStatus,
        sourceDocument: row.source_document,
        sourcePage: row.source_page,
        sourceHref: row.source_href || "",
        capturedAt: row.captured_at_iso,
      });
    }
    await addChangeMarkers(sql, requested, lines, missing);
    return buildStatement(lines, missing);
  } catch (error) {
    if (missingRelation(error)) return unavailableStatement();
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function eventSaysMissing(source: string, payload: Record<string, unknown> | null): boolean {
  if (source.trim().toLowerCase() === "not in package") return true;
  if (!payload) return false;
  if (payload.missing === true || payload.missing === "true") return true;
  return String(payload.status || "").trim().toLowerCase() === "missing";
}

/**
 * Muse records a missing month with `missing: true` and no line, amount, or status.
 * "Not in package" is the change's source, not the line's document. The line row can
 * fail the status check and still be named here from that event.
 */
async function addChangeMarkers(sql: Sql, siteIds: string[], lines: CapturedLine[], missing: MissingMonth[]): Promise<void> {
  let rows: { site_id: string; source: string; payload: unknown }[] = [];
  try {
    const result = await sql.query<{ site_id: string; source: string; payload: unknown }>(
      `SELECT DISTINCT ON (entity_id) site_id, source, payload
       FROM events
       WHERE entity_type = 'pnl_line' AND site_id = ANY($1::text[])
         AND (
           lower(btrim(source)) = 'not in package'
           OR coalesce(payload->>'missing', '') IN ('true', 't')
           OR lower(coalesce(payload->>'status', '')) = 'missing'
         )
       ORDER BY entity_id, created_at DESC`,
      [siteIds],
    );
    rows = result.rows;
  } catch (error) {
    if (missingRelation(error)) return;
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return;
    throw error;
  }
  for (const row of rows) {
    const payload = asRecord(row.payload);
    if (!eventSaysMissing(row.source || "", payload)) continue;
    const year = Number(payload?.year);
    const month = Number(payload?.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    const hasLine = lines.some((line) => line.grain === "monthly" && line.year === year && line.month === month);
    if (hasLine) continue;
    const markerSource = String(row.source || "").trim();
    const existing = missing.find((item) => item.year === year && item.month === month);
    if (existing) {
      if (!existing.markerSource && markerSource) existing.markerSource = markerSource;
      if (!existing.sourceDocument) existing.sourceDocument = String(payload?.source_document || "");
      if (!existing.sourcePage) existing.sourcePage = String(payload?.source_page || "");
      if (!existing.sourceHref) existing.sourceHref = String(payload?.source_href || "");
      if (!existing.capturedAt) existing.capturedAt = String(payload?.captured_at || "");
      if (!existing.periodId) existing.periodId = String(payload?.period_id || "");
      continue;
    }
    const business = payload?.business_type === "auto_service" ? "auto_service" : "car_wash";
    missing.push({
      year,
      month,
      business,
      periodId: String(payload?.period_id || ""),
      sourceDocument: String(payload?.source_document || ""),
      sourcePage: String(payload?.source_page || ""),
      sourceHref: String(payload?.source_href || ""),
      capturedAt: String(payload?.captured_at || ""),
      markerSource,
    });
  }
}
