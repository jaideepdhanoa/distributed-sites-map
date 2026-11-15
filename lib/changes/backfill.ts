import { createHash } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { applyParsedChanges, numericSuffix, raiseIdFloor } from "./apply";
import type { Actor, ParsedChange } from "./schema";
import { importEntityFromWorkbook } from "./flags";
import { SITE_COMPARE_FIELDS, fieldsOf, parseSheet, siteComparable } from "./site";
import { COMMS_FIELDS, type ActivityType, type Market, type ServiceAreaClass, type StageName } from "./vocab";
import { issueIds, workbookIssues, type ActivityRow, type CommsRow, type StageRow, type WorkbookSlice } from "./workbook";
import { readDatabaseSlice } from "./diff";

export type ImportCounts = {
  inserted: { stage: number; activity: number; comms: number; site: number };
  unchanged: { stage: number; activity: number; comms: number; site: number };
  invalid: { stage: number; activity: number; comms: number; site: number };
  cut_over: ShadowCut[];
  /** Tables this process can see are missing. The other entities still import. */
  unmigrated: ShadowCut[];
};

type ShadowCut = "stage" | "activity" | "comms" | "site";

const ACTOR: Actor = { id: "workbook-sync", kind: "agent" };

function sameFields(left: Record<string, string>, right: Record<string, string>, fields: readonly string[]): boolean {
  return fields.every((field) => (left[field] || "") === (right[field] || ""));
}

function stageFields(row: StageRow): Record<string, string> {
  return {
    stage: row.stage,
    market: row.market,
    service_area_class: row.service_area_class,
    reason: row.reason,
  };
}

function activityFields(row: ActivityRow): Record<string, string> {
  return {
    site_id: row.site_id,
    date: row.date,
    type: row.type,
    summary: row.summary,
    source_link: row.source_link,
  };
}

function commsFields(row: CommsRow): Record<string, string> {
  const fields: Record<string, string> = { site_id: row.site_id };
  for (const field of COMMS_FIELDS) fields[field] = row[field];
  return fields;
}

async function tableReady(sql: Sql, name: string): Promise<boolean> {
  const result = await sql.query<{ name: string | null }>(`SELECT to_regclass($1) AS name`, [`public.${name}`]);
  return Boolean(result.rows[0]?.name);
}

async function versions(sql: Sql, sitesReady: boolean): Promise<{ stage: Map<string, number>; activity: Map<string, number>; comms: Map<string, number>; site: Map<string, number> }> {
  const stage = await sql.query<{ site_id: string; version: number | string }>(`SELECT site_id, version FROM site_stages`);
  const activity = await sql.query<{ entity_id: string; version: number | string }>(`SELECT entity_id, version FROM activities`);
  const comms = await sql.query<{ entity_id: string; version: number | string }>(`SELECT entity_id, version FROM comms_entries`);
  const site = sitesReady
    ? await sql.query<{ site_id: string; version: number | string }>(`SELECT site_id, version FROM sites`)
    : { rows: [] as { site_id: string; version: number | string }[] };
  return {
    stage: new Map(stage.rows.map((row) => [row.site_id, Number(row.version)])),
    activity: new Map(activity.rows.map((row) => [row.entity_id, Number(row.version)])),
    comms: new Map(comms.rows.map((row) => [row.entity_id, Number(row.version)])),
    site: new Map(site.rows.map((row) => [row.site_id, Number(row.version)])),
  };
}

/**
 * Copy workbook rows that differ from the database. Invalid cells are left
 * out and reported. A second pass of the same snapshot writes nothing.
 * An entity whose read flag is on is skipped: the database is the record.
 */
