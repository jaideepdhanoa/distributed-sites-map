import type { GeoFeature } from "./types";

/** Same mile approximation the map has always used for these circles. */
const MILES_PER_DEGREE = 69;
const STEPS = 64;

export const RING_MILES = [5, 10] as const;

export type LngLatBounds = { west: number; south: number; east: number; north: number };

export type RingFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { miles: number; depot: string };
};

export function ringPoint(lon: number, lat: number, miles: number, step: number): [number, number] {
  const angle = (step / STEPS) * Math.PI * 2;
  const latRad = (lat * Math.PI) / 180;
  const cos = Math.cos(latRad) || 1e-6;
  return [lon + (miles / (MILES_PER_DEGREE * cos)) * Math.cos(angle), lat + (miles / MILES_PER_DEGREE) * Math.sin(angle)];
}

export function ringLine(lon: number, lat: number, miles: number): [number, number][] {
  return Array.from({ length: STEPS + 1 }, (_, index) => ringPoint(lon, lat, miles, index));
}

function depotCoord(depot: GeoFeature): [number, number] | null {
  if (!depot.geometry || depot.geometry.type !== "Point" || !Array.isArray(depot.geometry.coordinates)) return null;
  const [lon, lat] = depot.geometry.coordinates as number[];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/** Closed lines, not polygons, so a tile clip cannot draw a false straight edge. */
export function depotRingFeatures(depots: GeoFeature[]): RingFeature[] {
  const features: RingFeature[] = [];
  for (const depot of depots) {
    const coords = depotCoord(depot);
    if (!coords) continue;
    const place = String(depot.properties.address || depot.properties.id || "this depot");
    for (const miles of RING_MILES) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ringLine(coords[0], coords[1], miles) },
        properties: { miles, depot: place },
      });
    }
  }
  return features;
}

function pointInside(point: [number, number], box: LngLatBounds) {
  return point[0] >= box.west && point[0] <= box.east && point[1] >= box.south && point[1] <= box.north;
}

function crosses(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const d1 = abx * (cy - ay) - aby * (cx - ax);
  const d2 = abx * (dy - ay) - aby * (dx - ax);
  const cdx = dx - cx;
  const cdy = dy - cy;
  const d3 = cdx * (ay - cy) - cdy * (ax - cx);
  const d4 = cdx * (by - cy) - cdy * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segmentHits(a: [number, number], b: [number, number], box: LngLatBounds) {
  if (pointInside(a, box) || pointInside(b, box)) return true;
  const edges: [[number, number], [number, number]][] = [
    [[box.west, box.south], [box.east, box.south]],
    [[box.east, box.south], [box.east, box.north]],
    [[box.east, box.north], [box.west, box.north]],
    [[box.west, box.north], [box.west, box.south]],
  ];
  return edges.some(([c, d]) => crosses(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]));
}

export function lineMeetsBounds(line: [number, number][], box: LngLatBounds) {
  for (let i = 0; i < line.length - 1; i += 1) {
    if (segmentHits(line[i], line[i + 1], box)) return true;
  }
  return false;
}

/** True when a 5- or 10-mile ring stroke actually crosses the view. */
export function ringStrokeMeets(depots: GeoFeature[], box: LngLatBounds) {
  return depotRingFeatures(depots).some((feature) => lineMeetsBounds(feature.geometry.coordinates, box));
}

function milesBetween(a: [number, number], b: [number, number]) {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (a[0] - b[0]) * MILES_PER_DEGREE * Math.cos(lat);
  const dy = (a[1] - b[1]) * MILES_PER_DEGREE;
  return Math.hypot(dx, dy);
}

/**
 * Points to frame when the strokes are outside the view.
 * Depots inside the view win. Otherwise the depot nearest the center.
 */
export function ringFrameCoordinates(depots: GeoFeature[], center: [number, number], box: LngLatBounds): [number, number][] {
  const placed = depots.flatMap((depot) => {
    const coords = depotCoord(depot);
    return coords ? [coords] : [];
  });
  if (!placed.length) return [];
  const inside = placed.filter((point) => pointInside(point, box));
  const chosen = inside.length ? inside : [placed.reduce((best, point) => (milesBetween(point, center) < milesBetween(best, center) ? point : best))];
  return chosen.flatMap((point) => RING_MILES.flatMap((miles) => ringLine(point[0], point[1], miles)));
}
