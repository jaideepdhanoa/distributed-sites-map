import type { Sql } from "@/lib/actions/db";
import { importEntityFromWorkbook, type ShadowEntity } from "./flags";
import { SITE_COMPARE_FIELDS, SITE_FIELDS, emptySiteFields, parseSheet, photoCanonical, photosFromCanonical, sheetCanonical, siteComparable, type SiteRow } from "./site";
import { COMMS_FIELDS, type CommsField } from "./vocab";
import { issueIds, legacyStageIds, workbookIssues, type ActivityRow, type CommsRow, type RowIssue, type StageRow, type WorkbookSlice } from "./workbook";

export type DiffChange = { id: string; field: string; workbook: string; database: string };

export type EntityDiff = {
  workbook: number;
  database: number;
  missing: string[];
  extra: string[];
  changed: DiffChange[];
};

export type DiffReport = {
  workbook_source: string;
  clean: boolean;
  clean_by_entity: { stage: boolean; activity: boolean; comms: boolean; site: boolean };
  cut_over: ShadowEntity[];
  legacy_stages: string[];
  invalid: { stage: RowIssue[]; activity: RowIssue[]; comms: RowIssue[]; site: RowIssue[] };
  entities: { stage: EntityDiff; activity: EntityDiff; comms: EntityDiff; site: EntityDiff };
};

const STAGE_FIELDS = ["stage", "market", "service_area_class", "reason"] as const;
const ACTIVITY_FIELDS = ["site_id", "date", "type", "summary", "source_link"] as const;
const ENTITIES = ["stage", "activity", "comms", "site"] as const;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
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

function compare(
  workbook: Map<string, Record<string, string>>,
  database: Map<string, Record<string, string>>,
  fields: readonly string[],
): EntityDiff {
  const missing: string[] = [];
  const extra: string[] = [];
  const changed: DiffChange[] = [];
  for (const [id, row] of workbook) {
    const other = database.get(id);
    if (!other) {
      missing.push(id);
      continue;
    }
    for (const field of fields) {
      if ((row[field] || "") !== (other[field] || "")) {
        changed.push({ id, field, workbook: row[field] || "", database: other[field] || "" });
      }
    }
  }
  for (const id of database.keys()) {
    if (!workbook.has(id)) extra.push(id);
  }
  missing.sort();
  extra.sort();
  changed.sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field));
  return { workbook: workbook.size, database: database.size, missing, extra, changed };
}

function stageMap(rows: StageRow[]): Map<string, Record<string, string>> {
  return new Map(rows.map((row) => [row.site_id, {
    stage: row.stage,
    market: row.market,
    service_area_class: row.service_area_class,
    reason: row.reason,
  }]));
}

function activityMap(rows: ActivityRow[]): Map<string, Record<string, string>> {
  return new Map(rows.map((row) => [row.entity_id, {
    site_id: row.site_id,
    date: row.date,
    type: row.type,
    summary: row.summary,
    source_link: row.source_link,
  }]));
}

function commsMap(rows: CommsRow[]): Map<string, Record<string, string>> {
  return new Map(rows.map((row) => {
    const fields: Record<string, string> = { site_id: row.site_id };
    for (const field of COMMS_FIELDS) fields[field] = row[field];
    return [row.entity_id, fields];
  }));
}

function siteMap(rows: SiteRow[]): Map<string, Record<string, string>> {
  return new Map(rows.map((row) => [row.site_id, siteComparable(row)]));
}

/** Fields that differ between the published deals file and the private raw cells. */
const RAW_SHEET_FIELDS = new Set(["sheet", "notes", "address", "listing_status", "listing_url"]);

export function siteCompareFields(rows: SiteRow[]): readonly string[] {
  const hasRawSheet = rows.some((row) => {
    const sheet = row.sheet?.trim();
    return Boolean(sheet && sheet !== "{}");
  });
  if (hasRawSheet) return SITE_COMPARE_FIELDS;
  return SITE_COMPARE_FIELDS.filter((field) => !RAW_SHEET_FIELDS.has(field));
}

function withoutIds<T extends { site_id?: string; entity_id?: string }>(rows: T[], ids: Set<string>, idOf: (row: T) => string): T[] {
  return rows.filter((row) => !ids.has(idOf(row)));
}

