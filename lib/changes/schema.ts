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
import { safeGmailLink } from "@/lib/comms";
import { parseTag, type TagPayload } from "@/lib/tags/parse";
import { BUSINESS_TYPES as PNL_BUSINESSES, PNL_LINE_CODES, type PnlBusiness, type PnlLineCode } from "@/lib/pnl/lines";
import { parseAmount } from "@/lib/pnl/money";
import { coverageOf } from "@/lib/pnl/period";
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
  gmail_message_id?: string;
  gmail_thread_id?: string;
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

export type PnlLineStatus = "reported" | "estimated" | "normalized" | "missing";

export type PnlLinePayload = {
  grain: "annual" | "monthly";
  year: number;
  month?: number;
  /** First month of an annual period. Omit for January. */
  start_month?: number;
  /** Last month of an annual period that is not a full 12 months. */
  through_month?: number;
  /** Inclusive end of an annual partial, YYYY-MM-DD. period_start still comes from year and start_month. */
  period_end?: string;
  business_type: PnlBusiness;
  line?: PnlLineCode;
  /** Omitted when missing is true. Stored text, never a JSON number. */
  amount?: string;
  /** `stated` is accepted and stored as `reported`. */
  status: PnlLineStatus;
  /** A month the package should have but does not. No amount and no line. */
  missing?: boolean;
  source_document: string;
  source_page: string;
  source_href?: string;
  captured_at: string;
};

/** Muse retracts a line. The row stays, with the reason, and an event is appended. */
export type PnlRetractPayload = {
  retract: true;
  reason: string;
  /** ISO-8601 time with a numeric offset or Z, stored exactly. */
  at: string;
};

export function isPnlRetract(payload: unknown): payload is PnlRetractPayload {
  return Boolean(payload && typeof payload === "object" && "retract" in payload && (payload as { retract?: unknown }).retract === true);
}

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

export type { TagPayload } from "@/lib/tags/parse";

export type ParsedChange = {
  entity_type: EntityType;
  site_id: string;
  entity_id?: string;
  expected_version: number;
  source: string;
  /** Workbook import keeps the sheet's id. The HTTP API never sets this. */
  preserve_id?: boolean;
  payload: StagePayload | ActivityPayload | CommsPayload | SitePayload | PnlLinePayload | PnlRetractPayload | SiteSpacePayload | TagPayload;
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
    message_id: z.string().trim().max(200).optional(),
    thread_id: z.string().trim().max(200).optional(),
    link: z.string().trim().max(500).optional(),
    gmail_message_id: z.string().trim().max(64).optional(),
    gmail_thread_id: z.string().trim().max(64).optional(),
  })
  .strict();

const pnlLinePayload = z
  .object({
    grain: z.enum(["annual", "monthly"]),
    year: z.number().int().min(1990).max(2100),
    month: z.number().int().min(1).max(12).optional(),
    start_month: z.number().int().min(1).max(12).optional(),
    through_month: z.number().int().min(1).max(12).optional(),
    period_end: z.string().trim().min(1).max(10).optional(),
    business_type: z.enum(PNL_BUSINESSES),
    line: z.enum(PNL_LINE_CODES).optional(),
    amount: z.string().trim().min(1).max(20).optional(),
    status: z.enum(["stated", "reported", "normalized", "estimated"]).optional(),
    missing: z.literal(true).optional(),
    source_document: z.string().trim().min(1).max(200),
    source_page: z.string().trim().min(1).max(80),
    source_href: z.string().trim().max(500).optional(),
    captured_at: z.string().trim().min(1).max(40),
  })
  .strict();

