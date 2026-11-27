import { edgeFitRange, fitRange, outlineDimensions, type Aerial, type Zone } from "./options";

export const fitChecks = {
  inside: "Four fit inside the outline",
  clearance: "Fourth stall depends on clearance",
  adjacent: "Four depend on an adjacent aisle",
  short: "Below four in both layouts",
  footprint: "Recheck the mapped footprint",
  aisle: "Verify the aisle route",
  measure: "Measure the footprint",
  interior: "Check interior bay dimensions",
} as const;
export type FitCheck = keyof typeof fitChecks;
export type ScaleFrame = Pick<Aerial, "bounds" | "width" | "height" | "metersPerPixel">;

export function checkSpaceFit(zone: Zone, frame?: ScaleFrame) {
  const dimensions = outlineDimensions(zone, frame?.bounds, frame);
  const reserve = dimensions ? Math.min(6, dimensions[1]) : 0;
  const inside = dimensions && fitRange(...dimensions, reserve, "stalls_90");
  const adjacent = dimensions && zone.fitHold !== "aisle"
    ? edgeFitRange(...dimensions, reserve, 24, "stalls_90") : null;
  let check: FitCheck = "measure";
  if (zone.fitHold === "footprint") check = "footprint";
  else if (zone.kind === "ground") check = "footprint";
  else if (zone.kind === "bay") check = "interior";
  else if (inside) {
    if (inside[0] >= 4) check = "inside";
    else if (inside[1] >= 4) check = "clearance";
    else if (zone.fitHold === "aisle") check = "aisle";
    else if (adjacent && adjacent[1] >= 4) check = "adjacent";
    else check = "short";
  }
  return { dimensions, inside, adjacent, check };
}
