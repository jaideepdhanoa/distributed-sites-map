import type { Sql } from "@/lib/actions/db";
import { databaseUrl } from "@/lib/actions/db";
import { isProductionDatabase } from "@/lib/changes/guard";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { embedPending } from "./embed";
import { indexRecord, scrub } from "./docs";

export function backfillDecision(url: string | null, confirm: boolean): { ok: true } | { ok: false; reason: string } {
  if (isProductionDatabase(url) && !confirm) {
    return { ok: false, reason: "Refusing to use the production database without CONFIRM=1." };
  }
  return { ok: true };
}

export async function backfillSearch(sql: Sql, options: { write: boolean; embed: boolean }): Promise<{
  dryRun: boolean;
  sites: number;
  brokers: number;
  comms: number;
  notes: number;
  activities: number;
  pnl: number;
  embedded: number;
}> {
  const sites = await sql.query<{ site_id: string; name: string; address: string; apn: string; market: string; category: string; broker: string; firm: string }>(
    `SELECT site_id, name, address, apn, market, category, broker, firm FROM sites`,
  );
  const comms = await sql.query<{ entity_id: string; site_id: string; person: string; summary: string }>(
    `SELECT entity_id, site_id, coalesce(payload->>'person', '') AS person, coalesce(payload->>'summary', '') AS summary FROM comms_entries`,
  );
  const notes = await sql.query<{ id: string; target_id: string; body: string }>(
    `SELECT id, target_id, body FROM notes`,
  );
  const activities = await sql.query<{ entity_id: string; site_id: string; type: string; summary: string }>(
    `SELECT entity_id, site_id, coalesce(payload->>'type', '') AS type, coalesce(payload->>'summary', '') AS summary FROM activities`,
  );
  const pnl = await sql.query<{ entity_id: string; site_id: string; line_code: string; grain: string; year: string }>(
    `SELECT l.entity_id, l.site_id, l.line_code, p.grain, p.year::text AS year
     FROM pnl_lines l JOIN pnl_periods p ON p.entity_id = l.period_id`,
  );
  const counts = {
    dryRun: !options.write,
    sites: sites.rows.filter((row) => !isExcludedSite(row.site_id)).length,
    brokers: sites.rows.filter((row) => !isExcludedSite(row.site_id) && (scrub(row.broker) || scrub(row.firm))).length,
    comms: comms.rows.filter((row) => !isExcludedSite(row.site_id)).length,
    notes: notes.rows.filter((row) => !isExcludedSite(row.target_id)).length,
    activities: activities.rows.filter((row) => !isExcludedSite(row.site_id)).length,
    pnl: pnl.rows.filter((row) => !isExcludedSite(row.site_id)).length,
    embedded: 0,
  };
  if (!options.write) return counts;
  for (const row of sites.rows) {
    await indexRecord(sql, { entityType: "site", entityId: row.site_id, siteId: row.site_id, payload: row });
  }
  for (const row of comms.rows) {
    await indexRecord(sql, {
      entityType: "comms",
      entityId: row.entity_id,
      siteId: row.site_id,
      payload: { person: row.person, summary: row.summary },
    });
  }
  for (const row of notes.rows) {
    await indexRecord(sql, { entityType: "note", entityId: row.id, siteId: row.target_id, payload: { body: row.body } });
  }
  for (const row of activities.rows) {
    await indexRecord(sql, {
      entityType: "activity",
      entityId: row.entity_id,
      siteId: row.site_id,
      payload: { type: row.type, summary: row.summary },
    });
  }
  for (const row of pnl.rows) {
    await indexRecord(sql, {
      entityType: "pnl_line",
      entityId: row.entity_id,
      siteId: row.site_id,
      payload: { line: row.line_code, grain: row.grain, year: row.year },
    });
  }
  if (options.embed) {
    const embedded = await embedPending(sql);
    counts.embedded = embedded.embedded;
  }
  return counts;
}

export function productionBackfillAllowed(confirm: boolean): { ok: true } | { ok: false; reason: string } {
  return backfillDecision(databaseUrl(), confirm);
}