const pnlRetractPayload = z
  .object({
    retract: z.literal(true),
    reason: z.string().trim().min(1).max(500),
    at: z.string().trim().min(1).max(40),
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
    entity_type: z.enum(["stage", "activity", "comms", "site", "pnl_line", "site_space", "tag"]),
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
  if (path.endsWith("gmail_message_id") || path.endsWith("gmail_thread_id")) return "Gmail ids are 16 hex characters.";
  if (path.endsWith("message_id") || path.endsWith("thread_id")) return "That id is not valid.";
  if (path.endsWith("link")) return "The link must be an https URL.";
  if (path.endsWith("site_id")) return "That site id is not valid.";
  if (path.endsWith("expected_version")) return "Version must be a whole number.";
  if (path === "changes" || path.endsWith("changes")) return "Add at least one change.";
  if (path.endsWith("date") || path.endsWith("at") || path.endsWith("captured_at")) return "Use an ISO-8601 time with a zone offset.";
  if (path.endsWith("grain")) return "Period grain must be annual or monthly.";
  if (path.endsWith("business_type")) return "Business type must be car_wash or auto_service.";
  if (path.endsWith("line")) return "That line is not in the chart of accounts.";
  if (path.endsWith("amount")) return "amount must be a string such as \"12345\", \"12345.6\", or \"12345.00\".";
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

function commsToken(index: number, label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value) return "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new InputError(`Change ${index + 1}: ${label === "thread_id" ? "That thread id is not valid." : "That message id is not valid."}`);
  }
  return /^[0-9a-f]{16}$/i.test(value) ? value.toLowerCase() : value;
}

function gmailToken(index: number, label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value) return "";
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    throw new InputError(`Change ${index + 1}: ${label === "gmail_thread_id" ? "Gmail thread ids are 16 hex characters." : "Gmail message ids are 16 hex characters."}`);
  }
  return value.toLowerCase();
}

function commsLink(index: number, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return "";
  if (text.startsWith("https://mail.google.com/")) {
    const safe = safeGmailLink(text);
    if (!safe) throw new InputError(`Change ${index + 1}: The link must be an https URL.`);
    return safe;
  }
  if (!/^https:\/\/\S+$/.test(text) || text.includes("@")) {
    throw new InputError(`Change ${index + 1}: The link must be an https URL.`);
  }
  return text;
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
    const tagKeyed = row.entity_type === "tag";
    if (row.entity_id && (row.expected_version === 0 || siteKeyed || tagKeyed)) {
      throw new InputError(`Change ${index + 1}: The server assigns ids.`);
    }
    if (row.expected_version > 0 && !siteKeyed && !tagKeyed && !row.entity_id) {
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
      cleanText(data.summary);
      cleanText(data.source_link);
      assertActivityActor(actor, index, data.type);
      const zoned = parseZonedTimestamp(data.date);
      if (data.at_approximate === true && !zoned && realDate(data.date)) {
        return { ...row, payload: { ...data, date: data.date, at_approximate: true } };
      }
      if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
      return {
        ...row,
        payload: { ...data, date: zoned.date, date_iso: zoned.iso, ...(data.at_approximate ? { at_approximate: true } : {}) },
      };
    }
    if (row.entity_type === "pnl_line") {
      return {
        ...row,
        payload: parsePnlLine(actor, index, row.site_id, row.payload, {
          entityId: row.entity_id,
          expectedVersion: row.expected_version,
        }),
      };
    }
    if (row.entity_type === "site_space") {
      return { ...row, payload: parseSiteSpace(actor, index, row.site_id, row.expected_version, row.payload) };
    }
    if (row.entity_type === "tag") {
      const parsedTag = parseTag(actor, index, row.site_id, row.payload);
      if (parsedTag.since) {
        const zoned = parseZonedTimestamp(parsedTag.since);
        if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
        parsedTag.since = zoned.iso;
      }
      return { ...row, payload: parsedTag };
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
    const messageId = commsToken(index, "message_id", data.message_id);
    const threadId = commsToken(index, "thread_id", data.thread_id);
    const link = commsLink(index, data.link);
    const gmailMessageId = gmailToken(index, "gmail_message_id", data.gmail_message_id);
    const gmailThreadId = gmailToken(index, "gmail_thread_id", data.gmail_thread_id);
    return {
      ...row,
      payload: {
        ...data,
        ...(messageId !== undefined ? { message_id: messageId } : {}),
        ...(threadId !== undefined ? { thread_id: threadId } : {}),
        ...(link !== undefined ? { link } : {}),
        ...(gmailMessageId !== undefined ? { gmail_message_id: gmailMessageId } : {}),
        ...(gmailThreadId !== undefined ? { gmail_thread_id: gmailThreadId } : {}),
      },
    };
  });
  return { key, changes };
}

