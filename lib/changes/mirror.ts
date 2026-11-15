import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { readEntityFromDb, type ShadowEntity } from "./flags";
import { MIRROR_FIELD_HEADERS, mirrorCellInput, mirrorHeaderAllowed, parseSheet, sameWorkbookCell, shortHash } from "./site";
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
};

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

export function assertWorkbookMirrorAllowed(): void {
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
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
  if (process.env.WORKBOOK_MIRROR_ENABLED !== "1") {
    throw new Error(
      "WORKBOOK_MIRROR_ENABLED is not 1. Set the repository variable WORKBOOK_MIRROR_ENABLED to 1 to copy database rows into the workbook.",
    );
  }
}

export function mirrorDryRun(): boolean {
  const value = process.env.WORKBOOK_MIRROR_DRY_RUN?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

type RecordRow = { id: string; values: Record<string, string> };

function planTable(input: {
  table: SheetTable;
  idHeaders: string[];
  fields: { headers: string[]; key: string }[];
  records: RecordRow[];
  append: boolean;
  protectRow: boolean;
  idPattern?: RegExp;
  skipBlank?: boolean;
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
  const byId = new Map<string, { row: number; cells: string[] }>();
  for (const row of input.table.rows) {
    const id = cellText(row.cells[idAt]);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  const changes: CellChange[] = [];
  const unmatched: string[] = [];
  let skippedProtected = 0;
  let appended = 0;
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
      for (const column of columns) {
        if (column.index < 0) continue;
        const after = cellText(record.values[column.key]);
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
      input.table.rows.push({
        row,
        cells: columns.reduce<string[]>((cells, column) => {
          if (column.index >= 0) cells[column.index] = cellText(record.values[column.key]);
          return cells;
        }, []),
      });
      continue;
    }
    for (const column of columns) {
      if (column.index < 0 || column.key === "id") continue;
      const after = cellText(record.values[column.key]);
      if (input.skipBlank && !after) continue;
      const before = cellText(existing.cells[column.index]);
      if (sameWorkbookCell(before, after)) continue;
      changes.push({
        sheet: input.table.title,
        row: existing.row,
        column: column.index + 1,
        header: input.table.headers[column.index] || column.headers[0],
        id: record.id,
        before,
        after,
      });
    }
  }
  return { changes, skippedProtected, unmatched, appended };
}

export function planStageMirror(tables: SheetTable[], stages: { site_id: string; stage: string }[]): MirrorPlan {
  const combined: MirrorPlan = { changes: [], skippedProtected: 0, unmatched: [], appended: 0 };
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
  const combined: MirrorPlan = { changes: [], skippedProtected: 0, unmatched: [], appended: 0 };
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
        if (sameWorkbookCell(before, after)) continue;
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

export function planActivityMirror(
  table: SheetTable,
  rows: { entity_id: string; site_id: string; date: string; type: string; summary: string; source_link: string }[],
): MirrorPlan {
  return planTable({
    table,
    idHeaders: ["event id"],
    fields: ACTIVITY_FIELDS,
    records: rows.map((row) => ({
      id: row.entity_id,
      values: {
        id: row.entity_id,
        date: row.date,
        site_id: row.site_id,
        type: row.type,
        summary: row.summary,
        source_link: row.source_link,
      },
    })),
    append: true,
    protectRow: false,
    idPattern: /^A-\d{4,}$/,
  });
}

export function planCommsMirror(
  table: SheetTable,
  rows: { entity_id: string; values: Record<string, string> }[],
): MirrorPlan {
  return planTable({
    table,
    idHeaders: ["comms id"],
    fields: COMMS_FIELDS_BY_HEADER,
    records: rows.map((row) => ({ id: row.entity_id, values: { ...row.values, id: row.entity_id } })),
    append: true,
    protectRow: false,
    idPattern: /^CM-\d{4,}$/,
  });
}

export function assertPlannedWrites(changes: CellChange[]): void {
  for (const change of changes) {
    if (change.id === PROTECTED_SITE_ID) {
      throw new Error(`Refusing to write ${PROTECTED_SITE_ID}.`);
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
  return (["stage", "activity", "comms", "site"] as const).filter((entity) => readEntityFromDb(entity));
}

const PRIVATE_PLAN_HEADERS = new Set(["next step", "broker", "notes", "photo notes", "sheet"]);

function planValue(header: string, value: string): string {
  const privateCell = PRIVATE_PLAN_HEADERS.has(header.trim().toLowerCase()) || value.trim().startsWith("{");
  return privateCell ? `#${shortHash(value)}` : JSON.stringify(value);
}

export function formatPlan(changes: CellChange[]): string {
  if (!changes.length) return "No cell changes.";
  return changes
    .map((change) => `${a1(change.sheet, change.row, change.column)} ${change.header} ${change.id}: ${planValue(change.header, change.before)} -> ${planValue(change.header, change.after)}`)
    .join("\n");
}

type StageDb = { site_id: string; stage: string };
type ActivityDb = { entity_id: string; site_id: string; payload: unknown };
type CommsDb = { entity_id: string; payload: unknown };

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

export async function loadMirrorRows(sql: Sql): Promise<{
  stages: { site_id: string; stage: string }[];
  activities: { entity_id: string; site_id: string; date: string; type: string; summary: string; source_link: string }[];
  comms: { entity_id: string; values: Record<string, string> }[];
  sites: { site_id: string; writes: Record<string, string> }[];
}> {
  const stages = await sql.query<StageDb>(`SELECT site_id, stage FROM site_stages ORDER BY site_id`);
  const activities = await sql.query<ActivityDb>(`SELECT entity_id, site_id, payload FROM activities ORDER BY entity_id`);
  const comms = await sql.query<CommsDb>(`SELECT entity_id, payload FROM comms_entries ORDER BY entity_id`);
  const sites = await sql.query<{ site_id: string; sheet_writes: unknown }>(`SELECT site_id, sheet_writes FROM sites ORDER BY site_id`);
  return {
    stages: stages.rows.map((row) => ({ site_id: text(row.site_id), stage: text(row.stage) })),
    activities: activities.rows.map((row) => {
      const payload = asObject(row.payload);
      return {
        entity_id: text(row.entity_id),
        site_id: text(row.site_id),
        date: text(payload.date),
        type: text(payload.type),
        summary: text(payload.summary),
        source_link: text(payload.source_link),
      };
    }),
    comms: comms.rows.map((row) => {
      const payload = asObject(row.payload);
      const values: Record<string, string> = {};
      for (const field of COMMS_FIELDS) values[field] = text(payload[field]);
      return { entity_id: text(row.entity_id), values };
    }),
    sites: sites.rows.map((row) => ({
      site_id: text(row.site_id),
      writes: typeof row.sheet_writes === "string" ? parseSheet(row.sheet_writes) : parseSheet(JSON.stringify(row.sheet_writes ?? {})),
    })),
  };
}

export async function recordMirrorRun(
  sql: Sql,
  counts: Record<string, number>,
  notes: string,
  status: "succeeded" | "failed",
): Promise<void> {
  await sql.query(
    `INSERT INTO runs (id, actor, status, finished_at, counts, notes)
     VALUES ($1, 'workbook-mirror', $2, clock_timestamp(), $3::jsonb, $4)`,
    [`run_${randomUUID().replaceAll("-", "")}`, status, JSON.stringify(counts), notes.slice(0, 500)],
  );
}

export function stageTabs(): readonly { title: string; headerRow: number }[] {
  return STAGE_TABS;
}

export const ACTIVITY_HEADER_ROW = 1;
export const COMMS_HEADER_ROW = 1;
export const ACTIVITY_SHEET = "Activity";
export const COMMS_SHEET = "Comms Log";

export type { CommsField };
