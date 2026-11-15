import { actionsEnabled, withSql } from "@/lib/actions/db";
import type { CommsSnapshot, CommsRecord } from "@/lib/comms";
import { stageKey } from "@/lib/stageOverlay";
import { readEntityFromDb } from "./flags";

type DealFile = { features?: { properties?: Record<string, unknown> }[] };

type StageRecord = { site_id: string; stage: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Paint database stages onto a deal collection. Rows the database does not have keep the snapshot stage. */
export function applyStageRows<T extends DealFile>(file: T, rows: StageRecord[]): T {
  const byId = new Map(rows.map((row) => [row.site_id, row.stage]));
  const features = (file.features || []).map((feature) => {
    const props = feature.properties || {};
    const id = text(props.deal_id);
    const stage = byId.get(id);
    if (!stage) return feature;
    return { ...feature, properties: { ...props, stage, stage_group: stageKey(stage) || props.stage_group } };
  });
  return { ...file, features };
}

export async function overlayDealStages<T extends DealFile>(file: T): Promise<T> {
  if (!readEntityFromDb("stage") || !actionsEnabled()) return file;
  try {
    const rows = await withSql((sql) => sql.query<StageRecord>(`SELECT site_id, stage FROM site_stages`));
    return applyStageRows(file, rows.rows);
  } catch {
    console.error(JSON.stringify({ event: "stage_read_fallback" }));
    return file;
  }
}

type ActivityItem = { record_id: string; event_id: string; date: string; type: string; summary: string; source_link?: string };

export function applyActivityItems(raw: unknown, items: ActivityItem[]): unknown {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { ...root, items };
}

export async function overlayTimeline(raw: unknown): Promise<unknown> {
  if (!readEntityFromDb("activity") || !actionsEnabled()) return raw;
  try {
    const rows = await withSql((sql) =>
      sql.query<{ entity_id: string; site_id: string; payload: unknown }>(`SELECT entity_id, site_id, payload FROM activities`),
    );
    const items: ActivityItem[] = rows.rows.map((row) => {
      const payload = asObject(row.payload);
      const item: ActivityItem = {
        record_id: text(row.site_id),
        event_id: text(row.entity_id),
        date: text(payload.date),
        type: text(payload.type),
        summary: text(payload.summary),
      };
      const link = text(payload.source_link);
      if (link) item.source_link = link;
      return item;
    });
    return applyActivityItems(raw, items);
  } catch {
    console.error(JSON.stringify({ event: "activity_read_fallback" }));
    return raw;
  }
}

export function applyCommsRows(snapshot: CommsSnapshot, rows: CommsRecord[]): CommsSnapshot {
  const sites: Record<string, string[]> = {};
  for (const row of rows) {
    for (const site of String(row.site_ids || "").split(";")) {
      const id = site.trim();
      if (!id) continue;
      const list = sites[id] || [];
      if (!list.includes(row.comms_id)) list.push(row.comms_id);
      sites[id] = list;
    }
  }
  return { ...snapshot, rows, sites };
}

export async function overlayComms(snapshot: CommsSnapshot): Promise<CommsSnapshot> {
  if (!readEntityFromDb("comms") || !actionsEnabled()) return snapshot;
  try {
    const result = await withSql((sql) =>
      sql.query<{ entity_id: string; payload: unknown }>(`SELECT entity_id, payload FROM comms_entries`),
    );
    const rows: CommsRecord[] = result.rows.map((row) => {
      const payload = asObject(row.payload);
      return {
        comms_id: text(row.entity_id),
        site_ids: text(payload.site_ids),
        thread_id: text(payload.thread_id),
        link: text(payload.link),
        at: text(payload.at),
        direction: text(payload.direction),
        person: text(payload.person),
        firm: text(payload.firm),
        channel: text(payload.channel),
        summary: text(payload.summary),
        asks_made: text(payload.asks_made),
        asks_answered: text(payload.asks_answered),
        attachments: text(payload.attachments),
        state_changes: text(payload.state_changes),
        source: text(payload.workbook_source),
        message_id: text(payload.message_id),
        subject: text(payload.subject),
      };
    });
    return applyCommsRows(snapshot, rows);
  } catch {
    console.error(JSON.stringify({ event: "comms_read_fallback" }));
    return snapshot;
  }
}
