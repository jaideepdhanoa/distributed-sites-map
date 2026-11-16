import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { isPnlLineCode, type PnlBusiness } from "./lines";
import { parseAmount } from "./money";
import { buildStatement, emptyStatement, unavailableStatement, type CapturedLine, type PnlStatement } from "./statement";

type Row = {
  period_id: string;
  grain: string;
  year: number | string;
  month: number | string | null;
  through_month: number | string | null;
  business_type: string;
  line_id: string;
  line_code: string;
  amount_text: string;
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

function numberOrNull(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  return Number(value);
}

/** The requested record plus its linked deal or universe site, requested id first. */
export function linkedPnlIds(requested: string, links: { dealId: string; siteId: string }[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (value: string) => {
    const text = value.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ids.push(text);
  };
  add(requested);
  for (const link of links) {
    if (link.dealId === requested || link.siteId === requested) {
      add(link.dealId);
      add(link.siteId);
    }
  }
  return ids;
}

export async function loadPnlStatement(sql: Sql, siteId: string | string[]): Promise<PnlStatement> {
  const requested = (Array.isArray(siteId) ? siteId : [siteId]).map((id) => id.trim()).filter((id) => id && !isExcludedSite(id));
  if (!requested.length) return emptyStatement();
  try {
    const result = await sql.query<Row & { site_id: string }>(
      `SELECT l.site_id, p.entity_id AS period_id, p.grain, p.year, p.month, p.through_month, p.business_type,
              l.entity_id AS line_id, l.line_code, l.amount_text, l.status,
              l.source_document, l.source_page, l.source_href, l.captured_at_iso
       FROM pnl_lines l
       JOIN pnl_periods p ON p.entity_id = l.period_id
       WHERE l.site_id = ANY($1::text[])`,
      [requested],
    );
    const keyed = requested.find((id) => result.rows.some((row) => row.site_id === id));
    const rows = keyed ? result.rows.filter((row) => row.site_id === keyed) : [];
    const lines: CapturedLine[] = [];
    for (const row of rows) {
      if (!isPnlLineCode(row.line_code)) continue;
      if (row.business_type !== "car_wash" && row.business_type !== "auto_service") continue;
      if (row.grain !== "annual" && row.grain !== "monthly") continue;
      if (row.status !== "reported" && row.status !== "estimated") continue;
      const amount = parseAmount(row.amount_text);
      if (!amount) continue;
      lines.push({
        id: row.line_id,
        periodId: row.period_id,
        grain: row.grain,
        year: Number(row.year),
        month: numberOrNull(row.month),
        throughMonth: numberOrNull(row.through_month),
        business: row.business_type as PnlBusiness,
        code: row.line_code,
        amount,
        status: row.status,
        sourceDocument: row.source_document,
        sourcePage: row.source_page,
        sourceHref: row.source_href || "",
        capturedAt: row.captured_at_iso,
      });
    }
    return buildStatement(lines);
  } catch (error) {
    if (missingRelation(error)) return unavailableStatement();
    throw error;
  }
}
