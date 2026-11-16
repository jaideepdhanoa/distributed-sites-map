import { createHash } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { applyParsedChanges } from "./apply";
import { isProductionDatabase } from "./guard";
import { ACTIVITY_HEADER_ROW, ACTIVITY_SHEET, SPREADSHEET_ID, type SheetRender, type SheetTable } from "./mirror";
import { parseZonedTimestamp, type Actor, type ActivityPayload } from "./schema";
import { loadSheetTable, readSheetRanges } from "./sheetTable";
import { shortHash } from "./site";
import { SITE_ID } from "./vocab";

const ACTOR: Actor = { id: "workbook-sync", kind: "agent" };
const SOURCE = "workbook row";
const ACTIVITY_ID = /^A-\d{4,}$/;

export type CaptureSheetRow = {
  entityId: string;
  siteId: string;
  when: string;
  summary: string;
  sourceLink: string;
};

export type CaptureStamp = { date: string; dateIso?: string; approximate: boolean };

type StoredCapture = {
  entity_id: string;
  site_id: string;
  version: number;
  date: string;
  date_iso: string;
  summary: string;
  source_link: string;
  approximate: boolean;
};

export type CapturePlanItem = {
  hash: string;
  action: "insert" | "update";
  entityId: string;
  siteId: string;
  date: string;
  dateIso: string;
  approximate: boolean;
  summary: string;
  sourceLink: string;
  version: number;
};

export type CapturePlan = {
  inserts: CapturePlanItem[];
  updates: CapturePlanItem[];
  unchanged: number;
  skipped: string[];
  digest: string;
};

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

function calendar(yearText: string, monthText: string, dayText: string): string | null {
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A date with no clock stays date-only and approximate. A zoned clock keeps its offset. */
export function parseCaptureWhen(value: string): CaptureStamp | null {
  const raw = value.trim();
  if (!raw) return null;
  const zoned = parseZonedTimestamp(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw);
  if (zoned) return { date: zoned.date, dateIso: zoned.iso, approximate: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, approximate: true };
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
  if (mdy) {
    const date = calendar(mdy[3], mdy[1], mdy[2]);
    return date ? { date, approximate: true } : null;
  }
  const clock = /^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}/.exec(raw) || /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+\d{1,2}:\d{2}/.exec(raw);
  if (clock) {
    const date = clock.length === 2 ? clock[1] : calendar(clock[3], clock[1], clock[2]);
    return date ? { date, approximate: false } : null;
  }
  return null;
}

function column(headers: string[], names: string[]): number {
  const wanted = new Set(names);
  return headers.findIndex((header) => wanted.has(header.trim().toLowerCase()));
}

/** Capture rows from an Activity tab. Other types are ignored. Cell text is not returned to logs. */
export function capturesFromActivityTable(table: SheetTable): CaptureSheetRow[] {
  const idAt = column(table.headers, ["event id"]);
  const dateAt = column(table.headers, ["date", "when"]);
  const siteAt = column(table.headers, ["site id", "site_id", "record id"]);
  const typeAt = column(table.headers, ["type", "kind"]);
  const summaryAt = column(table.headers, ["summary"]);
  const linkAt = column(table.headers, ["source link", "source_link"]);
  if (idAt < 0 || dateAt < 0 || siteAt < 0 || typeAt < 0) return [];
  const rows: CaptureSheetRow[] = [];
  for (const row of table.rows) {
    if (text(row.cells[typeAt]).toLowerCase() !== "capture") continue;
    rows.push({
      entityId: text(row.cells[idAt]),
      siteId: text(row.cells[siteAt]).toUpperCase(),
      when: text(row.cells[dateAt]),
      summary: text(summaryAt >= 0 ? row.cells[summaryAt] : "").replace(/\s+/g, " ").slice(0, 300),
      sourceLink: text(linkAt >= 0 ? row.cells[linkAt] : "").slice(0, 500),
    });
  }
  return rows;
}

export async function readCaptureRows(token: string): Promise<CaptureSheetRow[]> {
  const read = (ranges: string[], kind: SheetRender) => readSheetRanges(token, SPREADSHEET_ID, ranges, kind);
  const table = await loadSheetTable(read, ACTIVITY_SHEET, ACTIVITY_HEADER_ROW, [
    ["event id"],
    ["date", "when"],
    ["site id", "site_id", "record id"],
    ["type", "kind"],
    ["summary"],
    ["source link", "source_link"],
  ]);
  return capturesFromActivityTable(table);
}

function same(stored: StoredCapture, item: CapturePlanItem): boolean {
  return stored.site_id === item.siteId
    && stored.date === item.date
    && stored.date_iso === item.dateIso
    && stored.summary === item.summary
    && stored.source_link === item.sourceLink
    && stored.approximate === item.approximate;
}

