import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { Sql } from "@/lib/actions/db";
import { readEntityFromDb, type ShadowEntity } from "./flags";
import { labeledIdFloors, numericSuffix } from "./apply";
import { derivePowerRating, type PowerRatingName } from "@/lib/score/power-rating";
import { DERIVED_POWER_HEADER, columnsToAppend, isPowerRatingName, rowsToAppend } from "@/lib/score/power-sheet";
import { MIRROR_FIELD_HEADERS, isDateField, isTruncatedCell, losesSheetDate, mirrorCellInput, mirrorHeaderAllowed, parseSheet, sameCommsStamp, sameSheetDate, sameWorkbookCell, sheetAllowsApprox, shortHash, withSheetStamp } from "./site";
import { COMMS_FIELDS, type CommsField } from "./vocab";

/** The quarantined pipeline row. Never written. */
export const PROTECTED_SITE_ID = "PIPE-PHX-0006";
export const PROTECTED_ROW = 10;

export const SPREADSHEET_ID = "167rIKoApP3sMJ3vrp1lg3MT-h5yQGqmMhY_TbBIqByY";

/** The sync token uses drive.readonly. Cell writes need the Sheets scope. */
export const MIRROR_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** How a cell is read. Unformatted values and formulas are for the site tabs only. */
export type SheetRender = "formatted" | "unformatted" | "formulas";

export function sheetValueRender(kind: SheetRender): "UNFORMATTED_VALUE" | "FORMULA" | null {
  if (kind === "formulas") return "FORMULA";
  if (kind === "unformatted") return "UNFORMATTED_VALUE";
  return null;
}
export const SYNC_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export type CellChange = {
  sheet: string;
  row: number;
  column: number;
  header: string;
  id: string;
  before: string;
  after: string;
  /** RAW for text. USER_ENTERED for numeric and date site cells. */
  valueInput?: "RAW" | "USER_ENTERED";
};

export type SheetTable = {
  title: string;
  headerRow: number;
  headers: string[];
  rows: { row: number; cells: string[]; formulas?: string[] }[];
};

export type MirrorPlan = {
  changes: CellChange[];
  skippedProtected: number;
  unmatched: string[];
  appended: number;
  /** Sheet ids whose database rows were never imported and do not match the sheet. */
  refused: string[];
  /** Cells skipped because the database value is only a prefix of the sheet. */
  held: { id: string; header: string }[];
};

function emptyPlan(): MirrorPlan {
  return { changes: [], skippedProtected: 0, unmatched: [], appended: 0, refused: [], held: [] };
}

const STAGE_TABS = [
  { title: "Pipeline", headerRow: 4 },
  { title: "Land Sites", headerRow: 4 },
] as const;

const ACTIVITY_FIELDS: { headers: string[]; key: string }[] = [
  { headers: ["event id"], key: "id" },
  { headers: ["date", "when"], key: "date" },
  { headers: ["site id", "site_id", "record id"], key: "site_id" },
  { headers: ["type", "kind"], key: "type" },
  { headers: ["summary"], key: "summary" },
  { headers: ["source link", "source_link"], key: "source_link" },
];

const COMMS_FIELDS_BY_HEADER: { headers: string[]; key: string }[] = [
  { headers: ["comms id"], key: "id" },
  { headers: ["site ids"], key: "site_ids" },
  { headers: ["thread id"], key: "thread_id" },
  { headers: ["link"], key: "link" },
  { headers: ["date/time"], key: "at" },
  { headers: ["direction"], key: "direction" },
  { headers: ["counterparty person"], key: "person" },
  { headers: ["counterparty firm"], key: "firm" },
  { headers: ["channel"], key: "channel" },
  { headers: ["summary"], key: "summary" },
  { headers: ["asks made"], key: "asks_made" },
  { headers: ["asks answered"], key: "asks_answered" },
  { headers: ["attachments"], key: "attachments" },
  { headers: ["state changes"], key: "state_changes" },
  { headers: ["source"], key: "workbook_source" },
  { headers: ["message id"], key: "message_id" },
  { headers: ["subject"], key: "subject" },
];

