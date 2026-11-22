import { z } from "zod";
import type { ActionRole } from "@/lib/actions/roles";
import { canDecide, canWriteContent } from "@/lib/actions/roles";
import { parseMentionIds } from "@/lib/actions/mentions";
import { isCommentLine, type CommentTag } from "@/lib/comments/anchor";
import { InputError } from "@/lib/actions/text";
import { LISTING_SEARCH_MESSAGE, listingSearchPage } from "@/lib/listingUrl";
import { assertClean } from "@/lib/policy/banned";
import {
  CHECK_FIELDS,
  CREATE_IDENTITY_FIELDS,
  CREATE_MARKETS,
  FACT_FIELDS,
  INDIE_IDENTITY_FIELDS,
  TRADE_FIELDS,
  LISTING_STATUSES,
  MUSE_FIELDS,
  NUMERIC_FACT_FIELDS,
  PHOTO_FIELDS,
  TOP_LEVEL_FACT_FIELDS,
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
import { CONFLICT_SUBJECTS, type ConflictSubject } from "@/lib/conflicts/view";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { SPACE_LAYOUT_IDS, SPACE_TYPE_IDS, spaceSiteAllowed, type SpaceLayout, type SpaceType } from "@/lib/spaces/vocab";
import { safeGmailLink } from "@/lib/comms";
import { parseTag, type TagPayload } from "@/lib/tags/parse";
import { BUSINESS_TYPES as PNL_BUSINESSES, PNL_LINE_CODES, type PnlBusiness, type PnlLineCode } from "@/lib/pnl/lines";
import { parseAmount } from "@/lib/pnl/money";
import { QUICK_LUBE_FIELDS, UNIVERSE_CREATE_CATEGORIES, normalizeAddress, quickLubeValueProblem, serviceAreaToken } from "@/lib/quickLube";
import { segmentKey, segmentLabel } from "@/lib/segments";
import { coverageOf } from "@/lib/pnl/period";
import {
  ACTIVITY_TYPES,
  BUSINESS_TYPES,
  CANONICAL_STAGES,
  COMMS_DIRECTIONS,
  MARKETS,
  SERVICE_AREA_CLASSES,
  LISTING_ID,
  NDA_ID,
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

/** Package receipt that cites a Drive file and a comms id or an email date. Never a Gmail id. */
export type PackageReceipt = {
  document: string;
  /** Exact ISO-8601 time with a numeric zone offset. R-101. */
  received_at: string;
  comms_id?: string;
  email_date?: string;
};

export const AGENT_STAGE_DECISION_SOURCE = "Agent stage decision";
export const RECEIPT_ACTIVITY_SUMMARY = "Moved to Financial screen on package receipt";

export type StagePayload = {
  stage: StageName;
  market: Market;
  service_area_class?: ServiceAreaClass | "";
  reason?: string;
  /** Exact ISO-8601 time with a numeric zone offset. R-101. */
  at?: string;
  receipt?: PackageReceipt;
  /** Set by the server for the one agent stage move. */
  decision_source?: "agent";
  cited_source?: string;
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
  /** The row's current site id when an agent attaches it to a new site. Blank or L-*. */
  relink_from?: string;
  /** Previous site id, stored by the server. */
  relinked_from?: string;
  /** Agent id that attached the row, stored by the server. */
  relinked_by?: string;
  asks_made?: string;
  asks_answered?: string;
  attachments?: string;
  state_changes?: string;
  workbook_source?: string;
  message_id?: string;
};

export type SiteMint = {
  kind: "pipeline" | "land" | "universe";
  /** L- id for a pipeline or land create. Blank for a universe census row. */
  listing_id: string;
};

export type SitePayload = {
  fields: Partial<Record<SiteField, string>>;
  sources?: Partial<Record<string, string>>;
  sheet?: Record<string, string>;
  facts?: Record<string, string>;
  coord_status?: string;
  photos?: import("./site").PhotoRef[];
  /** Present only on an agent create. Pipeline and land mint both ids. Universe mints a Universe id. */
  mint?: SiteMint;
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

/** A discussion note anchored to a P&L cell, a P&L line, a marked lot, or an NDA. */
export type CommentPayload = {
  anchor?: { type: "pnl_cell" | "pnl_line" | "space" | "nda"; line: string; period: string; space_id: string };
  parent_id?: string;
  body?: string;
  tag?: CommentTag;
  mentions?: string[];
  resolved?: boolean;
  /** ISO-8601 time with a numeric offset or Z, stored exactly. */
  at: string;
};

export type ConflictSourcePayload = { value: string; document: string; page: string };

/** Two sources that disagree. Muse writes it. The values stay on the signed-in read. */
export type ConflictPayload = {
  subject: ConflictSubject;
  field: string;
  period: string;
  sources: [ConflictSourcePayload, ConflictSourcePayload];
  value_in_use: string;
  status: "open" | "asked_broker" | "resolved";
  resolution_note: string;
  at: string;
};

/** A status, owner, or next-step write on an NDA register row. */
export type NdaPayload = {
  action: "status" | "assign" | "next_step";
  status: string;
  waiting_on: string;
  owner: string;
  next_step: string;
  note: string;
  at: string;
};

export type ParsedChange = {
  entity_type: EntityType;
  site_id: string;
  entity_id?: string;
  expected_version: number;
  source: string;
  /** Workbook import keeps the sheet's id. The HTTP API never sets this. */
  preserve_id?: boolean;
  /** The listing id was already minted. Apply returns the stored ids and does not write again. */
  listing_replay?: boolean;
  /** This market and address were already minted. Apply returns the stored Universe id and does not write again. */
  universe_replay?: boolean;
  /** A Universe-only row was given this Pipeline id. Facts and the Universe id stay. */
  promoted?: boolean;
  payload: StagePayload | ActivityPayload | CommsPayload | SitePayload | PnlLinePayload | PnlRetractPayload | SiteSpacePayload | TagPayload | ConflictPayload | CommentPayload | NdaPayload;
};

const stagePayload = z
  .object({
    stage: z.enum(CANONICAL_STAGES),
    market: z.enum(MARKETS),
    service_area_class: z.enum(SERVICE_AREA_CLASSES).optional(),
    reason: z.string().trim().max(500).optional(),
    at: z.string().trim().min(1).max(40).optional(),
    receipt: z
      .object({
        document: z.string().trim().min(1).max(200),
        received_at: z.string().trim().min(1).max(40),
        comms_id: z.string().trim().min(1).max(40).optional(),
        email_date: z.string().trim().min(1).max(40).optional(),
      })
      .strict()
      .optional(),
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
    relink_from: z.string().trim().max(40).optional(),
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
    segment: z.string().trim().max(80).optional(),
    segment_group: z.string().trim().max(80).optional(),
    broker: z.string().trim().max(120).optional(),
    firm: z.string().trim().max(160).optional(),
    listing_url: z.string().trim().max(400).optional(),
    asking_price: z.number().finite().nullable().optional(),
    acreage: z.number().finite().nullable().optional(),
    ...Object.fromEntries(TOP_LEVEL_FACT_FIELDS.map((key) => [key, z.union([z.string().trim().max(500), z.number().finite(), z.null()]).optional()])),
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
    kind: z.enum(["pipeline", "land", "universe"]).optional(),
    listing_id: z.string().trim().max(40).optional(),
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

const conflictSourcePayload = z
  .object({
    value: z.string().trim().min(1).max(80),
    document: z.string().trim().min(1).max(200),
    page: z.string().trim().min(1).max(80),
  })
  .strict();

const conflictPayload = z
  .object({
    subject: z.enum(CONFLICT_SUBJECTS),
    field: z.string().trim().min(1).max(80),
    period: z.string().trim().max(80).optional(),
    sources: z.tuple([conflictSourcePayload, conflictSourcePayload]),
    value_in_use: z.string().trim().min(1).max(80),
    status: z.enum(["open", "asked_broker", "resolved"]),
    resolution_note: z.string().trim().max(500).optional(),
    at: z.string().trim().min(1).max(40),
  })
  .strict();

const commentAnchorPayload = z
  .object({
    type: z.enum(["pnl_cell", "pnl_line", "space", "nda"]),
    line: z.string().trim().max(40).optional(),
    period: z.string().trim().max(80).optional(),
    space_id: z.string().trim().max(40).optional(),
  })
  .strict();

const commentPayload = z
  .object({
    anchor: commentAnchorPayload.optional(),
    parent_id: z.string().trim().min(1).max(40).optional(),
    body: z.string().trim().max(2000).optional(),
    tag: z.enum(["investigate", "ask_broker", "normalize", "explained", "verified"]).optional(),
    mentions: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    resolved: z.boolean().optional(),
    at: z.string().trim().min(1).max(40),
  })
  .strict();

const changeSchema = z
  .object({
    entity_type: z.enum(["stage", "activity", "comms", "site", "pnl_line", "site_space", "tag", "data_conflict", "comment", "nda"]),
    site_id: z.string().trim().max(40).optional(),
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
  if (path.includes("sources") && code === "too_big") return "Source text is too long (200 characters max).";
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

const GMAIL_ID = /^[0-9a-f]{16}$/i;
const COMMS_ID = /^CM-\d{4,}$/;

function gmailId(value: string): boolean {
  return GMAIL_ID.test(value.trim());
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

  const changes: ParsedChange[] = parsed.data.changes.map((input, index) => {
    const row = { ...input, site_id: (input.site_id || "").trim() };
    const siteKeyed = row.entity_type === "stage" || row.entity_type === "site" || row.entity_type === "nda";
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
    if (row.entity_id && row.entity_type === "data_conflict" && !/^CF-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    if (row.entity_id && row.entity_type === "comment" && !/^NT-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    const agentMint = row.entity_type === "site" && row.expected_version === 0 && actor.kind === "agent" && !row.site_id;
    if (row.entity_type === "site" && row.expected_version === 0 && actor.kind === "agent" && row.site_id) {
      throw new InputError(`Change ${index + 1}: The server assigns site ids.`);
    }
    const siteId = row.site_id || "";
    const siteAllowed = agentMint
      ? true
      : row.entity_type === "comms"
        ? commsSiteAllowed(siteId)
        : row.entity_type === "site_space"
          ? spaceSiteAllowed(siteId)
          : row.entity_type === "comment"
            ? spaceSiteAllowed(siteId) || NDA_ID.test(siteId)
          : row.entity_type === "nda"
            ? NDA_ID.test(siteId)
            : SITE_ID.test(siteId);
    if (!siteAllowed) throw new InputError(`Change ${index + 1}: That site id is not valid.`);
    cleanText(row.source);
    if (row.entity_type === "site") {
      return { ...row, payload: parseSite(actor, index, row.expected_version, row.payload, agentMint) };
    }
    if (row.entity_type === "nda") {
      return { ...row, payload: parseNda(actor, index, row.payload) };
    }
    if (row.entity_type === "stage") {
      const parsedPayload = stagePayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      cleanText(data.reason);
      const receipt = assertStageActor(actor, index, data.stage, data.reason, data.receipt);
      let at: string | undefined;
      if (data.at) {
        const zoned = parseZonedTimestamp(data.at);
        if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`);
        at = zoned.iso;
      }
      const payload: StagePayload = { ...data };
      if (at) payload.at = at;
      else delete payload.at;
      if (receipt) {
        payload.receipt = receipt;
        payload.decision_source = "agent";
      } else {
        delete payload.receipt;
      }
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
    if (row.entity_type === "data_conflict") {
      return { ...row, payload: parseDataConflict(actor, index, row.site_id, row.payload) };
    }
    if (row.entity_type === "comment") {
      return { ...row, payload: parseComment(actor, index, row.site_id, row.expected_version, row.payload) };
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
    if (data.relink_from !== undefined && data.relink_from !== "" && !LISTING_ID.test(data.relink_from)) {
      throw new InputError(`Change ${index + 1}: A comms relink starts from a blank site or a listing id (L-).`);
    }
    if (data.relink_from && gmailId(data.relink_from)) {
      throw new InputError(`Change ${index + 1}: A Gmail id cannot relink a comms row.`);
    }
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

function sourceValueIsNumber(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const sources = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => source && typeof source === "object" && typeof (source as { value?: unknown }).value === "number");
}

function parseDataConflict(actor: Actor, index: number, siteId: string, payload: unknown): ConflictPayload {
  if (isExcludedSite(siteId)) throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  if (actor.kind !== "agent" || actor.id.trim().toLowerCase() !== "muse") {
    throw new InputError(`Change ${index + 1}: Only Muse can record a data conflict.`, 403, "actor");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError(`Change ${index + 1}: That field is not accepted.`, 400, "payload");
  }
  const raw = payload as Record<string, unknown>;
  if (!("at" in raw) || raw.at == null || raw.at === "") {
    throw new InputError(`Change ${index + 1}: at is required`, 400, "at");
  }
  if (sourceValueIsNumber(raw) || typeof raw.value_in_use === "number") {
    throw new InputError(`Change ${index + 1}: value must be a string such as "12345", not a number`, 400, "value");
  }
  const parsed = conflictPayload.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : "payload";
    throw new InputError(`Change ${index + 1}: ${field} is not valid`, 400, field);
  }
  const zoned = parseZonedTimestamp(parsed.data.at);
  if (!zoned) throw new InputError(`Change ${index + 1}: at must be an ISO-8601 time with a zone offset`, 400, "at");
  const sources = parsed.data.sources;
  if (sources[0].value === sources[1].value) {
    throw new InputError(`Change ${index + 1}: the two sources must disagree`, 400, "sources");
  }
  if (parsed.data.value_in_use !== sources[0].value && parsed.data.value_in_use !== sources[1].value) {
    throw new InputError(`Change ${index + 1}: value_in_use must be one of the source values`, 400, "value_in_use");
  }
  const note = parsed.data.resolution_note?.trim() || "";
  if (parsed.data.status === "resolved" && !note) {
    throw new InputError(`Change ${index + 1}: a resolved conflict needs a resolution note`, 400, "resolution_note");
  }
  if (parsed.data.status !== "resolved" && note) {
    throw new InputError(`Change ${index + 1}: a resolution note is only stored when the conflict is resolved`, 400, "resolution_note");
  }
  cleanText(parsed.data.field);
  cleanText(parsed.data.period);
  cleanText(parsed.data.value_in_use);
  cleanText(note);
  for (const source of sources) {
    cleanText(source.value);
    cleanText(source.document);
    cleanText(source.page);
  }
  return {
    subject: parsed.data.subject,
    field: parsed.data.field,
    period: parsed.data.period?.trim() || "",
    sources,
    value_in_use: parsed.data.value_in_use,
    status: parsed.data.status,
    resolution_note: note,
    at: zoned.iso,
  };
}

function assertCommentActor(actor: Actor, index: number, resolved: boolean | undefined): void {
  if (actor.kind === "agent") return;
  if (!actor.role || !canWriteContent(actor.role)) {
    throw new InputError(`Change ${index + 1}: You do not have permission for that.`, 403);
  }
  if (resolved !== undefined && !canDecide(actor.role)) {
    throw new InputError(`Change ${index + 1}: Resolve needs a reviewer.`, 403);
  }
}

function parseNda(actor: Actor, index: number, payload: unknown): NdaPayload {
  if (actor.kind !== "human" || !actor.role || !canWriteContent(actor.role)) {
    throw new InputError(`Change ${index + 1}: You do not have permission for that.`, 403);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError(`Change ${index + 1}: That field is not accepted.`, 400, "payload");
  }
  const raw = payload as Record<string, unknown>;
  const action = raw.action;
  if (action !== "status" && action !== "assign" && action !== "next_step") {
    throw new InputError(`Change ${index + 1}: That NDA action is not accepted.`, 400, "action");
  }
  const atRaw = typeof raw.at === "string" ? raw.at : "";
  const zoned = parseZonedTimestamp(atRaw);
  if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`, 400, "at");
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  const waiting = typeof raw.waiting_on === "string" ? raw.waiting_on.trim() : "";
  const owner = typeof raw.owner === "string" ? raw.owner.trim() : "";
  const next = typeof raw.next_step === "string" ? raw.next_step.trim() : "";
  if (note.length > 400) throw new InputError(`Change ${index + 1}: The note is too long.`, 400, "note");
  if (status.length > 80) throw new InputError(`Change ${index + 1}: That status is too long.`, 400, "status");
  if (waiting.length > 80) throw new InputError(`Change ${index + 1}: That court is too long.`, 400, "waiting_on");
  if (owner.length > 80) throw new InputError(`Change ${index + 1}: That owner is too long.`, 400, "owner");
  if (next.length > 400) throw new InputError(`Change ${index + 1}: That next step is too long.`, 400, "next_step");
  cleanText(note);
  cleanText(status);
  cleanText(waiting);
  cleanText(owner);
  cleanText(next);
  if (action === "status" && !status) throw new InputError(`Change ${index + 1}: Choose a status.`, 400, "status");
  if (action === "status" && !note) throw new InputError(`Change ${index + 1}: A status change needs a note.`, 400, "note");
  if (action === "assign" && !owner) throw new InputError(`Change ${index + 1}: Choose an owner.`, 400, "owner");
  if (action === "next_step" && !next) throw new InputError(`Change ${index + 1}: Write the next step.`, 400, "next_step");
  return { action, status, waiting_on: waiting, owner, next_step: next, note, at: zoned.iso };
}

function parseComment(actor: Actor, index: number, siteId: string, expectedVersion: number, payload: unknown): CommentPayload {
  if (isExcludedSite(siteId)) throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError(`Change ${index + 1}: That field is not accepted.`, 400, "payload");
  }
  const raw = payload as Record<string, unknown>;
  if (!("at" in raw) || raw.at == null || raw.at === "") {
    throw new InputError(`Change ${index + 1}: at is required`, 400, "at");
  }
  const parsed = commentPayload.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : "payload";
    throw new InputError(`Change ${index + 1}: ${field} is not valid`, 400, field);
  }
  const zoned = parseZonedTimestamp(parsed.data.at);
  if (!zoned) throw new InputError(`Change ${index + 1}: at must be an ISO-8601 time with a zone offset`, 400, "at");
  const creating = expectedVersion === 0;
  if (creating && parsed.data.resolved) throw new InputError(`Change ${index + 1}: Resolve the thread after it exists.`, 400, "resolved");
  assertCommentActor(actor, index, parsed.data.resolved);
  if (parsed.data.parent_id && parsed.data.anchor) {
    throw new InputError(`Change ${index + 1}: A reply stays on the thread it answers.`, 400, "parent_id");
  }
  if (parsed.data.parent_id && !/^NT-\d{4,}$/.test(parsed.data.parent_id)) {
    throw new InputError(`Change ${index + 1}: That thread id is not valid.`, 400, "parent_id");
  }
  if (creating && !parsed.data.parent_id && !parsed.data.anchor) {
    throw new InputError(`Change ${index + 1}: A comment needs a P&L cell, a P&L line, a lot, or an NDA.`, 400, "anchor");
  }
  if (!creating && (parsed.data.anchor || parsed.data.parent_id)) {
    throw new InputError(`Change ${index + 1}: That field is not accepted.`, 400, "anchor");
  }
  const anchor = parsed.data.anchor;
  if (anchor?.type === "space" && !anchor.space_id) throw new InputError(`Change ${index + 1}: A lot comment needs the lot id.`, 400, "space_id");
  if (anchor?.type === "nda" && !NDA_ID.test((anchor.line || "").toUpperCase())) {
    throw new InputError(`Change ${index + 1}: An NDA comment needs the agreement id.`, 400, "line");
  }
  if (anchor?.type === "nda" && siteId.toUpperCase() !== (anchor.line || "").toUpperCase()) {
    throw new InputError(`Change ${index + 1}: An NDA comment stays on that agreement.`, 400, "site_id");
  }
  if (anchor && anchor.type !== "space" && anchor.type !== "nda" && !isCommentLine(anchor.line || "")) {
    throw new InputError(`Change ${index + 1}: That line is not in the chart of accounts.`, 400, "line");
  }
  if (anchor?.type === "pnl_cell" && !anchor.period) throw new InputError(`Change ${index + 1}: A cell comment needs a period.`, 400, "period");
  if (anchor?.type === "pnl_line" && anchor.period) throw new InputError(`Change ${index + 1}: A line comment does not take a period.`, 400, "period");
  let mentions: string[] | undefined;
  if (parsed.data.mentions) {
    try {
      mentions = parseMentionIds(parsed.data.mentions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Choose an account from the list.";
      throw new InputError(`Change ${index + 1}: ${message}`, 400, "mentions");
    }
  }
  if (parsed.data.body !== undefined) cleanText(parsed.data.body);
  const body = parsed.data.body?.trim();
  if (creating && !body) throw new InputError(`Change ${index + 1}: Add a comment.`, 400, "body");
  return {
    ...(anchor
      ? {
          anchor: {
            type: anchor.type,
            line: anchor.type === "space" ? "" : anchor.type === "nda" ? (anchor.line || "").toUpperCase() : anchor.line || "",
            period: anchor.type === "pnl_cell" ? anchor.period || "" : "",
            space_id: anchor.type === "space" ? anchor.space_id || "" : "",
          },
        }
      : {}),
    ...(parsed.data.parent_id ? { parent_id: parsed.data.parent_id } : {}),
    ...(body ? { body } : {}),
    ...(parsed.data.tag ? { tag: parsed.data.tag } : {}),
    ...(mentions ? { mentions } : {}),
    ...(parsed.data.resolved === undefined ? {} : { resolved: parsed.data.resolved }),
    at: zoned.iso,
  };
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

function assertStageActor(
  actor: Actor,
  index: number,
  stage: string,
  reason: string | undefined,
  receipt: { document: string; received_at: string; comms_id?: string; email_date?: string } | undefined,
): PackageReceipt | undefined {
  // R-097. A drop is a reviewer decision with a reason. Agents cannot make it,
  // and nothing in the capture path may set Dropped on its own.
  if (stage === "Dropped" && (actor.kind !== "human" || actor.id === "system")) {
    throw new InputError(`Change ${index + 1}: An agent cannot set Stage to Dropped.`, 403);
  }
  if (stage === "Dropped" && !reason?.trim()) {
    throw new InputError(`Change ${index + 1}: Stage Dropped needs a reason.`);
  }
  if (actor.id === "system") return undefined;
  if (actor.kind === "agent") return normalizeAgentReceipt(index, stage, receipt);
  if (actor.kind !== "human" || !actor.role || !canDecide(actor.role)) {
    throw new InputError(`Change ${index + 1}: Stage changes need a reviewer.`, 403);
  }
  return undefined;
}

/** The only agent stage write: Desk screen to Financial screen, with a package receipt. */
function normalizeAgentReceipt(
  index: number,
  stage: string,
  receipt: { document: string; received_at: string; comms_id?: string; email_date?: string } | undefined,
): PackageReceipt {
  if (stage !== "2 Financial screen") {
    throw new InputError(`Change ${index + 1}: An agent can only move a site from Desk screen to Financial screen.`, 403);
  }
  if (!receipt?.document?.trim() || !receipt.received_at?.trim() || (!receipt.comms_id?.trim() && !receipt.email_date?.trim())) {
    throw new InputError(
      `Change ${index + 1}: A package receipt needs a document, the time it was received, and a comms id or an email date.`,
      400,
    );
  }
  const document = receipt.document.trim();
  if (gmailId(document) || /mail\.google\.com/i.test(document)) {
    throw new InputError(`Change ${index + 1}: A package receipt cites a Drive file id or a file name, not a Gmail id.`, 400);
  }
  const zoned = parseZonedTimestamp(receipt.received_at);
  if (!zoned) throw new InputError(`Change ${index + 1}: Use an ISO-8601 time with a zone offset.`, 400);
  const comms = receipt.comms_id?.trim() || "";
  const email = receipt.email_date?.trim() || "";
  if (comms && (gmailId(comms) || !COMMS_ID.test(comms))) {
    throw new InputError(`Change ${index + 1}: The comms id is a CM- id, not a Gmail id.`, 400);
  }
  if (email && (gmailId(email) || !realDate(email))) {
    throw new InputError(`Change ${index + 1}: The email date is a YYYY-MM-DD label, not a Gmail id.`, 400);
  }
  return {
    document,
    received_at: zoned.iso,
    ...(comms ? { comms_id: comms } : {}),
    ...(email ? { email_date: email } : {}),
  };
}

export function receiptCitation(receipt: PackageReceipt): string {
  const parts = [receipt.document, receipt.received_at];
  if (receipt.comms_id) parts.push(receipt.comms_id);
  if (receipt.email_date) parts.push(receipt.email_date);
  return parts.join("; ").slice(0, 500);
}

export function isAgentStageDecision(payload: Record<string, unknown>): boolean {
  return payload.decision_source === "agent" && String(payload.stage || "") === "2 Financial screen";
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

function withServiceAreaToken(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const raw = { ...(payload as Record<string, unknown>) };
  if (typeof raw.service_area_class !== "string") return raw;
  const token = serviceAreaToken(raw.service_area_class);
  if (token == null) return raw;
  if (!token) delete raw.service_area_class;
  else raw.service_area_class = token;
  return raw;
}

function parseSite(actor: Actor, index: number, expectedVersion: number, payload: unknown, mint = false): SitePayload {
  payload = withServiceAreaToken(payload);
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
  const segmentInput = data.segment ?? data.segment_group;
  if (data.segment !== undefined && data.segment_group !== undefined && segmentKey(data.segment) !== segmentKey(data.segment_group)) {
    throw new InputError(`Change ${index + 1}: segment and segment_group have to match.`);
  }
  if (segmentInput !== undefined) {
    const label = segmentLabel(segmentInput);
    if (!label) throw new InputError(`Change ${index + 1}: Segment must be one of the known segment groups.`);
    fields.category = label;
    if (expectedVersion === 0 && data.sources && !data.sources.category) {
      data.sources.category = data.sources.segment || data.sources.segment_group || "";
    }
  }
  put("broker", data.broker);
  put("firm", data.firm);
  if (data.listing_url && listingSearchPage(data.listing_url)) {
    throw new InputError(`Change ${index + 1}: ${LISTING_SEARCH_MESSAGE}`, 400, "listing_url");
  }
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
    if (key === "score" || key.endsWith("_points")) {
      throw new InputError(`Change ${index + 1}: Score cells stay in the workbook.`);
    }
    if (!FACT_FIELDS.includes(key as (typeof FACT_FIELDS)[number]) && key !== POWER_RATING) {
      throw new InputError(`Change ${index + 1}: That field is not accepted.`);
    }
    facts[key] = value == null ? "" : canonicalFact(value);
  }
  for (const key of QUICK_LUBE_FIELDS) {
    if (!(key in facts)) continue;
    const value = facts[key] || "";
    if (!value) {
      delete facts[key];
      continue;
    }
    const problem = quickLubeValueProblem(key, value);
    if (problem) throw new InputError(`Change ${index + 1}: ${problem}`);
    if (key === "source_tag") continue;
    const source = data.sources?.[key]?.trim() || "";
    if (!source) throw new InputError(`Change ${index + 1}: ${key} needs a source.`);
  }
  if (data.folder_url !== undefined) facts.folder_url = data.folder_url;
  if (fields.category && (data.segment !== undefined || data.segment_group !== undefined)) facts.segment_group = fields.category;
  const topLevel = data as Record<string, unknown>;
  for (const key of TOP_LEVEL_FACT_FIELDS) {
    const value = topLevel[key];
    if (value === undefined || facts[key] !== undefined) continue;
    facts[key] = value == null ? "" : canonicalFact(value as string | number);
  }
  if (facts.folder_url) {
    const problem = driveFolderProblem(facts.folder_url);
    if (problem) throw new InputError(`Change ${index + 1}: ${problem}`, 400, "folder_url");
  }
  if (!Object.keys(fields).length && !Object.keys(facts).length) throw new InputError(`Change ${index + 1}: Add a field to change.`);
  assertSiteOwnership(actor, index, new Set([...Object.keys(fields), ...Object.keys(facts)]), data.service_area_class, mint);
  for (const key of Object.keys(data.sources || {})) {
    const identitySource = mint && (CREATE_IDENTITY_FIELDS as readonly string[]).includes(key);
    const indieIdentity = !mint && actor.kind === "agent" && actor.id === "indie" && (INDIE_IDENTITY_FIELDS as readonly string[]).includes(key);
    const quickSource = (QUICK_LUBE_FIELDS as readonly string[]).includes(key);
    const roadSource = key === "trade_aadt_road";
    const segmentSource = key === "segment" || key === "segment_group" || key === "category";
    if (!identitySource && !indieIdentity && !quickSource && !roadSource && !segmentSource && !NUMERIC_FACT_FIELDS.includes(key as (typeof NUMERIC_FACT_FIELDS)[number])) {
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
  const road = facts.trade_aadt_road?.trim() || "";
  if (road) {
    const source = data.sources?.trade_aadt_road?.trim() || "";
    if (!source) throw new InputError(`Change ${index + 1}: trade_aadt_road needs a source.`);
    cleanText(source);
    sources.trade_aadt_road = source;
  }
  for (const field of QUICK_LUBE_FIELDS) {
    if (!facts[field]) continue;
    const source = data.sources?.[field]?.trim() || "";
    if (!source) continue;
    cleanText(source);
    sources[field] = source;
  }
  if (!mint && actor.kind === "agent" && actor.id === "indie" && fields.category && (data.segment !== undefined || data.segment_group !== undefined || data.category !== undefined)) {
    const source = data.sources?.segment?.trim() || data.sources?.segment_group?.trim() || data.sources?.category?.trim() || "";
    if (!source) throw new InputError(`Change ${index + 1}: segment needs a source.`);
    cleanText(source);
    sources.segment = source;
  }
  if (!mint && actor.kind === "agent" && actor.id === "indie") {
    for (const field of INDIE_IDENTITY_FIELDS) {
      const value = fields[field as SiteField];
      if (value === undefined || value === "") continue;
      const source = data.sources?.[field]?.trim() || "";
      if (!source) throw new InputError(`Change ${index + 1}: ${field} needs a source.`);
      cleanText(source);
      sources[field] = source;
    }
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
  const requireIdentitySources = () => {
    for (const field of CREATE_IDENTITY_FIELDS) {
      const value = fields[field as SiteField];
      if (value === undefined || value === "") continue;
      const source = data.sources?.[field]?.trim() || "";
      if (!source) throw new InputError(`Change ${index + 1}: ${field} needs a source.`);
      cleanText(source);
      sources[field] = source;
    }
  };
  let siteMint: SiteMint | undefined;
  if (mint) {
    if (data.kind === "universe") {
      const category = fields.category || "";
      if (!(UNIVERSE_CREATE_CATEGORIES as readonly string[]).includes(category)) {
        throw new InputError(`Change ${index + 1}: A universe row needs a category of ${UNIVERSE_CREATE_CATEGORIES.join(" or ")}.`);
      }
      if (!normalizeAddress(fields.address || "")) {
        throw new InputError(`Change ${index + 1}: A universe row needs an address.`);
      }
      const listing = (data.listing_id || "").trim();
      if (listing) throw new InputError(`Change ${index + 1}: A universe row does not take a listing id.`);
      requireIdentitySources();
      siteMint = { kind: "universe", listing_id: "" };
    } else {
      if (data.kind !== "pipeline" && data.kind !== "land") {
        throw new InputError(`Change ${index + 1}: A new site needs a kind of pipeline or land.`);
      }
      const listing = (data.listing_id || "").trim();
      if (!LISTING_ID.test(listing)) throw new InputError(`Change ${index + 1}: A new site needs a listing id (L-).`);
      if (gmailId(listing)) throw new InputError(`Change ${index + 1}: A Gmail id cannot be a listing id.`);
      requireIdentitySources();
      siteMint = { kind: data.kind, listing_id: listing };
    }
  }
  return { fields, sources, facts, photos: data.photo_refs ? photos : undefined, ...(siteMint ? { mint: siteMint } : {}) };
}

function assertSiteOwnership(actor: Actor, index: number, touched: Set<string>, serviceArea: string | undefined, mint: boolean): void {
  if (actor.kind !== "agent") return;
  if (serviceArea === "edge_legacy" || serviceArea === "unknown") {
    throw new InputError(`Change ${index + 1}: An agent cannot set that service area.`);
  }
  const allowed = new Set<string>(actor.id === "indie" ? [...PHOTO_FIELDS, ...CHECK_FIELDS, ...TRADE_FIELDS] : actor.id === "muse" ? [...MUSE_FIELDS] : []);
  const createAllowed = mint ? new Set<string>([...CREATE_IDENTITY_FIELDS, "segment", "segment_group"]) : new Set<string>();
  const indieUpdate = new Set<string>(actor.id === "indie" && !mint ? ["folder_url", "category", "segment", "segment_group", ...INDIE_IDENTITY_FIELDS] : []);
  for (const key of touched) {
    if (createAllowed.has(key) || indieUpdate.has(key)) continue;
    if ((SCHEMA_FIELDS as readonly string[]).includes(key) || !allowed.has(key)) {
      throw new InputError(`Change ${index + 1}: An agent cannot write that field.`);
    }
  }
}

/** A Drive folder link, or the folder id by itself. */
export function driveFolderProblem(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/^[A-Za-z0-9_-]{10,80}$/.test(text)) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "folder_url must be a Drive folder URL or folder id.";
  }
  const id = url.searchParams.get("id") || "";
  const folder = /\/folders\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] || "";
  if (url.protocol === "https:" && url.hostname === "drive.google.com" && (folder || id)) return "";
  return "folder_url must be a Drive folder URL or folder id.";
}