export function buildReport(workbook: WorkbookSlice, database: WorkbookSlice, workbookSource: string): DiffReport {
  const invalid = workbookIssues(workbook);
  const skip = {
    stage: issueIds(invalid.stage),
    activity: issueIds(invalid.activity),
    comms: issueIds(invalid.comms),
    site: issueIds(invalid.site.filter((issue) => issue.field === "site_id")),
  };
  const entities = {
    stage: compare(
      stageMap(withoutIds(workbook.stages, skip.stage, (row) => row.site_id)),
      stageMap(withoutIds(database.stages, skip.stage, (row) => row.site_id)),
      STAGE_FIELDS,
    ),
    activity: compare(
      activityMap(withoutIds(workbook.activities, skip.activity, (row) => row.entity_id)),
      activityMap(withoutIds(database.activities, skip.activity, (row) => row.entity_id)),
      ACTIVITY_FIELDS,
    ),
    comms: compare(
      commsMap(withoutIds(workbook.comms, skip.comms, (row) => row.entity_id)),
      commsMap(withoutIds(database.comms, skip.comms, (row) => row.entity_id)),
      ["site_id", ...COMMS_FIELDS],
    ),
    site: compare(
      siteMap(withoutIds(workbook.sites || [], skip.site, (row) => row.site_id)),
      siteMap(withoutIds(database.sites || [], skip.site, (row) => row.site_id)),
      siteCompareFields(workbook.sites || []),
    ),
  };
  const cutOver: ShadowEntity[] = [];
  for (const entity of ENTITIES) {
    if (importEntityFromWorkbook(entity)) continue;
    cutOver.push(entity);
    entities[entity] = { ...entities[entity], missing: [], extra: [], changed: [] };
    invalid[entity] = [];
  }
  const clean_by_entity = {
    stage: entityClean(entities.stage, invalid.stage),
    activity: entityClean(entities.activity, invalid.activity),
    comms: entityClean(entities.comms, invalid.comms),
    site: entityClean(entities.site, invalid.site),
  };
  const clean = clean_by_entity.stage && clean_by_entity.activity && clean_by_entity.comms && clean_by_entity.site;
  return {
    workbook_source: workbookSource,
    clean,
    clean_by_entity,
    cut_over: cutOver,
    legacy_stages: legacyStageIds(workbook),
    invalid,
    entities,
  };
}

function entityClean(row: EntityDiff, issues: RowIssue[]): boolean {
  return row.missing.length === 0 && row.extra.length === 0 && row.changed.length === 0 && issues.length === 0;
}

export async function readDatabaseSlice(sql: Sql): Promise<WorkbookSlice> {
  const stages = await sql.query<{
    site_id: string;
    stage: string;
    market: string;
    service_area_class: string;
    reason: string;
  }>(`SELECT site_id, stage, market, service_area_class, reason FROM site_stages`);
  const activities = await sql.query<{ entity_id: string; site_id: string; payload: unknown }>(
    `SELECT entity_id, site_id, payload FROM activities`,
  );
  const comms = await sql.query<{ entity_id: string; site_id: string; payload: unknown }>(
    `SELECT entity_id, site_id, payload FROM comms_entries`,
  );
  const sitesReady = await sql.query<{ name: string | null }>(`SELECT to_regclass('public.sites') AS name`);
  const sites = sitesReady.rows[0]?.name
    ? await sql.query<Record<string, unknown>>(
        `SELECT site_id, ${SITE_FIELDS.filter((field) => field !== "photo_refs").join(", ")}, photo_refs, sheet, facts, coord_status FROM sites`,
      )
    : { rows: [] as Record<string, unknown>[] };
  return {
    stages: stages.rows.map((row) => ({
      site_id: text(row.site_id),
      stage: text(row.stage),
      market: text(row.market),
      service_area_class: text(row.service_area_class),
      reason: text(row.reason),
    })),
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
      const record = {
        entity_id: text(row.entity_id),
        site_id: text(row.site_id),
      } as CommsRow;
      for (const field of COMMS_FIELDS) record[field] = text(payload[field]);
      return record;
    }),
    sites: sites.rows.map((row) => {
      const record = {
        site_id: text(row.site_id),
        coord_status: text(row.coord_status),
        sheet: sheetCanonical(typeof row.sheet === "string" ? parseSheet(row.sheet) : parseSheet(JSON.stringify(row.sheet ?? {}))),
        facts: asObject(row.facts) as Record<string, string>,
        ...emptySiteFields(),
      } as SiteRow;
      for (const field of SITE_FIELDS) {
        if (field === "photo_refs") {
          const raw = row.photo_refs;
          const canonical = typeof raw === "string" ? photoCanonical(photosFromCanonical(raw)) : photoCanonical(photosFromCanonical(JSON.stringify(raw ?? [])));
          record.photo_refs = canonical;
        } else {
          record[field] = text(row[field]);
        }
      }
      if (!record.sheet) record.sheet = "{}";
      return record;
    }),
  };
}

