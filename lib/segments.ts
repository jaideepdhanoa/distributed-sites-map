/** The workbook segment groups in scripts/vocabulary.py. Segment and segment group stay the same label. */

export const SEGMENT_GROUPS = [
  "car wash",
  "auto service",
  "auto repair",
  "general auto repair",
  "tire and lube",
  "tire and light auto service",
  "gas station",
  "c-store",
  "convenience store",
  "quick lube",
  "land",
  "land only",
  "vacant",
  "entitled",
  "yard or lot",
  "storage",
  "other",
] as const;

const SEGMENT_LABELS: Record<(typeof SEGMENT_GROUPS)[number], string> = {
  "car wash": "Car wash",
  "auto service": "Auto service",
  "auto repair": "Auto repair",
  "general auto repair": "General auto repair",
  "tire and lube": "Tire and lube",
  "tire and light auto service": "Tire and light auto service",
  "gas station": "Gas station",
  "c-store": "C-store",
  "convenience store": "Convenience store",
  "quick lube": "Quick lube",
  land: "Land",
  "land only": "Land only",
  vacant: "Vacant",
  entitled: "Entitled",
  "yard or lot": "Yard or lot",
  storage: "Storage",
  other: "Other",
};

export function segmentKey(value: string | null | undefined): string {
  return String(value || "").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The label stored on the site and copied to the Segment cell. Blank when the group is unknown. */
export function segmentLabel(value: string | null | undefined): string {
  const key = segmentKey(value);
  if (!key || !SEGMENT_GROUPS.includes(key as (typeof SEGMENT_GROUPS)[number])) return "";
  return SEGMENT_LABELS[key as (typeof SEGMENT_GROUPS)[number]];
}

export function knownSegment(value: string | null | undefined): boolean {
  return Boolean(segmentLabel(value));
}
