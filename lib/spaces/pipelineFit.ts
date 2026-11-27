import { areaCounts, assessedCases } from "./assessedMix";
import { checkSpaceFit } from "./fitCheck";
import type { MapSpaceSite } from "./mapCatalog";
import { kinds, type Assessment } from "./options";

export type ChargingFootprint = { stalls: number; condition: string; parcel?:boolean; conversionCost?:number; lostAnnualCash?:number; system?:boolean; operatingConversion?:boolean; parts?:{area:string;stalls:number}[] };
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
    if (assessment?.status === "reviewed") {
      const cases = assessedCases(site.zones,site.frame,assessment);
      const assessed = cases.map(c => {
        const parts=areaCounts(c.rows);
        return {stalls:parts.reduce((total,p)=>total+p.stalls,0),condition:c.name+". "+c.condition,
          system:!!c.system,parcel:true,parts,operatingConversion:!!c.system && parts.some(p=>site.zones.some(z=>z.label===p.area && ["bay","vacuum","apron","storage"].includes(z.kind))),conversionCost:c.conversionCost,lostAnnualCash:c.lostAnnualCash};
      });
      if (assessed.length) {
        const first=assessed[0];
        return {value:rangeText([first.stalls,first.stalls]),basis:"System estimate · "+cases[0].name,
          count:first.stalls,layouts:assessed};
      }
      if (assessment.parcelCases?.length) return pending("Recheck the filed rows and their aisles against the latest outlines");
    }
    const layouts = options.filter(zone=>zone.kind!=="ground").map(zone => ({ zone, fit: checkSpaceFit(zone, site.frame) }))
      .filter(layout => layout.fit.inside != null)
      .sort((a, b) => b.fit.inside![0] - a.fit.inside![0] || b.fit.inside![1] - a.fit.inside![1]
        || (b.fit.adjacent?.[1] ?? 0) - (a.fit.adjacent?.[1] ?? 0));
    const best = layouts[0];
    if (best?.fit.inside) {
      const {inside,adjacent} = best.fit;
      if (inside[1]===0 && !(adjacent && adjacent[1]>0) && (options.some(z=>z.kind==="bay" || z.kind==="ground" || z.fitHold) || assessment?.inventory)) {
        return pending("Zero on the tested outline. Review the remaining areas and access");
      }
      const basis = [kinds[best.zone.kind].label + " outline estimate"];
      if (adjacent && adjacent[1] > inside[1]) basis.push("up to " + adjacent[1] + " with a shared aisle");
      if (best.zone.fitHold === "aisle") basis.push("check aisle access");
      const label = kinds[best.zone.kind].label;
      const layouts: ChargingFootprint[] = [];
      if (inside[0] > 0) layouts.push({ stalls: inside[0], condition: label + (best.zone.fitHold === "aisle" ? " if aisle access is confirmed" : " inside the outline") });
      if (inside[1] > inside[0]) layouts.push({ stalls: inside[1], condition: label + " if clearance and aisle access are confirmed" });
      if (adjacent && adjacent[1] > inside[1]) {
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
