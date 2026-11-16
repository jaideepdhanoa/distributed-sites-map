import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { EXCLUDED_SITE_ID, isExcludedSite } from "@/lib/alerts/excluded";
import { applyParsedChanges, numericSuffix, raiseIdFloor } from "./apply";
import { databaseHost, isProductionDatabase } from "./guard";
import { ACTIVITY_HEADER_ROW, ACTIVITY_SHEET, SPREADSHEET_ID, type SheetRender, type SheetTable } from "./mirror";
import { parseZonedTimestamp, type Actor, type ActivityPayload } from "./schema";
import { loadSheetTable, readSheetRanges } from "./sheetTable";
import { shortHash } from "./site";
import { SITE_ID } from "./vocab";

const ACTOR: Actor = { id: "workbook-sync", kind: "agent" };
const ACTIVITY_ID = /^A-\d{4,}$/;
const WHO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const PRIVATE_LOG = /@|https?:\/\/|\$\d|mail\.google/i;

export const CAPTURE_IMPORT_CONFIRM = "import-production";
export const CAPTURE_IMPORT_WORKFLOW = "Capture import";
export const CAPTURE_RUN_NOTE = "workbook capture import";

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
  date: string;
  type: string;
  approximate: boolean;
};

export type CapturePlanItem = {
  hash: string;
  entityId: string;
  siteId: string;
  date: string;
  dateIso: string;
  approximate: boolean;
  summary: string;
  sourceLink: string;
};

export type CaptureListedRow = {
  action: "insert" | "existing";
  id: string;
  siteId: string;
  kind: "capture" | "other";
  date: string;
  approximate: boolean;
};

export type CaptureSiteCount = {
  siteId: string;
  insert: number;
  existing: number;
};

export type CapturePlan = {
  inserts: CapturePlanItem[];
  existing: number;
  skipped: string[];
  excluded: number;
  sites: CaptureSiteCount[];
  rows: CaptureListedRow[];
  digest: string;
};

export type CaptureMode = "dry-run" | "write";

export type CaptureArtifact = {
  mode: CaptureMode;
  insert: number;
  existing: number;
  skipped: number;
  excluded: number;
  sites: { site_id: string; insert: number; existing: number }[];
  rows: { id: string; site_id: string; kind: "capture" | "other"; date: string; action: "insert" | "existing"; approximate: boolean }[];
};

