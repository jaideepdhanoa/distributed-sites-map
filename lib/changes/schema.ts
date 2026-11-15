import { z } from "zod";
import type { ActionRole } from "@/lib/actions/roles";
import { canDecide, canWriteContent } from "@/lib/actions/roles";
import { InputError } from "@/lib/actions/text";
import { assertClean } from "@/lib/policy/banned";
import {
  CHECK_FIELDS,
  CREATE_MARKETS,
  FACT_FIELDS,
  LISTING_STATUSES,
  MUSE_FIELDS,
  NUMERIC_FACT_FIELDS,
  PHOTO_FIELDS,
  PHOTO_ROLES,
  PHOTO_SOURCES,
  SCHEMA_FIELDS,
  SITE_NUMERIC_FIELDS,
  canonicalFact,
  photoCanonical,
  type PhotoRef,
  type SiteField,
} from "./site";
import {
  ACTIVITY_TYPES,
  BUSINESS_TYPES,
  CANONICAL_STAGES,
  COMMS_DIRECTIONS,
  MARKETS,
  SERVICE_AREA_CLASSES,
  SITE_ID,
  commsSiteAllowed,
  type ActivityType,
  type CommsDirection,
  type EntityType,
  type Market,
  type ServiceAreaClass,
  type StageName,
} from "./vocab";

export type Actor = { id: string; kind: "human" | "agent"; role?: ActionRole };

export type StagePayload = {
  stage: StageName;
  market: Market;
  service_area_class?: ServiceAreaClass | "";
  reason?: string;
};

export type ActivityPayload = {
  date: string;
  type: ActivityType;
  summary: string;
  source_link?: string;
};

export type CommsPayload = {
  direction: CommsDirection | "internal";
  at?: string;
  person?: string;
  firm?: string;
  channel?: string;
  summary?: string;
  subject?: string;
  site_ids?: string;
  thread_id?: string;
  link?: string;
  asks_made?: string;
  asks_answered?: string;
  attachments?: string;
  state_changes?: string;
  workbook_source?: string;
  message_id?: string;
};

export type SitePayload = {
  fields: Partial<Record<SiteField, string>>;
  sources?: Partial<Record<string, string>>;
  sheet?: Record<string, string>;
  facts?: Record<string, string>;
  coord_status?: string;
  photos?: import("./site").PhotoRef[];
};

export type ParsedChange = {
  entity_type: EntityType;
  site_id: string;
  entity_id?: string;
  expected_version: number;
  source: string;
  /** Workbook import keeps the sheet's id. The HTTP API never sets this. */
  preserve_id?: boolean;
  payload: StagePayload | ActivityPayload | CommsPayload | SitePayload;
};

