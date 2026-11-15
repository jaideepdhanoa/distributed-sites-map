import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { InputError } from "@/lib/actions/text";
import {
  SITE_FIELDS,
  SITE_NUMERIC_FIELDS,
  emptySiteFields,
  parseSheet,
  photoCanonical,
  photosFromCanonical,
  pricePerAcre,
  sheetCanonical,
  type PhotoRef,
  type SiteField,
} from "./site";
import type { ActivityPayload, Actor, CommsPayload, ParsedChange, SitePayload, StagePayload } from "./schema";
import { validateBatch } from "./schema";
import type { EntityType } from "./vocab";

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

async function mint(sql: Sql, name: "activity" | "comms" | "event"): Promise<number> {
  const result = await sql.query<{ value: number | string }>(
    `INSERT INTO id_counters (name, value)
     VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = id_counters.value + 1
     RETURNING value`,
    [name],
  );
  return Number(result.rows[0]?.value || 0);
}

function formatId(kind: "activity" | "comms" | "event", value: number): string {
  if (kind === "activity") return `A-${String(value).padStart(6, "0")}`;
  if (kind === "comms") return `CM-${String(value).padStart(4, "0")}`;
  return `EV-${String(value).padStart(8, "0")}`;
}

async function readVersion(sql: Sql, change: ParsedChange): Promise<number> {
  if (change.entity_type === "stage" || change.entity_type === "site") {
    const table = change.entity_type === "stage" ? "site_stages" : "sites";
    const result = await sql.query<{ version: number | string }>(
      `SELECT version FROM ${table} WHERE site_id = $1`,
      [change.site_id],
    );
    return result.rows[0] ? Number(result.rows[0].version) : 0;
  }
  const table = change.entity_type === "activity" ? "activities" : "comms_entries";
  const result = await sql.query<{ version: number | string }>(
    `SELECT version FROM ${table} WHERE entity_id = $1`,
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
  const eventId = formatId("event", await mint(sql, "event"));
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

async function writeStage(
  sql: Sql,
  change: ParsedChange,
  actorId: string,
  version: number,
  mode: "api" | "workbook",
): Promise<Record<string, unknown>> {
  const payload = change.payload as StagePayload;
  const previous = await sql.query<{ stage: string; service_area_class: string }>(
    `SELECT stage, service_area_class FROM site_stages WHERE site_id = $1`,
    [change.site_id],
  );
  const priorStage = previous.rows[0]?.stage || "";
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
  return stored;
}

async function writeActivity(
  sql: Sql,
  change: ParsedChange,
  entityId: string,
  actorId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const payload = change.payload as ActivityPayload;
  const previous = await sql.query<{ payload: unknown }>(`SELECT payload FROM activities WHERE entity_id = $1`, [entityId]);
  const prior = asObject(previous.rows[0]?.payload);
  const stored = {
    date: payload.date,
    type: payload.type,
    summary: payload.summary,
    source_link: payload.source_link ?? textOf(prior.source_link),
  };
  await sql.query(
    `INSERT INTO activities (entity_id, site_id, payload, version, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (entity_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       payload = EXCLUDED.payload,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by`,
    [entityId, change.site_id, JSON.stringify(stored), version, actorId],
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
  const previous = await sql.query<{ payload: unknown }>(`SELECT payload FROM comms_entries WHERE entity_id = $1`, [entityId]);
  const prior = asObject(previous.rows[0]?.payload);
  const stored = {
    site_ids: payload.site_ids ?? change.site_id,
    direction: payload.direction,
    at: payload.at ?? textOf(prior.at),
    person: payload.person ?? textOf(prior.person),
    firm: payload.firm ?? textOf(prior.firm),
    channel: payload.channel ?? textOf(prior.channel),
    summary: payload.summary ?? textOf(prior.summary),
    subject: payload.subject ?? textOf(prior.subject),
    thread_id: payload.thread_id ?? textOf(prior.thread_id),
    link: payload.link ?? textOf(prior.link),
    asks_made: payload.asks_made ?? textOf(prior.asks_made),
    asks_answered: payload.asks_answered ?? textOf(prior.asks_answered),
    attachments: payload.attachments ?? textOf(prior.attachments),
    state_changes: payload.state_changes ?? textOf(prior.state_changes),
    workbook_source: payload.workbook_source ?? textOf(prior.workbook_source),
    message_id: payload.message_id ?? textOf(prior.message_id),
  };
  await sql.query(
    `INSERT INTO comms_entries (entity_id, site_id, payload, version, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (entity_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       payload = EXCLUDED.payload,
       version = EXCLUDED.version,
       updated_at = clock_timestamp(),
       updated_by = EXCLUDED.updated_by`,
    [entityId, change.site_id, JSON.stringify(stored), version, actorId],
  );
  return stored;
}

type SiteDb = Record<SiteField, string> & {
  photo_refs: unknown;
  fact_sources: unknown;
  sheet: unknown;
  facts: unknown;
  coord_status: string;
  version: number | string;
};

const SITE_COLUMNS = SITE_FIELDS.filter((field) => field !== "photo_refs").join(", ");

async function readSite(sql: Sql, siteId: string): Promise<SiteDb | null> {
  const result = await sql.query<SiteDb>(
    `SELECT ${SITE_COLUMNS}, photo_refs, fact_sources, sheet, facts, coord_status, version FROM sites WHERE site_id = $1`,
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
    const headers: Partial<Record<SiteField, string>> = {
      name: "Name",
      notes: "Next step",
      asking_price: "Asking price ($)",
      acreage: "Land (acres)",
      listing_status: "Listing status",
      listing_url: "Listing link",
      apn: "APN or folio",
      market: "Market",
      photo_status: "Photo status",
      photo_notes: "Photo notes",
      photos_checked: "Photos checked",
      photo_diligence_count: "Diligence photo count",
      photo_listing_count: "Listing photo count",
    };
    for (const [field, header] of Object.entries(headers) as [SiteField, string][]) {
      if (incoming[field] === undefined) continue;
      if (!incoming[field]) delete sheet[header];
      else sheet[header] = incoming[field];
    }
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
       universe_id, listing_status, score, location_points, coord_status, sheet, facts, fact_sources, version, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20, $21,
       $22, $23::jsonb, $24, $25, $26, $27, $28,
       $29, $30, $31, $32, $33, $34::jsonb, $35::jsonb, $36::jsonb, $37, $38
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

async function applyOne(
  sql: Sql,
  actor: Actor,
  change: ParsedChange,
  idempotencyKey: string,
  runId: string,
  mode: "api" | "workbook",
): Promise<ChangeResult> {
  const siteKeyed = change.entity_type === "stage" || change.entity_type === "site";
  const lock = siteKeyed ? `${change.entity_type}:${change.site_id}` : `${change.entity_type}:${change.entity_id || "new"}`;
  await lockKey(sql, lock);
  const mintedKind = change.entity_type === "comms" ? "comms" : "activity";
  const entityId = siteKeyed
    ? change.site_id
    : change.preserve_id && change.entity_id
      ? change.entity_id
      : change.expected_version === 0
        ? formatId(mintedKind, await mint(sql, mintedKind))
        : change.entity_id || "";
  const actual = await readVersion(sql, { ...change, entity_id: entityId });
  if (actual !== change.expected_version) throw conflict(change, entityId, actual);
  const version = change.expected_version + 1;
  const payload =
    change.entity_type === "stage"
      ? await writeStage(sql, change, actor.id, version, mode)
      : change.entity_type === "site"
        ? await writeSite(sql, change, actor.id, version, mode)
        : change.entity_type === "activity"
          ? await writeActivity(sql, change, entityId, actor.id, version)
          : await writeComms(sql, change, entityId, actor.id, version);
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
  return { entity_type: change.entity_type, entity_id: entityId, site_id: change.site_id, event_id: eventId, version };
}

export async function applyParsedChanges(
  sql: Sql,
  actor: Actor,
  idempotencyKey: string,
  changes: ParsedChange[],
  notes: string,
  mode: "api" | "workbook" = "api",
): Promise<ApplyResult> {
  const hash = requestHash(actor, changes);
  await sql.exec("BEGIN");
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
      await sql.exec("ROLLBACK");
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
    await sql.exec("COMMIT");
    return response;
  } catch (error) {
    try {
      await sql.exec("ROLLBACK");
    } catch {
      // The connection already closed the transaction.
    }
    throw error;
  }
}

export async function applyBatch(sql: Sql, actor: Actor, idempotencyKey: string, body: unknown): Promise<ApplyResult> {
  const { key, changes } = validateBatch(actor, idempotencyKey, body);
  return applyParsedChanges(sql, actor, key, changes, "api", "api");
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