export type CaptureApplyContext = {
  confirm: string | undefined;
  databaseUrl: string;
  who: string;
  at: string;
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

function logDate(value: string): string {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return day ? day[1] : "";
}

function logKind(value: string): "capture" | "other" {
  return value === "capture" ? "capture" : "other";
}

/** Provenance stored on the row and on its creating event. */
export function captureProvenance(entityId: string): string {
  return `workbook capture import, row ${entityId}`;
}

/**
 * A date with no numeric zone offset stays date-only and approximate.
 * A zoned clock keeps its offset. An unzoned clock is not stored as a time.
 */
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
    return date ? { date, approximate: true } : null;
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

function listed(action: "insert" | "existing", id: string, siteId: string, date: string, kind: string, approximate: boolean): CaptureListedRow {
  return {
    action,
    id,
    siteId,
    kind: action === "insert" ? "capture" : logKind(kind),
    date: logDate(date),
    approximate,
  };
}

/** Workbook capture rows, kept on their A- ids. An id that is already stored is skipped. */
export function planCaptureImport(rows: CaptureSheetRow[], stored: StoredCapture[]): CapturePlan {
  const have = new Map(stored.map((row) => [row.entity_id, row]));
  const inserts: CapturePlanItem[] = [];
  const rowsOut: CaptureListedRow[] = [];
  const skipped: string[] = [];
  const siteCounts = new Map<string, { insert: number; existing: number }>();
  let existing = 0;
  let excluded = 0;
  const seen = new Set<string>();
  const addSite = (siteId: string, field: "insert" | "existing") => {
    const current = siteCounts.get(siteId) || { insert: 0, existing: 0 };
    current[field] += 1;
    siteCounts.set(siteId, current);
  };
  for (const row of rows) {
    const entityId = row.entityId.trim();
    const siteId = row.siteId.trim().toUpperCase();
    const prior = have.get(entityId);
    if (isExcludedSite(siteId) || (prior && isExcludedSite(prior.site_id))) {
      excluded += 1;
      if (entityId) seen.add(entityId);
      continue;
    }
    if (!ACTIVITY_ID.test(entityId) || !SITE_ID.test(siteId) || seen.has(entityId)) {
      if (entityId) skipped.push(shortHash(entityId));
      continue;
    }
    seen.add(entityId);
    if (prior) {
      existing += 1;
      addSite(prior.site_id, "existing");
      const when = parseCaptureWhen(row.when);
      rowsOut.push(listed("existing", entityId, prior.site_id, when?.date || prior.date, prior.type, prior.approximate));
      continue;
    }
    const when = parseCaptureWhen(row.when);
    const summary = row.summary.trim();
    if (!when || !summary) {
      skipped.push(shortHash(entityId));
      continue;
    }
    inserts.push({
      hash: shortHash(entityId),
      entityId,
      siteId,
      date: when.date,
      dateIso: when.dateIso || "",
      approximate: when.approximate,
      summary,
      sourceLink: row.sourceLink.trim(),
    });
    addSite(siteId, "insert");
    rowsOut.push(listed("insert", entityId, siteId, when.date, "capture", when.approximate));
  }
  inserts.sort((a, b) => a.entityId.localeCompare(b.entityId));
  rowsOut.sort((a, b) => a.id.localeCompare(b.id) || a.action.localeCompare(b.action));
  skipped.sort();
  const sites = [...siteCounts.entries()]
    .map(([siteId, counts]) => ({ siteId, insert: counts.insert, existing: counts.existing }))
    .sort((a, b) => a.siteId.localeCompare(b.siteId));
  const digest = createHash("sha256")
    .update(inserts.map((item) => `insert:${item.hash}:${item.date}:${item.approximate ? "1" : "0"}:${shortHash(item.summary)}:${shortHash(item.sourceLink)}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { inserts, existing, skipped, excluded, sites, rows: rowsOut, digest };
}

export async function loadCapturePlan(sql: Sql, rows: CaptureSheetRow[]): Promise<CapturePlan> {
  const ids = [...new Set(rows.map((row) => row.entityId.trim()).filter((id) => ACTIVITY_ID.test(id)))];
  const result = ids.length
    ? await sql.query<{ entity_id: string; site_id: string; payload: unknown }>(
        `SELECT entity_id, site_id, payload FROM activities WHERE entity_id = ANY($1::text[])`,
        [ids],
      )
    : { rows: [] };
  const stored: StoredCapture[] = result.rows.map((row) => {
    const payload = asObject(row.payload);
    const type = text(payload.type);
    return {
      entity_id: text(row.entity_id),
      site_id: text(row.site_id).toUpperCase(),
      date: text(payload.date),
      type,
      approximate: payload.at_approximate === true,
    };
  });
  return planCaptureImport(rows, stored);
}

/** Counts per site, then workbook id, site id, kind, and date. No cell text. */
export function formatCapturePlan(plan: CapturePlan, mode: CaptureMode = "dry-run"): string {
  const lines = [
    `mode ${mode}`,
    `insert ${plan.inserts.length}`,
    `existing ${plan.existing}`,
    `skipped ${plan.skipped.length}`,
    `excluded ${plan.excluded}`,
    `sites ${plan.sites.length}`,
  ];
  for (const site of plan.sites) lines.push(`${site.siteId} insert ${site.insert} existing ${site.existing}`);
  for (const row of plan.rows) {
    lines.push(`- ${row.action} ${row.id} ${row.siteId} ${row.kind} ${row.date} ${row.approximate ? "approximate" : "exact"}`);
  }
  for (const hash of plan.skipped) lines.push(`- skipped #${hash}`);
  const text = lines.join("\n");
  assertPublicCaptureLog(text);
  return text;
}

export function captureArtifact(plan: CapturePlan, mode: CaptureMode): CaptureArtifact {
  const artifact: CaptureArtifact = {
    mode,
    insert: plan.inserts.length,
    existing: plan.existing,
    skipped: plan.skipped.length,
    excluded: plan.excluded,
    sites: plan.sites.map((site) => ({ site_id: site.siteId, insert: site.insert, existing: site.existing })),
    rows: plan.rows.map((row) => ({
      id: row.id,
      site_id: row.siteId,
      kind: row.kind,
      date: row.date,
      action: row.action,
      approximate: row.approximate,
    })),
  };
  assertPublicCaptureLog(JSON.stringify(artifact));
  return artifact;
}

export function assertPublicCaptureLog(text: string): void {
  if (text.includes(EXCLUDED_SITE_ID) || PRIVATE_LOG.test(text)) {
    throw new Error("Refusing to print the capture plan.");
  }
}

/** True only for the Capture import workflow on main, after the confirm phrase. */
export function productionCaptureApproved(): boolean {
  return process.env.ALLOW_PRODUCTION_CAPTURE_IMPORT === "1"
    && process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.GITHUB_REF === "refs/heads/main"
    && process.env.GITHUB_WORKFLOW === CAPTURE_IMPORT_WORKFLOW;
}

function localDatabase(url: string): boolean {
  const host = databaseHost(url);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertCaptureImportApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== CAPTURE_IMPORT_CONFIRM) {
    throw new Error("Refusing to import capture rows. Dry run is the default. Type import-production to write.");
  }
  if (isProductionDatabase(url)) {
    if (!productionCaptureApproved()) {
      throw new Error(
        "Refusing to import capture rows into the production database. Run the Capture import workflow on main with mode write and confirm import-production.",
      );
    }
    return;
  }
  if (!localDatabase(url) && !productionCaptureApproved()) {
    throw new Error(
      "Refusing to import capture rows into a remote database. Run the Capture import workflow on main with mode write and confirm import-production.",
    );
  }
}

function assertCaptureActor(who: string, at: string): void {
  if (!WHO.test(who)) throw new Error("The import run needs a person. Set IMPORT_ACTOR or GITHUB_ACTOR.");
  if (!parseZonedTimestamp(at)) throw new Error("The import run needs an ISO-8601 time with a zone offset.");
}

async function recordCaptureRun(
  sql: Sql,
  plan: CapturePlan,
  who: string,
  at: string,
  count: number,
  sites: number,
): Promise<void> {
  const counts = {
    mode: "write",
    count,
    sites,
    existing: plan.existing,
    skipped: plan.skipped.length,
    excluded: plan.excluded,
    at,
  };
  await sql.query(
    `INSERT INTO runs (id, actor, started_at, finished_at, status, counts, notes)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz, 'succeeded', $4::jsonb, $5)`,
    [`run_${randomUUID().replaceAll("-", "")}`, who, at, JSON.stringify(counts), CAPTURE_RUN_NOTE],
  );
}

export async function applyCaptureImport(sql: Sql, plan: CapturePlan, context: CaptureApplyContext): Promise<number> {
  assertCaptureImportApply(context.databaseUrl, context.confirm);
  const who = context.who.trim();
  const at = context.at.trim();
  assertCaptureActor(who, at);
  const items = plan.inserts.filter((item) => !isExcludedSite(item.siteId));
  let written = 0;
  for (let index = 0; index < items.length; index += 100) {
    const batch = items.slice(index, index + 100);
    const changes = batch.map((item) => {
      const payload: ActivityPayload = {
        date: item.date,
        type: "capture",
        summary: item.summary,
        at_approximate: item.approximate,
        provenance: captureProvenance(item.entityId),
      };
      if (item.dateIso) payload.date_iso = item.dateIso;
      if (item.sourceLink) payload.source_link = item.sourceLink;
      return {
        entity_type: "activity" as const,
        site_id: item.siteId,
        entity_id: item.entityId,
        preserve_id: true,
        expected_version: 0,
        source: captureProvenance(item.entityId),
        payload,
      };
    });
    await applyParsedChanges(sql, ACTOR, `capture-import-${plan.digest}-${index}`, changes, "import capture activity", "workbook");
    written += batch.length;
  }
  const floor = items.reduce((max, item) => Math.max(max, numericSuffix("A-", item.entityId)), 0);
  if (floor > 0) await raiseIdFloor(sql, "activity", floor);
  const sites = new Set(items.map((item) => item.siteId)).size;
  await recordCaptureRun(sql, plan, who, at, written, sites);
  return written;
}

export async function executeCaptureImport(
  sql: Sql,
  rows: CaptureSheetRow[],
  input: {
    apply: boolean;
    databaseUrl: string;
    confirm?: string;
    who?: string;
    at?: string;
    mode?: CaptureMode;
    onReady?: (report: { text: string; artifact: CaptureArtifact }) => void;
  },
): Promise<{ written: number; text: string; artifact: CaptureArtifact; plan: CapturePlan }> {
  const requested = input.mode || (input.apply ? "write" : "dry-run");
  if (requested !== "dry-run" && requested !== "write") throw new Error("Mode must be dry-run or write.");
  const writing = input.apply && requested === "write";
  if (input.apply && !writing) throw new Error("Refusing to write. Set mode to write and type import-production.");
  const plan = await loadCapturePlan(sql, rows);
  const text = formatCapturePlan(plan, requested);
  const artifact = captureArtifact(plan, requested);
  input.onReady?.({ text, artifact });
  if (!writing) return { written: 0, text, artifact, plan };
  const written = await applyCaptureImport(sql, plan, {
    confirm: input.confirm,
    databaseUrl: input.databaseUrl,
    who: input.who || "",
    at: input.at || "",
  });
  return { written, text, artifact, plan };
}
