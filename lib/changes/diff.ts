import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { COMMS_FIELDS, type CommsField } from "./vocab";
import type { ActivityRow, CommsRow, StageRow, WorkbookSlice } from "./workbook";

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
  entities: { stage: EntityDiff; activity: EntityDiff; comms: EntityDiff };
};

const STAGE_FIELDS = ["stage", "market", "service_area_class", "reason"] as const;
const ACTIVITY_FIELDS = ["site_id", "date", "type", "summary", "source_link"] as const;

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

export function buildReport(workbook: WorkbookSlice, database: WorkbookSlice, workbookSource: string): DiffReport {
  const entities = {
    stage: compare(stageMap(workbook.stages), stageMap(database.stages), STAGE_FIELDS),
    activity: compare(activityMap(workbook.activities), activityMap(database.activities), ACTIVITY_FIELDS),
    comms: compare(commsMap(workbook.comms), commsMap(database.comms), ["site_id", ...COMMS_FIELDS]),
  };
  const clean = (["stage", "activity", "comms"] as const).every((name) => {
    const row = entities[name];
    return row.missing.length === 0 && row.extra.length === 0 && row.changed.length === 0;
  });
  return { workbook_source: workbookSource, clean, entities };
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
  };
}

export async function diffDatabase(sql: Sql, workbook: WorkbookSlice, workbookSource: string): Promise<DiffReport> {
  const report = buildReport(workbook, await readDatabaseSlice(sql), workbookSource);
  const runId = `run_${randomUUID().replaceAll("-", "")}`;
  const counts = {
    clean: report.clean ? 1 : 0,
    stage_missing: report.entities.stage.missing.length,
    stage_extra: report.entities.stage.extra.length,
    stage_changed: report.entities.stage.changed.length,
    activity_missing: report.entities.activity.missing.length,
    activity_extra: report.entities.activity.extra.length,
    activity_changed: report.entities.activity.changed.length,
    comms_missing: report.entities.comms.missing.length,
    comms_extra: report.entities.comms.extra.length,
    comms_changed: report.entities.comms.changed.length,
  };
  await sql.query(
    `INSERT INTO runs (id, actor, status, finished_at, counts, notes)
     VALUES ($1, 'shadow-diff', 'succeeded', clock_timestamp(), $2::jsonb, $3)`,
    [runId, JSON.stringify(counts), report.clean ? "clean" : "drift"],
  );
  return report;
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
  for (const name of ["stage", "activity", "comms"] as const) {
    const row = report.entities[name];
    lines.push(`| ${name} | ${row.workbook} | ${row.database} | ${row.missing.length} | ${row.extra.length} | ${row.changed.length} |`);
  }
  lines.push(
    "",
    `Clean: ${report.clean ? "yes" : "no"}`,
    "",
    "Cutover needs three consecutive daily reports with Clean: yes. This job does not write the workbook and does not change what the site displays.",
    "",
  );
  for (const name of ["stage", "activity", "comms"] as const) {
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
