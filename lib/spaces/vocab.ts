import { SITE_ID } from "@/lib/changes/vocab";

/**
 * Space types for a marked area on a site aerial.
 * Short noun phrases and snake_case ids, the same tone as a tag vocabulary:
 * a label a person would say out loud. Bundle E's tag list is not in this
 * tree; keep new types in this constant so the two lists can merge later.
 */
export const SPACE_TYPES = [
  { id: "excess_parking", label: "Excess parking" },
  { id: "vacuum_row", label: "Vacuum row to convert" },
  { id: "unused_pad", label: "Unused pad" },
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number]["id"];

export const SPACE_TYPE_IDS = SPACE_TYPES.map((item) => item.id) as [SpaceType, ...SpaceType[]];

export function spaceTypeLabel(type: SpaceType): string {
  return SPACE_TYPES.find((item) => item.id === type)?.label || type;
}

/**
 * How an estimated count is packed into the rectangle.
 * Length runs along the parking row. Width is the depth, aisle included.
 * 90° uses the 24 ft aisle from the brief. 60° and 45° use a one-way aisle
 * (18 ft and 14 ft). Pull-through bays are the drive path, so they have no
 * separate aisle.
 */
export const SPACE_LAYOUTS = [
  { id: "stalls_90", label: "90° stalls", unit: "stall" },
  { id: "stalls_60", label: "60° stalls", unit: "stall" },
  { id: "stalls_45", label: "45° stalls", unit: "stall" },
  { id: "pull_through", label: "Pull-through chargers", unit: "bay" },
] as const;

export type SpaceLayout = (typeof SPACE_LAYOUTS)[number]["id"];

export const SPACE_LAYOUT_IDS = SPACE_LAYOUTS.map((item) => item.id) as [SpaceLayout, ...SpaceLayout[]];

export function spaceLayout(id: SpaceLayout) {
  const layout = SPACE_LAYOUTS.find((item) => item.id === id);
  if (!layout) throw new Error("Unknown space layout");
  return layout;
}

/** A pipeline deal id, or a universe site id in PHX, LAS, MIA, or SNA. */
const UNIVERSE_SITE = /^(?:PHX|LAS|MIA|SNA)-U\d{1,6}$/;

export function spaceSiteAllowed(siteId: string): boolean {
  return SITE_ID.test(siteId) || UNIVERSE_SITE.test(siteId);
}

export const SPACE_ID = /^SS-\d{4,}$/;

export type SpaceStatus = "estimated" | "verified";
