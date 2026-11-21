import { actionsEnabled, withSql } from "@/lib/actions/db";
import { commsSnapshotForIds, type CommsSnapshot, type CommsRecord } from "@/lib/comms";
import { timelineForIds } from "@/lib/timeline/filter";
import { moneyText } from "@/lib/pricing";
import { stageKey } from "@/lib/stageOverlay";
import { isProtectedId } from "@/lib/protectedSite";
import { readEntityFromDb } from "./flags";
import { readGenerated } from "@/lib/guard";
import { NUMERIC_FACT_FIELDS, SITE_FIELDS, displayNote, listingFlags, parseMeasure, parseSheet, passingClass, photoCanonical, photosFromCanonical, recordedPerAcre, scrubText, type PhotoRef, type SiteField } from "./site";

type DealFile = {
  features?: {
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown } | null;
  }[];
};

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

type SiteRead = Record<SiteField, string> & {
  site_id: string;
  sheet?: string;
  facts?: Record<string, string>;
  coord_status?: string;
  /** site_mints.kind when the row was minted. The id prefix is the fallback. */
  kind?: string;
};

function dealKind(row: { site_id: string; kind?: string }): "pipeline" | "land" | null {
  const stored = text(row.kind).toLowerCase();
  if (stored === "pipeline" || stored === "land") return stored;
  const id = text(row.site_id).toUpperCase();
  if (id.startsWith("PIPE-")) return "pipeline";
  if (id.startsWith("LAND-")) return "land";
  return null;
}

function copiedPoint(key: string, stored: string | undefined, snapshot: unknown): Record<string, number | null> {
  const fromDb = stored ? numberOrNull(stored) : null;
  if (stored && fromDb != null) return { [key]: fromDb };
  if (snapshot == null || snapshot === "") return {};
  const fromSnapshot = typeof snapshot === "number" ? snapshot : numberOrNull(String(snapshot));
  return fromSnapshot == null ? {} : { [key]: fromSnapshot };
}

function numberOrNull(value: string): number | null {
  return parseMeasure(value);
}

/** Numeric facts, plus the site columns that share that allowlist. Text facts are not in this set. */
const NUMERIC_FACT_KEYS = new Set<string>(NUMERIC_FACT_FIELDS);

/**
 * Facts are stored as text. Copy a number only when the snapshot value for
 * that key is a number, or the key is on the numeric allowlist. A link, a
 * date, a road, or a phase stays a string. An empty cell leaves the snapshot,
 * including null.
 */
function paintFact(key: string, value: unknown, snapshot: unknown): string | number | undefined {
  const textValue = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!textValue || key === "price_per_acre") return undefined;
  const numeric = NUMERIC_FACT_KEYS.has(key) || typeof snapshot === "number";
  if (!numeric) return textValue;
  const parsed = numberOrNull(textValue);
  return parsed == null ? undefined : parsed;
}

function photosOf(value: unknown): PhotoRef[] {
  if (typeof value === "string") return photosFromCanonical(value);
  return photosFromCanonical(JSON.stringify(value ?? []));
}

