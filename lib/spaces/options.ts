import { geodesicInverse } from "./measure";
import { estimateEdgeRow, estimateSlots } from "./slots";
import type { SpaceLayout } from "./vocab";

export const options = {
  retain: "Keep operations",
  outdoor: "Convert outdoor space",
  bays: "Convert bays",
} as const;
export type Option = keyof typeof options;
export type Point = [number, number];
export type Bounds = [number, number, number, number];
export const kinds = {
  ground: { option: "retain", label: "Undeveloped ground", protect: "Trace the part that could be paved while preserving existing operations.", check: "Verify buildable depth, landscape buffers, drainage, utilities and the cost of paving." },
  pad: { option: "retain", label: "Open pad", protect: "Keep access, drainage and equipment clearance.", check: "Measure the net pad and route from the street. Confirm control of the land." },
  parking: { option: "outdoor", label: "Parking", protect: "Keep required parking, accessible spaces and travel aisles.", check: "Count parked cars at the busiest hour and confirm the parking rights. Check whether an after-hours layout serves the fleet." },
  vacuum: { option: "outdoor", label: "Vacuum row", protect: "Keep the remaining vacuum positions, tunnel queue and bypass.", check: "Measure the row and bypass. Check peak vacuum demand and contribution lost from removing positions." },
  apron: { option: "outdoor", label: "Working apron", protect: "Keep entry, exit, stacking and swept paths clear.", check: "Walk the site at peak demand and trace the vehicle path. Establish which hours this strip can be dedicated." },
  storage: { option: "outdoor", label: "Vehicle storage", protect: "Retain access for tenant, inventory and service vehicles.", check: "Confirm the tenant's rights, replacement storage cost and truck turning area." },
  bay: { option: "bays", label: "Service or wash bay", protect: "Retain service access and account for displaced servicing work.", check: "Obtain the interior plan, pits, clear height and approach dimensions. Compare lost shop contribution and fleet-service value." },
  clear: { option: null, label: "Keep clear", protect: "", check: "" },
} as const;
export type Zone = { kind: keyof typeof kinds; label: string; points: Point[]; check?: string; fitHold?: "footprint" | "aisle" };
export type Aerial = { kind?: "site-plan" | "site-photo"; metersPerPixel?: number; documentUrl?: string; id: string; src: string; source: string; date: string; width: number; height: number; bounds?: Bounds };
export type Assessment = {
  inventory?: import("./parcelLayout").Inventory; parcelCases?: import("./parcelLayout").ParcelCase[];
  status: "reviewed" | "hold" | "needs-image"; summary: string; recorded: number | null;
  baseline: "recorded" | "unconfirmed" | "conflict"; zones: Zone[]; segment: string;
  cohort: "active" | "off-market" | "dropped"; evidence?: { label:string; url:string; option:Option }[]; revision: string; image?: Aerial;
};

export function optionZones(row: Assessment, option: Option) {
  return row.status === "reviewed" ? row.zones.filter(z => kinds[z.kind].option === option) : [];
}
export function firstOption(row: Assessment): Option {
  return (row.status === "reviewed" && row.zones.length && kinds[row.zones[0].kind].option) || "retain";
}
export function recordedFit(row: Assessment) {
  if (row.baseline === "conflict") return "Recorded zero conflicts with an unmeasured review";
  if (row.baseline === "unconfirmed") return "Recorded zero · measurement basis missing";
  if (row.recorded === null) return "No recorded stall count";
  return row.recorded + (row.recorded === 1 ? " stall" : " stalls") + " in the earlier screen";
}
export function worldPoint([x, y]: Point, [west, north, east, south]: Bounds): Point {
  return [west + (east - west) * x / 100, north + (south - north) * y / 100];
}
export function fitRange(length: number, depth: number, reserve: number, layout: SpaceLayout) {
  if (![length, depth, reserve].every(Number.isFinite) || length <= 0 || depth <= 0 || reserve < 0 || reserve > Math.min(length, depth)) return null;
  return [estimateSlots(length - reserve, depth - reserve, layout), estimateSlots(length, depth, layout)] as const;
}
export function edgeFitRange(length: number, depth: number, reserve: number, aisle: number, layout: SpaceLayout) {
  if (layout === "pull_through" || !Number.isFinite(aisle) || aisle < 0 || !fitRange(length, depth, reserve, layout)) return null;
  return [estimateEdgeRow(length - reserve, depth - reserve, aisle, layout), estimateEdgeRow(length, depth, aisle, layout)] as const;
}
export function threshold(low: number, high: number) {
  if (high < 4) return "Below four in both cases";
  return low >= 4 ? "Four fit in both cases" : "The fourth stall depends on clearance";
}
export function conversionReturn(investment: number, charging: number, displaced: number, ongoing: number) {
  if (![investment, charging, displaced, ongoing].every(n => Number.isFinite(n) && n >= 0)) return null;
  const net = charging - displaced - ongoing;
  return { net, years: net > 0 ? investment / net : null };
}

/** A rectangular outdoor footprint needs a map registration or a source scale bar. */
export function outlineDimensions(zone: Zone | undefined, bounds?: Bounds, image?: Pick<Aerial,"width"|"height"|"metersPerPixel">): [number, number] | null {
  if ((!bounds && !image?.metersPerPixel) || !zone || zone.fitHold === "footprint" || zone.kind === "bay" || zone.kind === "ground" || zone.kind === "clear" || zone.points.length !== 4) return null;
  const edges = zone.points.map((point, i) => {
    const next = zone.points[(i + 1) % 4];
    if (bounds) {
      const [lng, lat] = worldPoint(point, bounds), [nextLng, nextLat] = worldPoint(next, bounds);
      return geodesicInverse({ lng, lat }, { lng: nextLng, lat: nextLat });
    }
    const dx = (next[0] - point[0]) * image!.width / 100;
    const dy = (next[1] - point[1]) * image!.height / 100;
    return { meters: Math.hypot(dx,dy) * image!.metersPerPixel!, bearingDeg: Math.atan2(dx,-dy) * 180 / Math.PI };
  });
  if (edges.some((edge, i) => {
    const difference = Math.abs(((edge.bearingDeg - edges[(i + 1) % 4].bearingDeg + 540) % 360) - 180);
    return Math.abs(difference - 90) > 5;
  })) return null;
  const a = Math.floor(Math.min(edges[0].meters, edges[2].meters) / .3048);
  const b = Math.floor(Math.min(edges[1].meters, edges[3].meters) / .3048);
  return a > 0 && b > 0 ? [Math.max(a,b), Math.min(a,b)] : null;
}

/** Reject a collapsed or crossed outline before it becomes a team decision. */
export function usableOutline(points: Point[]) {
  if (points.length < 3 || points.length > 40 || points.some(p => p.some(n => !Number.isFinite(n) || n < 0 || n > 100))) return false;
  if (new Set(points.map(p => p.join(","))).size !== points.length) return false;
  const cross = (a: Point, b: Point, c: Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const onSegment = (a: Point, b: Point, p: Point) => cross(a,b,p) === 0 && p.every((v,k) => v >= Math.min(a[k],b[k]) && v <= Math.max(a[k],b[k]));
  let twiceArea = 0;
  for (let i=0; i<points.length; i++) {
    const a=points[i], b=points[(i+1)%points.length];
    twiceArea += a[0]*b[1]-a[1]*b[0];
    for (let j=i+2; j<points.length; j++) {
      if (i===0 && j===points.length-1) continue;
      const c=points[j], d=points[(j+1)%points.length];
      if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0 || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b)) return false;
    }
  }
  return Math.abs(twiceArea) >= .02;
}
