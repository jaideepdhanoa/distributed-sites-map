import { sitesFromFiles, siteIssues, type SiteRow } from "./site";
import {
  ACTIVITY_TYPES,
  COMMS_FIELDS,
  LEGACY_STAGES,
  MARKETS,
  SERVICE_AREA_CLASSES,
  SITE_ID,
  STAGES,
  WORKBOOK_DIRECTIONS,
  commsSiteAllowed,
  type CommsField,
} from "./vocab";

export type StageRow = {
  site_id: string;
  stage: string;
  market: string;
  service_area_class: string;
  reason: string;
};

export type ActivityRow = {
  entity_id: string;
  site_id: string;
  date: string;
  type: string;
  summary: string;
  source_link: string;
};

export type CommsRow = {
  entity_id: string;
  site_id: string;
} & Record<CommsField, string>;

export type WorkbookSlice = {
  stages: StageRow[];
  activities: ActivityRow[];
  comms: CommsRow[];
  /** Pipeline and land rows. Omitted slices are treated as none. */
  sites?: SiteRow[];
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function dedupe<T>(rows: T[], id: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = id(row);
    if (key) map.set(key, row);
  }
  return [...map.values()];
}

function firstSite(value: string): string {
  const token = value.split(";")[0]?.trim() || "";
  return token;
}

export function workbookFromFiles(files: { deals: string; timeline: string; comms: string; pricing?: string; sheet?: string }): WorkbookSlice {
  const deals = JSON.parse(files.deals) as { features?: { properties?: Record<string, unknown> }[] };
  const stages = dedupe(
    (deals.features || []).map((feature) => {
      const props = feature.properties || {};
      return {
        site_id: text(props.deal_id),
        stage: text(props.stage),
        market: text(props.city),
        service_area_class: text(props.service_area_class || props.service_area),
        reason: "",
      };
    }).filter((row) => row.site_id && row.stage),
    (row) => row.site_id,
  );

  const timeline = JSON.parse(files.timeline) as { items?: Record<string, unknown>[] };
  const activities = dedupe(
    (timeline.items || []).map((item) => ({
      entity_id: text(item.event_id),
      site_id: text(item.record_id),
      date: text(item.date),
      type: text(item.type),
      summary: text(item.summary),
      source_link: text(item.source_link),
    })).filter((row) => row.entity_id),
    (row) => row.entity_id,
  );

  const commsFile = JSON.parse(files.comms) as { rows?: Record<string, unknown>[] };
  const comms = dedupe(
    (commsFile.rows || []).map((row) => {
      const siteIds = text(row.site_ids);
      const record: CommsRow = {
        entity_id: text(row.comms_id),
        site_id: firstSite(siteIds),
        site_ids: siteIds,
        direction: text(row.direction),
        at: text(row.at),
        person: text(row.person),
        firm: text(row.firm),
        channel: text(row.channel),
        summary: text(row.summary),
        subject: text(row.subject),
        thread_id: text(row.thread_id),
        link: text(row.link),
        asks_made: text(row.asks_made),
        asks_answered: text(row.asks_answered),
        attachments: text(row.attachments),
        state_changes: text(row.state_changes),
        workbook_source: text(row.source),
        message_id: text(row.message_id),
      };
      for (const field of COMMS_FIELDS) record[field] = text(record[field]);
      return record;
    }).filter((row) => row.entity_id),
    (row) => row.entity_id,
  );

  return { stages, activities, comms, sites: sitesFromFiles(files.deals, files.pricing || "", files.sheet || "") };
}

export type RowIssue = { id: string; field: string; value: string };

function listed(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}

/** Invalid workbook cells. The values are returned unchanged and are not rewritten. */
export function workbookIssues(slice: WorkbookSlice): { stage: RowIssue[]; activity: RowIssue[]; comms: RowIssue[]; site: RowIssue[] } {
  const stage: RowIssue[] = [];
  const activity: RowIssue[] = [];
  const comms: RowIssue[] = [];
  const site: RowIssue[] = siteIssues(slice.sites || []);
  for (const row of slice.stages) {
    if (!listed(row.stage, STAGES)) stage.push({ id: row.site_id, field: "stage", value: row.stage });
    if (!listed(row.market, MARKETS)) stage.push({ id: row.site_id, field: "market", value: row.market });
    if (row.service_area_class && !listed(row.service_area_class, SERVICE_AREA_CLASSES)) {
      stage.push({ id: row.site_id, field: "service_area_class", value: row.service_area_class });
    }
    if (!SITE_ID.test(row.site_id)) stage.push({ id: row.site_id, field: "site_id", value: row.site_id });
  }
  for (const row of slice.activities) {
    if (!listed(row.type, ACTIVITY_TYPES)) activity.push({ id: row.entity_id, field: "type", value: row.type });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) activity.push({ id: row.entity_id, field: "date", value: row.date });
    if (!SITE_ID.test(row.site_id)) activity.push({ id: row.entity_id, field: "site_id", value: row.site_id });
    if (!/^A-\d{4,}$/.test(row.entity_id)) activity.push({ id: row.entity_id, field: "entity_id", value: row.entity_id });
  }
  for (const row of slice.comms) {
    if (!listed(row.direction, WORKBOOK_DIRECTIONS)) comms.push({ id: row.entity_id, field: "direction", value: row.direction });
    if (!commsSiteAllowed(row.site_id)) comms.push({ id: row.entity_id, field: "site_id", value: row.site_id });
    if (!/^CM-\d{4,}$/.test(row.entity_id)) comms.push({ id: row.entity_id, field: "entity_id", value: row.entity_id });
  }
  return { stage, activity, comms, site };
}

export function legacyStageIds(slice: WorkbookSlice): string[] {
  return slice.stages.filter((row) => listed(row.stage, LEGACY_STAGES)).map((row) => row.site_id).sort();
}

export function issueIds(issues: RowIssue[]): Set<string> {
  return new Set(issues.map((issue) => issue.id));
}
