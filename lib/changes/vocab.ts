/** Workbook labels the write API accepts. Spelling follows the existing code. */

export const MARKETS = ["PHX", "LAS", "MIA", "SNA"] as const;

export type Market = (typeof MARKETS)[number];

/** R-099 display labels. Legacy Edge is not a class a new write may set. */
export const SERVICE_AREA_CLASSES = ["Inside", "Near 0-5", "Near 5-10", "Outside", "Unknown"] as const;

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
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const COMMS_DIRECTIONS = ["in", "out"] as const;

export type CommsDirection = (typeof COMMS_DIRECTIONS)[number];

export const ENTITY_TYPES = ["stage", "activity", "comms"] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const SITE_ID = /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/;

export const COMMS_FIELDS = [
  "site_ids",
  "direction",
  "at",
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