/** Read-only. The comparison does not insert events or runs. */
export async function diffDatabase(sql: Sql, workbook: WorkbookSlice, workbookSource: string): Promise<DiffReport> {
  return buildReport(workbook, await readDatabaseSlice(sql), workbookSource);
}

function sample(ids: string[], changes: DiffChange[]): string[] {
  const lines: string[] = [];
  for (const id of ids.slice(0, 20)) lines.push(`- missing ${id}`);
  if (ids.length > 20) lines.push(`- and ${ids.length - 20} more missing in the artifact`);
  for (const change of changes.slice(0, 20)) {
    lines.push(`- ${change.id} ${change.field}: workbook ${JSON.stringify(change.workbook)}, database ${JSON.stringify(change.database)}`);
  }
  if (changes.length > 20) lines.push(`- and ${changes.length - 20} more changes in the artifact`);
  return lines;
}

export function renderReport(report: DiffReport): string {
  const lines = [
    "## Shadow diff",
    "",
    `Workbook source: ${report.workbook_source}`,
    "",
    "| Entity | Workbook | Database | Missing | Extra | Changed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const name of ENTITIES) {
    const row = report.entities[name];
    lines.push(`| ${name} | ${row.workbook} | ${row.database} | ${row.missing.length} | ${row.extra.length} | ${row.changed.length} |`);
  }
  lines.push(
    "",
    `Clean: ${report.clean ? "yes" : "no"}`,
    `clean_by_entity: stage ${report.clean_by_entity.stage ? "yes" : "no"}, activity ${report.clean_by_entity.activity ? "yes" : "no"}, comms ${report.clean_by_entity.comms ? "yes" : "no"}, site ${report.clean_by_entity.site ? "yes" : "no"}`,
    "",
    "Cutover of an entity needs one clean on-demand diff after a fresh import. Then set that entity's read flag and CHANGES_API_ENABLED. This job does not write the workbook or the database.",
    "",
  );
  if (report.cut_over.length) {
    lines.push(`Database is the record for: ${report.cut_over.join(", ")}. Workbook import is off for those entities.`, "");
  }
  if (report.legacy_stages.length) {
    lines.push(`Legacy stages: ${report.legacy_stages.length}.`, "");
    for (const id of report.legacy_stages.slice(0, 20)) lines.push(`- legacy stage ${id}`);
    if (report.legacy_stages.length > 20) lines.push(`- and ${report.legacy_stages.length - 20} more in the artifact`);
    lines.push("");
  }
  for (const name of ENTITIES) {
    const issues = report.invalid[name];
    if (!issues.length) continue;
    lines.push(`### ${name} invalid`, "");
    for (const issue of issues.slice(0, 20)) lines.push(`- ${issue.id} ${issue.field}: ${JSON.stringify(issue.value)}`);
    if (issues.length > 20) lines.push(`- and ${issues.length - 20} more in the artifact`);
    lines.push("");
  }
  for (const name of ENTITIES) {
    const row = report.entities[name];
    if (!row.missing.length && !row.extra.length && !row.changed.length) continue;
    lines.push(`### ${name}`, "");
    lines.push(...sample(row.missing, row.changed));
    for (const id of row.extra.slice(0, 20)) lines.push(`- extra ${id}`);
    if (row.extra.length > 20) lines.push(`- and ${row.extra.length - 20} more extra in the artifact`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export type { CommsField };
