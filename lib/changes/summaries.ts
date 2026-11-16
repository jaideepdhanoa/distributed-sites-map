import type { Sql } from "@/lib/actions/db";
import { applyParsedChanges } from "./apply";
import { COMMS_HEADER_ROW, COMMS_SHEET, SPREADSHEET_ID, type SheetRender, type SheetTable } from "./mirror";
import type { Actor, CommsPayload } from "./schema";
import { isTruncatedCell } from "./site";
import { loadSheetTable, readSheetRanges } from "./sheetTable";
import type { WorkbookSlice } from "./workbook";

const ACTOR: Actor = { id: "workbook-sync", kind: "agent" };

export type SummaryRestore = {
  entity_id: string;
  site_id: string;
  direction: string;
  version: number;
  fromLength: number;
  toLength: number;
};

type FullRow = { comms_id?: unknown; summary?: unknown };

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

/** One line, no 300-character cut. The public snapshot still clips; the sheet does not. */
export function fullSummaryText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Comms ID to the full Summary cell. Whitespace is collapsed and nothing is clipped. */
export function summariesFromCommsTable(table: SheetTable): Map<string, string> {
  const idAt = table.headers.findIndex((header) => header.trim().toLowerCase() === "comms id");
  const summaryAt = table.headers.findIndex((header) => header.trim().toLowerCase() === "summary");
  const out = new Map<string, string>();
  if (idAt < 0 || summaryAt < 0) return out;
  for (const row of table.rows) {
    const id = text(row.cells[idAt]);
    const summary = fullSummaryText(String(row.cells[summaryAt] ?? ""));
    if (id && summary) out.set(id, summary);
  }
  return out;
}

/** Comms ID to the Date/time cell, whitespace collapsed and not clipped. */
export function datesFromCommsTable(table: SheetTable): Map<string, string> {
  const idAt = table.headers.findIndex((header) => header.trim().toLowerCase() === "comms id");
  const dateAt = table.headers.findIndex((header) => header.trim().toLowerCase() === "date/time");
  const out = new Map<string, string>();
  if (idAt < 0 || dateAt < 0) return out;
  for (const row of table.rows) {
    const id = text(row.cells[idAt]);
    const when = fullSummaryText(String(row.cells[dateAt] ?? ""));
    if (id && when) out.set(id, when);
  }
  return out;
}

/** The Comms Log Date/time column, one batched values read. The cell text is not logged. */
export async function readCommsDates(token: string): Promise<Map<string, string>> {
  const read = (ranges: string[], kind: SheetRender) => readSheetRanges(token, SPREADSHEET_ID, ranges, kind);
  const table = await loadSheetTable(read, COMMS_SHEET, COMMS_HEADER_ROW, [["comms id"], ["date/time"]]);
  return datesFromCommsTable(table);
}

/** The Comms Log tab, one batched values read with the Sheets retry. Summary text is not logged. */
export async function readCommsSummaries(token: string): Promise<Map<string, string>> {
  const read = (ranges: string[], kind: SheetRender) => readSheetRanges(token, SPREADSHEET_ID, ranges, kind);
  const table = await loadSheetTable(read, COMMS_SHEET, COMMS_HEADER_ROW, [["comms id"], ["summary"]]);
  return summariesFromCommsTable(table);
}

/** Replace clipped snapshot summaries with the sheet text. Ids that are missing stay as they are. */
export function overlaySummaryMap(slice: WorkbookSlice, full: Map<string, string>): WorkbookSlice {
  if (!full.size) return slice;
  return {
    ...slice,
    comms: slice.comms.map((row) => {
      const summary = full.get(row.entity_id);
      if (!summary) return row;
      return { ...row, summary };
    }),
  };
}

/** Replace clipped snapshot summaries with the private full text. Ids that are missing stay as they are. */
export function overlayFullSummaries(slice: WorkbookSlice, body: string): WorkbookSlice {
  return overlaySummaryMap(slice, fullSummaries(body));
}

export function fullSummaries(body: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!body.trim()) return out;
  let parsed: { rows?: FullRow[] };
  try {
    parsed = JSON.parse(body) as { rows?: FullRow[] };
  } catch {
    return out;
  }
  for (const row of parsed.rows || []) {
    const id = text(row.comms_id);
    const summary = text(row.summary);
    if (id && summary) out.set(id, summary);
  }
  return out;
}

/**
 * Rows whose stored summary is only a prefix of the full workbook summary.
 * The result has lengths, not the text.
 */
export function planSummaryRestore(
  rows: { entity_id: string; site_id: string; summary: string; direction: string; version: number }[],
  full: Map<string, string>,
): SummaryRestore[] {
  const plan: SummaryRestore[] = [];
  for (const row of rows) {
    const next = full.get(row.entity_id);
    if (!next || !isTruncatedCell(next, row.summary)) continue;
    if (row.direction !== "in" && row.direction !== "out" && row.direction !== "internal") continue;
    plan.push({
      entity_id: row.entity_id,
      site_id: row.site_id,
      direction: row.direction,
      version: row.version,
      fromLength: row.summary.trim().length,
      toLength: next.length,
    });
  }
  plan.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return plan;
}

export function formatSummaryPlan(plan: SummaryRestore[]): string {
  if (!plan.length) return "No comms summaries to restore.";
  return plan.map((row) => `${row.entity_id} ${row.fromLength} -> ${row.toLength}`).join("\n");
}

export async function loadCommsSummaries(sql: Sql): Promise<{ entity_id: string; site_id: string; summary: string; direction: string; version: number }[]> {
  const result = await sql.query<{ entity_id: string; site_id: string; payload: unknown; version: number | string }>(
    `SELECT entity_id, site_id, payload, version FROM comms_entries ORDER BY entity_id`,
  );
  return result.rows.map((row) => {
    const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : ((row.payload || {}) as Record<string, unknown>);
    return {
      entity_id: text(row.entity_id),
      site_id: text(row.site_id),
      summary: text(payload.summary),
      direction: text(payload.direction),
      version: Number(row.version),
    };
  });
}

/** Writes the full summary onto rows the plan already chose. Other cells are copied. The text is not printed. */
export async function applySummaryRestore(sql: Sql, full: Map<string, string>, plan: SummaryRestore[]): Promise<number> {
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
      summary: full.get(row.entity_id) || "",
      at: text(prior.at),
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
      source: "comms summary restore",
      payload,
    };
  });
  await applyParsedChanges(sql, ACTOR, `comms-summary-restore-${plan.map((row) => row.entity_id).join(",")}`, changes, "restore full comms summaries", "workbook");
  return changes.length;
}