function paintDeal<T extends DealFile["features"] extends (infer Feature)[] | undefined ? Feature : never>(
  feature: T,
  row: SiteRead,
): T {
  const props = feature.properties || {};
    const cells = parseSheet(row.sheet || "{}");
    const asking = numberOrNull(cells["Asking price ($)"] || row.asking_price);
    const acres = numberOrNull(cells["Land (acres)"] || row.acreage);
    const photos = photosOf(row.photo_refs);
    const frontage = photos.find((photo) => photo.role === "street_frontage" && photo.view_url);
    const status = cells["Listing status"] || row.listing_status;
    const flags = listingFlags(status);
    const next: Record<string, unknown> = {
      ...props,
      name: scrubText(cells.Name || row.name),
      address: scrubText((cells.Address || cells.Site || row.address).replace(/^(PHX|LAS|MIA|SNA)\s+/i, "")),
      city: cells.Market || row.market || props.city,
      business_type: row.category || props.business_type,
      broker: row.broker,
      firm: row.firm,
      listing_url: cells["Listing link"] || row.listing_url,
      asking_price: asking,
      asking_price_display: asking == null ? null : moneyText(asking),
      land_acres: acres,
      apn: cells["APN or folio"] || cells.APN || row.apn,
      next_step: displayNote(cells["Next step"] || row.notes),
      universe_id: row.universe_id,
      miles_to_depot: numberOrNull(row.miles_to_depot),
      service_area_class: row.service_area_class || props.service_area_class,
      service_area_distance_mi: row.service_area_distance_mi ? numberOrNull(row.service_area_distance_mi) : props.service_area_distance_mi,
      service_area_polygon: row.service_area_polygon || props.service_area_polygon,
      score: row.score ? numberOrNull(row.score) : props.score,
      location_points: row.location_points ? numberOrNull(row.location_points) : props.location_points,
      ...copiedPoint("economics_points", row.economics_points, props.economics_points),
      ...copiedPoint("land_points", row.land_points, props.land_points),
      ...copiedPoint("power_points", row.power_points, props.power_points),
      ...copiedPoint("deal_points", row.deal_points, props.deal_points),
      photos: photos.map((photo) => {
        const item: Record<string, string> = {};
        for (const [key, value] of Object.entries(photo)) if (value) item[key] = value;
        return item;
      }),
      photo_status: row.photo_status,
      photo_diligence_count: numberOrNull(row.photo_diligence_count),
      photo_listing_count: numberOrNull(row.photo_listing_count),
      photos_checked: row.photos_checked,
      photo_notes: row.photo_notes,
      listed: flags.listed,
      listing_removed: flags.removed,
    };
    if (frontage?.view_url) next.street_view_url = frontage.view_url;
    if (row.county_value) next.county_value = numberOrNull(row.county_value);
    if (row.county_value_basis) next.county_value_basis = row.county_value_basis;
    if (row.land_value) next.land_value = numberOrNull(row.land_value);
    if (row.improvement_value) next.improvement_value = numberOrNull(row.improvement_value);
    next.price_per_acre = recordedPerAcre(row.facts?.price_per_acre || "", cells["Asking price ($)"] || row.asking_price, cells["Land (acres)"] || row.acreage);
    if (row.facts) {
      for (const [key, value] of Object.entries(row.facts)) {
        const painted = paintFact(key, value, props[key]);
        if (painted === undefined) continue;
        next[key] = painted;
      }
    }
    if (row.coord_status) next.coord_status = row.coord_status;
    const gate = passingClass(row.service_area_class);
    if (gate != null) next.in_area = gate;
    let geometry = feature.geometry;
    const lat = numberOrNull(row.lat);
    const lng = numberOrNull(row.lng);
    if (lat != null && lng != null) geometry = { type: "Point", coordinates: [lng, lat] };
    return { ...feature, geometry, properties: next };
}

/**
 * Paint database site rows onto deals. A deal the database does not have keeps
 * the snapshot. A database row whose id is missing from the snapshot is added.
 * On an id that is in both, the snapshot feature stays and the paint above
 * fills the database fields the list already reads. Protected ids are not added.
 * Stage text is applied later by the site_stages overlay.
 */
export function applySiteRows<T extends DealFile>(file: T, rows: SiteRead[]): T {
  const byId = new Map(rows.map((row) => [row.site_id, row]));
  const features = (file.features || []).map((feature) => {
    const props = feature.properties || {};
    const row = byId.get(text(props.deal_id));
    if (!row) return feature;
    return paintDeal(feature, row);
  });
  const present = new Set(features.map((feature) => text(feature.properties?.deal_id)).filter(Boolean));
  for (const row of rows) {
    const id = text(row.site_id);
    if (!id || present.has(id) || isProtectedId(id)) continue;
    const kind = dealKind(row);
    if (!kind) continue;
    features.push(
      paintDeal(
        { type: "Feature", geometry: null, properties: { deal_id: id, kind, stage: "", stage_group: "" } } as (typeof features)[number],
        row,
      ),
    );
    present.add(id);
  }
  return { ...file, features };
}

