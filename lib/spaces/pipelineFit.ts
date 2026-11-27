import { checkSpaceFit } from "./fitCheck";
import type { MapSpaceSite } from "./mapCatalog";
import { kinds, type Assessment } from "./options";

export type ChargingFootprint = { stalls: number; condition: string };
export type PipelineFit = { value: string; basis: string; count: number | null; layouts?: ChargingFootprint[] };

function rangeText([low, high]: readonly number[]) {
  return (low === high ? String(low) : low + "–" + high) + (high === 1 && low === 1 ? " space" : " spaces");
}

/** Compare alternative footprints separately. They can occupy the same ground. */
export function pipelineFit(site: MapSpaceSite | undefined, assessment: Assessment | undefined, current: boolean,
  recorded: number | null | undefined): PipelineFit {
  const pending = (basis: string): PipelineFit => ({ value: "Needs measurement", basis, count: null });
  if (site && !current) return pending("Check the latest outline");
  if (assessment?.status === "hold") return pending("Confirm the parcel and image");
  if (site) {
    const options = site.zones.filter(zone => zone.kind !== "clear");
    const layouts = options.map(zone => ({ zone, fit: checkSpaceFit(zone, site.frame) }))
      .filter(layout => layout.fit.inside != null)
      .sort((a, b) => b.fit.inside![0] - a.fit.inside![0] || b.fit.inside![1] - a.fit.inside![1]
        || (b.fit.adjacent?.[1] ?? 0) - (a.fit.adjacent?.[1] ?? 0));
    const best = layouts[0];
    if (best?.fit.inside) {
      const { inside, adjacent, check } = best.fit;
      const basis = [kinds[best.zone.kind].label + " outline estimate"];
      if (check === "adjacent" && adjacent) basis.push("up to " + adjacent[1] + " with a shared aisle");
      if (best.zone.fitHold === "aisle") basis.push("check aisle access");
      const label = kinds[best.zone.kind].label;
      const layouts: ChargingFootprint[] = [];
      if (inside[0] > 0) layouts.push({ stalls: inside[0], condition: label + (best.zone.fitHold === "aisle" ? " if aisle access is confirmed" : " inside the outline") });
      if (inside[1] > inside[0]) layouts.push({ stalls: inside[1], condition: label + " if clearance and aisle access are confirmed" });
      if (check === "adjacent" && adjacent && adjacent[1] > inside[1]) {
        layouts.push({ stalls: adjacent[1], condition: label + " with shared aisle access" });
      }
      return { value: rangeText(inside), basis: basis.join(" · "), count: inside[0], layouts };
    }
    if (options.some(zone => zone.kind === "bay")) return pending("Measure the inside of the service bays");
    return pending("Measure the candidate area and its aisle");
  }
  const count = assessment?.recorded ?? recorded;
  if (count != null && count >= 0 && (count > 0 || assessment?.baseline === "recorded")) {
    return { value: rangeText([count, count]), basis: "Earlier workbook estimate", count };
  }
  return pending(assessment?.status === "needs-image" ? "A site plan or aerial is needed" : "No measured layout on file");
}
