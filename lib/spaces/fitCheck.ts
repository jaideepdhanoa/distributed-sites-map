import { edgeFitRange, fitRange, outlineDimensions, type Aerial, type Zone } from "./options";

export const fitChecks = {
  "inside": "Four fit inside the outline",
  "clearance": "Fourth stall depends on clearance",
  "adjacent": "Four depend on an adjacent aisle",
  "short": "Below four in both layouts",
  "measure": "Measure the footprint",
  "interior": "Check interior bay dimensions",
} as const;
export type FitCheck = keyof typeof fitChecks;
export type ScaleFrame = Pick<Aerial,"bounds"|"width"|"height"|"metersPerPixel">;

export function checkSpaceFit(zone: Zone, frame?: ScaleFrame) {
  const dimensions = outlineDimensions(zone,frame?.bounds,frame);
  const reserve = dimensions ? Math.min(6,dimensions[1]) : 0;
  const inside = dimensions && fitRange(...dimensions,reserve,"stalls_90");
  const adjacent = dimensions && edgeFitRange(...dimensions,reserve,24,"stalls_90");
  const check: FitCheck = zone.kind==="bay" ? "interior" : !inside ? "measure"
    : inside[0]>=4 ? "inside" : inside[1]>=4 ? "clearance" : adjacent && adjacent[1]>=4 ? "adjacent" : "short";
  return {dimensions,inside,adjacent,check};
}