const stagePayload = z
  .object({
    stage: z.enum(CANONICAL_STAGES),
    market: z.enum(MARKETS),
    service_area_class: z.enum(SERVICE_AREA_CLASSES).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const activityPayload = z
  .object({
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(ACTIVITY_TYPES),
    summary: z.string().trim().min(1).max(300),
    source_link: z.string().trim().max(500).optional(),
  })
  .strict();

const commsPayload = z
  .object({
    direction: z.enum(COMMS_DIRECTIONS),
    at: z.string().trim().max(40).optional(),
    person: z.string().trim().max(200).optional(),
    firm: z.string().trim().max(200).optional(),
    channel: z.string().trim().max(80).optional(),
    summary: z.string().trim().max(300).optional(),
    subject: z.string().trim().max(300).optional(),
  })
  .strict();

const sitePayload = z
  .object({
    name: z.string().trim().max(160).optional(),
    address: z.string().trim().max(180).optional(),
    market: z.enum(MARKETS).optional(),
    lat: z.number().finite().nullable().optional(),
    lng: z.number().finite().nullable().optional(),
    category: z.enum(BUSINESS_TYPES).optional(),
    broker: z.string().trim().max(120).optional(),
    firm: z.string().trim().max(160).optional(),
    listing_url: z.string().trim().max(400).optional(),
    asking_price: z.number().finite().nullable().optional(),
    acreage: z.number().finite().nullable().optional(),
    apn: z.string().trim().max(80).optional(),
    land_value: z.number().finite().nullable().optional(),
    improvement_value: z.number().finite().nullable().optional(),
    county_value: z.number().finite().nullable().optional(),
    county_value_basis: z.string().trim().max(300).optional(),
    service_area_class: z.enum(SERVICE_AREA_CLASSES).optional(),
    service_area_distance_mi: z.number().finite().nullable().optional(),
    service_area_polygon: z.string().trim().max(80).optional(),
    miles_to_depot: z.number().finite().nullable().optional(),
    notes: z.string().trim().max(400).optional(),
    universe_id: z.string().trim().max(40).optional(),
    listing_status: z.union([z.enum(LISTING_STATUSES), z.literal("")]).optional(),
    folder_url: z.string().trim().max(500).optional(),
    photo_status: z.string().trim().max(40).optional(),
    photo_diligence_count: z.number().finite().nullable().optional(),
    photo_listing_count: z.number().finite().nullable().optional(),
    photos_checked: z.string().trim().max(40).optional(),
    photo_notes: z.string().trim().max(400).optional(),
    photo_refs: z.array(z.object({
      role: z.enum(PHOTO_ROLES),
      source: z.enum(PHOTO_SOURCES).optional(),
      file_id: z.string().trim().max(200).optional(),
      view_url: z.string().trim().max(500).optional(),
      as_of: z.string().trim().max(40).optional(),
      caption: z.string().trim().max(240).optional(),
      attribution: z.string().trim().max(240).optional(),
      visibility: z.literal("map").optional(),
    }).strict()).max(40).optional(),
    facts: z.record(z.string(), z.union([z.string().trim().max(500), z.number().finite(), z.null()])).optional(),
    sources: z.record(z.string(), z.string().trim().min(1).max(200)).optional(),
  })
  .strict();

const GUARD_KEYS = new Set([
  "folder",
  "folder_url",
  "photos",
  "photo_refs",
  "photo_notes",
  "photo_status",
  "photos_checked",
  "photo_diligence_count",
  "photo_listing_count",
  "street_view_url",
  "land_evidence",
  "land_notes",
  "evidence",
  "site_capacity",
  "checked_live",
  "verification",
  "stated_revenue",
  "stated_cash_flow",
  "cash_multiple",
  "revenue_multiple",
  "earnings_multiple",
  "business_multiple",
  "business_value",
  "package_status",
  "package_line",
  "package_href",
  "claim_word",
  "figures_source",
  "figures_basis",
  "figures_status",
  "financials_status",
]);

function guardKey(key: string): boolean {
  const norm = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (norm.startsWith("cap_") || norm.startsWith("nda_") || norm.startsWith("stated_") || norm.startsWith("pwr_")) return true;
  return GUARD_KEYS.has(norm);
}

const changeSchema = z
  .object({
    entity_type: z.enum(["stage", "activity", "comms", "site"]),
    site_id: z.string().trim().max(40),
    entity_id: z.string().trim().min(1).max(40).optional(),
    expected_version: z.number().int().nonnegative(),
    source: z.string().trim().min(1).max(200),
    payload: z.unknown(),
  })
  .strict();

const batchSchema = z
  .object({
    changes: z.array(changeSchema).min(1).max(100),
  })
  .strict();

function issueMessage(path: string, code: string): string {
  if (code === "unrecognized_keys") return "That field is not accepted.";
  if (path.endsWith("market")) return "Market must be one of PHX, LAS, MIA, SNA.";
  if (path.endsWith("service_area_class")) {
    return `Service area class must be one of ${SERVICE_AREA_CLASSES.join(", ")}.`;
  }
  if (path.includes("sources")) return "Every numeric fact needs a source.";
  if (path.endsWith("source")) return "Every change needs a source.";
  if (path.endsWith("category")) return "Category must be one of the map business types.";
  if (path.endsWith("stage")) return "That stage is not a known stage.";
  if (path.endsWith("direction")) return "Comms direction must be in or out.";
  if (path.endsWith("site_id")) return "That site id is not valid.";
  if (path.endsWith("expected_version")) return "Version must be a whole number.";
  if (path === "changes" || path.endsWith("changes")) return "Add at least one change.";
  if (path.endsWith("date")) return "Use a calendar date.";
  if (path.endsWith("summary")) return "Add a summary.";
  return "That change is not valid.";
}

function fail(index: number | null, path: string, code: string): never {
  const label = issueMessage(path, code);
  throw new InputError(index == null ? label : `Change ${index + 1}: ${label}`);
}

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cleanText(value: string | undefined): void {
  if (value) assertClean(value);
}

export function validateBatch(actor: Actor, idempotencyKey: string, body: unknown): { key: string; changes: ParsedChange[] } {
  const key = idempotencyKey.trim();
  if (!key) throw new InputError("Every batch needs an Idempotency-Key.");
  if (key.startsWith("shadow:")) throw new InputError("That Idempotency-Key is reserved.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)) throw new InputError("That Idempotency-Key is not valid.");

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.map(String).join(".");
    const index = issue.path.find((part) => typeof part === "number");
    fail(typeof index === "number" ? index : null, path, issue.code);
  }

  const changes: ParsedChange[] = parsed.data.changes.map((row, index) => {
    const siteKeyed = row.entity_type === "stage" || row.entity_type === "site";
    if (row.entity_id && (row.expected_version === 0 || siteKeyed)) {
      throw new InputError(`Change ${index + 1}: The server assigns ids.`);
    }
    if (row.expected_version > 0 && !siteKeyed && !row.entity_id) {
      throw new InputError(`Change ${index + 1}: That update needs the record id.`);
    }
    if (row.entity_id && row.entity_type === "activity" && !/^A-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    if (row.entity_id && row.entity_type === "comms" && !/^CM-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    const siteAllowed = row.entity_type === "comms" ? commsSiteAllowed(row.site_id) : SITE_ID.test(row.site_id);
    if (!siteAllowed) throw new InputError(`Change ${index + 1}: That site id is not valid.`);
    cleanText(row.source);
    if (row.entity_type === "site") {
      return { ...row, payload: parseSite(actor, index, row.expected_version, row.payload) };
    }
    if (row.entity_type === "stage") {
      const parsedPayload = stagePayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      cleanText(data.reason);
      assertStageActor(actor, index, data.stage, data.reason);
      return { ...row, payload: data };
    }
    if (row.entity_type === "activity") {
      const parsedPayload = activityPayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      if (!realDate(data.date)) throw new InputError(`Change ${index + 1}: Use a calendar date.`);
    cleanText(data.summary);
    cleanText(data.source_link);
    assertContentActor(actor, index);
    return { ...row, payload: data };
    }
    const parsedPayload = commsPayload.safeParse(row.payload);
    if (!parsedPayload.success) {
      const issue = parsedPayload.error.issues[0];
      fail(index, issue.path.map(String).join("."), issue.code);
    }
    const data = parsedPayload.data;
    cleanText(data.person);
    cleanText(data.firm);
    cleanText(data.channel);
    cleanText(data.subject);
    cleanText(data.at);
    cleanText(data.summary);
    assertContentActor(actor, index);
    return { ...row, payload: data };
  });
  return { key, changes };
}

function assertStageActor(actor: Actor, index: number, stage: string, reason: string | undefined): void {
  // R-097. A drop is a reviewer decision with a reason. Agents cannot make it.
  if (stage === "Dropped" && actor.kind !== "human") {
    throw new InputError(`Change ${index + 1}: An agent cannot set Stage to Dropped.`);
  }
  if (actor.kind !== "human" || !actor.role || !canDecide(actor.role)) {
    throw new InputError(`Change ${index + 1}: Stage changes need a reviewer.`, 403);
  }
  if (stage === "Dropped" && !reason?.trim()) {
    throw new InputError(`Change ${index + 1}: Stage Dropped needs a reason.`);
  }
}

function assertContentActor(actor: Actor, index: number): void {
  if (actor.kind === "agent") return;
  if (!actor.role || !canWriteContent(actor.role)) {
    throw new InputError(`Change ${index + 1}: You do not have permission for that.`, 403);
  }
}

function parseSite(actor: Actor, index: number, expectedVersion: number, payload: unknown): SitePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError(`Change ${index + 1}: That change is not valid.`);
  }
  const raw = payload as Record<string, unknown>;
  if ("stage" in raw || "Stage" in raw) {
    throw new InputError(`Change ${index + 1}: Stage is not written on a site.`);
  }
  const guarded = Object.keys(raw).filter(guardKey);
  if (guarded.length && expectedVersion === 0) {
    throw new InputError(
      `Change ${index + 1}: A new site does not copy Folder, photos, land evidence, typed power, check statuses, or financial claims.`,
    );
  }
  const parsedPayload = sitePayload.safeParse(payload);
  if (!parsedPayload.success) {
    const issue = parsedPayload.error.issues[0];
    fail(index, issue.path.map(String).join("."), issue.code);
  }
  const data = parsedPayload.data;
  assertContentActor(actor, index);
  const fields: Partial<Record<SiteField, string>> = {};
  const put = (key: SiteField, value: string | number | null | undefined) => {
    if (value === undefined) return;
    fields[key] = value == null ? "" : canonicalFact(value);
  };
  put("name", data.name);
  put("address", data.address);
  put("market", data.market);
  put("lat", data.lat);
  put("lng", data.lng);
  put("category", data.category);
  put("broker", data.broker);
  put("firm", data.firm);
  put("listing_url", data.listing_url);
  put("asking_price", data.asking_price);
  put("acreage", data.acreage);
  put("apn", data.apn);
  put("land_value", data.land_value);
  put("improvement_value", data.improvement_value);
  put("county_value", data.county_value);
  put("county_value_basis", data.county_value_basis);
  put("service_area_class", data.service_area_class);
  put("service_area_distance_mi", data.service_area_distance_mi);
  put("service_area_polygon", data.service_area_polygon);
  put("miles_to_depot", data.miles_to_depot);
  put("notes", data.notes);
  put("universe_id", data.universe_id);
  put("listing_status", data.listing_status);
  put("photo_status", data.photo_status);
  put("photo_diligence_count", data.photo_diligence_count);
  put("photo_listing_count", data.photo_listing_count);
  put("photos_checked", data.photos_checked);
  put("photo_notes", data.photo_notes);
  const photos: PhotoRef[] = (data.photo_refs || []).map((photo) => ({
    role: photo.role,
    source: photo.source || "",
    file_id: photo.file_id || "",
    view_url: photo.view_url || "",
    as_of: photo.as_of || "",
    caption: photo.caption || "",
    attribution: photo.attribution || "",
    visibility: photo.visibility || "",
  }));
  if (data.photo_refs) fields.photo_refs = photoCanonical(photos);
  const facts: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.facts || {})) {
    if (!FACT_FIELDS.includes(key as (typeof FACT_FIELDS)[number])) {
      throw new InputError(`Change ${index + 1}: That field is not accepted.`);
    }
    facts[key] = value == null ? "" : canonicalFact(value);
  }
  if (data.folder_url !== undefined) facts.folder_url = data.folder_url;
  if (!Object.keys(fields).length && !Object.keys(facts).length) throw new InputError(`Change ${index + 1}: Add a field to change.`);
  for (const key of Object.keys(data.sources || {})) {
    if (!NUMERIC_FACT_FIELDS.includes(key as (typeof NUMERIC_FACT_FIELDS)[number])) {
      throw new InputError(`Change ${index + 1}: That source is not for a numeric fact.`);
    }
  }
  const sources: Record<string, string> = {};
  for (const field of NUMERIC_FACT_FIELDS) {
    const inFields = fields[field as SiteField];
    const inFacts = facts[field];
    const value = inFields !== undefined ? inFields : inFacts;
    if (value === undefined || value === "") continue;
    const source = data.sources?.[field]?.trim() || "";
    if (!source) throw new InputError(`Change ${index + 1}: Every numeric fact needs a source.`);
    cleanText(source);
    sources[field] = source;
  }
  if (expectedVersion === 0 && !CREATE_MARKETS.includes(data.market as (typeof CREATE_MARKETS)[number])) {
    throw new InputError(`Change ${index + 1}: A new site needs a market of PHX, LAS, or MIA.`);
  }
  cleanText(fields.name);
  cleanText(fields.address);
  cleanText(fields.broker);
  cleanText(fields.firm);
  cleanText(fields.notes);
  cleanText(fields.apn);
  cleanText(fields.county_value_basis);
  cleanText(fields.service_area_polygon);
  cleanText(fields.listing_url);
  cleanText(fields.universe_id);
  cleanText(fields.listing_status);
  cleanText(fields.photo_notes);
  cleanText(facts.source_line);
  cleanText(facts.folder_url);
  for (const photo of photos) {
    cleanText(photo.caption);
    cleanText(photo.attribution);
  }
  assertSiteOwnership(actor, index, new Set([...Object.keys(fields), ...Object.keys(facts)]), data.service_area_class);
  return { fields, sources, facts, photos: data.photo_refs ? photos : undefined };
}

function assertSiteOwnership(actor: Actor, index: number, touched: Set<string>, serviceArea: string | undefined): void {
  if (actor.kind !== "agent") return;
  if (serviceArea === "edge_legacy" || serviceArea === "unknown") {
    throw new InputError(`Change ${index + 1}: An agent cannot set that service area.`);
  }
  const allowed = new Set<string>(actor.id === "indie" ? [...PHOTO_FIELDS, ...CHECK_FIELDS] : actor.id === "muse" ? [...MUSE_FIELDS] : []);
  for (const key of touched) {
    if ((SCHEMA_FIELDS as readonly string[]).includes(key) || !allowed.has(key)) {
      throw new InputError(`Change ${index + 1}: An agent cannot write that field.`);
    }
  }
}