export async function importChanged(sql: Sql, slice: WorkbookSlice, snapshotId: string): Promise<ImportCounts> {
  const counts: ImportCounts = {
    inserted: { stage: 0, activity: 0, comms: 0, site: 0 },
    unchanged: { stage: 0, activity: 0, comms: 0, site: 0 },
    invalid: { stage: 0, activity: 0, comms: 0, site: 0 },
    cut_over: [],
    unmigrated: [],
  };
  const issues = workbookIssues(slice);
  const invalidStage = issueIds(issues.stage);
  const invalidActivity = issueIds(issues.activity);
  const invalidComms = issueIds(issues.comms);
  const invalidSiteId = issueIds(issues.site.filter((issue) => issue.field === "site_id"));
  counts.invalid = {
    stage: invalidStage.size,
    activity: invalidActivity.size,
    comms: invalidComms.size,
    site: new Set(issues.site.map((issue) => issue.id)).size,
  };
  const sitesReady = await tableReady(sql, "sites");
  if (!sitesReady) counts.unmigrated.push("site");
  const current = await readDatabaseSlice(sql);
  const version = await versions(sql, sitesReady);
  const source = `workbook snapshot ${snapshotId}`;
  const changes: ParsedChange[] = [];
  const currentStage = new Map(current.stages.map((row) => [row.site_id, row]));
  const currentActivity = new Map(current.activities.map((row) => [row.entity_id, row]));
  const currentComms = new Map(current.comms.map((row) => [row.entity_id, row]));
  const currentSite = new Map((current.sites || []).map((row) => [row.site_id, row]));

  if (!importEntityFromWorkbook("stage")) counts.cut_over.push("stage");
  else {
    for (const row of slice.stages) {
      if (invalidStage.has(row.site_id)) continue;
      const prior = currentStage.get(row.site_id);
      if (prior && sameFields(stageFields(prior), stageFields(row), ["stage", "market", "service_area_class", "reason"])) {
        counts.unchanged.stage += 1;
        continue;
      }
      changes.push({
        entity_type: "stage",
        site_id: row.site_id,
        expected_version: version.stage.get(row.site_id) || 0,
        source,
        payload: {
          stage: row.stage as StageName,
          market: row.market as Market,
          service_area_class: row.service_area_class as ServiceAreaClass | "",
          reason: row.reason,
        },
      });
      counts.inserted.stage += 1;
    }
  }

  if (!importEntityFromWorkbook("activity")) counts.cut_over.push("activity");
  else {
    for (const row of slice.activities) {
      if (invalidActivity.has(row.entity_id)) continue;
      const prior = currentActivity.get(row.entity_id);
      if (prior && sameFields(activityFields(prior), activityFields(row), ["site_id", "date", "type", "summary", "source_link"])) {
        counts.unchanged.activity += 1;
        continue;
      }
      changes.push({
        entity_type: "activity",
        site_id: row.site_id,
        entity_id: row.entity_id,
        preserve_id: true,
        expected_version: version.activity.get(row.entity_id) || 0,
        source,
        payload: { date: row.date, type: row.type as ActivityType, summary: row.summary, source_link: row.source_link },
      });
      counts.inserted.activity += 1;
    }
  }

  if (!importEntityFromWorkbook("comms")) counts.cut_over.push("comms");
  else {
    for (const row of slice.comms) {
      if (invalidComms.has(row.entity_id)) continue;
      const prior = currentComms.get(row.entity_id);
      const fields = ["site_id", ...COMMS_FIELDS] as const;
      if (prior && sameFields(commsFields(prior), commsFields(row), fields)) {
        counts.unchanged.comms += 1;
        continue;
      }
      changes.push({
        entity_type: "comms",
        site_id: row.site_id,
        entity_id: row.entity_id,
        preserve_id: true,
        expected_version: version.comms.get(row.entity_id) || 0,
        source,
        payload: {
          direction: row.direction as "in" | "internal",
          at: row.at,
          person: row.person,
          firm: row.firm,
          channel: row.channel,
          summary: row.summary,
          subject: row.subject,
          site_ids: row.site_ids,
          thread_id: row.thread_id,
          link: row.link,
          asks_made: row.asks_made,
          asks_answered: row.asks_answered,
          attachments: row.attachments,
          state_changes: row.state_changes,
          workbook_source: row.workbook_source,
          message_id: row.message_id,
        },
      });
      counts.inserted.comms += 1;
    }
  }

  if (sitesReady && !importEntityFromWorkbook("site")) counts.cut_over.push("site");
  else if (sitesReady) {
    for (const row of slice.sites || []) {
      if (invalidSiteId.has(row.site_id)) continue;
      const prior = currentSite.get(row.site_id);
      if (prior && sameFields(siteComparable(prior), siteComparable(row), SITE_COMPARE_FIELDS)) {
        counts.unchanged.site += 1;
        continue;
      }
      changes.push({
        entity_type: "site",
        site_id: row.site_id,
        expected_version: version.site.get(row.site_id) || 0,
        source,
        payload: {
          fields: fieldsOf(row),
          sheet: parseSheet(row.sheet),
          facts: row.facts,
          coord_status: row.coord_status,
        },
      });
      counts.inserted.site += 1;
    }
  }

  await raiseIdFloor(sql, "activity", Math.max(0, ...slice.activities.map((row) => numericSuffix("A-", row.entity_id))));
  await raiseIdFloor(sql, "comms", Math.max(0, ...slice.comms.map((row) => numericSuffix("CM-", row.entity_id))));
  if (!changes.length) return counts;
  const digest = createHash("sha256").update(JSON.stringify(changes)).digest("hex").slice(0, 24);
  await applyParsedChanges(sql, ACTOR, `workbook-sync-${snapshotId}-${digest}`, changes, source, "workbook");
  return counts;
}