/** Workbook capture rows, kept on their A- ids. Date-only cells stay approximate. */
export function planCaptureImport(rows: CaptureSheetRow[], stored: StoredCapture[]): CapturePlan {
  const have = new Map(stored.map((row) => [row.entity_id, row]));
  const inserts: CapturePlanItem[] = [];
  const updates: CapturePlanItem[] = [];
  const skipped: string[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const entityId = row.entityId.trim();
    const siteId = row.siteId.trim().toUpperCase();
    if (isExcludedSite(siteId)) continue;
    if (!ACTIVITY_ID.test(entityId) || !SITE_ID.test(siteId) || seen.has(entityId)) {
      if (entityId) skipped.push(shortHash(entityId));
      continue;
    }
    seen.add(entityId);
    const when = parseCaptureWhen(row.when);
    const summary = row.summary.trim();
    if (!when || !summary) {
      skipped.push(shortHash(entityId));
      continue;
    }
    const prior = have.get(entityId);
    const item: CapturePlanItem = {
      hash: shortHash(entityId),
      action: prior ? "update" : "insert",
      entityId,
      siteId,
      date: when.date,
      dateIso: when.dateIso || "",
      approximate: when.approximate,
      summary,
      sourceLink: row.sourceLink.trim(),
      version: prior ? prior.version : 0,
    };
    if (prior && same(prior, item)) {
      unchanged += 1;
      continue;
    }
    if (prior) updates.push(item);
    else inserts.push(item);
  }
  const rank = (item: CapturePlanItem) => item.hash;
  inserts.sort((a, b) => rank(a).localeCompare(rank(b)));
  updates.sort((a, b) => rank(a).localeCompare(rank(b)));
  skipped.sort();
  const digest = createHash("sha256")
    .update([...inserts, ...updates].map((item) => `${item.action}:${item.hash}:${item.version}:${item.date}:${item.approximate ? "1" : "0"}:${shortHash(item.summary)}:${shortHash(item.sourceLink)}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { inserts, updates, unchanged, skipped, digest };
}

export async function loadCapturePlan(sql: Sql, rows: CaptureSheetRow[]): Promise<CapturePlan> {
  const ids = [...new Set(rows.map((row) => row.entityId.trim()).filter((id) => ACTIVITY_ID.test(id)))];
  const result = ids.length
    ? await sql.query<{ entity_id: string; site_id: string; payload: unknown; version: number | string }>(
        `SELECT entity_id, site_id, payload, version FROM activities WHERE entity_id = ANY($1::text[])`,
        [ids],
      )
    : { rows: [] };
  const stored: StoredCapture[] = result.rows.map((row) => {
    const payload = asObject(row.payload);
    return {
      entity_id: text(row.entity_id),
      site_id: text(row.site_id),
      version: Number(row.version),
      date: text(payload.date),
      date_iso: text(payload.date_iso),
      summary: text(payload.summary),
      source_link: text(payload.source_link),
      approximate: payload.at_approximate === true,
    };
  });
  return planCaptureImport(rows, stored);
}

/** Counts and hashed ids only. */
export function formatCapturePlan(plan: CapturePlan): string {
  const lines = [
    `insert ${plan.inserts.length}`,
    `update ${plan.updates.length}`,
    `unchanged ${plan.unchanged}`,
    `skipped ${plan.skipped.length}`,
  ];
  for (const item of plan.inserts) lines.push(`- insert #${item.hash}`);
  for (const item of plan.updates) lines.push(`- update #${item.hash}`);
  for (const hash of plan.skipped) lines.push(`- skipped #${hash}`);
  return lines.join("\n");
}

export function assertCaptureImportApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== "import-capture-activity") {
    throw new Error("Refusing to import capture rows. Dry run is the default. Set CONFIRM=import-capture-activity to apply.");
  }
  if (isProductionDatabase(url)) {
    throw new Error("Refusing to import capture rows into the production database.");
  }
}

export async function applyCaptureImport(sql: Sql, plan: CapturePlan): Promise<number> {
  const items = [...plan.inserts, ...plan.updates];
  let written = 0;
  for (let index = 0; index < items.length; index += 100) {
    const batch = items.slice(index, index + 100);
    const changes = batch.map((item) => {
      const payload: ActivityPayload = {
        date: item.date,
        type: "capture",
        summary: item.summary,
        at_approximate: item.approximate,
      };
      if (item.dateIso) payload.date_iso = item.dateIso;
      if (item.sourceLink) payload.source_link = item.sourceLink;
      return {
        entity_type: "activity" as const,
        site_id: item.siteId,
        entity_id: item.entityId,
        preserve_id: true,
        expected_version: item.version,
        source: SOURCE,
        payload,
      };
    });
    await applyParsedChanges(sql, ACTOR, `capture-import-${plan.digest}-${index}`, changes, "import capture activity", "workbook");
    written += batch.length;
  }
  return written;
}
