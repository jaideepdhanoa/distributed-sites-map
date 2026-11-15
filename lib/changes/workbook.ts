import { COMMS_FIELDS, type CommsField } from "./vocab";

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

export function workbookFromFiles(files: { deals: string; timeline: string; comms: string }): WorkbookSlice {
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

  return { stages, activities, comms };
}