const AMOUNT_FORM = "amount must be a string such as \"12345\", \"12345.6\", or \"12345.00\"";
const AMOUNT_FORMATTED = `${AMOUNT_FORM}, with at most two decimal places and no commas or symbols`;

function pnlError(index: number, field: string, message: string, status = 400): never {
  throw new InputError(`Change ${index + 1}: ${message}`, status, field);
}

function pnlField(path: PropertyKey[]): string {
  const field = path.length ? String(path[path.length - 1]) : "payload";
  if (field === "start_month" || field === "through_month" || field === "business_type" || field === "source_document" || field === "source_page" || field === "source_href" || field === "captured_at") {
    return field;
  }
  return field;
}

function pnlZodMessage(field: string): string {
  if (field === "amount") return AMOUNT_FORM;
  if (field === "status") return "status must be stated, reported, normalized, or estimated";
  if (field === "grain") return "grain must be annual or monthly";
  if (field === "year") return "year must be a whole number from 1990 to 2100";
  if (field === "month" || field === "start_month" || field === "through_month") return `${field} must be a whole number from 1 to 12`;
  if (field === "business_type") return "business_type must be car_wash or auto_service";
  if (field === "line") return "line must be one of the chart of accounts";
  if (field === "missing") return "missing must be true";
  if (field === "captured_at") return "captured_at is required";
  if (field === "at") return "at must be an ISO-8601 time with a zone offset";
  if (field === "source_document") return "source_document is required";
  if (field === "source_page") return "source_page must be a string";
  if (field === "period_end") return "period_end must be a YYYY-MM-DD date";
  if (field === "reason") return "reason is required";
  if (field === "source_href") return "source_href must be an https URL";
  return `${field} is not a field on a P&L line`;
}

function rawRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function parsePnlLine(
  actor: Actor,
  index: number,
  siteId: string,
  payload: unknown,
  identity: { entityId?: string; expectedVersion: number },
): PnlLinePayload | PnlRetractPayload {
  if (isExcludedSite(siteId)) throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  const raw = rawRecord(payload);
  if (raw && raw.retract === true) return parsePnlRetract(actor, index, raw, identity);
  if (actor.kind === "agent" && actor.id.trim().toLowerCase() !== "muse") {
    throw new InputError(`Change ${index + 1}: Only Muse can write a P&L line.`, 403);
  }
  assertContentActor(actor, index);
  if (raw && "amount" in raw && typeof raw.amount === "number") pnlError(index, "amount", `${AMOUNT_FORM}, not a number`);
  if (raw && "source_page" in raw && typeof raw.source_page === "number") pnlError(index, "source_page", "source_page must be a string");
  if (!raw || !("captured_at" in raw) || raw.captured_at == null || raw.captured_at === "") {
    pnlError(index, "captured_at", "captured_at is required");
  }
  if (raw && typeof raw.captured_at === "number") pnlError(index, "captured_at", "captured_at must be a string");
  const parsedPayload = pnlLinePayload.safeParse(payload);
  if (!parsedPayload.success) {
    const issue = parsedPayload.error.issues[0];
    const field = pnlField(issue.path);
    pnlError(index, field, pnlZodMessage(field));
  }
  const data = parsedPayload.data;
  if (data.missing) {
    if (data.grain !== "monthly") pnlError(index, "missing", "missing is only for a monthly period");
    if (data.month == null) pnlError(index, "month", "month must be a whole number from 1 to 12");
    if (data.amount != null) pnlError(index, "amount", "amount must be omitted when missing is true");
    if (data.line != null) pnlError(index, "line", "line must be omitted when missing is true");
    if (data.status != null) pnlError(index, "status", "status must be omitted when missing is true");
    if (data.through_month != null) pnlError(index, "through_month", "through_month is only for an annual period");
    if (data.start_month != null) pnlError(index, "start_month", "start_month is only for an annual period");
  } else {
    if (data.grain === "monthly" && data.month == null) pnlError(index, "month", "month must be a whole number from 1 to 12");
    if (data.grain === "annual" && data.month != null) pnlError(index, "month", "month is only for a monthly period");
    if (data.grain === "monthly" && data.through_month != null) pnlError(index, "through_month", "through_month is only for an annual period");
    if (data.grain === "monthly" && data.start_month != null) pnlError(index, "start_month", "start_month is only for an annual period");
    if (data.line == null) pnlError(index, "line", "line must be one of the chart of accounts");
    if (data.status == null) pnlError(index, "status", "status must be stated, reported, normalized, or estimated");
    if (data.amount == null) pnlError(index, "amount", AMOUNT_FORM);
    else if (!parseAmount(data.amount)) pnlError(index, "amount", AMOUNT_FORMATTED);
    const start = data.start_month ?? 1;
    const end = data.through_month;
    if (data.grain === "annual" && end != null && end === start) {
      pnlError(index, "through_month", "through_month must cover more than one month. A single month uses grain monthly");
    }
    if (data.period_end != null) assertPartialEnd(index, data.grain, data.year, data.start_month, data.through_month, data.period_end);
  }
  if (data.missing && data.period_end != null) pnlError(index, "period_end", "period_end must be omitted when missing is true");
  const zoned = parseZonedTimestamp(data.captured_at);
  if (!zoned) pnlError(index, "captured_at", "captured_at must be an ISO-8601 time with a zone offset");
  if (data.source_href && !/^https:\/\/\S+$/.test(data.source_href)) {
    pnlError(index, "source_href", "source_href must be an https URL");
  }
  cleanText(data.source_document);
  cleanText(data.source_page);
  cleanText(data.source_href);
  if (data.amount) cleanText(data.amount);
  const status = data.missing ? "missing" : data.status === "stated" ? "reported" : data.status || "reported";
  return {
    grain: data.grain,
    year: data.year,
    month: data.month,
    start_month: data.start_month,
    through_month: data.through_month,
    period_end: data.period_end,
    business_type: data.business_type,
    line: data.line,
    amount: data.amount,
    status,
    missing: data.missing === true,
    source_document: data.source_document,
    source_page: data.source_page,
    source_href: data.source_href || "",
    captured_at: zoned.iso,
  };
}

