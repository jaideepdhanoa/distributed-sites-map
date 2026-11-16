import type { Sql } from "@/lib/actions/db";
import { applyParsedChanges } from "./apply";
import type { Actor, CommsPayload } from "./schema";
import { losesSheetDate, sameSheetDate, shortHash } from "./site";

const ACTOR: Actor = { id: "workbook-sync", kind: "agent" };

export type DateRestore = { entity_id: string; site_id: string; version: number; chars: number; hash: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/**
 * Rows whose sheet Date/time would be erased by the stored value.
 * The plan has ids, lengths, and hashes. It does not include the cell text.
 */
export function planDateRestore(
  rows: { entity_id: string; site_id: string; at: string; at_text: string; version: number }[],
  sheet: Map<string, string>,
): DateRestore[] {
  const plan: DateRestore[] = [];
  for (const row of rows) {
    const cell = (sheet.get(row.entity_id) || "").trim();
    if (!cell) continue;
    const stored = row.at_text || row.at;
    if (sameSheetDate(cell, stored) || row.at_text === cell) continue;
    if (!losesSheetDate(cell, stored)) continue;
    plan.push({
      entity_id: row.entity_id,
      site_id: row.site_id,
      version: row.version,
      chars: cell.length,
      hash: shortHash(cell),
    });
  }
  plan.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return plan;
}

export function formatDatePlan(plan: DateRestore[]): string {
  if (!plan.length) return "No comms dates to restore.";
  return plan.map((row) => `${row.entity_id} ${row.chars} #${row.hash}`).join("\n");
}

export async function loadCommsDates(sql: Sql): Promise<{ entity_id: string; site_id: string; at: string; at_text: string; direction: string; version: number }[]> {
  const result = await sql.query<{ entity_id: string; site_id: string; payload: unknown; version: number | string }>(
    `SELECT entity_id, site_id, payload, version FROM comms_entries ORDER BY entity_id`,
  );
  return result.rows.map((row) => {
    const payload = asObject(row.payload);
    return {
      entity_id: text(row.entity_id),
      site_id: text(row.site_id),
      at: text(payload.at),
      at_text: text(payload.at_text),
      direction: text(payload.direction),
      version: Number(row.version),
    };
  });
}

/** Copies the sheet Date/time into at_text. Other fields stay. The text is not printed. */
export async function applyDateRestore(sql: Sql, sheet: Map<string, string>, plan: DateRestore[]): Promise<number> {
  if (!plan.length) return 0;
  const current = await sql.query<{ entity_id: string; payload: unknown }>(
    `SELECT entity_id, payload FROM comms_entries WHERE entity_id = ANY($1::text[])`,
    [plan.map((row) => row.entity_id)],
  );
  const payloadOf = new Map(current.rows.map((row) => [text(row.entity_id), asObject(row.payload)]));
  const changes = plan.map((row) => {
    const prior = payloadOf.get(row.entity_id) || {};
    const direction = text(prior.direction);
    const payload: CommsPayload = {
      direction: (direction === "out" || direction === "internal" ? direction : "in") as CommsPayload["direction"],
      at: text(prior.at),
      at_text: sheet.get(row.entity_id) || "",
      at_approximate: prior.at_approximate === true,
      summary: text(prior.summary),
      person: text(prior.person),
      firm: text(prior.firm),
      channel: text(prior.channel),
      subject: text(prior.subject),
      site_ids: text(prior.site_ids) || row.site_id,
      thread_id: text(prior.thread_id),
      link: text(prior.link),
      asks_made: text(prior.asks_made),
      asks_answered: text(prior.asks_answered),
      attachments: text(prior.attachments),
      state_changes: text(prior.state_changes),
      workbook_source: text(prior.workbook_source),
      message_id: text(prior.message_id),
    };
    return {
      entity_type: "comms" as const,
      site_id: row.site_id,
      entity_id: row.entity_id,
      preserve_id: true,
      expected_version: row.version,
      source: "comms date restore",
      payload,
    };
  });
  await applyParsedChanges(sql, ACTOR, `comms-date-restore-${plan.map((row) => row.entity_id).join(",")}`, changes, "restore comms date text", "workbook");
  return changes.length;
}
