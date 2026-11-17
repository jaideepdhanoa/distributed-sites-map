import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import {
  SITE_FIELDS,
  SITE_NUMERIC_FIELDS,
  emptySiteFields,
  brokerMirrorCell,
  mirrorWrites,
  parseSheet,
  photoCanonical,
  photosFromCanonical,
  pricePerAcre,
  sheetCanonical,
  writesCanonical,
  type PhotoRef,
  type SiteField,
} from "./site";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { storeComment } from "@/lib/comments/record";
import { storeConflict } from "@/lib/conflicts/record";
import { retractPnlLine, storePnlLine } from "@/lib/pnl/store";
import { storeSiteSpace } from "@/lib/spaces/store";
import type { ActivityPayload, Actor, CommentPayload, CommsPayload, ConflictPayload, ParsedChange, PnlLinePayload, SitePayload, SiteSpacePayload, StagePayload, TagPayload } from "./schema";
import { formatZonedTimestamp, isPnlRetract, parseZonedTimestamp, validateBatch } from "./schema";
import { marketCode, serviceAreaCode } from "./stageLabel";
import type { EntityType, Market, ServiceAreaClass } from "./vocab";

export type { Actor } from "./schema";

export type ChangeResult = {
  entity_type: EntityType;
  entity_id: string;
  site_id: string;
  event_id: string;
  version: number;
};

export type ApplyResult = {
  ok: true;
  replayed: boolean;
  run_id: string;
  idempotency_key: string;
  results: ChangeResult[];
};

export type ApplyOptions = { joinTransaction?: boolean };

export type VersionConflict = {
  entity_type: EntityType;
  site_id: string;
  entity_id: string;
  expected_version: number;
  actual_version: number;
};

export class VersionConflictError extends Error {
  readonly status = 409;
  readonly conflicts: VersionConflict[];
  constructor(conflicts: VersionConflict[]) {
    super("Version conflict");
    this.name = "VersionConflictError";
    this.conflicts = conflicts;
  }
}

