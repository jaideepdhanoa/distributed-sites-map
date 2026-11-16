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
  POWER_RATING,
  SITE_NUMERIC_FIELDS,
  canonicalFact,
  photoCanonical,
  type PhotoRef,
  type SiteField,
} from "./site";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { SPACE_LAYOUT_IDS, SPACE_TYPE_IDS, spaceSiteAllowed, type SpaceLayout, type SpaceType } from "@/lib/spaces/vocab";
import { BUSINESS_TYPES as PNL_BUSINESSES, PNL_LINE_CODES, type PnlBusiness, type PnlLineCode } from "@/lib/pnl/lines";
import { parseAmount } from "@/lib/pnl/money";
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
  /** Exact ISO-8601 time with a numeric zone offset. R-101. */
  at?: string;
};

export type ActivityPayload = {
  /** Calendar date. The API derives this from a zoned timestamp. */
  date: string;
  /** The ISO-8601 timestamp the API accepted, with its zone offset. */
  date_iso?: string;
  type: ActivityType;
  summary: string;
  source_link?: string;
  /** The workbook date had no clock. The calendar day is still exact. */
  at_approximate?: boolean;
  /** Workbook capture import line. Later edits keep it. The HTTP API does not set it. */
  provenance?: string;
};

export type CommsPayload = {
  direction: CommsDirection | "internal";
  /** Parsed clock, or the ISO-8601 timestamp the API accepted. */
  at?: string;
  /** Sheet wording that did not parse. The mirror keeps this text. */
  at_text?: string;
  /** The time is approximate. The sheet gains " (approx.)" only when its cell can take that mark. */
  at_approximate?: boolean;
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

export type PnlLinePayload = {
  grain: "annual" | "monthly";
  year: number;
  month?: number;
  through_month?: number;
  business_type: PnlBusiness;
  line: PnlLineCode;
  amount: string;
  status: "reported" | "estimated";
  source_document: string;
  source_page: string;
  source_href?: string;
  captured_at: string;
};

export type SiteSpacePayload =
  | { deleted: true }
  | {
      deleted?: false;
      center_lng: number;
      center_lat: number;
      length_ft: number;
      width_ft: number;
      rotation_deg: number;
      type: SpaceType;
      layout: SpaceLayout;
    };

export type ParsedChange = {
  entity_type: EntityType;
  site_id: string;
  entity_id?: string;
  expected_version: number;
  source: string;
  /** Workbook import keeps the sheet's id. The HTTP API never sets this. */
  preserve_id?: boolean;
  payload: StagePayload | ActivityPayload | CommsPayload | SitePayload | PnlLinePayload | SiteSpacePayload;
};

const stagePayload = z
  .object({
    stage: z.enum(CANONICAL_STAGES),
    market: z.enum(MARKETS),
    service_area_class: z.enum(SERVICE_AREA_CLASSES).optional(),
    reason: z.string().trim().max(500).optional(),
    at: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const activityPayload = z
  .object({
    date: z.string().trim().min(1),
    type: z.enum(ACTIVITY_TYPES),
    summary: z.string().trim().min(1).max(300),
    source_link: z.string().trim().max(500).optional(),
    at_approximate: z.boolean().optional(),
  })
  .strict();

const commsPayload = z
  .object({
    direction: z.enum(COMMS_DIRECTIONS),
    at: z.string().trim().max(40).optional(),
    at_approximate: z.boolean().optional(),
    person: z.string().trim().max(200).optional(),
    firm: z.string().trim().max(200).optional(),
    channel: z.string().trim().max(80).optional(),
    summary: z.string().trim().max(50000).optional(),
    subject: z.string().trim().max(2000).optional(),
  })
  .strict();

const pnlLinePayload = z
  .object({
    grain: z.enum(["annual", "monthly"]),
    year: z.number().int().min(1990).max(2100),
    month: z.number().int().min(1).max(12).optional(),
    through_month: z.number().int().min(1).max(12).optional(),
    business_type: z.enum(PNL_BUSINESSES),
    line: z.enum(PNL_LINE_CODES),
    amount: z.string().trim().min(1).max(20),
    status: z.enum(["reported", "estimated"]),
    source_document: z.string().trim().min(1).max(200),
    source_page: z.string().trim().min(1).max(80),
    source_href: z.string().trim().max(500).optional(),
    captured_at: z.string().trim().min(1).max(40),
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
  POWER_RATING,
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

const siteSpacePayload = z
  .object({
    center_lng: z.number().finite().optional(),
    center_lat: z.number().finite().optional(),
    length_ft: z.number().finite().optional(),
    width_ft: z.number().finite().optional(),
    rotation_deg: z.number().finite().optional(),
    type: z.enum(SPACE_TYPE_IDS).optional(),
    layout: z.enum(SPACE_LAYOUT_IDS).optional(),
    deleted: z.literal(true).optional(),
  })
  .strict();

const changeSchema = z
  .object({
    entity_type: z.enum(["stage", "activity", "comms", "site", "pnl_line", "site_space"]),
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
  if (path.endsWith("date") || path.endsWith("at") || path.endsWith("captured_at")) return "Use an ISO-8601 time with a zone offset.";
  if (path.endsWith("grain")) return "Period grain must be annual or monthly.";
  if (path.endsWith("business_type")) return "Business type must be car_wash or auto_service.";
  if (path.endsWith("line")) return "That line is not in the chart of accounts.";
  if (path.endsWith("amount")) return "Amount must be the captured number, with no rounding added.";
  if (path.endsWith("status")) return "Status must be reported or estimated.";
  if (path.endsWith("summary")) return "Add a summary.";
  return "That change is not valid.";
}

function fail(index: number | null, path: string, code: string): never {
  const label = issueMessage(path, code);
  throw new InputError(index == null ? label : `Change ${index + 1}: ${label}`);
}

const ZONED_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Local clock as an ISO-8601 timestamp with a numeric zone offset. R-101. */
export function formatZonedTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2) => String(Math.trunc(Math.abs(value))).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.trunc(absolute / 60))}:${pad(absolute % 60)}`;
}

/** An ISO-8601 timestamp that names a real calendar day and a numeric zone offset. */
export function parseZonedTimestamp(value: string): { iso: string; date: string } | null {
  const text = value.trim();
  const match = ZONED_TIMESTAMP.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const zone = match[7];
  if (zone !== "Z") {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59) return null;
  }
  return { iso: text, date: `${match[1]}-${match[2]}-${match[3]}` };
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
    if (row.entity_id && row.entity_type === "pnl_line" && !/^PL-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    if (row.entity_id && row.entity_type === "site_space" && !/^SS-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    const siteAllowed = row.entity_type === "comms"
      ? commsSiteAllowed(row.site_id)
      : row.entity_type === "site_space"
        ? spaceSiteAllowed(row.site_id)
        : SITE_ID.test(row.site_id);
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
      let at: string | undefined;
      if (data.at) {
        const zoned = parseZonedTimestamp(data.at);
        if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
        at = zoned.iso;
      }
      const payload = { ...data };
      if (at) payload.at = at;
      else delete payload.at;
      return { ...row, payload };
    }
    if (row.entity_type === "activity") {
      const parsedPayload = activityPayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      const zoned = parseZonedTimestamp(data.date);
      if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
      cleanText(data.summary);
      cleanText(data.source_link);
      assertActivityActor(actor, index, data.type);
      return { ...row, payload: { ...data, date: zoned.date, date_iso: zoned.iso } };
    }
    if (row.entity_type === "pnl_line") {
      return { ...row, payload: parsePnlLine(actor, index, row.site_id, row.payload) };
    }
    if (row.entity_type === "site_space") {
      return { ...row, payload: parseSiteSpace(actor, index, row.site_id, row.expected_version, row.payload) };
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
    if (data.at) {
      const zoned = parseZonedTimestamp(data.at);
      if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
      data.at = zoned.iso;
    }
    cleanText(data.at);
    cleanText(data.summary);
    assertContentActor(actor, index);
    return { ...row, payload: data };
  });
  return { key, changes };
}

function parsePnlLine(actor: Actor, index: number, siteId: string, payload: unknown): PnlLinePayload {
  if (isExcludedSite(siteId)) throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  if (actor.kind === "agent" && actor.id.trim().toLowerCase() !== "muse") {
    throw new InputError(`Change ${index + 1}: Only Muse can write a P&L line.`, 403);
  }
  assertContentActor(actor, index);
  const parsedPayload = pnlLinePayload.safeParse(payload);
  if (!parsedPayload.success) {
    const issue = parsedPayload.error.issues[0];
    fail(index, issue.path.map(String).join("."), issue.code);
  }
  const data = parsedPayload.data;
  if (data.grain === "monthly" && data.month == null) {
    throw new InputError(`Change ${index + 1}: A monthly period needs a month.`);
  }
  if (data.grain === "annual" && data.month != null) {
    throw new InputError(`Change ${index + 1}: An annual period has no month.`);
  }
  if (data.grain === "monthly" && data.through_month != null) {
    throw new InputError(`Change ${index + 1}: A monthly period has no through month.`);
  }
  if (!parseAmount(data.amount)) {
    throw new InputError(`Change ${index + 1}: Amount must be the captured number, with no rounding added.`);
  }
  const zoned = parseZonedTimestamp(data.captured_at);
  if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
  if (data.source_href && !/^https:\/\/\S+$/.test(data.source_href)) {
    throw new InputError(`Change ${index + 1}: The source link must be an https URL.`);
  }
  cleanText(data.source_document);
  cleanText(data.source_page);
  cleanText(data.source_href);
  cleanText(data.amount);
  return { ...data, captured_at: zoned.iso, source_href: data.source_href || "" };
}

function assertSpaceActor(actor: Actor, index: number): void {
  if (actor.kind !== "human" || !actor.role) {
    throw new InputError(`Change ${index + 1}: A person marks a space.`, 403);
  }
}

function parseSiteSpace(actor: Actor, index: number, siteId: string, expectedVersion: number, payload: unknown): SiteSpacePayload {
  if (isExcludedSite(siteId)) throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  assertSpaceActor(actor, index);
  const parsedPayload = siteSpacePayload.safeParse(payload);
  if (!parsedPayload.success) {
    const issue = parsedPayload.error.issues[0];
    fail(index, issue.path.map(String).join("."), issue.code);
  }
  const data = parsedPayload.data;
  if (data.deleted) {
    if (expectedVersion === 0) throw new InputError(`Change ${index + 1}: A new space cannot be deleted.`);
    return { deleted: true };
  }
  const centerLng = data.center_lng;
  const centerLat = data.center_lat;
  const lengthFt = data.length_ft;
  const widthFt = data.width_ft;
  const rotation = data.rotation_deg;
  if (centerLng == null || centerLat == null || lengthFt == null || widthFt == null || rotation == null || !data.type || !data.layout) {
    throw new InputError(`Change ${index + 1}: A marked space needs a rectangle, a type, and a layout.`);
  }
  if (centerLat < 24 || centerLat > 42 || centerLng < -125 || centerLng > -70) {
    throw new InputError(`Change ${index + 1}: That rectangle is outside the mapped markets.`);
  }
  if (lengthFt < 4 || lengthFt > 2000 || widthFt < 4 || widthFt > 2000) {
    throw new InputError(`Change ${index + 1}: Each side must be between 4 and 2,000 feet.`);
  }
  if (rotation < -360 || rotation > 360) {
    throw new InputError(`Change ${index + 1}: Rotation is degrees, from -360 to 360.`);
  }
  return {
    center_lng: centerLng,
    center_lat: centerLat,
    length_ft: lengthFt,
    width_ft: widthFt,
    rotation_deg: rotation,
    type: data.type,
    layout: data.layout,
  };
}

function assertStageActor(actor: Actor, index: number, stage: string, reason: string | undefined): void {
  // R-097. A drop is a reviewer decision with a reason. Agents cannot make it,
  // and nothing in the capture path may set Dropped on its own.
  if (stage === "Dropped" && (actor.kind !== "human" || actor.id === "system")) {
    throw new InputError(`Change ${index + 1}: An agent cannot set Stage to Dropped.`);
  }
  if (stage === "Dropped" && !reason?.trim()) {
    throw new InputError(`Change ${index + 1}: Stage Dropped needs a reason.`);
  }
  if (actor.id === "system") return;
  if (actor.kind !== "human" || !actor.role || !canDecide(actor.role)) {
    throw new InputError(`Change ${index + 1}: Stage changes need a reviewer.`, 403);
  }
}

function assertActivityActor(actor: Actor, index: number, type: string): void {
  assertContentActor(actor, index);
  // Capture rows are Muse's activity write. Other agent tokens stay on their own fields.
  if (type === "capture" && actor.kind === "agent" && actor.id !== "muse") {
    throw new InputError(`Change ${index + 1}: An agent cannot write that activity.`, 403);
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
    if (!FACT_FIELDS.includes(key as (typeof FACT_FIELDS)[number]) && key !== POWER_RATING) {
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
