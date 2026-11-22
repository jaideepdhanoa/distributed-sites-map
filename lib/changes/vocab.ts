/** Workbook labels the write API accepts. Spelling follows the existing code. */

export const MARKETS = ["PHX", "LAS", "MIA", "SNA"] as const;

export type Market = (typeof MARKETS)[number];

/**
 * Workbook service-area tokens. Import and the write API store them unchanged.
 * unknown and edge_legacy are not rewritten into another class.
 */
export const SERVICE_AREA_CLASSES = ["inside", "near_0_5", "near_5_10", "outside", "unknown", "edge_legacy"] as const;

export type ServiceAreaClass = (typeof SERVICE_AREA_CLASSES)[number];

/** Stages a person or an agent may write. */
export const CANONICAL_STAGES = [
  "1 Desk screen",
  "2 Financial screen",
  "3 Site checks",
  "4 Offer and close",
  "Dropped",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

/**
 * Older workbook labels. The import stores them unchanged and the diff
 * lists them. The write API does not accept them.
 */
export const LEGACY_STAGES = [
  "Financial screen",
  "Off-market target",
  "Off market (no lead)",
  "Sourced",
] as const;

export type LegacyStage = (typeof LEGACY_STAGES)[number];

export const STAGES = [...CANONICAL_STAGES, ...LEGACY_STAGES] as const;

export type StageName = (typeof STAGES)[number];

/** Workbook comms directions the import stores unchanged. The API accepts in and out. */
export const WORKBOOK_DIRECTIONS = ["in", "out", "internal"] as const;

/** Map-visible activity types from the Activity tab reader. */
export const ACTIVITY_TYPES = [
  "listing",
  "brochure",
  "om",
  "financials",
  "photos",
  "legal",
  "doc",
  "visit",
  "stage",
  "capture",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const COMMS_DIRECTIONS = ["in", "out"] as const;

export type CommsDirection = (typeof COMMS_DIRECTIONS)[number];

export const ENTITY_TYPES = ["stage", "activity", "comms", "site", "pnl_line", "site_space", "tag", "data_conflict", "comment", "nda"] as const;

/** Categories the map already ships. The workbook Segment cell is freer text and is not this list. */
export const BUSINESS_TYPES = [
  "Car wash",
  "Quick lube",
  "Auto repair",
  "Tire and lube",
  "Gas station",
  "Yard or lot",
  "Storage",
  "Land",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type EntityType = (typeof ENTITY_TYPES)[number];

export const SITE_ID = /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/;

/** An NDA register id, such as NDA-001. */
export const NDA_ID = /^NDA-\d{3,}$/;

/** A listing id on a comms row, such as L-441. */
export const LISTING_ID = /^L-\d+$/;

/** A comms row may name a site, name a listing, or name neither. */
export function commsSiteAllowed(value: string): boolean {
  return value === "" || SITE_ID.test(value) || LISTING_ID.test(value);
}

export const COMMS_FIELDS = [
  "site_ids",
  "direction",
  "at",
  "at_text",
  "person",
  "firm",
  "channel",
  "summary",
  "subject",
  "thread_id",
  "link",
  "asks_made",
  "asks_answered",
  "attachments",
  "state_changes",
  "workbook_source",
  "message_id",
] as const;

export type CommsField = (typeof COMMS_FIELDS)[number];