function assertPartialEnd(
  index: number,
  grain: "annual" | "monthly",
  year: number,
  startMonth: number | undefined,
  throughMonth: number | undefined,
  periodEnd: string,
): void {
  if (grain !== "annual") pnlError(index, "period_end", "period_end is only for an annual period");
  if (throughMonth != null) pnlError(index, "period_end", "period_end cannot be combined with through_month");
  if (!realDate(periodEnd)) pnlError(index, "period_end", "period_end must be a YYYY-MM-DD date");
  const full = coverageOf({ grain: "annual", year, startMonth });
  if (periodEnd <= full.periodStart) pnlError(index, "period_end", "period_end must be after period_start");
  if (periodEnd >= full.periodEnd) pnlError(index, "period_end", "period_end must end before the full period. Omit it on a full year");
}

function parsePnlRetract(
  actor: Actor,
  index: number,
  raw: Record<string, unknown>,
  identity: { entityId?: string; expectedVersion: number },
): PnlRetractPayload {
  if (actor.kind !== "agent" || actor.id.trim().toLowerCase() !== "muse") {
    pnlError(index, "retract", "Only Muse can retract a P&L line.", 403);
  }
  if (!identity.entityId || identity.expectedVersion < 1) {
    pnlError(index, "entity_id", "A retract needs the line id and its version");
  }
  if (!("at" in raw) || raw.at == null || raw.at === "") pnlError(index, "at", "at is required");
  const parsed = pnlRetractPayload.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = pnlField(issue.path);
    pnlError(index, field === "payload" ? "reason" : field, field === "reason" || field === "payload" ? "reason is required" : pnlZodMessage(field));
  }
  const zoned = parseZonedTimestamp(parsed.data.at);
  if (!zoned) pnlError(index, "at", "at must be an ISO-8601 time with a zone offset");
  cleanText(parsed.data.reason);
  return { retract: true, reason: parsed.data.reason, at: zoned.iso };
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
