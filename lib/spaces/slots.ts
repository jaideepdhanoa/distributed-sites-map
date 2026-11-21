import type { SpaceLayout } from "./vocab";

/** A 9×18 ft stall. The angle is measured from the aisle edge, so 90° is straight in. */
export const STALL_WIDTH_FT = 9;
export const STALL_DEPTH_FT = 18;

const AISLE_FT: Record<"stalls_90" | "stalls_60" | "stalls_45", number> = {
  stalls_90: 24,
  stalls_60: 18,
  stalls_45: 14,
};

/** A pull-through charger bay is the drive path: 12 ft wide and 40 ft deep. */
export const PULL_THROUGH_WIDTH_FT = 12;
export const PULL_THROUGH_DEPTH_FT = 40;

function fit(span: number, module: number): number {
  if (!(span > 0) || !(module > 0)) return 0;
  return Math.floor((span + 1e-6) / module);
}

export function stallFootprint(angleDeg: number): { alongFt: number; depthFt: number } {
  const theta = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return {
    alongFt: STALL_WIDTH_FT / sin,
    depthFt: STALL_DEPTH_FT * sin + STALL_WIDTH_FT * cos,
  };
}

/**
 * Rows run along `lengthFt`. Depth stacks along `widthFt`.
 * A module is one aisle with stalls on one side, or on both sides when the
 * depth can hold two stall rows. A stall row with no aisle counts as zero:
 * the cars cannot reach it.
 */
function stallRows(widthFt: number, depthFt: number, aisleFt: number): number {
  const single = depthFt + aisleFt;
  const double = depthFt * 2 + aisleFt;
  const doubles = fit(widthFt, double);
  const left = widthFt - doubles * double;
  return doubles * 2 + (left + 1e-6 >= single ? 1 : 0);
}

export function estimateSlots(lengthFt: number, widthFt: number, layout: SpaceLayout): number {
  if (layout === "pull_through") {
    return fit(lengthFt, PULL_THROUGH_WIDTH_FT) * fit(widthFt, PULL_THROUGH_DEPTH_FT);
  }
  const angle = layout === "stalls_90" ? 90 : layout === "stalls_60" ? 60 : 45;
  const stall = stallFootprint(angle);
  const along = fit(lengthFt, stall.alongFt);
  if (along < 1) return 0;
  return along * stallRows(widthFt, stall.depthFt, AISLE_FT[layout]);
}

export function spaceRollup(count: number, slots: number, sqft = 0): string {
  if (count <= 0) return "No lots drawn yet";
  const lots = count === 1 ? "1 lot" : `${count.toLocaleString("en-US")} lots`;
  const area = `${Math.max(0, Math.round(sqft)).toLocaleString("en-US")} sq ft`;
  return `${lots} · ${area} · ~${Math.max(0, slots).toLocaleString("en-US")} slots`;
}

export function spaceMapLabel(lengthFt: number, widthFt: number, slots: number): string {
  const feet = `${Math.round(lengthFt)} × ${Math.round(widthFt)} ft`;
  return `${feet} · ~${Math.max(0, slots)}`;
}

export function estimateLabel(count: number, unit: "stall" | "bay"): string {
  const noun = count === 1 ? unit : `${unit}s`;
  return `Estimated · ${count.toLocaleString("en-US")} ${noun}`;
}