export class IdempotencyConflictError extends InputError {
  constructor() {
    super("This Idempotency-Key was already used for a different batch.", 409);
    this.name = "IdempotencyConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(actor: Actor, changes: ParsedChange[]): string {
  return createHash("sha256").update(canonicalJson({ actor: actor.id, kind: actor.kind, changes })).digest("hex");
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

async function lockKey(sql: Sql, key: string): Promise<void> {
  await sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
}

async function tableIdFloor(sql: Sql, name: "activity" | "comms" | "pnl_period" | "pnl_line"): Promise<number> {
  const prefix = name === "activity" ? "A-" : name === "comms" ? "CM-" : name === "pnl_period" ? "PP-" : "PL-";
  const table = name === "activity" ? "activities" : name === "comms" ? "comms_entries" : name === "pnl_period" ? "pnl_periods" : "pnl_lines";
  const rows = await sql.query<{ entity_id: string }>(`SELECT entity_id FROM ${table}`);
  let max = 0;
  for (const row of rows.rows) max = Math.max(max, numericSuffix(prefix, textOf(row.entity_id)));
  return max;
}

async function mint(sql: Sql, name: "activity" | "comms" | "event" | "pnl_period" | "pnl_line" | "site_space" | "data_conflict" | "comment"): Promise<number> {
  if (name === "event" || name === "pnl_period" || name === "pnl_line" || name === "site_space" || name === "data_conflict" || name === "comment") {
    const result = await sql.query<{ value: number | string }>(
      `INSERT INTO id_counters (name, value)
       VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET value = id_counters.value + 1
       RETURNING value`,
      [name],
    );
    return Number(result.rows[0]?.value || 0);
  }
  // Above the counter and above every id already stored. The import raises the
  // counter to the highest workbook id, including rows that were not copied in.
  const counter = await sql.query<{ value: number | string }>(`SELECT value FROM id_counters WHERE name = $1`, [name]);
  const current = Number(counter.rows[0]?.value || 0);
  const next = Math.max(current, await tableIdFloor(sql, name)) + 1;
  await sql.query(
    `INSERT INTO id_counters (name, value) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value = GREATEST(id_counters.value, EXCLUDED.value)`,
    [name, next],
  );
  return next;
}

export function formatEntityId(kind: "activity" | "comms" | "event" | "pnl_period" | "pnl_line" | "site_space" | "data_conflict" | "comment", value: number): string {
  if (kind === "activity") return `A-${String(value).padStart(6, "0")}`;
  if (kind === "comms") return `CM-${String(value).padStart(4, "0")}`;
  if (kind === "pnl_period") return `PP-${String(value).padStart(6, "0")}`;
  if (kind === "pnl_line") return `PL-${String(value).padStart(6, "0")}`;
  if (kind === "site_space") return `SS-${String(value).padStart(6, "0")}`;
  if (kind === "data_conflict") return `CF-${String(value).padStart(6, "0")}`;
  if (kind === "comment") return `NT-${String(value).padStart(6, "0")}`;
  return `EV-${String(value).padStart(8, "0")}`;
}

async function readVersion(sql: Sql, change: ParsedChange): Promise<number> {
  if (change.entity_type === "tag") {
    const family = (change.payload as TagPayload).family;
    const result = await sql.query<{ version: number | string }>(
      `SELECT version FROM site_tags WHERE site_id = $1 AND family = $2`,
      [change.site_id, family],
    );
    return result.rows[0] ? Number(result.rows[0].version) : 0;
  }
  if (change.entity_type === "comment") {
    const result = await sql.query<{ version: number | string | null }>(
      `SELECT version FROM notes WHERE id = $1`,
      [change.entity_id],
    );
    const version = result.rows[0]?.version;
    return version == null ? 0 : Number(version);
  }
  if (change.entity_type === "stage" || change.entity_type === "site") {
    const table = change.entity_type === "stage" ? "site_stages" : "sites";
    const result = await sql.query<{ version: number | string }>(
      `SELECT version FROM ${table} WHERE site_id = $1`,
      [change.site_id],
    );
    return result.rows[0] ? Number(result.rows[0].version) : 0;
  }
  const table = change.entity_type === "activity"
    ? "activities"
    : change.entity_type === "pnl_line"
      ? "pnl_lines"
      : change.entity_type === "site_space"
        ? "site_spaces"
        : change.entity_type === "data_conflict"
          ? "data_conflicts"
          : "comms_entries";
  const column = change.entity_type === "site_space" ? "id" : "entity_id";
  const result = await sql.query<{ version: number | string }>(
    `SELECT version FROM ${table} WHERE ${column} = $1`,
    [change.entity_id],
  );
  return result.rows[0] ? Number(result.rows[0].version) : 0;
}

async function insertEvent(
  sql: Sql,
  input: {
    entityType: EntityType;
    entityId: string;
    siteId: string;
    payload: unknown;
    source: string;
    actor: string;
    idempotencyKey: string;
    runId: string | null;
  },
): Promise<string> {
  const eventId = formatEntityId("event", await mint(sql, "event"));
  await sql.query(
    `INSERT INTO events (id, entity_type, entity_id, site_id, payload, source, actor, idempotency_key, run_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      eventId,
      input.entityType,
      input.entityId,
      input.siteId,
      JSON.stringify(input.payload),
      input.source,
      input.actor,
      input.idempotencyKey,
      input.runId,
    ],
  );
  return eventId;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export type StageWrite = {
  stored: Record<string, string>;
  /** Null when this insert is the site's first stage row. */
  previousStage: string | null;
};

export async function applyStage(
  sql: Sql,
  change: ParsedChange,
  actorId: string,
  version: number,
  mode: "api" | "workbook",
): Promise<StageWrite> {
  const payload = change.payload as StagePayload;
  const previous = await sql.query<{ stage: string; service_area_class: string }>(
    `SELECT stage, service_area_class FROM site_stages WHERE site_id = $1`,
    [change.site_id],
  );
  const previousStage = previous.rows[0] ? previous.rows[0].stage : null;
  const priorStage = previousStage || "";
  const bringingBack = priorStage === "Dropped" && payload.stage !== "Dropped";
  if (mode === "api" && bringingBack && !payload.reason?.trim()) {
    throw new InputError("Bring back needs a reason.");
  }
  const serviceArea =
    payload.service_area_class !== undefined
      ? payload.service_area_class
      : previous.rows[0]?.service_area_class || "";
  const keepReason = payload.stage === "Dropped" || bringingBack;
  const stored: Record<string, string> = {
    stage: payload.stage,
    market: payload.market,
    service_area_class: serviceArea,
    reason: keepReason ? payload.reason?.trim() || "" : "",
  };
  if (payload.stage === "Dropped") stored.dropped_by = actorId;
  if (bringingBack) stored.brought_back_by = actorId;
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, service_area_class, reason, version, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (site_id) DO UPDATE SET
       market = EXCLUDED.market,
       stage = EXCLUDED.stage,
       service_area_class = EXCLUDED.service_area_class,
       reason = EXCLUDED.reason,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by`,
    [change.site_id, stored.market, stored.stage, stored.service_area_class, stored.reason, version, actorId],
  );
  return { stored, previousStage };
}

async function writeActivity(
  sql: Sql,
  change: ParsedChange,
  entityId: string,
  actorId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const payload = change.payload as ActivityPayload;
  const previous = await sql.query<{ payload: unknown; at_approximate?: boolean }>(
    `SELECT payload, at_approximate FROM activities WHERE entity_id = $1`,
    [entityId],
  );
  const prior = asObject(previous.rows[0]?.payload);
  // false clears a stored approximate flag. Omitting the field keeps it.
  const priorFlag = previous.rows[0]?.at_approximate === true || prior.at_approximate === true;
  const approximate = payload.at_approximate === true || (payload.at_approximate == null && priorFlag);
  const dateIso = (payload.date_iso ?? textOf(prior.date_iso)).trim();
  const stored: Record<string, unknown> = {
    date: payload.date,
    type: payload.type,
    summary: payload.summary,
    source_link: payload.source_link ?? textOf(prior.source_link),
  };
  if (dateIso) stored.date_iso = dateIso;
  // An empty provenance does not clear one that is already stored.
  const provenance = textOf(payload.provenance).trim() || textOf(prior.provenance).trim();
  if (provenance) stored.provenance = provenance;
  if (approximate) stored.at_approximate = true;
  await sql.query(
    `INSERT INTO activities (entity_id, site_id, payload, version, updated_by, at_approximate)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (entity_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       payload = EXCLUDED.payload,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by,
       at_approximate = EXCLUDED.at_approximate`,
    [entityId, change.site_id, JSON.stringify(stored), version, actorId, approximate],
  );
  return stored;
}

async function writeComms(
  sql: Sql,
  change: ParsedChange,
  entityId: string,
  actorId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const payload = change.payload as CommsPayload;
  const previous = await sql.query<{
    payload: unknown;
    message_id?: string | null;
    thread_id?: string | null;
    link?: string | null;
    gmail_message_id?: string | null;
    gmail_thread_id?: string | null;
  }>(
    `SELECT payload, message_id, thread_id, link, gmail_message_id, gmail_thread_id
     FROM comms_entries WHERE entity_id = $1`,
    [entityId],
  );
  const priorRow = previous.rows[0];
  const prior = asObject(priorRow?.payload);
  const keep = (next: string | undefined, column: string | null | undefined, payloadKey: string) =>
    next !== undefined ? next : textOf(column) || textOf(prior[payloadKey]);
  const messageId = keep(payload.message_id, priorRow?.message_id, "message_id");
  const threadId = keep(payload.thread_id, priorRow?.thread_id, "thread_id");
  const link = keep(payload.link, priorRow?.link, "link");
  const gmailMessageId = keep(payload.gmail_message_id, priorRow?.gmail_message_id, "gmail_message_id");
  const gmailThreadId = keep(payload.gmail_thread_id, priorRow?.gmail_thread_id, "gmail_thread_id");
  const stored = {
    site_ids: payload.site_ids ?? change.site_id,
    direction: payload.direction,
    at: payload.at ?? textOf(prior.at),
    at_text: payload.at_text ?? textOf(prior.at_text),
    at_approximate: payload.at_approximate ?? prior.at_approximate === true,
    person: payload.person ?? textOf(prior.person),
    firm: payload.firm ?? textOf(prior.firm),
    channel: payload.channel ?? textOf(prior.channel),
    summary: payload.summary ?? textOf(prior.summary),
    subject: payload.subject ?? textOf(prior.subject),
    thread_id: threadId,
    link,
    asks_made: payload.asks_made ?? textOf(prior.asks_made),
    asks_answered: payload.asks_answered ?? textOf(prior.asks_answered),
    attachments: payload.attachments ?? textOf(prior.attachments),
    state_changes: payload.state_changes ?? textOf(prior.state_changes),
    workbook_source: payload.workbook_source ?? textOf(prior.workbook_source),
    message_id: messageId,
  };
  await sql.query(
    `INSERT INTO comms_entries (
       entity_id, site_id, payload, version, updated_by, message_id, thread_id, link, gmail_message_id, gmail_thread_id
     ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, NULLIF($9, ''), NULLIF($10, ''))
     ON CONFLICT (entity_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       payload = EXCLUDED.payload,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by,
       message_id = EXCLUDED.message_id,
       thread_id = EXCLUDED.thread_id,
       link = EXCLUDED.link,
       gmail_message_id = EXCLUDED.gmail_message_id,
       gmail_thread_id = EXCLUDED.gmail_thread_id`,
    [entityId, change.site_id, JSON.stringify(stored), version, actorId, messageId, threadId, link, gmailMessageId, gmailThreadId],
  );
  return stored;
}

type SiteDb = Record<SiteField, string> & {
  photo_refs: unknown;
  fact_sources: unknown;
  sheet: unknown;
  sheet_writes: unknown;
  facts: unknown;
  coord_status: string;
  version: number | string;
};

const SITE_COLUMNS = SITE_FIELDS.filter((field) => field !== "photo_refs").join(", ");

async function readSite(sql: Sql, siteId: string): Promise<SiteDb | null> {
  const result = await sql.query<SiteDb>(
    `SELECT ${SITE_COLUMNS}, photo_refs, fact_sources, sheet, sheet_writes, facts, coord_status, version FROM sites WHERE site_id = $1`,
    [siteId],
  );
  return result.rows[0] || null;
}

function storedPhotos(value: unknown): PhotoRef[] {
  if (typeof value === "string") return photosFromCanonical(value);
  return photosFromCanonical(JSON.stringify(value ?? []));
}

async function writeSite(
  sql: Sql,
  change: ParsedChange,
  actorId: string,
  version: number,
  mode: "api" | "workbook",
): Promise<Record<string, unknown>> {
  const payload = change.payload as SitePayload;
  const previous = await readSite(sql, change.site_id);
  const priorFields = emptySiteFields();
  if (previous) {
    for (const field of SITE_FIELDS) {
      if (field === "photo_refs") priorFields.photo_refs = photoCanonical(storedPhotos(previous.photo_refs));
      else priorFields[field] = textOf(previous[field]);
    }
  }
  const stored = mode === "workbook" ? emptySiteFields() : { ...priorFields };
  const incoming = payload.fields || {};
  for (const field of SITE_FIELDS) {
    if (field === "photo_refs") {
      if (incoming.photo_refs !== undefined) stored.photo_refs = incoming.photo_refs || "[]";
      else if (mode === "workbook") stored.photo_refs = "[]";
      continue;
    }
    if (incoming[field] !== undefined) stored[field] = incoming[field] || "";
    else if (mode === "workbook") stored[field] = "";
  }
  const priorSources = asObject(previous?.fact_sources);
  const sources: Record<string, string> = {};
  for (const [key, value] of Object.entries(priorSources)) sources[key] = textOf(value);
  const priorSheet =
    mode === "workbook" ? {} : typeof previous?.sheet === "string" ? parseSheet(previous.sheet) : parseSheet(JSON.stringify(previous?.sheet ?? {}));
  const sheet = { ...priorSheet, ...(payload.sheet || {}) };
  const priorFacts = mode === "workbook" ? {} : asObject(previous?.facts);
  const facts: Record<string, string> = {};
  for (const [key, value] of Object.entries(priorFacts)) facts[key] = textOf(value);
  for (const [key, value] of Object.entries(payload.facts || {})) facts[key] = value || "";
  const coord = payload.coord_status ?? textOf(previous?.coord_status);
  const priorWrites =
    mode === "workbook"
      ? {}
      : typeof previous?.sheet_writes === "string"
        ? parseSheet(previous.sheet_writes)
        : parseSheet(JSON.stringify(previous?.sheet_writes ?? {}));
  const writes = { ...priorWrites };
  if (mode === "workbook") {
    for (const field of [...SITE_NUMERIC_FIELDS, "score", "location_points"] as const) {
      if (field === "lat" || field === "lng") continue;
      if (stored[field]) sources[field] = change.source;
      else delete sources[field];
    }
    const kind = coord.trim().toLowerCase();
    const coordSource =
      kind === "geocoded" || kind === "linked site" || kind === "failed"
        ? coord.trim()
        : kind === "listing" || kind === "from listing"
          ? "listing"
          : sheet.Lat || sheet.Lng || sheet.Lon
            ? change.source
            : "";
    if (coordSource && stored.lat) sources.lat = coordSource;
    else delete sources.lat;
    if (coordSource && stored.lng) sources.lng = coordSource;
    else delete sources.lng;
  } else {
    for (const [field, source] of Object.entries(payload.sources || {})) {
      const cleared = incoming[field as SiteField] === "" || facts[field] === "";
      if (cleared) delete sources[field];
      else if (source) sources[field] = source;
    }
    for (const field of SITE_NUMERIC_FIELDS) {
      if (incoming[field] === "") delete sources[field];
    }
    if (incoming.asking_price === "") delete facts.asking_price_source;
    if (incoming.acreage === "") delete facts.land_acres_basis;
    const brokerCell = priorSheet.Broker || priorSheet.broker || "";
    const edited = mirrorWrites(incoming, payload.facts || {}, { cell: brokerCell });
    if (incoming.broker !== undefined || incoming.firm !== undefined) {
      const decision = brokerMirrorCell(brokerCell, { broker: incoming.broker, firm: incoming.firm });
      if (decision.action === "skip") {
        if (incoming.broker !== undefined) console.log(JSON.stringify({ event: "broker_mirror_skipped", site_id: change.site_id, field: "broker" }));
        if (incoming.firm !== undefined) console.log(JSON.stringify({ event: "broker_mirror_skipped", site_id: change.site_id, field: "firm" }));
      }
    }
    for (const [header, value] of Object.entries(edited)) {
      if (!value) delete sheet[header];
      else sheet[header] = value;
    }
    for (const [header, value] of Object.entries(edited)) writes[header] = value;
  }
  const perAcre = pricePerAcre(stored.asking_price, stored.acreage);
  if (perAcre) facts.price_per_acre = perAcre;
  else delete facts.price_per_acre;
  const photos = storedPhotos(stored.photo_refs);
  await sql.query(
    `INSERT INTO sites (
       site_id, name, address, market, lat, lng, category, broker, firm, listing_url,
       asking_price, acreage, apn, land_value, improvement_value, county_value, county_value_basis,
       service_area_class, service_area_distance_mi, service_area_polygon, miles_to_depot,
       notes, photo_refs, photo_status, photo_diligence_count, photo_listing_count, photos_checked, photo_notes,
       universe_id, listing_status, score, location_points, coord_status, sheet, sheet_writes, facts, fact_sources, version, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20, $21,
       $22, $23::jsonb, $24, $25, $26, $27, $28,
       $29, $30, $31, $32, $33, $34::jsonb, $35::jsonb, $36::jsonb, $37::jsonb, $38, $39
     )
     ON CONFLICT (site_id) DO UPDATE SET
       name = EXCLUDED.name,
       address = EXCLUDED.address,
       market = EXCLUDED.market,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       category = EXCLUDED.category,
       broker = EXCLUDED.broker,
       firm = EXCLUDED.firm,
       listing_url = EXCLUDED.listing_url,
       asking_price = EXCLUDED.asking_price,
       acreage = EXCLUDED.acreage,
       apn = EXCLUDED.apn,
       land_value = EXCLUDED.land_value,
       improvement_value = EXCLUDED.improvement_value,
       county_value = EXCLUDED.county_value,
       county_value_basis = EXCLUDED.county_value_basis,
       service_area_class = EXCLUDED.service_area_class,
       service_area_distance_mi = EXCLUDED.service_area_distance_mi,
       service_area_polygon = EXCLUDED.service_area_polygon,
       miles_to_depot = EXCLUDED.miles_to_depot,
       notes = EXCLUDED.notes,
       photo_refs = EXCLUDED.photo_refs,
       photo_status = EXCLUDED.photo_status,
       photo_diligence_count = EXCLUDED.photo_diligence_count,
       photo_listing_count = EXCLUDED.photo_listing_count,
       photos_checked = EXCLUDED.photos_checked,
       photo_notes = EXCLUDED.photo_notes,
       universe_id = EXCLUDED.universe_id,
       listing_status = EXCLUDED.listing_status,
       score = EXCLUDED.score,
       location_points = EXCLUDED.location_points,
       coord_status = EXCLUDED.coord_status,
       sheet = EXCLUDED.sheet,
       sheet_writes = EXCLUDED.sheet_writes,
       facts = EXCLUDED.facts,
       fact_sources = EXCLUDED.fact_sources,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by`,
    [
      change.site_id,
      stored.name,
      stored.address,
      stored.market,
      stored.lat,
      stored.lng,
      stored.category,
      stored.broker,
      stored.firm,
      stored.listing_url,
      stored.asking_price,
      stored.acreage,
      stored.apn,
      stored.land_value,
      stored.improvement_value,
      stored.county_value,
      stored.county_value_basis,
      stored.service_area_class,
      stored.service_area_distance_mi,
      stored.service_area_polygon,
      stored.miles_to_depot,
      stored.notes,
      JSON.stringify(photos),
      stored.photo_status,
      stored.photo_diligence_count,
      stored.photo_listing_count,
      stored.photos_checked,
      stored.photo_notes,
      stored.universe_id,
      stored.listing_status,
      stored.score,
      stored.location_points,
      coord,
      sheetCanonical(sheet),
      writesCanonical(writes),
      JSON.stringify(facts),
      JSON.stringify(sources),
      version,
      actorId,
    ],
  );
  return { ...stored, photo_refs: photoCanonical(photos), sources };
}

function conflict(change: ParsedChange, entityId: string, actual: number): VersionConflictError {
  return new VersionConflictError([
    {
      entity_type: change.entity_type,
      site_id: change.site_id,
      entity_id: entityId,
      expected_version: change.expected_version,
      actual_version: actual,
    },
  ]);
}

async function writeTag(sql: Sql, change: ParsedChange, actorId: string, version: number): Promise<Record<string, unknown>> {
  const payload = change.payload as TagPayload;
  const stored = {
    family: payload.family,
    code: payload.code,
    since_iso: payload.since || "",
    source_ref: payload.source_ref || "",
    note: payload.note || "",
    owner: payload.owner || "",
    due_on: payload.due_on || "",
    actor: actorId,
  };
  await sql.query(
    `INSERT INTO site_tags (site_id, family, code, since, since_iso, source_ref, note, owner, due_on, actor, version)
     VALUES ($1, $2, $3, CASE WHEN $4 = '' THEN NULL ELSE $4::timestamptz END, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (site_id, family) DO UPDATE SET
       code = EXCLUDED.code,
       since = EXCLUDED.since,
       since_iso = EXCLUDED.since_iso,
       source_ref = EXCLUDED.source_ref,
       note = EXCLUDED.note,
       owner = EXCLUDED.owner,
       due_on = EXCLUDED.due_on,
       actor = EXCLUDED.actor,
       version = EXCLUDED.version,
       updated_at = clock_timestamp()`,
    [change.site_id, stored.family, stored.code, stored.since_iso, stored.source_ref, stored.note, stored.owner, stored.due_on, stored.actor, version],
  );
  return stored;
}

async function applyOne(
  sql: Sql,
  actor: Actor,
  change: ParsedChange,
  idempotencyKey: string,
  runId: string,
  mode: "api" | "workbook",
): Promise<ChangeResult> {
  const tag = change.entity_type === "tag";
  const family = tag ? (change.payload as TagPayload).family : "";
  const siteKeyed = change.entity_type === "stage" || change.entity_type === "site";
  const lock = tag ? `tag:${change.site_id}:${family}` : siteKeyed ? `${change.entity_type}:${change.site_id}` : `${change.entity_type}:${change.entity_id || "new"}`;
  await lockKey(sql, lock);
  const mintedKind = change.entity_type === "comms"
    ? "comms"
    : change.entity_type === "pnl_line"
      ? "pnl_line"
      : change.entity_type === "site_space"
        ? "site_space"
        : change.entity_type === "data_conflict"
          ? "data_conflict"
          : change.entity_type === "comment"
            ? "comment"
            : "activity";
  const entityId = tag
    ? `${change.site_id}:${family}`
    : siteKeyed
    ? change.site_id
    : change.preserve_id && change.entity_id
      ? change.entity_id
      : change.expected_version === 0
        ? formatEntityId(mintedKind, await mint(sql, mintedKind))
        : change.entity_id || "";
  const actual = await readVersion(sql, { ...change, entity_id: entityId });
  if (actual !== change.expected_version) throw conflict(change, entityId, actual);
  const version = change.expected_version + 1;
  let payload: Record<string, unknown>;
  if (change.entity_type === "stage") {
    const written = await applyStage(sql, change, actor.id, version, mode);
    const at = (change.payload as StagePayload).at;
    payload = { ...written.stored, previous_stage: written.previousStage, ...(at ? { at } : {}) };
  } else if (change.entity_type === "site") {
    payload = await writeSite(sql, change, actor.id, version, mode);
  } else if (change.entity_type === "activity") {
    payload = await writeActivity(sql, change, entityId, actor.id, version);
  } else if (change.entity_type === "pnl_line" && isPnlRetract(change.payload)) {
    const written = await retractPnlLine(sql, {
      siteId: change.site_id,
      entityId,
      actorId: actor.id,
      version,
      payload: change.payload,
    });
    if (!written.ok) throw conflict(change, written.entityId, written.actual);
    payload = written.payload;
  } else if (change.entity_type === "tag") {
    payload = await writeTag(sql, change, actor.id, version);
  } else if (change.entity_type === "pnl_line") {
    const written = await storePnlLine(sql, {
      siteId: change.site_id,
      entityId,
      expectedVersion: change.expected_version,
      actorId: actor.id,
      version,
      payload: change.payload as PnlLinePayload,
      mintPeriod: async () => formatEntityId("pnl_period", await mint(sql, "pnl_period")),
    });
    if (!written.ok) throw conflict(change, written.entityId, written.actual);
    payload = written.payload;
  } else if (change.entity_type === "data_conflict") {
    const body = change.payload as ConflictPayload;
    const written = await storeConflict(sql, entityId, {
      siteId: change.site_id,
      subject: body.subject,
      field: body.field,
      period: body.period,
      sources: body.sources,
      valueInUse: body.value_in_use,
      status: body.status,
      resolutionNote: body.resolution_note,
      actor: actor.id,
      at: body.at,
    }, change.expected_version);
    if ("conflict" in written) throw conflict(change, written.conflict.id, written.conflict.version);
    const stored = written.record;
    payload = {
      subject: stored.subject,
      field: stored.field,
      period: stored.period,
      sources: stored.sources,
      value_in_use: stored.valueInUse,
      status: stored.status,
      resolution_note: stored.resolutionNote,
      created_by: stored.createdBy,
      updated_by: stored.updatedBy,
      created_at: stored.createdAt,
      updated_at: stored.updatedAt,
      actor: actor.id,
      at: body.at,
    };
  } else if (change.entity_type === "comment") {
    const body = change.payload as CommentPayload;
    const written = await storeComment(sql, entityId, {
      siteId: change.site_id,
      parentId: body.parent_id || null,
      anchor: body.anchor
        ? {
            type: body.anchor.type,
            siteId: change.site_id,
            line: body.anchor.line,
            period: body.anchor.period,
            spaceId: body.anchor.space_id,
            label: "",
          }
        : null,
      body: body.body ?? null,
      tag: body.tag ?? null,
      mentions: body.mentions ?? null,
      resolved: body.resolved ?? null,
      actor: actor.id,
      at: body.at,
    }, change.expected_version);
    if (!written.ok) throw conflict(change, written.id, written.version);
    payload = {
      anchor: {
        type: written.anchor.type,
        line: written.anchor.line,
        period: written.anchor.period,
        space_id: written.anchor.spaceId,
        label: written.anchor.label,
      },
      tag: written.tag,
      resolved: written.resolved,
      parent_id: body.parent_id || "",
      actor: actor.id,
      at: body.at,
    };
  } else if (change.entity_type === "site_space") {
    const space = change.payload as SiteSpacePayload;
    payload = await storeSiteSpace(sql, {
      siteId: change.site_id,
      entityId,
      actorId: actor.id,
      version,
      deleted: space.deleted === true,
      box: space.deleted
        ? undefined
        : {
            center: { lng: space.center_lng, lat: space.center_lat },
            lengthFt: space.length_ft,
            widthFt: space.width_ft,
            rotationDeg: space.rotation_deg,
          },
      type: space.deleted ? undefined : space.type,
      layout: space.deleted ? undefined : space.layout,
    });
  } else {
    payload = await writeComms(sql, change, entityId, actor.id, version);
  }
  const eventId = await insertEvent(sql, {
    entityType: change.entity_type,
    entityId,
    siteId: change.site_id,
    payload,
    source: change.source,
    actor: actor.id,
    idempotencyKey,
    runId,
  });
  try {
    const { indexRecord } = await import("@/lib/search/docs");
    const indexPayload = change.entity_type === "comment"
      ? { ...payload, body: (change.payload as CommentPayload).body || "" }
      : payload;
    await indexRecord(sql, {
      entityType: change.entity_type,
      entityId,
      siteId: change.site_id,
      payload: indexPayload,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "search_index_error", name: error instanceof Error ? error.name : "error" }));
  }
  return { entity_type: change.entity_type, entity_id: entityId, site_id: change.site_id, event_id: eventId, version };
}

const SYSTEM_ACTOR: Actor = { id: "system", kind: "agent" };
const INITIAL_STAGE = "1 Desk screen";
const INITIAL_STAGE_SOURCE = "Initial stage for new capture";

async function ensureCapture(
  sql: Sql,
  actor: Actor,
  changes: ParsedChange[],
  idempotencyKey: string,
  runId: string,
  mode: "api" | "workbook",
): Promise<ChangeResult[]> {
  if (mode !== "api") return [];
  const extra: ChangeResult[] = [];
  for (const change of changes) {
    if (change.entity_type !== "site" || change.expected_version !== 0) continue;
    if (isExcludedSite(change.site_id)) continue;
    const staged = await sql.query<{ version: number | string }>(`SELECT version FROM site_stages WHERE site_id = $1`, [change.site_id]);
    if (!staged.rows.length) {
      const site = await sql.query<{ market: string; service_area_class: string }>(
        `SELECT market, service_area_class FROM sites WHERE site_id = $1`,
        [change.site_id],
      );
      const market = marketCode(site.rows[0]?.market || "", change.site_id);
      if (!market) throw new InputError("That site has no market.");
      const area = serviceAreaCode(site.rows[0]?.service_area_class || "");
      const at = formatZonedTimestamp();
      const payload: StagePayload = { stage: INITIAL_STAGE, market: market as Market, at };
      if (area) payload.service_area_class = area as ServiceAreaClass;
      extra.push(
        await applyOne(
          sql,
          SYSTEM_ACTOR,
          {
            entity_type: "stage",
            site_id: change.site_id,
            expected_version: 0,
            source: INITIAL_STAGE_SOURCE,
            payload,
          },
          `${idempotencyKey}#initial-stage:${change.site_id}`,
          runId,
          "api",
        ),
      );
    }
    const hasActivity = changes.some((row) => row.entity_type === "activity" && row.site_id === change.site_id);
    if (!hasActivity) {
      const zoned = parseZonedTimestamp(formatZonedTimestamp());
      if (!zoned) throw new InputError("Use an ISO-8601 time with a zone offset.");
      const payload: ActivityPayload = { date: zoned.date, date_iso: zoned.iso, type: "capture", summary: "Site added" };
      extra.push(
        await applyOne(
          sql,
          actor,
          {
            entity_type: "activity",
            site_id: change.site_id,
            expected_version: 0,
            source: change.source,
            payload,
          },
          `${idempotencyKey}#initial-activity:${change.site_id}`,
          runId,
          "api",
        ),
      );
    }
  }
  return extra;
}

export async function applyParsedChanges(
  sql: Sql,
  actor: Actor,
  idempotencyKey: string,
  changes: ParsedChange[],
  notes: string,
  mode: "api" | "workbook" = "api",
  options?: ApplyOptions,
): Promise<ApplyResult> {
  const join = options?.joinTransaction === true;
  const hash = requestHash(actor, changes);
  await sql.exec(join ? "SAVEPOINT apply_batch" : "BEGIN");
  try {
    await lockKey(sql, `idem:${idempotencyKey}`);
    const existing = await sql.query<{ request_hash: string; response: unknown }>(
      `SELECT request_hash, response FROM change_receipts WHERE idempotency_key = $1 FOR UPDATE`,
      [idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new IdempotencyConflictError();
      const stored = asObject(prior.response) as unknown as ApplyResult;
      await sql.exec(join ? "RELEASE SAVEPOINT apply_batch" : "ROLLBACK");
      return { ...stored, replayed: true };
    }
    const runId = `run_${randomUUID().replaceAll("-", "")}`;
    await sql.query(
      `INSERT INTO runs (id, actor, status, counts, notes) VALUES ($1, $2, 'running', '{}'::jsonb, $3)`,
      [runId, actor.id, notes.slice(0, 500)],
    );
    const results: ChangeResult[] = [];
    for (let index = 0; index < changes.length; index += 1) {
      results.push(await applyOne(sql, actor, changes[index], `${idempotencyKey}#${index}`, runId, mode));
    }
    results.push(...(await ensureCapture(sql, actor, changes, idempotencyKey, runId, mode)));
    if (results.some((row) => row.entity_type === "stage")) {
      await sql.exec("SAVEPOINT proposal_close");
      try {
        const { closeProposalsForStageDrops } = await import("@/lib/actions/proposalClose");
        await closeProposalsForStageDrops(sql, actor.id, results);
        await sql.exec("RELEASE SAVEPOINT proposal_close");
      } catch (error) {
        await sql.exec("ROLLBACK TO SAVEPOINT proposal_close");
        const { missingCloseSchema } = await import("@/lib/actions/proposalClose");
        if (!missingCloseSchema(error)) throw error;
        console.error(JSON.stringify({ event: "proposal_close_skipped" }));
      }
    }
    const counts: Record<string, number> = { changes: results.length };
    for (const result of results) counts[result.entity_type] = (counts[result.entity_type] || 0) + 1;
    await sql.query(
      `UPDATE runs SET status = 'succeeded', finished_at = clock_timestamp(), counts = $2::jsonb WHERE id = $1`,
      [runId, JSON.stringify(counts)],
    );
    const response: ApplyResult = { ok: true, replayed: false, run_id: runId, idempotency_key: idempotencyKey, results };
    await sql.query(
      `INSERT INTO change_receipts (idempotency_key, request_hash, response, actor) VALUES ($1, $2, $3::jsonb, $4)`,
      [idempotencyKey, hash, JSON.stringify(response), actor.id],
    );
    await sql.exec(join ? "RELEASE SAVEPOINT apply_batch" : "COMMIT");
    try {
      const { scheduleEmbed } = await import("@/lib/search/embed");
      scheduleEmbed();
    } catch (error) {
      console.error(JSON.stringify({ event: "embedding_error", name: error instanceof Error ? error.name : "error" }));
    }
    return response;
  } catch (error) {
    try {
      await sql.exec(join ? "ROLLBACK TO SAVEPOINT apply_batch" : "ROLLBACK");
    } catch {
      // The connection already closed the transaction.
    }
    throw error;
  }
}

export async function applyBatch(sql: Sql, actor: Actor, idempotencyKey: string, body: unknown, options?: ApplyOptions): Promise<ApplyResult> {
  const { key, changes } = validateBatch(actor, idempotencyKey, body);
  return applyParsedChanges(sql, actor, key, changes, "api", "api", options);
}

/** Highest numeric suffix already stored, so a later mint does not reuse a workbook id. */
export async function raiseIdFloor(sql: Sql, name: "activity" | "comms" | "event", value: number): Promise<void> {
  if (value < 1) return;
  await sql.query(
    `INSERT INTO id_counters (name, value) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value = GREATEST(id_counters.value, EXCLUDED.value)`,
    [name, value],
  );
}

export function numericSuffix(prefix: string, value: string): number {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(value);
  return match ? Number(match[1]) : 0;
}

export { insertEvent };