export function columnLetters(column: number): string {
  let n = column;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function a1(sheet: string, row: number, column: number): string {
  const title = /[^A-Za-z0-9]/.test(sheet) ? `'${sheet.replaceAll("'", "''")}'` : sheet;
  return `${title}!${columnLetters(column)}${row}`;
}

function normHeader(value: string): string {
  return value.trim().toLowerCase();
}

function cellText(value: string | undefined): string {
  return String(value ?? "").trim();
}

function headerIndex(headers: string[], names: string[]): number {
  const wanted = new Set(names.map(normHeader));
  return headers.findIndex((header) => wanted.has(normHeader(header)));
}

function nextAppendRow(rows: { row: number }[], headerRow: number, protectRow: boolean): number {
  const max = rows.reduce((best, row) => Math.max(best, row.row), headerRow);
  let row = max + 1;
  if (protectRow) while (row === PROTECTED_ROW) row += 1;
  return row;
}

export function siteFlagSimulation(): boolean {
  const value = process.env.SIMULATE_SITE_FLAG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

/** A site-flag dry run is the only place that variable may be forced on. */
export function assertSiteFlagSimulation(): void {
  if (!siteFlagSimulation()) return;
  if (!mirrorDryRun()) {
    throw new Error("simulate_site_flag is only allowed when dry_run is true.");
  }
}

/** The sheet copy stays off on every Vercel environment, including when the flag is 1. */
export function workbookMirrorEnabled(): boolean {
  if (process.env.VERCEL_ENV) return false;
  return process.env.WORKBOOK_MIRROR_ENABLED === "1";
}

export function assertWorkbookMirrorAllowed(): void {
  assertSiteFlagSimulation();
  if (process.env.VERCEL_ENV) {
    throw new Error("Refusing to mirror the workbook from Vercel.");
  }
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    throw new Error("Refusing to mirror the workbook from a pull request.");
  }
  const ref = process.env.GITHUB_REF?.trim();
  if (process.env.GITHUB_ACTIONS === "true" && ref !== "refs/heads/main") {
    throw new Error("The workbook mirror runs only on main.");
  }
  if (mirrorDryRun()) return;
  if (!workbookMirrorEnabled()) {
    throw new Error(
      "WORKBOOK_MIRROR_ENABLED is not 1. Set the repository variable WORKBOOK_MIRROR_ENABLED to 1 to copy database rows into the workbook.",
    );
  }
}

export function mirrorDryRun(): boolean {
  const value = process.env.WORKBOOK_MIRROR_DRY_RUN?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

type RecordRow = { id: string; values: Record<string, string>; imported?: boolean };

function cellsEqual(input: { sameCell?: (key: string, before: string, after: string) => boolean }, key: string, before: string, after: string): boolean {
  return input.sameCell ? input.sameCell(key, before, after) : sameWorkbookCell(before, after);
}

function planTable(input: {
  table: SheetTable;
  idHeaders: string[];
  fields: { headers: string[]; key: string }[];
  records: RecordRow[];
  append: boolean;
  protectRow: boolean;
  idPattern?: RegExp;
  skipBlank?: boolean;
  /** Optional. The mirror does not set this. A caller can still refuse an unimported collision instead of overwriting it. */
  refuseUnimported?: boolean;
  /** Never replace a sheet cell with a clipped prefix of itself. */
  holdTruncation?: boolean;
  sameCell?: (key: string, before: string, after: string) => boolean;
  appendValue?: (key: string, value: string, samples: string[]) => string;
}): MirrorPlan {
  const idAt = headerIndex(input.table.headers, input.idHeaders);
  if (idAt < 0) {
    throw new Error(`${input.table.title} is missing an id column (${input.idHeaders.join(", ")}).`);
  }
  const columns = input.fields.map((field) => ({
    ...field,
    index: headerIndex(input.table.headers, field.headers),
  }));
  const required = columns.filter((column) => column.key === "id" || column.headers.includes("stage"));
  for (const column of required) {
    if (column.index < 0) throw new Error(`${input.table.title} is missing the ${column.headers[0]} column.`);
  }
  const byId = new Map<string, { row: number; cells: string[]; formulas?: string[] }>();
  for (const row of input.table.rows) {
    const id = cellText(row.cells[idAt]);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  const changes: CellChange[] = [];
  const unmatched: string[] = [];
  const refused: string[] = [];
  const held: { id: string; header: string }[] = [];
  let skippedProtected = 0;
  let appended = 0;
  const samplesFor = (index: number): string[] => {
    if (index < 0) return [];
    return input.table.rows.map((row) => cellText(row.cells[index])).filter(Boolean);
  };
  const writtenValue = (key: string, value: string, index: number): string => {
    const text = cellText(value);
    return input.appendValue ? input.appendValue(key, text, samplesFor(index)) : text;
  };
  for (const record of input.records) {
    if (record.id === PROTECTED_SITE_ID) {
      skippedProtected += 1;
      continue;
    }
    const existing = byId.get(record.id);
    if (input.protectRow && existing && existing.row === PROTECTED_ROW) {
      skippedProtected += 1;
      continue;
    }
    if (!existing) {
      if (!input.append || (input.idPattern && !input.idPattern.test(record.id))) {
        unmatched.push(record.id);
        continue;
      }
      const row = nextAppendRow(input.table.rows, input.table.headerRow, input.protectRow);
      appended += 1;
      const stored: string[] = [];
      for (const column of columns) {
        if (column.index < 0) continue;
        const after = writtenValue(column.key, record.values[column.key] || "", column.index);
        stored[column.index] = after;
        if (input.skipBlank && column.key !== "id" && !after) continue;
        changes.push({
          sheet: input.table.title,
          row,
          column: column.index + 1,
          header: input.table.headers[column.index] || column.headers[0],
          id: record.id,
          before: "",
          after,
        });
      }
      input.table.rows.push({ row, cells: stored });
      continue;
    }
    if (input.refuseUnimported && record.imported === false) {
      const conflict = columns.some((column) => {
        if (column.index < 0 || column.key === "id") return false;
        const after = cellText(record.values[column.key]);
        if (input.skipBlank && !after) return false;
        const before = cellText(existing.cells[column.index]);
        if (cellsEqual(input, column.key, before, after)) return false;
        if (input.holdTruncation && isTruncatedCell(before, after)) return false;
        return true;
      });
      if (conflict) {
        refused.push(record.id);
        continue;
      }
    }
    for (const column of columns) {
      if (column.index < 0 || column.key === "id") continue;
      const formula = cellText(existing.formulas?.[column.index]);
      if (formula.startsWith("=")) continue;
      const after = cellText(record.values[column.key]);
      if (input.skipBlank && !after) continue;
      const before = cellText(existing.cells[column.index]);
      const header = input.table.headers[column.index] || column.headers[0];
      let next = after;
      if (isDateField(column.key, header)) {
        const raw = cellText(record.values.at_text);
        const iso = cellText(record.values.at_iso);
        const approximate = record.values.at_approximate === "1";
        if (raw && sameSheetDate(before, raw)) continue;
        if (approximate && iso) {
          if (!sheetAllowsApprox(before, iso)) {
            held.push({ id: record.id, header });
            continue;
          }
          next = `${iso} (approx.)`;
        }
        if (sameSheetDate(before, next)) continue;
        if (losesSheetDate(before, next)) {
          held.push({ id: record.id, header });
          continue;
        }
      } else if (cellsEqual(input, column.key, before, next)) continue;
      if (input.holdTruncation && isTruncatedCell(before, next)) {
        held.push({ id: record.id, header });
        continue;
      }
      changes.push({
        sheet: input.table.title,
        row: existing.row,
        column: column.index + 1,
        header,
        id: record.id,
        before,
        after: next,
      });
    }
  }
  return { changes, skippedProtected, unmatched, appended, refused, held };
}

export function planStageMirror(tables: SheetTable[], stages: { site_id: string; stage: string }[]): MirrorPlan {
  const combined: MirrorPlan = emptyPlan();
  const claimed = new Set<string>();
  const writable = stages.filter((row) => row.site_id !== PROTECTED_SITE_ID);
  if (writable.length !== stages.length) combined.skippedProtected += 1;
  for (const table of tables) {
    const plan = planTable({
      table,
      idHeaders: ["site id"],
      fields: [
        { headers: ["site id"], key: "id" },
        { headers: ["stage"], key: "stage" },
      ],
      records: writable
        .filter((row) => !claimed.has(row.site_id))
        .map((row) => ({ id: row.site_id, values: { id: row.site_id, stage: row.stage } })),
      append: false,
      protectRow: true,
    });
    for (const row of table.rows) {
      const idAt = headerIndex(table.headers, ["site id"]);
      const id = cellText(row.cells[idAt]);
      if (id) claimed.add(id);
    }
    combined.changes.push(...plan.changes);
    combined.skippedProtected += plan.skippedProtected;
    combined.unmatched.push(...plan.unmatched.filter((id) => !claimed.has(id)));
    combined.refused.push(...plan.refused);
    combined.held.push(...plan.held);
  }
  const seen = new Set<string>();
  combined.unmatched = combined.unmatched.filter((id) => {
    if (claimed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return combined;
}

function headerAliases(header: string): string[] {
  const norm = header.trim().toLowerCase();
  const row = MIRROR_FIELD_HEADERS.find((item) => item.headers.some((name) => name.toLowerCase() === norm));
  return (row?.headers || [header]).map((name) => name.toLowerCase());
}

/** Write only headers an API change touched, and only those on the allow-list. A fresh import has no writes. */
export function planSiteMirror(
  tables: SheetTable[],
  sites: { site_id: string; writes?: Record<string, string>; cells?: Record<string, string> }[],
): MirrorPlan {
  const combined: MirrorPlan = emptyPlan();
  const claimed = new Set<string>();
  const writable = sites.filter((row) => row.site_id !== PROTECTED_SITE_ID);
  if (writable.length !== sites.length) combined.skippedProtected += 1;
  for (const table of tables) {
    const idAt = headerIndex(table.headers, ["site id"]);
    if (idAt < 0) throw new Error(`${table.title} is missing an id column (site id).`);
    const byId = new Map<string, { row: number; cells: string[]; formulas?: string[] }>();
    for (const row of table.rows) {
      const id = cellText(row.cells[idAt]);
      if (id && !byId.has(id)) byId.set(id, row);
      if (id) claimed.add(id);
    }
    for (const record of writable) {
      if (claimed.has(record.site_id) && !byId.has(record.site_id)) continue;
      const existing = byId.get(record.site_id);
      if (!existing) {
        if (!claimed.has(record.site_id)) combined.unmatched.push(record.site_id);
        continue;
      }
      if (existing.row === PROTECTED_ROW) {
        combined.skippedProtected += 1;
        continue;
      }
      const writes = record.writes || {};
      for (const [key, raw] of Object.entries(writes)) {
        if (!mirrorHeaderAllowed(key)) continue;
        const wanted = new Set(headerAliases(key));
        const index = table.headers.findIndex((header) => wanted.has(header.trim().toLowerCase()));
        if (index < 0) continue;
        const formula = cellText(existing.formulas?.[index]);
        if (formula.startsWith("=")) continue;
        const after = cellText(raw);
        const before = cellText(existing.cells[index]);
        const header = table.headers[index] || key;
        if (isDateField(key, header)) {
          if (sameSheetDate(before, after)) continue;
          if (losesSheetDate(before, after)) {
            combined.held.push({ id: record.site_id, header });
            continue;
          }
        }
        if (!after) continue;
        if (sameWorkbookCell(before, after)) continue;
        if (isTruncatedCell(before, after)) {
          combined.held.push({ id: record.site_id, header });
          continue;
        }
        combined.changes.push({
          sheet: table.title,
          row: existing.row,
          column: index + 1,
          header: table.headers[index] || key,
          id: record.site_id,
          before,
          after,
          valueInput: mirrorCellInput(table.headers[index] || key),
        });
      }
    }
  }
  const seen = new Set<string>();
  combined.unmatched = combined.unmatched.filter((id) => {
    if (claimed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return combined;
}

export type CreatedSiteMirror = {
  site_id: string;
  kind: "pipeline" | "land";
  values: Record<string, string>;
};

export type UniverseMirrorRow = {
  universe_id: string;
  values: Record<string, string>;
};

/** Append a server-minted site onto Pipeline or Land Sites. Existing rows stay on the update path. */
export function planCreatedSiteMirror(tables: SheetTable[], rows: CreatedSiteMirror[]): MirrorPlan {
  const combined = emptyPlan();
  for (const table of tables) {
    const kind = table.title === "Land Sites" ? "land" : table.title === "Pipeline" ? "pipeline" : "";
    if (!kind) continue;
    const records = rows.filter((row) => row.kind === kind && row.site_id !== PROTECTED_SITE_ID);
    const plan = planTable({
      table,
      idHeaders: ["site id"],
      fields: CREATED_SITE_FIELDS,
      records: records.map((row) => ({ id: row.site_id, values: { ...row.values, id: row.site_id } })),
      append: true,
      protectRow: true,
      idPattern: /^(PIPE|LAND)-[A-Z]{2,4}-\d{4,}$/,
      skipBlank: true,
    });
    combined.changes.push(...plan.changes);
    combined.skippedProtected += plan.skippedProtected;
    combined.unmatched.push(...plan.unmatched);
    combined.appended += plan.appended;
    combined.refused.push(...plan.refused);
    combined.held.push(...plan.held);
  }
  return combined;
}

function lastUsedHeader(headers: string[]): number {
  let last = 0;
  headers.forEach((header, index) => {
    if (header.trim()) last = index + 1;
  });
  return last;
}

/** Market, business name, and address. A blank part cannot identify a row. */
export function universeMatchKey(market: string, name: string, address: string): string {
  const norm = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const parts = [norm(market), norm(name), norm(address)];
  if (parts.some((part) => !part)) return "";
  return parts.join("|");
}

function columnText(headers: string[], cells: string[], names: string[]): string {
  const index = headerIndex(headers, names);
  if (index < 0) return "";
  return cellText(cells[index]);
}

/**
 * Append a minted Universe row. The id is the WB- id already stored.
 * A missing id column is added. Existing legacy cells are not rewritten:
 * a blank id is filled only when one sheet row and one database row share
 * the same market, name, and address.
 */
export function planUniverseMirror(table: SheetTable, rows: UniverseMirrorRow[]): MirrorPlan {
  const plan = emptyPlan();
  let idAt = headerIndex(table.headers, ["universe id", "site id", "lead id"]);
  if (idAt < 0) {
    const column = lastUsedHeader(table.headers) + 1;
    while (table.headers.length < column) table.headers.push("");
    table.headers[column - 1] = "Universe ID";
    idAt = column - 1;
    plan.changes.push({
      sheet: table.title,
      row: table.headerRow,
      column,
      header: "Universe ID",
      id: "",
      before: "",
      after: "Universe ID",
    });
  }
  const idHeader = table.headers[idAt] || "Universe ID";
  let skippedProtected = 0;
  const incoming = rows.filter((row) => {
    if (row.universe_id !== PROTECTED_SITE_ID) return true;
    skippedProtected += 1;
    return false;
  });
  const rowById = new Map<string, { row: number; cells: string[] }>();
  for (const row of table.rows) {
    const id = cellText(row.cells[idAt]);
    if (id && !rowById.has(id)) rowById.set(id, row);
  }
  const blankByKey = new Map<string, { row: number; cells: string[] }[]>();
  for (const row of table.rows) {
    if (cellText(row.cells[idAt])) continue;
    const key = universeMatchKey(
      columnText(table.headers, row.cells, ["market"]),
      columnText(table.headers, row.cells, ["business name", "name"]),
      columnText(table.headers, row.cells, ["address"]),
    );
    if (!key) continue;
    const list = blankByKey.get(key) || [];
    list.push(row);
    blankByKey.set(key, list);
  }
  const pending = incoming.filter((row) => !rowById.has(row.universe_id));
  const dbByKey = new Map<string, UniverseMirrorRow[]>();
  for (const row of pending) {
    const key = universeMatchKey(row.values.market || "", row.values.name || "", row.values.address || "");
    if (!key) continue;
    const list = dbByKey.get(key) || [];
    list.push(row);
    dbByKey.set(key, list);
  }
  const claimed = new Set<string>();
  for (const row of pending) {
    const key = universeMatchKey(row.values.market || "", row.values.name || "", row.values.address || "");
    if (!key) continue;
    const sheets = blankByKey.get(key) || [];
    const dbs = dbByKey.get(key) || [];
    if (sheets.length !== 1 || dbs.length !== 1) {
      if (sheets.length > 0) {
        claimed.add(row.universe_id);
        plan.unmatched.push(row.universe_id);
      }
      continue;
    }
    const target = sheets[0];
    while (target.cells.length <= idAt) target.cells.push("");
    target.cells[idAt] = row.universe_id;
    plan.changes.push({
      sheet: table.title,
      row: target.row,
      column: idAt + 1,
      header: idHeader,
      id: row.universe_id,
      before: "",
      after: row.universe_id,
    });
    claimed.add(row.universe_id);
  }
  const appended = planTable({
    table,
    idHeaders: ["universe id", "site id", "lead id"],
    fields: UNIVERSE_FIELDS,
    records: pending
      .filter((row) => !claimed.has(row.universe_id))
      .map((row) => ({ id: row.universe_id, values: { ...row.values, id: row.universe_id } })),
    append: true,
    protectRow: false,
    idPattern: /^WB-[A-Z]{2,4}-\d{4,}$/,
    skipBlank: true,
  });
  plan.changes.push(...appended.changes);
  plan.skippedProtected += skippedProtected + appended.skippedProtected;
  plan.unmatched.push(...appended.unmatched);
  plan.appended += appended.appended;
  plan.refused.push(...appended.refused);
  plan.held.push(...appended.held);
  return plan;
}

function referencesProtectedSite(siteId: string, siteIds = ""): boolean {
  if (siteId === PROTECTED_SITE_ID) return true;
  return siteIds.split(/[;,\s]+/).some((part) => part === PROTECTED_SITE_ID);
}

export function planActivityMirror(
  table: SheetTable,
  rows: {
    entity_id: string;
    site_id: string;
    date: string;
    type: string;
    summary: string;
    source_link: string;
    imported?: boolean;
    date_iso?: string;
    at_approximate?: boolean | string;
  }[],
): MirrorPlan {
  let skippedProtected = 0;
  const kept = rows.filter((row) => {
    if (!referencesProtectedSite(row.site_id)) return true;
    skippedProtected += 1;
    return false;
  });
  const plan = planTable({
    table,
    idHeaders: ["event id"],
    fields: ACTIVITY_FIELDS,
    records: kept.map((row) => ({
      id: row.entity_id,
      imported: row.imported,
      values: {
        id: row.entity_id,
        date: row.date,
        site_id: row.site_id,
        type: row.type,
        summary: row.summary,
        source_link: row.source_link,
        at_iso: row.date_iso || "",
        at_approximate: row.at_approximate === true || row.at_approximate === "1" ? "1" : "",
      },
    })),
    append: true,
    protectRow: false,
    idPattern: /^A-\d{4,}$/,
    holdTruncation: true,
  });
  plan.skippedProtected += skippedProtected;
  return plan;
}

export function planCommsMirror(
  table: SheetTable,
  rows: { entity_id: string; values: Record<string, string> }[],
): MirrorPlan {
  let skippedProtected = 0;
  const kept = rows.filter((row) => {
    if (!referencesProtectedSite(row.values.site_id || "", row.values.site_ids || "")) return true;
    skippedProtected += 1;
    return false;
  });
  const plan = planTable({
    table,
    idHeaders: ["comms id"],
    fields: COMMS_FIELDS_BY_HEADER,
    records: kept.map((row) => ({ id: row.entity_id, values: { ...row.values, id: row.entity_id } })),
    append: true,
    protectRow: false,
    idPattern: /^CM-\d{4,}$/,
    holdTruncation: true,
    sameCell: (key, before, after) => (key === "at" ? sameCommsStamp(before, after) : sameWorkbookCell(before, after)),
    appendValue: (key, value, samples) => {
      if (key !== "at" || value.includes("(approx.)")) return value;
      return withSheetStamp(samples, value);
    },
  });
  plan.skippedProtected += skippedProtected;
  return plan;
}

/** Ids only. A refusal means the mirror must not write any cell. */
export function assertMirrorRefusals(refused: string[]): void {
  if (!refused.length) return;
  throw new Error(
    `Refusing to write ${refused.join(", ")}. Those ids are already on the sheet with different content the database did not import. Nothing was written.`,
  );
}

/** Highest numeric id on a sheet tab. The value is a number, not cell text. */
export function tableIds(table: SheetTable, idHeaders: string[]): string[] {
  const idAt = headerIndex(table.headers, idHeaders);
  if (idAt < 0) return [];
  return table.rows.map((row) => cellText(row.cells[idAt])).filter(Boolean);
}

/** PIPE, LAND, and WB floors already on a sheet tab. */
export function labeledFloorsFromTable(table: SheetTable, idHeaders: string[]): { name: string; value: number }[] {
  return labeledIdFloors(tableIds(table, idHeaders));
}

export function sheetIdFloor(table: SheetTable, idHeaders: string[], prefix: string): number {
  const idAt = headerIndex(table.headers, idHeaders);
  if (idAt < 0) return 0;
  let max = 0;
  for (const row of table.rows) max = Math.max(max, numericSuffix(prefix, cellText(row.cells[idAt])));
  return max;
}

export function assertPlannedWrites(changes: CellChange[]): void {
  for (const change of changes) {
    if (change.id === PROTECTED_SITE_ID || change.before === PROTECTED_SITE_ID || change.after === PROTECTED_SITE_ID) {
      throw new Error("Refusing to write a quarantined site.");
    }
    if (change.row === PROTECTED_ROW && (change.sheet === "Pipeline" || change.sheet === "Land Sites")) {
      throw new Error(`Refusing to write sheet row ${PROTECTED_ROW}.`);
    }
  }
}

export function assertReadBack(changes: CellChange[], actual: { sheet: string; row: number; column: number; value: string }[]): void {
  const found = new Map(actual.map((cell) => [`${cell.sheet}:${cell.row}:${cell.column}`, cellText(cell.value)]));
  for (const change of changes) {
    const key = `${change.sheet}:${change.row}:${change.column}`;
    const value = found.get(key);
    if (value == null || !sameWorkbookCell(value, change.after)) {
      throw new Error(`Read-back mismatch at ${a1(change.sheet, change.row, change.column)} for ${change.id}.`);
    }
  }
}

export function entitiesToMirror(): ShadowEntity[] {
  const selected = (["stage", "activity", "comms", "site"] as const).filter((entity) => readEntityFromDb(entity));
  if (siteFlagSimulation() && mirrorDryRun() && !selected.includes("site")) selected.push("site");
  return selected;
}

export function entityChangeCounts(changes: CellChange[]): { site: number; stage: number; activity: number; comms: number } {
  const counts = { site: 0, stage: 0, activity: 0, comms: 0 };
  for (const change of changes) {
    if (change.sheet === ACTIVITY_SHEET) counts.activity += 1;
    else if (change.sheet === COMMS_SHEET) counts.comms += 1;
    else if (change.header.trim().toLowerCase() === "stage") counts.stage += 1;
    else if (change.sheet === "Pipeline" || change.sheet === "Land Sites" || change.sheet === UNIVERSE_SHEET) counts.site += 1;
  }
  return counts;
}

/** Counts only. Site cell text stays in the hashed plan. */
export function formatPlanSummary(changes: CellChange[]): string {
  const counts = entityChangeCounts(changes);
  return `site ${counts.site}\nstage ${counts.stage}\nactivity ${counts.activity}\ncomms ${counts.comms}`;
}

/** Cell counts by sheet title. Values are not included. */
export function formatTabCounts(changes: CellChange[]): string {
  const counts = new Map<string, number>();
  for (const change of changes) counts.set(change.sheet, (counts.get(change.sheet) || 0) + 1);
  if (!counts.size) return "tabs 0";
  return [...counts.entries()].map(([sheet, count]) => `${sheet} ${count}`).join("\n");
}

/** Status text safe for a public log. Tokens, keys, hosts, and emails are removed. */
/** Sheets error text for a failed write. Status and message only. No token or key. */
export function sheetsFailureMessage(status: number, body: string): string {
  let statusText = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
    statusText = typeof parsed.error?.status === "string" ? parsed.error.status : "";
    message = typeof parsed.error?.message === "string" ? parsed.error.message : "";
  } catch {
    message = body.replace(/\s+/g, " ").trim();
  }
  const detail = [statusText, message].filter(Boolean).join(": ");
  return redactMirrorError(new Error(`Sheets write failed (${status})${detail ? `: ${detail}` : ""}.`));
}

export function redactMirrorError(error: unknown): string {
  const text = error instanceof Error ? error.message : "workbook mirror failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

export type MirrorTabTask = {
  tab: string;
  run: () => Promise<MirrorPlan>;
};

export type PlannedMirrorTab = {
  tab: string;
  plan: MirrorPlan;
};

export type FailedMirrorTab = {
  tab: string;
  message: string;
};

/** Plan each tab on its own. A thrown tab is recorded and the rest still plan. */
export async function planMirrorTabs(tasks: MirrorTabTask[]): Promise<{ planned: PlannedMirrorTab[]; failed: FailedMirrorTab[] }> {
  const planned: PlannedMirrorTab[] = [];
  const failed: FailedMirrorTab[] = [];
  for (const task of tasks) {
    try {
      planned.push({ tab: task.tab, plan: await task.run() });
    } catch (error) {
      failed.push({ tab: task.tab, message: redactMirrorError(error) });
    }
  }
  return { planned, failed };
}

/** Write each planned tab on its own. A thrown write is recorded and the rest still write. */
export async function writeMirrorTabs(
  planned: PlannedMirrorTab[],
  write: (tab: string, changes: CellChange[]) => Promise<void>,
): Promise<{ written: CellChange[]; failed: FailedMirrorTab[] }> {
  const written: CellChange[] = [];
  const failed: FailedMirrorTab[] = [];
  for (const tab of planned) {
    try {
      await write(tab.tab, tab.plan.changes);
      written.push(...tab.plan.changes);
    } catch (error) {
      failed.push({ tab: tab.tab, message: redactMirrorError(error) });
    }
  }
  return { written, failed };
}

export type MirrorSheetGrid = {
  sheetId: number;
  columnCount: number;
  rowCount: number;
};

/** True when a values write would land outside the current grid. */
export function mirrorGridNeedsGrowth(changes: CellChange[], grid: Pick<MirrorSheetGrid, "columnCount" | "rowCount">): boolean {
  return changes.some((change) => columnsToAppend(change.column, grid.columnCount) > 0 || rowsToAppend(change.row, grid.rowCount) > 0);
}

/**
 * One spreadsheets.batchUpdate body. appendDimension runs before updateCells.
 * The request is atomic: a rejected range writes nothing.
 * Cell text is stored as a string, so a leading "=" is not a formula.
 */
export function mirrorGridRequests(changes: CellChange[], grid: MirrorSheetGrid): { requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  let extraColumns = 0;
  let extraRows = 0;
  for (const change of changes) {
    extraColumns = Math.max(extraColumns, columnsToAppend(change.column, grid.columnCount));
    extraRows = Math.max(extraRows, rowsToAppend(change.row, grid.rowCount));
  }
  if (extraColumns > 0) requests.push({ appendDimension: { sheetId: grid.sheetId, dimension: "COLUMNS", length: extraColumns } });
  if (extraRows > 0) requests.push({ appendDimension: { sheetId: grid.sheetId, dimension: "ROWS", length: extraRows } });
  for (const change of changes) {
    requests.push({
      updateCells: {
        start: { sheetId: grid.sheetId, rowIndex: change.row - 1, columnIndex: change.column - 1 },
        rows: [{ values: [{ userEnteredValue: { stringValue: change.after } }] }],
        fields: "userEnteredValue",
      },
    });
  }
  return { requests };
}

function planValue(_change: CellChange, value: string): string {
  return `#${shortHash(value)}`;
}

export type MirrorDrift = { cells: number; fills: number; ids: string[] };

function driftChange(change: CellChange): boolean {
  if (change.id === PROTECTED_SITE_ID || change.before === PROTECTED_SITE_ID || change.after === PROTECTED_SITE_ID) return false;
  if (change.row === PROTECTED_ROW && (change.sheet === "Pipeline" || change.sheet === "Land Sites")) return false;
  return true;
}

/**
 * A drifted cell already had a value that differs from the database.
 * The count includes a database change not yet copied and a hand edit.
 * The mirror overwrites both with the database value.
 */
export function mirrorDrift(changes: CellChange[]): MirrorDrift {
  const safe = changes.filter(driftChange);
  const drifted = safe.filter((change) => change.before.trim() !== "");
  const ids = [...new Set(drifted.map((change) => shortHash(change.id)))].sort();
  return {
    cells: drifted.length,
    fills: safe.filter((change) => change.before.trim() === "").length,
    ids,
  };
}

/** Held rows stay on the sheet. The report is a count and hashed ids. */
export function formatHeld(held: { id: string; header: string }[]): string {
  const ids = [...new Set(held.map((row) => row.id).filter((id) => id !== PROTECTED_SITE_ID))].map((id) => shortHash(id)).sort();
  const shown = ids.slice(0, 20).map((id) => `#${id}`).join(" ");
  const more = ids.length > 20 ? ` and ${ids.length - 20} more` : "";
  const text = [
    `held ${held.length}`,
    `held_ids ${ids.length}${shown ? ` ${shown}` : ""}${more}`,
    "A shorter database value that is only a prefix of the sheet cell was not written.",
  ].join("\n");
  if (text.includes(PROTECTED_SITE_ID)) throw new Error("Held report included a quarantined id.");
  return text;
}

export function formatMirrorDrift(drift: MirrorDrift): string {
  const shown = drift.ids.slice(0, 20).map((id) => `#${id}`).join(" ");
  const more = drift.ids.length > 20 ? ` and ${drift.ids.length - 20} more` : "";
  const text = [
    `drift_cells ${drift.cells}`,
    `drift_ids ${drift.ids.length}${shown ? ` ${shown}` : ""}${more}`,
    `fills ${drift.fills}`,
    "The mirror overwrites drifted cells with the database value. Cell text is not printed.",
  ].join("\n");
  if (text.includes(PROTECTED_SITE_ID)) throw new Error("Drift report included a quarantined id.");
  return text;
}

export function formatPlan(changes: CellChange[]): string {
  if (!changes.length) return "No cell changes.";
  return changes
    .map((change) => `${a1(change.sheet, change.row, change.column)} ${change.header} ${change.id}: ${planValue(change, change.before)} -> ${planValue(change, change.after)}`)
    .join("\n");
}

type StageDb = { site_id: string; stage: string };
type ActivityDb = { entity_id: string; site_id: string; payload: unknown; at_approximate?: boolean | null };
type CommsDb = {
  entity_id: string;
  payload: unknown;
  message_id?: string | null;
  thread_id?: string | null;
  link?: string | null;
};

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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** 025 is not on production until that migration workflow runs. The mirror still copies the older tables. */
async function optionalMirrorQuery<T extends QueryResultRow>(sql: Sql, textSql: string): Promise<T[]> {
  try {
    return (await sql.query<T>(textSql)).rows;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "42P01") return [];
    throw error;
  }
}

/** The shadow import and the capture import write these sources. An API batch does not. */
export function importedFromWorkbook(source: string | null | undefined): boolean {
  const text = (source || "").trim().toLowerCase();
  return text.startsWith("workbook snapshot") || text.startsWith("workbook capture import");
}

function undefinedColumn(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42703");
}

type SiteMirrorDb = { site_id: string; market?: string; category?: string; sheet_writes: unknown; facts?: unknown; power_rating?: string };

function tradeAreaChecked(facts: Record<string, unknown>): string {
  return Object.keys(facts).some((key) => key.startsWith("trade_") && text(facts[key])) ? "Yes" : "";
}

async function loadSiteMirrorSources(sql: Sql): Promise<{ rows: SiteMirrorDb[] }> {
  try {
    return await sql.query<SiteMirrorDb>(
      `SELECT site_id, market, category, sheet_writes, facts, power_rating FROM sites ORDER BY site_id`,
    );
  } catch (error) {
    if (!undefinedColumn(error)) throw error;
    return sql.query<SiteMirrorDb>(`SELECT site_id, market, category, sheet_writes, facts FROM sites ORDER BY site_id`);
  }
}

export async function loadMirrorRows(sql: Sql): Promise<{
  stages: { site_id: string; stage: string }[];
  activities: { entity_id: string; site_id: string; date: string; type: string; summary: string; source_link: string; imported?: boolean; date_iso?: string; at_approximate?: boolean }[];
  comms: { entity_id: string; values: Record<string, string> }[];
  sites: { site_id: string; writes: Record<string, string> }[];
  createdSites: CreatedSiteMirror[];
  universeRows: UniverseMirrorRow[];
}> {
  const stages = await sql.query<StageDb>(`SELECT site_id, stage FROM site_stages ORDER BY site_id`);
  const activities = await sql.query<ActivityDb>(`SELECT entity_id, site_id, payload, at_approximate FROM activities ORDER BY entity_id`);
  const origins = await sql.query<{ entity_id: string; source: string }>(
    `SELECT DISTINCT ON (entity_id) entity_id, source
     FROM events
     WHERE entity_type = 'activity'
     ORDER BY entity_id, created_at ASC, id ASC`,
  );
  const originOf = new Map(origins.rows.map((row) => [text(row.entity_id), text(row.source)]));
  const comms = await sql.query<CommsDb>(
    `SELECT entity_id, payload, message_id, thread_id, link FROM comms_entries ORDER BY entity_id`,
  );
  const sites = await loadSiteMirrorSources(sql);
  const created = await optionalMirrorQuery<{
    site_id: string;
    universe_id: string;
    kind: string;
    name: string;
    address: string;
    market: string;
    category: string;
    apn: string;
    lat: string;
    lng: string;
    listing_url: string;
    broker: string;
    stage: string | null;
    facts?: unknown;
  }>(sql,
    `SELECT m.site_id, m.universe_id, m.kind, s.name, s.address, s.market, s.category, s.apn, s.lat, s.lng,
            s.listing_url, s.broker, st.stage, s.facts
     FROM site_mints m
     JOIN sites s ON s.site_id = m.site_id
     LEFT JOIN site_stages st ON st.site_id = m.site_id
     ORDER BY m.site_id`,
  );
  const universe = await optionalMirrorQuery<{
    universe_id: string;
    market: string;
    name: string;
    address: string;
    category: string;
    apn: string;
    lat: string;
    lng: string;
    listing_url: string;
    broker: string;
    counted: string;
  }>(sql,
    `SELECT universe_id, market, name, address, category, apn, lat, lng, listing_url, broker, counted
     FROM universe_rows ORDER BY universe_id`,
  );
  return {
    stages: stages.rows.map((row) => ({ site_id: text(row.site_id), stage: text(row.stage) })),
    activities: activities.rows.map((row) => {
      const payload = asObject(row.payload);
      const entityId = text(row.entity_id);
      const origin = originOf.get(entityId);
      return {
        entity_id: entityId,
        site_id: text(row.site_id),
        date: text(payload.date),
        date_iso: text(payload.date_iso),
        at_approximate: row.at_approximate === true || payload.at_approximate === true || payload.at_approximate === "1",
        type: text(payload.type),
        summary: text(payload.summary),
        source_link: text(payload.source_link),
        imported: origin == null ? undefined : importedFromWorkbook(origin),
      };
    }),
    comms: comms.rows.map((row) => {
      const payload = asObject(row.payload);
      const values: Record<string, string> = {};
      for (const field of COMMS_FIELDS) values[field] = text(payload[field]);
      if (text(row.message_id)) values.message_id = text(row.message_id);
      if (text(row.thread_id)) values.thread_id = text(row.thread_id);
      if (text(row.link)) values.link = text(row.link);
      const clock = values.at || "";
      values.at_iso = /T\d{2}:\d{2}/.test(clock) ? clock : "";
      values.at_approximate = payload.at_approximate === true || payload.at_approximate === "1" ? "1" : "";
      if (!values.at_text && values.at_approximate === "1" && values.at_iso) values.at = `${values.at_iso} (approx.)`;
      return { entity_id: text(row.entity_id), values };
    }),
    sites: sites.rows.map((row) => {
      const writes = typeof row.sheet_writes === "string" ? parseSheet(row.sheet_writes) : parseSheet(JSON.stringify(row.sheet_writes ?? {}));
      const facts = asObject(row.facts);
      const stored = text(row.power_rating);
      const rating: PowerRatingName = isPowerRatingName(stored)
        ? stored
        : derivePowerRating({ market: text(row.market), ...facts }).rating;
      writes[DERIVED_POWER_HEADER] = rating;
      const folder = text(facts.folder_url);
      if (folder) writes.Folder = folder;
      const segment = text(row.category);
      if (segment) writes.Segment = segment;
      const checked = tradeAreaChecked(facts);
      if (checked) writes["Trade-area checked"] = checked;
      return { site_id: text(row.site_id), writes };
    }),
    createdSites: created.map((row) => ({
      site_id: text(row.site_id),
      kind: row.kind === "land" ? "land" as const : "pipeline" as const,
      values: {
        stage: text(row.stage) || "1 Desk screen",
        name: text(row.name),
        address: text(row.address),
        market: text(row.market),
        category: text(row.category),
        apn: text(row.apn),
        lat: text(row.lat),
        lng: text(row.lng),
        listing_url: text(row.listing_url),
        broker: text(row.broker),
        universe_id: text(row.universe_id),
        folder_url: text(asObject(row.facts).folder_url),
        trade_area_checked: tradeAreaChecked(asObject(row.facts)),
      },
    })),
    universeRows: universe.map((row) => ({
      universe_id: text(row.universe_id),
      values: {
        name: text(row.name),
        address: text(row.address),
        market: text(row.market),
        category: text(row.category),
        apn: text(row.apn),
        lat: text(row.lat),
        lng: text(row.lng),
        listing_url: text(row.listing_url),
        broker: text(row.broker),
        counted: text(row.counted) || "Yes",
      },
    })),
  };
}

export type MirrorWritePhase = "idle" | "writing" | "written";

export function newMirrorRunId(): string {
  return `run_${randomUUID().replaceAll("-", "")}`;
}

export function cancelledMirrorNote(phase: MirrorWritePhase): string {
  if (phase === "written") return "cancelled after writing cells";
  if (phase === "writing") return "cancelled while writing cells";
  return "cancelled before the sheet write finished";
}

/**
 * Insert the runs row before the sheet write, then update that same id.
 * A cancel that lands after the insert still leaves the row. A second save
 * does not reopen a row that already finished.
 */
export async function saveMirrorRun(
  sql: Sql,
  id: string,
  counts: Record<string, number>,
  notes: string,
  status: "running" | "succeeded" | "failed",
): Promise<void> {
  await sql.query(
    `INSERT INTO runs (id, actor, status, finished_at, counts, notes)
     VALUES ($1, 'workbook-mirror', $2, CASE WHEN $2 = 'running' THEN NULL ELSE clock_timestamp() END, $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE
     SET status = EXCLUDED.status,
         finished_at = CASE WHEN EXCLUDED.status = 'running' THEN runs.finished_at ELSE clock_timestamp() END,
         counts = EXCLUDED.counts,
         notes = EXCLUDED.notes
     WHERE runs.status = 'running'`,
    [id, status, JSON.stringify(counts), notes.slice(0, 500)],
  );
}

export async function recordMirrorRun(
  sql: Sql,
  counts: Record<string, number>,
  notes: string,
  status: "succeeded" | "failed",
): Promise<void> {
  await saveMirrorRun(sql, newMirrorRunId(), counts, notes, status);
}

/** SIGTERM during a cancel still gets a few seconds. Record the runs row, then exit. */
export function watchMirrorCancel(
  getPhase: () => MirrorWritePhase,
  finish: (note: string) => Promise<void>,
  exit: (code: number) => void,
  listen: (signal: "SIGTERM" | "SIGINT", handler: () => void) => void = (signal, handler) => {
    process.once(signal, handler);
  },
): void {
  let started = false;
  const onSignal = () => {
    if (started) return;
    started = true;
    void finish(cancelledMirrorNote(getPhase())).finally(() => exit(1));
  };
  listen("SIGTERM", onSignal);
  listen("SIGINT", onSignal);
}

export function stageTabs(): readonly { title: string; headerRow: number }[] {
  return STAGE_TABS;
}

export const ACTIVITY_HEADER_ROW = 1;
export const COMMS_HEADER_ROW = 1;
export const ACTIVITY_SHEET = "Activity";
export const COMMS_SHEET = "Comms Log";
export const UNIVERSE_SHEET = "Universe";
export const UNIVERSE_HEADER_ROW = 1;

const CREATED_SITE_FIELDS: { headers: string[]; key: string }[] = [
  { headers: ["site id"], key: "id" },
  { headers: ["stage"], key: "stage" },
  { headers: ["name"], key: "name" },
  { headers: ["address", "site"], key: "address" },
  { headers: ["market"], key: "market" },
  { headers: ["segment group", "category"], key: "category" },
  { headers: ["apn or folio", "apn"], key: "apn" },
  { headers: ["lat"], key: "lat" },
  { headers: ["lng", "lon"], key: "lng" },
  { headers: ["listing link"], key: "listing_url" },
  { headers: ["broker"], key: "broker" },
  { headers: ["universe id", "lead id"], key: "universe_id" },
  { headers: ["Folder"], key: "folder_url" },
  { headers: ["Segment"], key: "category" },
  { headers: ["Trade-area checked"], key: "trade_area_checked" },
];

const UNIVERSE_FIELDS: { headers: string[]; key: string }[] = [
  { headers: ["universe id", "site id", "lead id"], key: "id" },
  { headers: ["business name", "name"], key: "name" },
  { headers: ["address"], key: "address" },
  { headers: ["market"], key: "market" },
  { headers: ["apn", "apn or folio"], key: "apn" },
  { headers: ["lat"], key: "lat" },
  { headers: ["lon", "lng"], key: "lng" },
  { headers: ["segment group", "category"], key: "category" },
  { headers: ["listing link"], key: "listing_url" },
  { headers: ["broker"], key: "broker" },
  { headers: ["counted in funnel"], key: "counted" },
];

export type { CommsField };
