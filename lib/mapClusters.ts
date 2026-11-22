/**
 * City cameras sit around zoom 10–11. Below that, nearby pins share one bubble.
 * At this zoom and closer, each pin is drawn on its own again.
 */
export const PIN_SPLIT_ZOOM = 10;

/** MapLibre clusters at integer zooms up to this value, so zoom 10 and above stay unclustered. */
export const CLUSTER_MAX_ZOOM = PIN_SPLIT_ZOOM - 1;

/** Screen pixels. Wider than a pin, so leftover individual pins do not stack. */
export const CLUSTER_RADIUS = 72;

/** Phone bubbles are at least a 44px target. The radius is half of that. */
export const PHONE_BUBBLE_PX = 44;

export const CLUSTER_SOURCE = {
  cluster: true,
  clusterRadius: CLUSTER_RADIUS,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
} as const;

const CHIP_LIMIT = 28;

/** The bubble's only label: a short count, never a sentence. */
export function clusterBubbleLabel(count: number): string {
  const n = Math.max(0, Math.round(Number.isFinite(count) ? count : 0));
  if (n < 1000) return String(n);
  const scaled = n / 1000;
  const text = scaled >= 10 ? `${Math.round(scaled)}k` : `${(Math.round(scaled * 10) / 10).toFixed(1)}k`.replace(/\.0k$/, "k");
  return text.length <= CHIP_LIMIT ? text : `${Math.round(scaled)}k`;
}

export function phoneBubbleRadius(): number {
  return PHONE_BUBBLE_PX / 2;
}

export type PinFeature = {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
};

function sameId(properties: Record<string, unknown> | null | undefined, id: string) {
  if (!properties) return false;
  return properties.site_id === id || properties.deal_id === id || properties.listing_id === id;
}

/**
 * One feature per place. Pipeline counts deals. Universe counts sites.
 * The county-status diamonds are not added on top of the stage pins.
 */
export function countedPins(input: { group: "deals" | "sites"; sites: PinFeature[]; offMarket: PinFeature[]; deals: PinFeature[] }): PinFeature[] {
  const rows = input.group === "deals" ? input.deals : [...input.sites, ...input.offMarket];
  const seen = new Set<string>();
  const counted: PinFeature[] = [];
  for (const feature of rows) {
    if (!feature.geometry || feature.geometry.type !== "Point") continue;
    const id = String(feature.properties?.deal_id || feature.properties?.site_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    counted.push(feature);
  }
  return counted;
}

/** The deep-linked record stays a single pin. Everything else can share a bubble. */
export function takeSolo<T extends PinFeature>(features: T[], id: string | null | undefined): { grouped: T[]; solo: T | null } {
  if (!id) return { grouped: features, solo: null };
  let solo: T | null = null;
  const grouped: T[] = [];
  for (const feature of features) {
    if (!solo && feature.geometry && sameId(feature.properties, id)) solo = feature;
    else grouped.push(feature);
  }
  return { grouped, solo };
}

export function leafBounds(leaves: PinFeature[]): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let count = 0;
  for (const leaf of leaves) {
    const coords = leaf.geometry?.type === "Point" && Array.isArray(leaf.geometry.coordinates) ? leaf.geometry.coordinates : null;
    if (!coords) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    count += 1;
  }
  if (!count) return null;
  return [[west, south], [east, north]];
}

/** True when two pin centers are closer than a pin is wide. */
export function pinsOverlap(points: { x: number; y: number }[], minGap: number): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.hypot(dx, dy) < minGap) return true;
    }
  }
  return false;
}

/** A bubble center plus its radius stays above the phone sheet. */
export function bubbleClearsSheet(centerY: number, radius: number, sheetTop: number): boolean {
  return centerY + radius <= sheetTop + 0.5;
}