export async function overlayDealSites<T extends DealFile>(file: T): Promise<T> {
  if (!readEntityFromDb("site") || !actionsEnabled()) return file;
  try {
    const rows = await withSql((sql) =>
      sql.query<Record<string, unknown>>(
        `SELECT s.site_id, ${SITE_FIELDS.filter((field) => field !== "photo_refs").map((field) => `s.${field}`).join(", ")}, s.photo_refs, s.sheet, s.facts, s.coord_status, m.kind AS site_kind
         FROM sites s
         LEFT JOIN site_mints m ON m.site_id = s.site_id`,
      ),
    );
    const mapped: SiteRead[] = rows.rows.map((row) => {
      const record = {
        site_id: text(row.site_id),
        sheet: typeof row.sheet === "string" ? row.sheet : JSON.stringify(row.sheet ?? {}),
        facts: (row.facts && typeof row.facts === "object" ? row.facts : {}) as Record<string, string>,
        coord_status: text(row.coord_status),
        kind: text(row.site_kind),
      } as SiteRead;
      for (const field of SITE_FIELDS) {
        if (field === "photo_refs") record.photo_refs = photoCanonical(photosOf(row.photo_refs));
        else record[field] = text(row[field]);
      }
      return record;
    });
    return applySiteRows(file, mapped);
  } catch {
    console.error(JSON.stringify({ event: "site_read_fallback" }));
    return file;
  }
}

/** The deals file, with Neon site rows painted on when the site read flag is on. */
export async function readDeals(): Promise<DealFile> {
  const file = readGenerated("deals.geojson") as DealFile;
  return overlayDealSites(file);
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

type ActivityItem = {
  record_id: string;
  event_id: string;
  date: string;
  type: string;
  summary: string;
  source_link?: string;
  at_approximate?: boolean;
};

export function applyActivityItems(raw: unknown, items: ActivityItem[]): unknown {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { ...root, items };
}

function wantedIds(ids: string[] | undefined): string[] | null {
  if (!ids) return null;
  return [...new Set(ids.map((id) => id.trim().toUpperCase()).filter(Boolean))];
}

export async function overlayTimeline(raw: unknown, ids?: string[]): Promise<unknown> {
  const base = ids?.length ? timelineForIds(raw, ids) : raw;
  if (!readEntityFromDb("activity") || !actionsEnabled()) return base;
  const wanted = wantedIds(ids);
  try {
    const rows = await withSql((sql) =>
      wanted
        ? sql.query<{ entity_id: string; site_id: string; payload: unknown }>(
            `SELECT entity_id, site_id, payload FROM activities WHERE upper(site_id) = ANY($1::text[])`,
            [wanted],
          )
        : sql.query<{ entity_id: string; site_id: string; payload: unknown }>(`SELECT entity_id, site_id, payload FROM activities`),
    );
    const items: ActivityItem[] = rows.rows.map((row) => {
      const payload = asObject(row.payload);
      const item: ActivityItem = {
        record_id: text(row.site_id),
        event_id: text(row.entity_id),
        date: text(payload.date_iso) || text(payload.date),
        type: text(payload.type),
        summary: text(payload.summary),
      };
      const link = text(payload.source_link);
      if (link) item.source_link = link;
      if (payload.at_approximate === true || payload.at_approximate === "1") item.at_approximate = true;
      return item;
    });
    return applyActivityItems(base, items);
  } catch {
    console.error(JSON.stringify({ event: "activity_read_fallback" }));
    return base;
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

export async function overlayComms(snapshot: CommsSnapshot, ids?: string[]): Promise<CommsSnapshot> {
  const base = ids?.length ? commsSnapshotForIds(snapshot, ids) : snapshot;
  if (!readEntityFromDb("comms") || !actionsEnabled()) return base;
  const wanted = wantedIds(ids);
  if (wanted && !wanted.length) return applyCommsRows(base, []);
  try {
    const result = await withSql((sql) =>
      wanted
        ? sql.query<{ entity_id: string; payload: unknown }>(
            `SELECT entity_id, payload FROM comms_entries
             WHERE upper(site_id) = ANY($1::text[])
                OR EXISTS (
                  SELECT 1
                  FROM unnest(string_to_array(coalesce(payload->>'site_ids', ''), ';')) AS token
                  WHERE upper(btrim(token)) = ANY($1::text[])
                )`,
            [wanted],
          )
        : sql.query<{ entity_id: string; payload: unknown }>(`SELECT entity_id, payload FROM comms_entries`),
    );
    const rows: CommsRecord[] = result.rows.map((row) => {
      const payload = asObject(row.payload);
      return {
        comms_id: text(row.entity_id),
        site_ids: text(payload.site_ids),
        thread_id: text(payload.thread_id),
        link: text(payload.link),
        at: text(payload.at),
        at_iso: text(payload.at_iso),
        at_text: text(payload.at_text),
        at_approximate: payload.at_approximate === true || payload.at_approximate === "1",
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
    return applyCommsRows(base, rows);
  } catch {
    console.error(JSON.stringify({ event: "comms_read_fallback" }));
    return base;
  }
}
